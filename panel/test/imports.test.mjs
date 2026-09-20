/**
 * Every shared helper a file CALLS, that file must IMPORT.
 *
 * This repo has no linter and no dependencies, so the one thing a build step
 * would catch for free - a name used and never imported - is caught here
 * instead. `node --check` sees only syntax, and the suite never mounts a card,
 * so a helper called inside a render method stays invisible until the browser
 * throws "x is not defined" and the tile renders as an error. That is exactly
 * how `sentence()` reached the preview unimported in the room card.
 *
 *   node --test panel/test/imports.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "vendor" && name !== "test" && name !== "node_modules") walk(p, out);
    } else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

const files = [...walk(path.join(ROOT, "panel")), ...walk(path.join(ROOT, "cards"))];
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

/** What each shared core module offers: `export function x` / `export const x`. */
const shared = new Map();      // name -> the file that defines it
for (const [file, text] of source) {
  if (!file.endsWith("-core.js")) continue;
  for (const m of text.matchAll(/^export (?:async )?function (\w+)|^export const (\w+)\s*=/gm)) {
    shared.set(m[1] || m[2], file);
  }
}

// RED IF: a file calls a shared helper it never imported. Proven to bite - it
// is the bug this file was written for, and removing the `sentence` import from
// va-room-card.js turns it red again.
test("every shared helper a file calls is imported by that file", () => {
  const missing = [];
  for (const [file, text] of source) {
    const body = text.replace(/^import[\s\S]*?from\s*["'][^"']+["'];/gm, "");   // the call sites only
    const imported = new Set();
    for (const m of text.matchAll(/^import\s*\{([^}]*)\}\s*from/gm)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) imported.add(name);
      }
    }
    for (const [name, definedIn] of shared) {
      if (definedIn === file || imported.has(name)) continue;
      // its own local definition of the same name is not a missing import
      if (new RegExp(`(?:function|const|let|class)\\s+${name}\\b`).test(body)) continue;
      if (new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(body)) {
        missing.push(`${path.relative(ROOT, file)} calls ${name}() from ${path.relative(ROOT, definedIn)}`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});

// RED IF: a module does not parse or does not load. The suite tests cores, and
// nothing imports the ELEMENTS, so a broken panel or card reached the browser
// twice in one day: a helper used without importing it, and a back-tick typed
// inside the CSS template literal, which ended the string and made the rest of
// the file nonsense. `node --check` misses the second - it parses as a script,
// and the browser parses as a module. Actually importing catches both.
test("every panel and card module parses and loads as a module", async () => {
  const saved = { ...globalThis };
  const el = () => ({ style: { setProperty() {}, removeProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, appendChild: (c) => c, append() {},
    replaceChildren() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    querySelectorAll: () => [], remove() {}, focus() {}, attachShadow() { return el(); } });
  globalThis.HTMLElement = class { constructor() { this.isConnected = false; } attachShadow() { return el(); }
    addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
    setAttribute() {} getAttribute() { return null; } };
  globalThis.customElements = { define() {}, get: () => undefined, whenDefined: async () => {} };
  globalThis.document = { createElement: () => el(), addEventListener() {}, removeEventListener() {},
    documentElement: el(), body: el() };
  globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  globalThis.CustomEvent = class { constructor(t, i) { this.type = t; Object.assign(this, i); } };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => "" });
  globalThis.CSS = { escape: (s) => s };
  try {
    const failed = [];
    for (const file of files) {
      // loader.js FETCHES current.json as it loads - that is its whole job, so
      // it cannot be imported off the box. Its own guard is db31/race.html.
      if (path.basename(file) === "loader.js") continue;
      try { await import(pathToFileURL(file).href); } catch (e) { failed.push(`${path.relative(ROOT, file)}: ${e.message}`); }
    }
    assert.deepEqual(failed, [], failed.join("\n"));
  } finally {
    for (const k of ["HTMLElement", "customElements", "document", "window", "CustomEvent", "ResizeObserver",
      "getComputedStyle", "CSS"]) { if (!(k in saved)) delete globalThis[k]; else globalThis[k] = saved[k]; }
  }
});

// RED IF: the check above is looking at nothing - an empty file list or an
// empty helper set would pass it silently for the rest of the project's life.
test("the check has files and helpers to look at", () => {
  assert.ok(files.length > 15, `only ${files.length} files`);
  assert.ok(shared.size > 30, `only ${shared.size} shared helpers`);
  assert.ok(shared.has("sentence") && shared.has("speedControl"));
});
