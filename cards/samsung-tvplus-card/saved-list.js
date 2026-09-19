/**
 * The saved TV Plus channel list, where Home Assistant keeps it.
 *
 * Shared by the guide (which edits the list) and the TV remote card (which shows
 * the first few as one-tap favourites), so both read and write it the same way:
 * `frontend/*_user_data` per user, or `frontend/*_system_data` for one house
 * list (`saved_for: house`, which only an admin can write), under
 * `samsung_tvplus.saved.<list>`. Subscribed, not read once, so every card
 * showing the list follows an edit made anywhere.
 */

import { savedKey } from "./tvplus-core.js";

const scope = (savedFor) => (savedFor === "house" ? "system" : "user");

/** Subscribe; `onValue` gets the list, or null when nothing is saved. Resolves to an unsubscribe. */
export function subscribeSaved(hass, { list = "default", savedFor = "user" } = {}, onValue) {
  return hass.connection.subscribeMessage((ev) => onValue(ev?.value ?? null),
    { type: `frontend/subscribe_${scope(savedFor)}_data`, key: savedKey(list) });
}

export function writeSaved(hass, { list = "default", savedFor = "user" } = {}, value) {
  return hass.connection.sendMessagePromise(
    { type: `frontend/set_${scope(savedFor)}_data`, key: savedKey(list), value });
}
