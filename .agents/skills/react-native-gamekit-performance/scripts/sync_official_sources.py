#!/usr/bin/env python3
"""Download the official Markdown files used by the GameKit performance skill."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parent.parent
MANIFEST_PATH = SKILL_DIR / "references" / "source-manifest.json"
USER_AGENT = "react-native-gamekit-doc-sync/1.0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Download pinned official Skia, Reanimated, and Worklets docs into "
            "a new directory for review."
        )
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="A new directory to create for downloaded source files.",
    )
    parser.add_argument(
        "--latest",
        action="store_true",
        help="Use each repository's default branch instead of its pinned revision.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="Network timeout per file in seconds (default: 20).",
    )
    return parser.parse_args()


def load_manifest() -> dict[str, Any]:
    with MANIFEST_PATH.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict) or not isinstance(value.get("repositories"), list):
        raise ValueError(f"Invalid source manifest: {MANIFEST_PATH}")
    return value


def repository_slug(repository_url: str) -> str:
    prefix = "https://github.com/"
    if not repository_url.startswith(prefix):
        raise ValueError(f"Unsupported repository URL: {repository_url}")
    return repository_url.removeprefix(prefix).removesuffix(".git")


def download(url: str, destination: Path, timeout: float) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return len(payload)


def sync_repository(
    repository: dict[str, Any], output: Path, latest: bool, timeout: float
) -> dict[str, Any]:
    name = str(repository["name"])
    revision = (
        str(repository["default_branch"]) if latest else str(repository["revision"])
    )
    slug = repository_slug(str(repository["url"]))
    files = repository.get("files")
    if not isinstance(files, list):
        raise ValueError(f"Invalid file list for {name}")

    downloaded: list[dict[str, Any]] = []
    for source_path_value in files:
        source_path = str(source_path_value)
        raw_url = f"https://raw.githubusercontent.com/{slug}/{revision}/{source_path}"
        destination = output / name / source_path
        byte_count = download(raw_url, destination, timeout)
        downloaded.append(
            {"path": source_path, "url": raw_url, "bytes": byte_count}
        )
        print(f"downloaded {name}/{source_path} ({byte_count} bytes)")

    return {
        "name": name,
        "repository": repository["url"],
        "revision": revision,
        "files": downloaded,
    }


def main() -> int:
    args = parse_args()
    output = args.output.expanduser().resolve()
    if output.exists():
        print(f"error: output directory already exists: {output}", file=sys.stderr)
        return 2

    try:
        manifest = load_manifest()
        output.mkdir(parents=True, exist_ok=False)
        results = [
            sync_repository(repository, output, args.latest, args.timeout)
            for repository in manifest["repositories"]
        ]
        record = {
            "manifest_retrieved_at": manifest.get("retrieved_at"),
            "used_latest_branches": args.latest,
            "repositories": results,
        }
        with (output / "SOURCE_INFO.json").open("w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2)
            handle.write("\n")
    except (OSError, ValueError, KeyError, urllib.error.URLError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(f"source snapshot written to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
