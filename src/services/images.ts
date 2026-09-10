// R2 write/read behavior for question and passage images — BANK.md §5-6; images verified from
// actual file bytes, never filename extension or client-supplied MIME header.

import { unzipSync, type UnzipFileInfo } from "fflate"
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  IMAGES_ROUTE_PREFIX,
  MAX_IMAGE_BYTES,
  MAX_ZIP_BYTES,
  MAX_ZIP_INFLATED_BYTES,
} from "../core/config"

export type ExtractedImage = { filename: string; bytes: Uint8Array; contentType: string }
export type RejectedZipEntry = { name: string; accepted: false; reason: string }
export type ZipExtractionResult = {
  malformed: boolean
  images: ExtractedImage[]
  rejected: RejectedZipEntry[]
}

export type ZipExtractionLimits = {
  maxZipBytes?: number
  maxInflatedBytes?: number
  maxImageBytes?: number
}

function isSafeEntryName(name: string): boolean {
  if (name.length === 0) return false
  if (name.endsWith("/")) return false // directory entry
  if (name.startsWith("/")) return false // absolute path
  if (name.includes("\0")) return false
  if (name.split("/").includes("..")) return false // traversal, including nested segments
  return true
}

export function detectImageContentType(bytes: Uint8Array): (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

export function extractImagesFromZip(zipBytes: Uint8Array, limits: ZipExtractionLimits = {}): ZipExtractionResult {
  const maxZipBytes = limits.maxZipBytes ?? MAX_ZIP_BYTES
  const maxInflatedBytes = limits.maxInflatedBytes ?? MAX_ZIP_INFLATED_BYTES
  const maxImageBytes = limits.maxImageBytes ?? MAX_IMAGE_BYTES

  if (zipBytes.byteLength > maxZipBytes) {
    return { malformed: true, images: [], rejected: [] }
  }

  const rejected: RejectedZipEntry[] = []
  const seenNormalizedNames = new Set<string>()
  let cumulativeAcceptedBytes = 0

  const reject = (name: string, reason: string) => {
    rejected.push({ name, accepted: false, reason })
    return false
  }

  let inflated: Record<string, Uint8Array>
  try {
    inflated = unzipSync(zipBytes, {
      filter(file: UnzipFileInfo) {
        const normalized = file.name.toLowerCase()
        if (!isSafeEntryName(file.name)) return reject(file.name, "unsafe entry name")
        if (seenNormalizedNames.has(normalized)) return reject(file.name, "duplicate entry name")
        if (file.originalSize > maxImageBytes) return reject(file.name, "exceeds per-image size limit")
        if (cumulativeAcceptedBytes + file.originalSize > maxInflatedBytes) {
          return reject(file.name, "exceeds total inflated size budget")
        }
        seenNormalizedNames.add(normalized)
        cumulativeAcceptedBytes += file.originalSize
        return true
      },
    })
  } catch {
    return { malformed: true, images: [], rejected: [] }
  }

  const images: ExtractedImage[] = []
  for (const [name, bytes] of Object.entries(inflated)) {
    const contentType = detectImageContentType(bytes)
    if (!contentType) {
      reject(name, "not a recognized JPEG/PNG/WebP image")
      continue
    }
    images.push({ filename: name, bytes, contentType })
  }

  return { malformed: false, images, rejected }
}

// Flat (no slash) so the key is safe inside the fixed `/api/images/:key` route, but still
// prefix-listable by import for best-effort bulk cleanup after a failed/reverted import.
export function generateImageKey(importId: string): string {
  return `${importId}-${crypto.randomUUID()}`
}

export function imageKeyPrefix(importId: string): string {
  return `${importId}-`
}

export function imageUrl(key: string): string {
  return `${IMAGES_ROUTE_PREFIX}/${encodeURIComponent(key)}`
}

export async function uploadImage(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  await bucket.put(key, bytes, { httpMetadata: { contentType } })
}

export async function getImage(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key)
}

export async function deleteImage(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key)
}

export async function deleteImagesByPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined
  do {
    const listed: R2Objects = await bucket.list({ prefix, cursor })
    if (listed.objects.length > 0) {
      await bucket.delete(listed.objects.map((object) => object.key))
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
}
