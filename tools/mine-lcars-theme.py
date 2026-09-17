#!/usr/bin/env python3
"""Mine an ha-lcars theme file into token-theme-kit data.

The theme file is one shared base (palette, shape, type, HA mappings) plus a set of
themes that each assign palette colours to a small number of ROLES. This tool
separates the two:

  palette.json      every named colour in the base block
  core-tokens.json  token-theme-kit groups for the roles, shape and type, with
                    defaults resolved from one chosen theme
  presets.json      every theme's resolved role values, its dark-mode overrides,
                    and a contrast check of each text/background pair

Derived values (sidebar, header, the ha-color scales, rgb-* mirrors) are NOT tokens:
the dashboard derives them from the roles.

Usage:
  python tools/mine-lcars-theme.py <path/to/lcars.yaml> [--defaults "LCARS Transporter"] [--out tokens/lcars]

The theme file path is required on purpose; this repo does not record where it lives.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

import yaml

# Role tokens: (group, key, css variable, paired background key for a contrast check)
ROLE_TOKENS = [
    ("roles", "ui-primary", "--lcars-ui-primary", None),
    ("roles", "ui-primary-text", "--lcars-ui-primary-text", "ui-primary"),
    ("roles", "ui-secondary", "--lcars-ui-secondary", None),
    ("roles", "ui-secondary-text", "--lcars-ui-secondary-text", "ui-secondary"),
    ("roles", "ui-tertiary", "--lcars-ui-tertiary", None),
    ("roles", "ui-tertiary-text", "--lcars-ui-tertiary-text", "ui-tertiary"),
    ("roles", "ui-quaternary", "--lcars-ui-quaternary", None),
    ("roles", "ui-quaternary-text", "--lcars-ui-quaternary-text", "ui-quaternary"),
    ("roles", "ui-accent", "--lcars-ui-accent-color", None),
    ("roles", "ui-accent-text", "--lcars-ui-accent-text", "ui-accent"),
    ("roles", "background", "--lcars-background-color", None),
    ("roles", "background-text", "--lcars-background-text", "background"),
    ("card", "card-top", "--lcars-card-top-color", None),
    ("card", "card-top-text", "--lcars-card-top-text", "card-top"),
    ("card", "card-mid", "--lcars-card-mid-color", None),
    ("card", "card-mid-text", "--lcars-card-mid-text", "card-mid"),
    ("card", "card-button", "--lcars-card-button-color", None),
    ("card", "card-button-text", "--lcars-card-button-text", "card-button"),
    ("card", "card-bottom", "--lcars-card-bottom-color", None),
    ("card", "card-bottom-text", "--lcars-card-bottom-text", "card-bottom"),
    ("card", "settings-card", "--lcars-settings-card-color", None),
    ("status", "success", "--success-color", "background"),
    ("status", "warning", "--warning-color", "background"),
    ("status", "error", "--error-color", "background"),
]
GROUP_LABELS = {"roles": "Frame roles", "card": "Card regions", "status": "Status",
                "shape": "Frame shape", "type": "Type"}
SHAPE_TOKENS = [  # (key, css variable) — px lengths in the base block
    ("vertical-border", "--lcars-vertical-border"),
    ("horizontal-border", "--lcars-horizontal-border"),
    ("outer-radius", "--lcars-outer-radius"),
    ("inner-radius", "--lcars-inner-radius"),
]
TYPE_TOKENS = [("font", "--lcars-font"), ("fallback-font", "--lcars-fallback-font")]

HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
VAR = re.compile(r"^var\(--([\w-]+)\)$")


def norm_hex(v: str) -> str | None:
    m = HEX.match(v.strip())
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h.lower()


def resolve(theme: dict, value, depth: int = 0):
    """Follow var(--x) references inside one theme until a non-reference value."""
    v = str(value).strip()
    m = VAR.match(v)
    if m and depth < 16 and m.group(1) in theme:
        return resolve(theme, theme[m.group(1)], depth + 1)
    return v


def palette_name(theme: dict, value) -> str | None:
    """The last named palette colour in a reference chain, e.g. 'lcars-navy-gray'."""
    v, name = str(value).strip(), None
    for _ in range(16):
        m = VAR.match(v)
        if not m or m.group(1) not in theme:
            break
        name, v = m.group(1), str(theme[m.group(1)]).strip()
    return name if name and norm_hex(v) else None


def luminance(hex_: str) -> float:
    rgb = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("theme_file")
    ap.add_argument("--defaults", default="LCARS Transporter", help="theme whose values seed the token defaults")
    ap.add_argument("--out", default=os.path.join("tokens", "lcars"))
    args = ap.parse_args()

    with open(args.theme_file, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    names = list(doc)
    base_blocks = [n for n in names if n.startswith("(DO NOT USE")]
    themes = [n for n in names if n not in base_blocks]
    variables = doc[base_blocks[0]] or {}
    if args.defaults not in themes:
        sys.exit("--defaults %r is not a theme in this file" % args.defaults)

    palette = {k: norm_hex(str(v)) for k, v in variables.items() if norm_hex(str(v))}

    def role_values(theme: dict) -> dict:
        out = {}
        for group, key, css, _pair in ROLE_TOKENS:
            raw = theme.get(css[2:])
            if raw is None:
                continue
            hx = norm_hex(resolve(theme, raw))
            out[key] = {"value": hx or resolve(theme, raw), "source": str(raw),
                        "palette": palette_name(theme, raw)}
        return out

    presets = {}
    for t in themes:
        th = doc[t] or {}
        roles = role_values(th)
        modes = {}
        for mode, over in ((th.get("modes") or {}).items()):
            merged = dict(th)
            merged.update(over or {})
            changed = {k: v for k, v in role_values(merged).items() if roles.get(k, {}).get("value") != v["value"]}
            if changed:
                modes[mode] = changed
        checks = []
        for group, key, css, pair in ROLE_TOKENS:
            if not pair or key not in roles or pair not in roles:
                continue
            fg, bg = roles[key]["value"], roles[pair]["value"]
            if norm_hex(fg) and norm_hex(bg):
                r = round(contrast(fg, bg), 2)
                checks.append({"text": key, "on": pair, "ratio": r,
                               "verdict": "ok" if r >= 4.5 else "large-text-only" if r >= 3 else "FAIL"})
        presets[t] = {"roles": roles, "modes": modes, "contrast": checks}

    defaults = presets[args.defaults]["roles"]
    groups, by_group = [], {}
    for group, key, css, _pair in ROLE_TOKENS:
        tok = {"key": key, "type": "color", "cssVar": css}
        if key in defaults and norm_hex(defaults[key]["value"]):
            tok["default"] = defaults[key]["value"]
            if defaults[key]["palette"]:
                tok["palette"] = defaults[key]["palette"]
        by_group.setdefault(group, []).append(tok)
    for key, css in SHAPE_TOKENS:
        v = str(variables.get(css[2:], "")).strip()
        m = re.fullmatch(r"(-?\d+(?:\.\d+)?)px", v)
        tok = {"key": key, "type": "number", "unit": "px", "cssVar": css, "min": 0, "max": 80, "step": 1}
        if m:
            tok["default"] = float(m.group(1)) if "." in m.group(1) else int(m.group(1))
        by_group.setdefault("shape", []).append(tok)
    for key, css in TYPE_TOKENS:
        by_group.setdefault("type", []).append(
            {"key": key, "type": "raw", "cssVar": css, "default": str(variables.get(css[2:], ""))})
    for gid in ("roles", "card", "status", "shape", "type"):
        groups.append({"id": "lcars-" + gid, "label": GROUP_LABELS[gid], "tokens": by_group[gid]})

    os.makedirs(args.out, exist_ok=True)
    meta = {"generated_by": "tools/mine-lcars-theme.py", "defaults_from": args.defaults,
            "themes": len(themes)}
    for fname, payload in (("palette.json", {"meta": meta, "palette": palette}),
                           ("core-tokens.json", {"meta": meta, "groups": groups}),
                           ("presets.json", {"meta": meta, "presets": presets})):
        with open(os.path.join(args.out, fname), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(payload, fh, indent=1, ensure_ascii=False)
            fh.write("\n")

    ntok = sum(len(g["tokens"]) for g in groups)
    print("%d themes, %d palette colours, %d core tokens in %d groups -> %s"
          % (len(themes), len(palette), ntok, len(groups), args.out))
    fails = [(t, c) for t, p in presets.items() for c in p["contrast"] if c["verdict"] == "FAIL"]
    print("contrast FAIL pairs: %d" % len(fails))
    for t, c in fails:
        print("  %-36s %-18s on %-14s %.2f" % (t, c["text"], c["on"], c["ratio"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
