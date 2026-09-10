#!/usr/bin/env python3
"""Validate structural and citation invariants of Quizzer backend task packets."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SECTION_PATTERN = re.compile(r"^## (\d+)\. ", re.MULTILINE)
CITATION_PATTERN = re.compile(
    r"`(?P<path>[A-Za-z0-9_./ -]+\.[A-Za-z0-9_-]+):(?P<start>\d+)"
    r"(?:-(?P<end>\d+))?`"
)
REQUIRED_QA_HEADINGS = (
    "#### Backend / API",
    "#### Frontend / UI",
    "#### Chrome DevTools / extension verification",
    "#### Operator-executed",
)
END_PATTERN = re.compile(r"End of Codex Task Packet — `claude-task--\d{3}`")


def packet_paths(root: Path, arguments: list[str]) -> list[Path]:
    if arguments:
        return [(root / argument).resolve() for argument in arguments]

    return sorted(root.glob("todos/sprint */claude-task--*.md"))


def validate_citations(root: Path, text: str) -> list[str]:
    errors: list[str] = []

    for match in CITATION_PATTERN.finditer(text):
        relative_path = match.group("path")
        cited_path = root / relative_path
        start = int(match.group("start"))
        end = int(match.group("end") or start)

        if not cited_path.is_file():
            errors.append(f"citation target does not exist: {relative_path}")
            continue

        line_count = len(cited_path.read_text(encoding="utf-8").splitlines())
        if start < 1 or end < start or end > line_count:
            errors.append(
                f"citation out of bounds: {relative_path}:{start}-{end} "
                f"(file has {line_count} lines)"
            )

    return errors


def validate_packet(root: Path, path: Path) -> list[str]:
    if not path.is_file():
        return [f"{path}: packet does not exist"]

    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    try:
        label = path.relative_to(root)
    except ValueError:
        label = path

    if not re.match(r"^# claude-task--\d{3}:", text):
        errors.append("missing canonical claude-task header")

    sections = [int(value) for value in SECTION_PATTERN.findall(text)]
    if sections != list(range(1, 13)):
        errors.append(f"numbered sections must be exactly 1..12; found {sections}")

    for heading in REQUIRED_QA_HEADINGS:
        if heading not in text:
            errors.append(f"missing mandatory QA heading: {heading}")

    if not END_PATTERN.search(text):
        errors.append("missing canonical end marker")

    if "archive/backend-specs" in text:
        errors.append("packet cites or references the excluded archived generation")

    errors.extend(validate_citations(root, text))

    if not CITATION_PATTERN.search(text):
        errors.append("no path:line citations found")

    return [f"{label}: {error}" for error in errors]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("packets", nargs="*", help="packet paths relative to repository root")
    arguments = parser.parse_args()
    root = Path.cwd().resolve()
    paths = packet_paths(root, arguments.packets)

    if not paths:
        print("No active task packets found.", file=sys.stderr)
        return 1

    errors = [error for path in paths for error in validate_packet(root, path)]
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    print(f"Validated {len(paths)} task packet(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
