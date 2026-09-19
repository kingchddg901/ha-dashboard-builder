/**
 * Home Assistant adapter — persist themes in HA's per-user frontend store (stud #4).
 *
 * HA-native and cross-device with NO custom integration to install: values are
 * written via the `frontend/set_user_data` WebSocket command into the logged-in
 * user's storage, so a theme set on one device shows up on another. (For
 * server-side / service-driven storage you can write an integration-backed adapter
 * to the same `{ load, save }` shape — this covers the common case.)
 *
 * Pass the card's `hass` object, OR a getter returning the current one — HA hands
 * cards a fresh `hass` on every update, and a getter avoids a stale reference.
 *
 * Writes are debounced (default 350ms) because an editor typically calls `save`
 * on every drag tick, and each write is a round-trip. `flush()` forces a pending
 * write (call it on card disconnect). Everything degrades gracefully to a no-op
 * if `hass` isn't ready — theming keeps working, it just isn't persisted yet.
 */
export function haUserDataAdapter(hass, storeKey = "theme-kit", { saveDebounceMs = 350 } = {}) {
  const getHass = typeof hass === "function" ? hass : () => hass;

  const ws = (msg) => {
    const h = getHass();
    if (!h) return null;
    if (typeof h.callWS === "function") return h.callWS(msg);
    if (h.connection?.sendMessagePromise) return h.connection.sendMessagePromise(msg);
    return null;
  };

  let timer = null;
  let pending;
  let hasPending = false;

  const write = async (values) => {
    try {
      const p = ws({ type: "frontend/set_user_data", key: storeKey, value: values || {} });
      if (p) await p;
    } catch {
      /* HA unreachable / rejected the key — non-fatal for a theming layer */
    }
  };

  const flush = async () => {
    if (!hasPending) return;
    hasPending = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await write(pending);
  };

  return {
    async load() {
      try {
        const res = await ws({ type: "frontend/get_user_data", key: storeKey });
        return (res && res.value) || {};
      } catch {
        return {};
      }
    },
    async save(values) {
      pending = values || {};
      hasPending = true;
      if (saveDebounceMs <= 0) return flush();
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, saveDebounceMs);
    },
    flush,
  };
}
