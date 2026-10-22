/**
 * Retime — shift selected strokes in time (v3.6.0). Pure, no stores.
 *
 * The Editor's Set time… dialog moves the EARLIEST selected stroke to a chosen
 * date and time and shifts every other selected stroke by the same amount, so
 * their spacing is unchanged. Everything that shows a date (Timeline, Dates,
 * capture-date index, task dates) derives it from stroke `startTime`, so the
 * stroke times are the whole change.
 *
 * THE ID IS THE TIME. A stored stroke's id is `s{startTime}` and saves are
 * append-only, deduped by id, so a retimed stroke saves as a NEW id and the old
 * one stays on disk unless something deletes it. `retimedFrom: { id }` is that
 * something: an in-memory marker (like `movedFrom`; `strokeToStored()` never
 * copies it) naming the id the stroke has on disk, kept from the FIRST retime
 * until the page is saved. Every path that turns a canvas stroke into an id to
 * remove from disk (deletion, volume move, the retime itself) reads it through
 * `strokeDiskId()`.
 *
 * The pen's memory still holds the stroke at its original time, so the save
 * also records the change in `pages/_retimed.json` (see
 * electron/retimed-sidecar.cjs) and offline import drops those pen strokes
 * (`dropRetimedPenStrokes()`).
 */

import { dayKey } from './timeline.js';
import { toBookKey, ncodeBookOf } from './volumes.js';

/** Retimes before this are refused (guards a typo like year 0202). */
export const RETIME_MIN_MS = Date.UTC(2000, 0, 1);

/** The id this canvas stroke has on disk now (or would have, if never saved). */
export function strokeDiskId(stroke) {
  return stroke?.retimedFrom?.id || `s${stroke?.startTime}`;
}

/**
 * Can this stroke be retimed? It needs a page and a real start time. Pasted
 * strokes are excluded: their times are synthetic and they aren't saved until
 * placed.
 */
export function isRetimable(stroke) {
  return !!stroke && !stroke._pasted && !!stroke.pageInfo
    && Number.isFinite(stroke.startTime) && stroke.startTime > 0;
}

/**
 * A copy of `stroke` shifted by `deltaMs`: start, end and every numeric point
 * timestamp. Null / missing point timestamps stay as they are; geometry, force,
 * the sketch flag, `lineId` / `blockUuid` and every other field are untouched.
 * Stamps `retimedFrom` (the FIRST disk id) and drops it when the shift brings
 * the stroke back to that id.
 */
export function shiftStroke(stroke, deltaMs) {
  if (!deltaMs) return stroke;
  const diskId = strokeDiskId(stroke);
  const next = {
    ...stroke,
    startTime: stroke.startTime + deltaMs,
    endTime: Number.isFinite(stroke.endTime) ? stroke.endTime + deltaMs : stroke.endTime
  };
  if (Array.isArray(stroke.dotArray)) {
    next.dotArray = stroke.dotArray.map((d) => (typeof d?.timestamp === 'number'
      ? { ...d, timestamp: d.timestamp + deltaMs }
      : d));
  }
  if (`s${next.startTime}` === diskId) delete next.retimedFrom;
  else next.retimedFrom = { id: diskId };
  return next;
}

/** `"B388v2/P41"`, the canvas page key (book key + integer page). */
export function canvasPageKey(pageInfo) {
  return `B${toBookKey(pageInfo?.book)}/P${pageInfo?.page}`;
}

/** `"388/41"`, the physical page the pen saw: NCode book + integer page. */
export function penPageKey(pageInfo) {
  const book = ncodeBookOf(toBookKey(pageInfo?.book));
  const page = Number(pageInfo?.page);
  if (!Number.isInteger(book) || !Number.isInteger(page)) return null;
  return `${book}/${page}`;
}

function daysOf(times) {
  return [...new Set(times.map(dayKey).filter(Boolean))].sort();
}

/**
 * What the dialog shows for a selection and a proposed new earliest time.
 *
 * @param {Array} strokesArr     the canvas strokes
 * @param {Iterable<number>} indices  selected indices
 * @param {number|null} newStartMs   proposed new earliest start (null: no change yet)
 * @returns {{ indices: number[], skipped: number, earliest: number|null, latest: number|null,
 *             delta: number, pages: Array<{ key, book, page, selected, total, daysBefore, daysAfter }> }}
 */
export function planRetime(strokesArr, indices, newStartMs = null) {
  const picked = [];
  let skipped = 0;
  for (const i of indices || []) {
    const s = strokesArr[i];
    if (isRetimable(s)) picked.push(i);
    else if (s) skipped++;
  }
  picked.sort((a, b) => a - b);

  let earliest = null;
  let latest = null;
  for (const i of picked) {
    const s = strokesArr[i];
    const end = Number.isFinite(s.endTime) ? s.endTime : s.startTime;
    if (earliest === null || s.startTime < earliest) earliest = s.startTime;
    if (latest === null || end > latest) latest = end;
  }
  const delta = earliest !== null && Number.isFinite(newStartMs) ? newStartMs - earliest : 0;

  const pickedSet = new Set(picked);
  const byPage = new Map();
  strokesArr.forEach((s, i) => {
    if (!s?.pageInfo) return;
    const key = canvasPageKey(s.pageInfo);
    let p = byPage.get(key);
    if (!p) {
      p = { key, book: toBookKey(s.pageInfo.book), page: s.pageInfo.page, selected: 0, total: 0, before: [], after: [] };
      byPage.set(key, p);
    }
    p.total++;
    if (!Number.isFinite(s.startTime)) return;
    p.before.push(s.startTime);
    p.after.push(pickedSet.has(i) ? s.startTime + delta : s.startTime);
    if (pickedSet.has(i)) p.selected++;
  });

  const pages = [...byPage.values()]
    .filter((p) => p.selected > 0)
    .map(({ before, after, ...p }) => ({ ...p, daysBefore: daysOf(before), daysAfter: daysOf(after) }));

  return { indices: picked, skipped, earliest, latest, delta, pages };
}

/**
 * Strokes that would land on an id already taken on their page, and so be
 * dropped by the save's dedupe. Taken = the page's ids on disk (minus the ones
 * being vacated by a retime, this one or an earlier unsaved one) plus the ids of
 * the page's canvas strokes that aren't moving.
 *
 * @param {Array} strokesArr
 * @param {number[]} indices         the strokes being shifted (from planRetime)
 * @param {number} deltaMs
 * @param {Map<string, Set<string>>} diskIdsByPage  canvas page key → ids on disk
 * @returns {Array<{ index: number, page: string, id: string }>}
 */
export function findRetimeCollisions(strokesArr, indices, deltaMs, diskIdsByPage) {
  if (!deltaMs || !indices?.length) return [];
  const moving = new Set(indices);
  const taken = new Map();
  const vacated = new Map();
  const set = (m, k) => m.get(k) || m.set(k, new Set()).get(k);

  strokesArr.forEach((s, i) => {
    if (!s?.pageInfo) return;
    const key = canvasPageKey(s.pageInfo);
    if (moving.has(i)) set(vacated, key).add(strokeDiskId(s));
    else {
      if (s.retimedFrom) set(vacated, key).add(s.retimedFrom.id);
      set(taken, key).add(`s${s.startTime}`);
    }
  });

  const out = [];
  for (const i of indices) {
    const s = strokesArr[i];
    const key = canvasPageKey(s.pageInfo);
    const id = `s${s.startTime + deltaMs}`;
    const onDisk = diskIdsByPage?.get(key);
    const gone = vacated.get(key);
    if (taken.get(key)?.has(id) || (onDisk?.has(id) && !gone?.has(id))) {
      out.push({ index: i, page: key, id });
    }
  }
  return out;
}

/**
 * Sidecar entries for strokes being saved that carry a retime:
 * `[{ page: "388/41", from: "s<disk id>", to: "s<new id>" }]`.
 */
export function retimeEntries(strokesArr) {
  const out = [];
  for (const s of strokesArr || []) {
    if (!s?.retimedFrom?.id) continue;
    const page = penPageKey(s.pageInfo);
    const to = `s${s.startTime}`;
    if (!page || to === s.retimedFrom.id) continue;
    out.push({ page, from: s.retimedFrom.id, to });
  }
  return out;
}

/**
 * Drop pen strokes (offline import, raw NCode pageInfo) whose id the user has
 * retimed away: the retimed copy is already in the data folder at its new time.
 *
 * @param {Array} penStrokes
 * @param {Object} retimedPages  the sidecar's `pages`
 * @returns {{ kept: Array, dropped: number }}
 */
export function dropRetimedPenStrokes(penStrokes, retimedPages) {
  if (!retimedPages || Object.keys(retimedPages).length === 0) {
    return { kept: penStrokes || [], dropped: 0 };
  }
  let dropped = 0;
  const kept = (penStrokes || []).filter((s) => {
    const map = retimedPages[penPageKey(s?.pageInfo)];
    if (map && Object.prototype.hasOwnProperty.call(map, `s${s.startTime}`)) {
      dropped++;
      return false;
    }
    return true;
  });
  return { kept, dropped };
}

/** `+11 d 4 h 53 min 12 s`, or `0 s`. */
export function formatShift(deltaMs) {
  if (!deltaMs) return '0 s';
  const sign = deltaMs < 0 ? '−' : '+';
  let s = Math.round(Math.abs(deltaMs) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [d && `${d} d`, h && `${h} h`, m && `${m} min`, s && `${s} s`].filter(Boolean);
  return sign + (parts.length ? parts.join(' ') : `${Math.abs(deltaMs)} ms`);
}
