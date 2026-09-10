import { SignJWT, exportJWK, generateKeyPair } from "jose"

export const GOOGLE_ISSUER = "https://accounts.google.com"

export async function makeGoogleKeyPair(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true })
  const jwk = await exportJWK(publicKey)
  return { privateKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } as Record<string, unknown> }
}

export function jwksResponse(jwks: unknown[]): Response {
  return new Response(JSON.stringify({ keys: jwks }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  })
}

export async function signGoogleIdToken(
  privateKey: CryptoKey,
  kid: string,
  audience: string,
  overrides: Record<string, unknown> = {},
  { nowSec = Math.floor(Date.now() / 1000), expInSec = 3600 }: { nowSec?: number; expInSec?: number } = {}
): Promise<string> {
  return new SignJWT({
    email: "student@example.com",
    email_verified: true,
    name: "Test Student",
    picture: "https://example.com/pic.jpg",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt(nowSec)
    .setIssuer(GOOGLE_ISSUER)
    .setAudience(audience)
    .setSubject((overrides.sub as string) ?? crypto.randomUUID())
    .setExpirationTime(nowSec + expInSec)
    .sign(privateKey)
}
