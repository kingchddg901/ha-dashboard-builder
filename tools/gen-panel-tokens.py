"""Write panel/token-groups.js from tokens/lcars/core-tokens.json.

The browser cannot import the JSON directly on every device the panel runs on,
so the groups are written out as a module. They are token-theme-kit token
groups as they stand - the theme tab's editor builds one control per token from
them - plus a readable label for each token. panel/test/theme-core.test.mjs
holds the module to the JSON, so re-run this after tools/mine-lcars-theme.py.

    python tools/gen-panel-tokens.py
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "tokens" / "lcars" / "core-tokens.json"
OUT = REPO / "panel" / "token-groups.js"
KEEP = ("key", "type", "cssVar", "default", "unit", "min", "max", "step")


def label(key: str) -> str:
    words = ["UI" if w == "ui" else w for w in key.split("-")]
    return " ".join([words[0][:1].upper() + words[0][1:], *words[1:]])


def main() -> int:
    core = json.loads(SRC.read_text(encoding="utf-8"))
    groups = []
    for g in core["groups"]:
        tokens = [{**{k: t[k] for k in KEEP if k in t}, "label": label(t["key"])} for t in g["tokens"]]
        groups.append({"id": g["id"], "label": g["label"], "tokens": tokens})
    body = ",\n".join("  " + json.dumps(g, ensure_ascii=False) for g in groups)
    OUT.write_text(
        "/**\n"
        " * The panel's theme tokens as token-theme-kit groups - generated from\n"
        " * ../tokens/lcars/core-tokens.json by tools/gen-panel-tokens.py; do not edit.\n"
        " * The theme tab's editor builds one control per token from these.\n"
        " */\n\n"
        f"export const TOKEN_GROUPS = [\n{body},\n];\n",
        encoding="utf-8", newline="\n")
    print(f"{OUT.relative_to(REPO)}: {sum(len(g['tokens']) for g in groups)} tokens in {len(groups)} groups")
    return 0


if __name__ == "__main__":
    sys.exit(main())
