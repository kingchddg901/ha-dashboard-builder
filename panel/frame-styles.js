/**
 * How each frame draws the panel's structure - one stylesheet block per frame,
 * appended to the panel's own. The panel's base rules ARE the LCARS frame; every
 * other frame's rules select on `:host([data-frame="<name>"])`, so none of them
 * reach any other frame. Colours always come from the tokens - a frame decides
 * shape, line and texture, a theme decides colour.
 *
 * Which tokens a frame does not draw with is declared in ./panel-tokens.js
 * (FRAMES[].skips), measured by setting each token in each frame and checking
 * what changes on screen.
 */

import { GRAIN } from "./cockpit-art.js";

const F = (frame) => `:host([data-frame="${frame}"])`;

/* The same structure without the LCARS elbow joint and blocks - most frames start here. */
const noElbow = (f) => `
  ${F(f)} .elbow { background: transparent; border-top-left-radius: 0; }
  ${F(f)} .elbow::after { display: none; }
  ${F(f)} .bar { align-items: center; }
  ${F(f)} .rail-fill { background: transparent; border-bottom-left-radius: 0; }`;

/* Words as written, not LCARS capitals. */
const asWritten = (f) => `
  ${F(f)} .title, ${F(f)} .tab, ${F(f)} .tile-bar, ${F(f)} .row-title, ${F(f)} .sheet-bar,
  ${F(f)} .btn, ${F(f)} .shelf-head, ${F(f)} .area-head, ${F(f)} .grab, ${F(f)} .shelve { text-transform: none; letter-spacing: .01em; }`;

/* Tabs as a list: left-aligned, one line, no block height. */
const listTabs = (f) => `
  ${F(f)} .tab { text-align: left; justify-content: flex-start; align-items: center; min-height: 40px; }`;

/* ------------------------------------------------------------- cockpit */

const COCKPIT = `
  /* ---------------------------------------------------------- cockpit frame
     A fighter's cockpit, not LCARS recoloured: no elbow, no band running into
     the title. The top is a GLARE SHIELD - one console plate across the full
     width, lower corners cut away, the time and the name housed together in a
     recessed instrument cluster in the middle. The rail is a SIDE CONSOLE of its
     own, its tabs backlit keys with a lamp. Tiles are FACETED PLATES: two
     corners cut, the edge drawn along the cut, screws in the other two. Chosen
     by the \`frame\` token; nothing here reaches the LCARS frame. Colours still
     come from the tokens. */
  :host([data-frame="cockpit"]) {
    /* Controls sit on the tile's surface, a step above the ground, so the cards'
       control fill and dividers are mixed from THAT surface - mixed from the
       ground they land on the surface exactly and vanish. VA's Black One recipe:
       warm text at ~8% for a control, ~17% for an edge. */
    --secondary-background-color: color-mix(in srgb, var(--db-text) 8%, var(--db-surface));
    --divider-color: color-mix(in srgb, var(--db-text) 17%, var(--db-surface));
    --db-lamp-off: color-mix(in srgb, var(--db-text) 16%, var(--db-bg));
    --db-screw: color-mix(in srgb, var(--db-text) 24%, var(--db-surface));
    --db-glow: color-mix(in srgb, var(--db-active) 55%, transparent);
    --db-recess: color-mix(in srgb, #000 65%, var(--db-bg));
    /* One light (the Light tokens, painted as --db-lx/--db-ly, a unit vector toward
       it, and --db-light-k, its strength): the plate's sheen falls from it, the
       edge facing it catches it, the edge facing away is dark. */
    --db-plate-lit: linear-gradient(calc(var(--db-light-deg, 0) * 1deg + 180deg),
      color-mix(in srgb, var(--db-text) calc(var(--db-light-k, .6) * 10%), transparent), transparent 55%);
    --db-plate-edge:
      inset calc(var(--db-lx, 0) * -1px) calc(var(--db-ly, -1) * -1px) 0 color-mix(in srgb, var(--db-text) calc(var(--db-light-k, .6) * 17%), transparent),
      inset calc(var(--db-lx, 0) * 1px) calc(var(--db-ly, -1) * 1px) 0 rgba(0, 0, 0, calc(var(--db-light-k, .6)));
    --db-key-edge:
      inset calc(var(--db-lx, 0) * -1px) calc(var(--db-ly, -1) * -1px) 0 color-mix(in srgb, var(--db-text) calc(var(--db-light-k, .6) * 15%), transparent),
      inset calc(var(--db-lx, 0) * 2px) calc(var(--db-ly, -1) * 2px) 0 rgba(0, 0, 0, calc(var(--db-light-k, .6) * .75)),
      calc(var(--db-lx, 0) * -1px) calc(var(--db-ly, -1) * -1px) 2px rgba(0, 0, 0, .6);
    --db-grain: ${GRAIN};
  }
  :host([data-frame="cockpit"]) .shell { row-gap: 8px;
    background-image:
      linear-gradient(color-mix(in srgb, var(--db-text) 3.5%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--db-text) 3.5%, transparent) 1px, transparent 1px);
    background-size: 24px 24px; }

  /* The glare shield: the elbow cell and the bar are one plate, cut away below. */
  :host([data-frame="cockpit"]) .elbow, :host([data-frame="cockpit"]) .bar {
    background-color: var(--db-frame); background-image: var(--db-grain), var(--db-plate-lit); box-shadow: var(--db-plate-edge); }
  :host([data-frame="cockpit"]) .elbow { background-image: var(--db-greeble-corner, none), var(--db-grain), var(--db-plate-lit); }
  :host([data-frame="cockpit"]) .elbow { border-top-left-radius: 0;
    clip-path: polygon(0 0, 100% 0, 100% 100%, calc(var(--db-c) * 2) 100%, 0 calc(100% - var(--db-c) * 2)); }
  :host([data-frame="cockpit"]) .elbow::after { display: none; }
  :host([data-frame="cockpit"]) .bar { align-items: center; gap: 12px; padding: 0 18px 0 6px;
    clip-path: polygon(0 0, 100% 0, 100% calc(100% - var(--db-c) * 2), calc(100% - var(--db-c) * 2) 100%, 0 100%); }
  /* Either side of the cluster, generated hardware (cockpit-art.js) - lit, never
     lighting anything; the Greeble density control decides how much. */
  :host([data-frame="cockpit"]) .band, :host([data-frame="cockpit"]) .cap {
    flex: 1; width: auto; height: 36px; border-radius: 0; clip-path: none;
    background: var(--db-greeble-strip, none) 0 center / auto 36px repeat-x; }
  :host([data-frame="cockpit"]) .cap { background-position: -300px center; }
  :host([data-frame="cockpit"]) .clock, :host([data-frame="cockpit"]) .title {
    background: var(--db-recess); box-shadow: inset 0 2px 4px rgba(0, 0, 0, .9), 0 0 0 1px var(--db-border);
    color: var(--db-active); text-shadow: 0 0 6px var(--db-glow); }
  :host([data-frame="cockpit"]) .clock { font-family: var(--db-mono); font-size: 17px; line-height: 30px; padding: 0 10px; }
  :host([data-frame="cockpit"]) .title { font-size: 20px; line-height: 30px; padding: 0 14px; letter-spacing: .3em; font-weight: 600; }

  /* The side console: its own plate below the shield, keys inset on it. */
  :host([data-frame="cockpit"]) .desk .rail { padding: 8px 6px 0; gap: 6px;
    background-color: var(--db-frame); background-image: var(--db-grain), var(--db-plate-lit); box-shadow: var(--db-plate-edge);
    clip-path: polygon(0 0, calc(100% - var(--db-c)) 0, 100% var(--db-c), 100% 100%, 0 100%); }
  /* The pinned tools carry the console's bottom margin themselves, so no tab shows below them. */
  :host([data-frame="cockpit"]) .desk .tools { background: var(--db-frame); box-shadow: 0 -6px 0 var(--db-frame); padding-bottom: 8px; }
  :host([data-frame="cockpit"]) .tab { position: relative; box-shadow: var(--db-key-edge); }
  :host([data-frame="cockpit"]) .tab::before { content: ""; position: absolute; left: 10px; top: 10px; width: 16px; height: 4px;
    border-radius: 1px; background: var(--db-lamp-off); }
  :host([data-frame="cockpit"]) .tab.active::before { background: var(--db-active); box-shadow: 0 0 8px var(--db-active); }
  :host([data-frame="cockpit"]) .tab.active {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--db-active) 55%, transparent), 0 0 14px color-mix(in srgb, var(--db-active) 22%, transparent); }
  :host([data-frame="cockpit"]) .phone .tab::before { left: 50%; top: auto; bottom: 4px; width: 18px; height: 3px; transform: translateX(-50%); }
  :host([data-frame="cockpit"]) .tab.tool::before { display: none; }
  :host([data-frame="cockpit"]) .tab.tool {
    background-image: repeating-linear-gradient(-45deg, rgba(0, 0, 0, .6) 0 5px, transparent 5px 10px);
    background-size: 10px 100%; background-repeat: no-repeat; }
  :host([data-frame="cockpit"]) .rail-fill { border-bottom-left-radius: 0; background: var(--db-greeble-column, none) center top / 138px auto repeat-y; }

  /* Faceted plates. The tile is filled with the edge colour and cut; its
     ::before is the plate, cut the same way 1px in, so the edge runs along the
     cuts too. A screw in each uncut corner, light from above, and the cards -
     see-through in a tile - sit on it. */
  :host([data-frame="cockpit"]) .tile { border: 0; border-radius: 0; box-shadow: none;
    background: var(--db-border);
    clip-path: polygon(var(--db-c) 0, 100% 0, 100% calc(100% - var(--db-c)), calc(100% - var(--db-c)) 100%, 0 100%, 0 var(--db-c)); }
  :host([data-frame="cockpit"]) .tile::before { content: ""; position: absolute; inset: 1px; z-index: 0; pointer-events: none;
    background-color: var(--db-surface);
    background-image:
      radial-gradient(circle at calc(100% - 8px) 8px, var(--db-screw) 0 1.8px, transparent 2.4px),
      radial-gradient(circle at 8px calc(100% - 8px), var(--db-screw) 0 1.8px, transparent 2.4px),
      var(--db-grain), var(--db-plate-lit);
    box-shadow: var(--db-plate-edge);
    clip-path: polygon(calc(var(--db-c) - .6px) 0, 100% 0, 100% calc(100% - var(--db-c) + .6px),
      calc(100% - var(--db-c) + .6px) 100%, 0 100%, 0 calc(var(--db-c) - .6px)); }
  /* Content sits above the plate the tile draws in ::before. NOT the wear
     layer, which belongs under the content and over the plate - without the
     exclusion this rule lifted it to z-index 1 and it covered the tile. */
  :host([data-frame="cockpit"]) .tile > *:not(.tile-wear) { position: relative; z-index: 1; }
  :host([data-frame="cockpit"]) .tile > .resize { position: absolute; }
  :host([data-frame="cockpit"]) .editing .tile { background: var(--db-edit); }
  :host([data-frame="cockpit"]) .tile-bar { font-size: 11px; letter-spacing: .14em; padding-left: calc(var(--db-c) + 4px);
    border-bottom: 1px solid color-mix(in srgb, var(--db-active) 45%, transparent); }

  /* Phone rows and the drop outline are cut like the tiles, not rounded. */
  :host([data-frame="cockpit"]) .row, :host([data-frame="cockpit"]) .ghost { border-radius: 0;
    clip-path: polygon(var(--db-c) 0, 100% 0, 100% calc(100% - var(--db-c)), calc(100% - var(--db-c)) 100%, 0 100%, 0 var(--db-c)); }
  :host([data-frame="cockpit"]) .row { border: 0; box-shadow: var(--db-plate-edge); background-image: var(--db-grain), var(--db-plate-lit); }
  :host([data-frame="cockpit"]) .mark { border-radius: 2px; }
  :host([data-frame="cockpit"]) .row.st-on .mark { box-shadow: 0 0 8px var(--db-active); }
  :host([data-frame="cockpit"]) .g-val, :host([data-frame="cockpit"]) .status { font-family: var(--db-mono); }
  :host([data-frame="cockpit"]) .g-row.on .g-val { text-shadow: 0 0 6px var(--db-glow); }
  :host([data-frame="cockpit"]) .sheet-bar { border-radius: 0;
    clip-path: polygon(var(--db-c) 0, calc(100% - var(--db-c)) 0, 100% var(--db-c), 100% 100%, 0 100%, 0 var(--db-c)); }
  /* On a phone the shield is the header row on its own. */
  :host([data-frame="cockpit"]) .phone .bar { padding: 0 10px 0 6px; }
  :host([data-frame="cockpit"]) .phone .title { font-size: 16px; letter-spacing: .2em; padding: 0 8px; }
  :host([data-frame="cockpit"]) .phone .clock { font-size: 14px; padding: 0 6px; }`;

/* ----------------------------------------------------------- blueprint
   Line work on drafting blue: outlines, never fills; a dimension line for the
   band; a drafting grid behind everything; dashed tools. */
const BLUEPRINT = `
  ${F("blueprint")} { --secondary-background-color: transparent;
    --divider-color: color-mix(in srgb, var(--db-line) 70%, transparent); }
  ${F("blueprint")} .shell {
    background-image:
      linear-gradient(color-mix(in srgb, var(--db-text) 12%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--db-text) 12%, transparent) 1px, transparent 1px),
      linear-gradient(color-mix(in srgb, var(--db-text) 5%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--db-text) 5%, transparent) 1px, transparent 1px);
    background-size: 80px 80px, 80px 80px, 16px 16px, 16px 16px; }
  ${noElbow("blueprint")}
  ${F("blueprint")} .elbow { border: 1px solid var(--db-line); border-width: 1px 0 0 1px; }
  ${F("blueprint")} .band { height: 0; background: none; border-top: 1px solid var(--db-text); position: relative; }
  ${F("blueprint")} .band::before, ${F("blueprint")} .band::after { content: ""; position: absolute; top: -6px;
    width: 1px; height: 11px; background: var(--db-text); }
  ${F("blueprint")} .band::before { left: 0; } ${F("blueprint")} .band::after { right: 0; }
  ${F("blueprint")} .cap { background: none; border: 1px solid var(--db-line); border-radius: 0; }
  ${F("blueprint")} .title { color: var(--db-text); font-size: 22px; letter-spacing: .3em; }
  ${F("blueprint")} .tab { background: transparent; color: var(--db-text); border: 1px solid var(--db-line); }
  ${F("blueprint")} .tab.active { background: var(--db-tab-on); color: var(--db-tab-on-text); border-color: var(--db-tab-on); }
  ${F("blueprint")} .tab.tool { background: transparent; color: var(--db-edit); border: 1px dashed var(--db-edit); }
  ${F("blueprint")} .rail-fill { border-left: 1px dashed var(--db-line); margin-left: 50%; }
  ${F("blueprint")} .tile-bar { background: transparent; color: var(--db-text); border-bottom: 1px solid var(--db-border); }
  ${F("blueprint")} .row { background: transparent; border: 1px solid var(--db-line); }
  ${F("blueprint")} .mark { border-radius: 0; }
  ${F("blueprint")} .sheet-bar { background: var(--db-bg); color: var(--db-text); border: 1px solid var(--db-line); border-radius: 0; }
  ${F("blueprint")} .phone .menu { background: transparent; color: var(--db-text); border: 1px solid var(--db-line); }
  ${F("blueprint")} .phone .band { border-radius: 0; }`;

/* ------------------------------------------------------------ terminal
   A ship's computer on a phosphor screen: one hue, brightness and inverse
   video do the work; scanlines over everything; a prompt marks where you are. */
const TERMINAL = `
  ${F("terminal")} { --secondary-background-color: transparent;
    --divider-color: color-mix(in srgb, var(--db-line) 80%, transparent); }
  ${F("terminal")} .shell { position: relative; text-shadow: 0 0 4px color-mix(in srgb, var(--db-text) 55%, transparent); }
  ${F("terminal")} .shell::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 5;
    background: repeating-linear-gradient(0deg, rgba(0, 0, 0, .25) 0 1px, transparent 1px 3px); }
  ${noElbow("terminal")}
  ${listTabs("terminal")}
  ${F("terminal")} .band { height: 0; background: none; border-top: 1px dashed var(--db-line); }
  ${F("terminal")} .cap { display: none; }
  ${F("terminal")} .bar { padding-right: 14px; }
  ${F("terminal")} .title { color: var(--db-text); font-size: 22px; letter-spacing: .12em; }
  ${F("terminal")} .clock { font-size: 20px; }
  ${F("terminal")} .tab { background: transparent; color: color-mix(in srgb, var(--db-text) 70%, var(--db-bg)); min-height: 34px; }
  ${F("terminal")} .tab::before { content: "  "; white-space: pre; }
  ${F("terminal")} .tab.active { background: var(--db-tab-on); color: var(--db-tab-on-text); text-shadow: none; }
  ${F("terminal")} .tab.active::before { content: "> "; }
  ${F("terminal")} .tab.tool { background: transparent; color: var(--db-edit); }
  ${F("terminal")} .tab.tool::before { content: "# "; }
  ${F("terminal")} .tile-bar { background: transparent; color: var(--db-text); }
  ${F("terminal")} .tile-title::before { content: "== "; } ${F("terminal")} .tile-title::after { content: " =="; }
  ${F("terminal")} .row { background: transparent; border: 1px solid var(--db-line); }
  ${F("terminal")} .mark { border-radius: 0; }
  ${F("terminal")} .row.st-on .mark { box-shadow: 0 0 6px var(--db-active); }
  ${F("terminal")} .sheet-bar { background: var(--db-bg); color: var(--db-text); border: 1px solid var(--db-line); border-radius: 0; }
  ${F("terminal")} .phone .menu { background: transparent; color: var(--db-text); border: 1px solid var(--db-line); }
  ${F("terminal")} .phone .band { border-radius: 0; }`;

/* --------------------------------------------------------------- braun
   Dieter Rams: a light, calm instrument. Warm grey plates, white panels, keys
   with a dot that turns the accent colour for what is on; words as written. */
const BRAUN = `
  ${F("braun")} .elbow { background: var(--db-frame); border-top-left-radius: 0; }
  ${F("braun")} .elbow::after { display: none; }
  ${F("braun")} .bar { align-items: center; padding-right: 14px; }
  ${asWritten("braun")}
  ${listTabs("braun")}
  ${F("braun")} .band { height: 2px; background: var(--db-text); }
  ${F("braun")} .cap { display: none; }
  ${F("braun")} .title { color: var(--db-text); font-size: 22px; font-weight: 700; }
  ${F("braun")} .clock { background: var(--db-text); color: var(--db-bg); padding: 2px 10px; border-radius: var(--db-ctl-r);
    font-size: 18px; line-height: 26px; }
  ${F("braun")} .desk .rail { background: var(--db-frame); padding: 8px 8px 0; gap: 6px; }
  ${F("braun")} .tab { position: relative; padding-left: 30px; box-shadow: 0 1px 1px rgba(0, 0, 0, .14); }
  ${F("braun")} .tab::before { content: ""; position: absolute; left: 12px; top: 50%; width: 8px; height: 8px; margin-top: -4px;
    border-radius: 50%; background: color-mix(in srgb, var(--db-text) 25%, var(--db-tab)); }
  ${F("braun")} .tab.active::before { background: var(--db-active); }
  ${F("braun")} .tab.tool::before { background: color-mix(in srgb, var(--db-edit-text) 40%, var(--db-edit)); }
  ${F("braun")} .rail-fill { background: transparent; border-bottom-left-radius: 0; }
  ${F("braun")} .desk .tools { background: var(--db-frame); box-shadow: 0 -6px 0 var(--db-frame); padding-bottom: 8px; }
  ${F("braun")} .row { background: var(--db-surface); border: 1px solid var(--db-border); }
  ${F("braun")} .sheet-bar { background: var(--db-frame); color: var(--db-frame-text); }
  ${F("braun")} .phone .band { border-radius: 0; height: 2px; }`;

/* ----------------------------------------------------------------- hud
   A holographic overlay: tiles drawn as their corners only over a faint fill,
   tabs cut at one corner, one glowing hue with amber for the tools. */
const HUD = `
  ${F("hud")} { --secondary-background-color: color-mix(in srgb, var(--db-line) 10%, transparent);
    --divider-color: color-mix(in srgb, var(--db-line) 45%, transparent); }
  ${noElbow("hud")}
  ${F("hud")} .band { height: 0; background: none; border-top: 1px solid color-mix(in srgb, var(--db-line) 55%, transparent); }
  ${F("hud")} .cap { display: none; }
  ${F("hud")} .bar { padding-right: 14px; }
  ${F("hud")} .title { font-size: 22px; letter-spacing: .25em; text-shadow: 0 0 8px color-mix(in srgb, var(--db-active) 80%, transparent); }
  ${F("hud")} .clock { color: var(--db-active); text-shadow: 0 0 6px color-mix(in srgb, var(--db-active) 60%, transparent); }
  ${F("hud")} .tab { background: color-mix(in srgb, var(--db-tab) 60%, transparent); color: var(--db-tab-text);
    border: 1px solid color-mix(in srgb, var(--db-line) 40%, transparent);
    clip-path: polygon(var(--db-c) 0, 100% 0, 100% 100%, 0 100%, 0 var(--db-c)); }
  ${F("hud")} .tab.active { background: var(--db-tab-on); color: var(--db-tab-on-text); border-color: var(--db-line);
    box-shadow: 0 0 12px color-mix(in srgb, var(--db-line) 35%, transparent) inset; }
  ${F("hud")} .tab.tool { background: transparent; color: var(--db-edit); border-color: color-mix(in srgb, var(--db-edit) 60%, transparent); }
  ${F("hud")} .tile { border: 0; background-color: color-mix(in srgb, var(--db-surface) 70%, transparent);
    background-image:
      linear-gradient(var(--db-border), var(--db-border)), linear-gradient(var(--db-border), var(--db-border)),
      linear-gradient(var(--db-border), var(--db-border)), linear-gradient(var(--db-border), var(--db-border)),
      linear-gradient(var(--db-border), var(--db-border)), linear-gradient(var(--db-border), var(--db-border)),
      linear-gradient(var(--db-border), var(--db-border)), linear-gradient(var(--db-border), var(--db-border));
    background-size: 16px 1px, 1px 16px, 16px 1px, 1px 16px, 16px 1px, 1px 16px, 16px 1px, 1px 16px;
    background-position: 0 0, 0 0, 100% 0, 100% 0, 0 100%, 0 100%, 100% 100%, 100% 100%; background-repeat: no-repeat; }
  ${F("hud")} .tile-bar { background: transparent; color: var(--db-active); }
  ${F("hud")} .row { background: color-mix(in srgb, var(--db-surface) 70%, transparent); border: 1px solid color-mix(in srgb, var(--db-line) 35%, transparent);
    clip-path: polygon(var(--db-c) 0, 100% 0, 100% 100%, 0 100%, 0 var(--db-c)); }
  ${F("hud")} .row.st-on .mark { box-shadow: 0 0 8px var(--db-active); }
  ${F("hud")} .sheet-bar { background: var(--db-bg); color: var(--db-text); border-bottom: 1px solid var(--db-line); border-radius: 0; }
  ${F("hud")} .phone .menu { background: transparent; color: var(--db-text); border: 1px solid color-mix(in srgb, var(--db-line) 40%, transparent); }
  ${F("hud")} .phone .band { border-radius: 0; }`;

/* --------------------------------------------------------------- glass
   Calm and everyday: frosted panels over a soft backdrop lit by the accent and
   tool colours, almost no chrome, words as written. */
const GLASS = `
  ${F("glass")} .shell { background:
      radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--db-active) 35%, transparent) 0, transparent 42%),
      radial-gradient(circle at 88% 92%, color-mix(in srgb, var(--db-edit) 30%, transparent) 0, transparent 48%),
      var(--db-bg); }
  ${noElbow("glass")}
  ${asWritten("glass")}
  ${listTabs("glass")}
  ${F("glass")} .bar { padding-right: 16px; }
  ${F("glass")} .band { background: transparent; }
  ${F("glass")} .cap { display: none; }
  ${F("glass")} .title { color: var(--db-text); font-size: 22px; font-weight: 600; }
  ${F("glass")} .clock { font-size: 20px; }
  ${F("glass")} .tab { background: transparent; color: color-mix(in srgb, var(--db-text) 80%, transparent); }
  ${F("glass")} .tab.active { background: color-mix(in srgb, var(--db-tab-on) 85%, transparent); color: var(--db-tab-on-text); }
  ${F("glass")} .tab.tool { background: color-mix(in srgb, var(--db-edit) 30%, transparent); color: var(--db-text); }
  ${F("glass")} .desk .tools { background: color-mix(in srgb, var(--db-bg) 70%, transparent); box-shadow: none;
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  ${F("glass")} .tile { background: color-mix(in srgb, var(--db-surface) 45%, transparent);
    border-color: color-mix(in srgb, var(--db-border) 60%, transparent);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
  ${F("glass")} .tile-bar { background: transparent; color: var(--db-text); }
  ${F("glass")} .row { background: color-mix(in srgb, var(--db-surface) 45%, transparent);
    border: 1px solid color-mix(in srgb, var(--db-border) 60%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
  ${F("glass")} .sheet-bar { background: color-mix(in srgb, var(--db-surface) 85%, transparent); color: var(--db-text); }
  ${F("glass")} .phone .menu { background: color-mix(in srgb, var(--db-text) 10%, transparent); color: var(--db-text); }
  ${F("glass")} .phone .tools { background: color-mix(in srgb, var(--db-bg) 70%, transparent); box-shadow: none; }
  ${F("glass")} .phone .band { background: transparent; }`;

/* --------------------------------------------------------- field notes
   E-ink paper for a daylight wall tablet: rules and type, no fills, no boxes;
   the tab you are on is set in bold with a rule under it. */
const FIELD_NOTES = `
  ${F("fieldnotes")} { --secondary-background-color: transparent; }
  ${noElbow("fieldnotes")}
  ${asWritten("fieldnotes")}
  ${listTabs("fieldnotes")}
  ${F("fieldnotes")} .bar { padding-right: 14px; }
  ${F("fieldnotes")} .band { height: 0; background: none; border-top: 3px double var(--db-text); }
  ${F("fieldnotes")} .cap { display: none; }
  ${F("fieldnotes")} .title { color: var(--db-text); font-size: 26px; font-style: italic; }
  ${F("fieldnotes")} .clock { font-size: 18px; }
  ${F("fieldnotes")} .desk .rail { border-right: 1px solid var(--db-line); padding-right: 10px; gap: 0; }
  ${F("fieldnotes")} .tab { background: transparent; color: var(--db-text); font-variant: small-caps;
    border-bottom: 1px solid color-mix(in srgb, var(--db-line) 35%, transparent); }
  ${F("fieldnotes")} .tab.active { background: transparent; color: var(--db-tab-on-text); font-weight: 700;
    border-bottom: 2px solid var(--db-tab-on-text); }
  ${F("fieldnotes")} .tab.tool { background: transparent; color: var(--db-text); font-style: italic; border-bottom: 0; }
  ${F("fieldnotes")} .tile { border: 0; border-top: 2px solid var(--db-border); background: transparent; box-shadow: none; border-radius: 0; }
  ${F("fieldnotes")} .tile-bar { background: transparent; color: var(--db-text); font-variant: small-caps; }
  ${F("fieldnotes")} .row { background: transparent; border-top: 1px solid var(--db-line); border-radius: 0; }
  ${F("fieldnotes")} .row-title { font-variant: small-caps; }
  ${F("fieldnotes")} .mark { border-radius: 0; }
  ${F("fieldnotes")} .sheet-bar { background: var(--db-bg); color: var(--db-text); border-bottom: 2px solid var(--db-text); border-radius: 0; }
  ${F("fieldnotes")} .phone .menu { background: transparent; color: var(--db-text); border: 1px solid var(--db-line); }
  ${F("fieldnotes")} .phone .band { border-radius: 0; }`;

/** Each frame's block, by frame value - LCARS is the panel's base and has none. */
export const FRAME_BLOCKS = Object.freeze({
  cockpit: COCKPIT, blueprint: BLUEPRINT, terminal: TERMINAL, braun: BRAUN, hud: HUD, glass: GLASS, fieldnotes: FIELD_NOTES,
});

export const FRAME_STYLES = Object.values(FRAME_BLOCKS).join("\n");
