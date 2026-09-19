/**
 * The reference editor's stylesheet — separated from element.js so it can be
 * asserted on in Node.
 *
 * element.js declares `class ThemeKitEditor extends HTMLElement`, which THROWS
 * the moment the module is evaluated without a DOM, so anything living in that
 * file is unreachable from `node --test`. The escape-hatch invariant below has
 * to be machine-checked -- a comment saying "do not tokenise this" is not a
 * guard -- so the stylesheet lives here instead. Same reason computeVars and
 * editorModel are pure: what can be tested in Node, is.
 */

export const STYLE = `
  :host { display: block; color: var(--tk-fg, inherit); font: inherit; }
  fieldset { border: 1px solid var(--tk-line, #2a3550); border-radius: 10px;
             margin: 0 0 12px; padding: 8px 12px 12px; }
  legend { padding: 0 6px; color: var(--tk-dim, #8b98a5); font-size: 12px;
           letter-spacing: .04em; text-transform: uppercase; }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; margin: 8px 0; }
  .verdict { font-size: 12.5px; margin: 1px 0 6px; }
  .verdict.warn { color: var(--tk-warn, #e3b341); }
  .verdict.error { color: var(--tk-error, #ff7b72); }
  input[type=color] { width: 44px; height: 26px; padding: 0; border: 1px solid var(--tk-line, #2a3550);
                      border-radius: 6px; background: none; cursor: pointer; }

  /* A control row and its per-token reset. The reset sits OUTSIDE .row, which is
     a <label> -- a <button> inside a label activates the label's control, so a
     reset placed there would fight the widget it resets. */
  .ctl { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
  .ctl .verdicts { grid-column: 1 / -1; }

  /* --- BEGIN RESET CONTROLS: NO var() BEYOND THIS POINT -------------------
     Every reset is a recovery control, so none of them may be styled by the
     tokens they reset. Every value below is a LITERAL on purpose, and
     test/reset.test.mjs fails if a var() ever appears between these markers.

     Everything else in this editor IS themed by the tokens the editor edits,
     which is correct -- live preview is the point. But that makes every other
     control reachable by a bad value: set text colour equal to surface colour
     and the UI that would undo it is gone, and the value is already persisted
     through the adapter, so a reload does not help.

     Black on white is 21:1, the maximum ratio there is, and it depends on
     nothing, so no combination of user values can touch it. On a light theme
     these read as out-of-place black controls. That is the intended trade:
     a recovery control has to be legible, not tasteful.

     Covering the PER-TOKEN resets and not only the total one buys something
     specific. When the surrounding editor does vanish, the column of black
     reset buttons is still visible, and it is a map of the rows -- so the
     recovery is "undo the one token I just broke" rather than "discard
     everything". Without it, the total reset is the only survivor and the only
     available answer is the nuclear one.

     The white outline is for the dark case -- #000 on a dark surround stays
     perfectly readable but loses its edge, so it reads as floating text rather
     than a button. font-size is pinned for the same reason the colours are:
     "font: inherit" on :host means a themed font could otherwise shrink it away.

     NOT defended: an ancestor with opacity/filter/mix-blend-mode. Nothing
     self-contained can survive that, and it would take the whole page with it.
     --------------------------------------------------------------------- */
  [part~="reset"] {
    background: #000000;
    color: #ffffff;
    border: 1px solid #ffffff;
    cursor: pointer;
    opacity: 1;
  }
  /* Per-token: a small square, so 400 of them read as a margin rail rather
     than 400 slabs. */
  [part~="reset-token"] {
    padding: 2px 6px;
    border-radius: 6px;
    font-size: 14px;
    line-height: 1.2;
  }
  /* Per-group: rides in the <legend>, which is uppercased and letter-spaced. */
  [part~="reset-group"] {
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    line-height: 1.4;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  /* Total: full width and last, because it is the one you reach for when
     everything else has gone wrong. */
  [part~="reset-all"] {
    display: block;
    width: 100%;
    margin: 4px 0 0;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.2;
    font-weight: 600;
  }
  /* Hover inverts rather than tinting: still two literals, still 21:1. */
  [part~="reset"]:hover { background: #ffffff; color: #000000; }
  /* --- END RESET CONTROLS ----------------------------------------------- */
`;
