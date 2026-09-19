/**
 * The vendored token-theme-kit is a COPY. A fix belongs in the kit's own repo,
 * then tools/vendor-kit.py is re-run; an edit made here would be silently
 * overwritten by the next copy, and would never reach the kit's other users.
 *
 *   node --test panel/test/vendor.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const dir = fileURLToPath(new URL("../../vendor/token-theme-kit/", import.meta.url));
const record = JSON.parse(readFileSync(join(dir, "VENDORED.json"), "utf8"));

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [relative(dir, p).split(sep).join("/")];
});

// RED IF: a vendored file is edited in place, one goes missing, or one is added
// that the copy did not make.
test("the vendored kit is exactly what tools/vendor-kit.py copied", () => {
  for (const [rel, sha] of Object.entries(record.files)) {
    assert.equal(createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex"), sha, rel);
  }
  assert.deepEqual(walk(dir).filter((f) => f !== "VENDORED.json").sort(), Object.keys(record.files).sort());
});

test("the kit's MIT licence travels with the copy, and the copy says where it came from", () => {
  assert.equal(record.license, "MIT");
  assert.match(readFileSync(join(dir, "LICENSE"), "utf8"), /MIT License/);
  assert.match(record.commit, /^[0-9a-f]{40}$/);
});
