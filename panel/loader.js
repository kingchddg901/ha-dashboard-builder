/**
 * The one STABLE file - deployed to /local/dashboard-builder/loader.js and
 * never versioned, because panel_custom's module_url lives in YAML and changing
 * it costs a restart.
 *
 * Why the rest IS versioned: HA serves /local with `Cache-Control: max-age=
 * 2678400` (31 days, measured 2026-09-19). A `?v=` on an entry file refreshes
 * that file only - every module it imports keeps its cached copy, so a new card
 * can run against a month-old core. Each deploy therefore goes into its own
 * directory (v1/, v2/, ...) where every URL is new, and this loader asks - past
 * the cache - which directory is current.
 *
 * Keep this file tiny and boring: a browser may hold an old copy of it for a
 * month too.
 */

const base = new URL(".", import.meta.url);
const res = await fetch(new URL("current.json", base), { cache: "no-store" });
if (!res.ok) throw new Error(`dashboard-builder: current.json ${res.status}`);
const { version } = await res.json();
if (!/^v\d+$/.test(String(version))) throw new Error(`dashboard-builder: bad version ${version}`);
await import(new URL(`${version}/panel/dashboard-panel.js`, base).href);
