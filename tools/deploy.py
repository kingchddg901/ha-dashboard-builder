"""Deploy the cards and the panel to Home Assistant as ONE versioned tree.

    python tools/deploy.py            # deploy, verify, switch, repoint resources
    python tools/deploy.py --dry-run  # say what would happen, touch nothing

Why versioned: HA serves /local with `Cache-Control: public, max-age=2678400`
(31 days, measured 2026-09-19). A `?v=` on a card's entry file refreshes that
file only; every module it imports keeps its cached copy, so a new card can run
against a month-old core. So each deploy is copied whole into its own directory
(`v7/cards/...`, `v7/panel/...`, mirroring the repo so relative imports
resolve), where every URL is new. Then:

  1. every copied file is fetched back over HTTP and compared byte for byte;
  2. `current.json` is switched to the new version - LAST, so a half-copied
     tree is never live;
  3. the Lovelace resources for the cards are repointed at the new directory,
     and the loader resource (for the panel) is added if missing.

`panel/loader.js` is the one stable file, at the top level: panel_custom's
module_url lives in YAML and cannot change without a restart, so the loader
reads `current.json` past the cache and imports the current tree.

Old version directories are left in place; nothing is deleted.
"""
import argparse
import asyncio
import json
import os
import pathlib
import re
import shutil
import sys
import urllib.request

REPO = pathlib.Path(__file__).resolve().parents[1]
WWW = pathlib.Path(os.environ.get("DB_WWW", r"\\192.168.4.104\config\www\dashboard-builder"))
HA = os.environ.get("DB_HA", "192.168.4.104:8123")
TOKEN_FILE = os.environ.get("HA_TOKEN_FILE", r"C:\Users\CKing\Documents\claude use only.txt")
URL_BASE = "/local/dashboard-builder"
TREES = ("cards", "panel", "vendor")
CARDS = ("appliance-card", "tv-card", "builder-debug-card", "samsung-tvplus-card")
CARD_URL = re.compile(r"^/local/dashboard-builder/(?:v\d+/cards/)?(?P<card>[a-z-]+)/(?P=card)\.js(?:\?.*)?$")
LOADER_URL = f"{URL_BASE}/loader.js"


def shipped_files():
    """Every .js under the shipped trees, minus tests - plus each vendored
    package's LICENSE, which the MIT licence requires to travel with every copy."""
    for tree in TREES:
        for p in sorted((REPO / tree).rglob("*")):
            rel = p.relative_to(REPO)
            if not p.is_file() or not (p.suffix == ".js" or (tree == "vendor" and p.name == "LICENSE")):
                continue
            if "test" in rel.parts or rel.as_posix() == "panel/loader.js":
                continue
            yield rel


def current_version():
    try:
        v = json.loads((WWW / "current.json").read_text(encoding="utf-8"))["version"]
        return int(v[1:])
    except (FileNotFoundError, KeyError, ValueError):
        found = [int(d.name[1:]) for d in WWW.glob("v*") if d.is_dir() and d.name[1:].isdigit()]
        return max(found, default=0)


def fetch(url_path):
    with urllib.request.urlopen(f"http://{HA}{url_path}", timeout=15) as r:
        return r.read()


def token():
    with open(TOKEN_FILE, encoding="utf-8-sig") as fh:
        return fh.read().strip().splitlines()[-1].strip()


async def ws(commands):
    import websockets  # only needed for the resource step
    out = []
    async with websockets.connect(f"ws://{HA}/api/websocket", max_size=8 << 20) as sock:
        await sock.recv()
        await sock.send(json.dumps({"type": "auth", "access_token": token()}))
        if json.loads(await sock.recv()).get("type") != "auth_ok":
            raise SystemExit("auth failed")
        for i, cmd in enumerate(commands, 1):
            await sock.send(json.dumps({"id": i, **cmd}))
            while True:
                msg = json.loads(await sock.recv())
                if msg.get("id") == i and msg.get("type") == "result":
                    if not msg.get("success"):
                        raise SystemExit(f"{cmd['type']} failed: {msg.get('error')}")
                    out.append(msg.get("result"))
                    break
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = list(shipped_files())
    prev = current_version()
    ver = f"v{prev + 1}"
    dest = WWW / ver
    print(f"{len(files)} files -> {dest}  (current: v{prev})")
    if args.dry_run:
        for f in files:
            print("  ", f.as_posix())
        return

    if dest.exists():
        raise SystemExit(f"{dest} already exists - refusing to overwrite a deployed version")
    for rel in files:
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(REPO / rel, dest / rel)

    bad = [rel for rel in files if fetch(f"{URL_BASE}/{ver}/{rel.as_posix()}") != (REPO / rel).read_bytes()]
    if bad:
        raise SystemExit(f"served copy differs for {[b.as_posix() for b in bad]} - NOT switching")
    print(f"verified {len(files)} files over HTTP")

    loader = (REPO / "panel" / "loader.js").read_bytes()
    if not (WWW / "loader.js").exists() or (WWW / "loader.js").read_bytes() != loader:
        (WWW / "loader.js").write_bytes(loader)
        print("loader.js written (browsers may keep an older copy for up to 31 days)")

    (WWW / "current.json").write_text(json.dumps({"version": ver}) + "\n", encoding="utf-8")
    served = json.loads(urllib.request.urlopen(
        urllib.request.Request(f"http://{HA}{URL_BASE}/current.json", headers={"Cache-Control": "no-cache"}),
        timeout=15).read())
    if served.get("version") != ver:
        raise SystemExit(f"current.json serves {served} - expected {ver}")
    print(f"current.json -> {ver}")

    resources = asyncio.run(ws([{"type": "lovelace/resources"}]))[0]
    cmds = []
    for r in resources:
        m = CARD_URL.match(r["url"])
        if m and m["card"] in CARDS:
            url = f"{URL_BASE}/{ver}/cards/{m['card']}/{m['card']}.js"
            if r["url"] != url:
                cmds.append({"type": "lovelace/resources/update", "resource_id": r["id"], "res_type": "module", "url": url})
    if not any(r["url"].split("?")[0] == LOADER_URL for r in resources):
        cmds.append({"type": "lovelace/resources/create", "res_type": "module", "url": LOADER_URL})
    if cmds:
        asyncio.run(ws(cmds))
    for c in cmds:
        print(f"resource {c['type'].split('/')[-1]}: {c['url']}")
    print(f"deployed {ver}")


if __name__ == "__main__":
    sys.exit(main())
