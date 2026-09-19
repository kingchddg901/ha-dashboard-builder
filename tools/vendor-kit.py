"""Copy token-theme-kit's source into vendor/token-theme-kit/.

The panel ships with no bundler: deploy.py copies the repo's trees to /local
as they are, so the kit has to be inside the tree to be importable. It is
copied, never edited here - a fix belongs in the kit's own repo, then this is
re-run. VENDORED.json records the commit and a hash of every file, and
panel/test/vendor.test.mjs goes red if a vendored file is edited in place.

The kit is MIT: its LICENSE travels with the copy.

    python tools/vendor-kit.py [path-to-token-theme-kit]
"""

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEST = REPO / "vendor" / "token-theme-kit"
DEFAULT_KIT = REPO.parent / "token-theme-kit"


def git(kit: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(kit), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def main() -> int:
    kit = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_KIT
    if not (kit / "src" / "kit.js").is_file():
        raise SystemExit(f"no token-theme-kit at {kit}")
    dirty = git(kit, "status", "--porcelain", "--", "src", "LICENSE")
    if dirty:
        raise SystemExit(f"the kit has uncommitted changes - commit them there first:\n{dirty}")

    files = sorted(p for p in (kit / "src").rglob("*.js"))
    if DEST.exists():
        shutil.rmtree(DEST)
    hashes = {}
    for src in files + [kit / "LICENSE"]:
        rel = src.relative_to(kit).as_posix()
        out = DEST / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        data = src.read_bytes()
        out.write_bytes(data)
        hashes[rel] = hashlib.sha256(data).hexdigest()

    record = {
        "source": git(kit, "remote", "get-url", "origin"),
        "commit": git(kit, "rev-parse", "HEAD"),
        "license": "MIT",
        "files": hashes,
    }
    (DEST / "VENDORED.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(f"vendored {len(hashes)} files from {record['commit'][:7]} -> {DEST.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
