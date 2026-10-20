/**
 * safe-storage — localStorage access that can never take the app down.
 *
 * localStorage throws when it is blocked or full, and a stored value can be
 * corrupt or hand-edited. A store that reads it at module load with a bare
 * `JSON.parse` would then throw while the app is starting, so nothing renders.
 * These helpers fall back instead: a bad read gives the fallback, a failed
 * write or remove is ignored. Display preferences only; data lives in PageDocs.
 *
 * Tested in `src/lib/__tests__/safe-storage.test.js`.
 */

/**
 * The parsed value under `key`, or `fallback` when missing, unreadable,
 * unparseable or rejected by `accept`.
 * @param {string} key
 * @param {*} fallback
 * @param {(value: *) => boolean} [accept]
 */
export function readJson(key, fallback, accept = () => true) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = JSON.parse(raw);
    return accept(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** The raw string under `key`, or null. Never throws. */
export function readString(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store a string (or JSON for anything else). Never throws. */
export function write(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    /* quota or unavailable storage: the preference just isn't remembered */
  }
}

/** Remove a key. Never throws. */
export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** A plain object (not null, not an array): the shape of the per-page maps. */
export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
