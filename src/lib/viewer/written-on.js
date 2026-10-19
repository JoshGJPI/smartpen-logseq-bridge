/**
 * written-on — the page header's written date and the "written on" ribbon of
 * day chips (reading-first package D). Pure: no DOM, no stores.
 *
 * Built from `pageDayGroups()` (page-sittings.js), the same local-day groups the
 * hover uses, so a chip, its highlighted ink and the Timeline day it opens all
 * agree. Capture date comes from stroke `startTime` only, never from
 * `metadata.lastUpdated`.
 *
 * Tested in `src/lib/__tests__/written-on.test.js`.
 */

import { dayStart } from '../timeline.js';
import { plural } from '../plural.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function md(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/**
 * "Sep 30, 2026" for one day; "Sep 30 – Oct 5, 2026" for a range within a year;
 * "Dec 30, 2025 – Jan 2, 2026" across years. '' when the page has no timed ink.
 *
 * @param {Array<{day: string}>} groups  ascending, from pageDayGroups()
 */
export function writtenLabel(groups) {
  const days = (groups || []).map((g) => dayStart(g.day)).filter(Boolean);
  if (!days.length) return '';
  const a = days[0];
  const b = days[days.length - 1];
  if (days.length === 1) return `${md(a)}, ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) return `${md(a)} – ${md(b)}, ${b.getFullYear()}`;
  return `${md(a)}, ${a.getFullYear()} – ${md(b)}, ${b.getFullYear()}`;
}

/**
 * One chip per day the page was written on, in date order. The year shows only
 * when the page's days span more than one year.
 *
 * @param {Array<{index: number, day: string, strokes: Array}>} groups
 * @returns {Array<{index: number, day: string, label: string, title: string}>}
 */
export function writtenChips(groups) {
  const list = (groups || []).filter((g) => dayStart(g.day));
  const years = new Set(list.map((g) => g.day.slice(0, 4)));
  return list.map((g) => {
    const d = dayStart(g.day);
    const label = years.size > 1 ? `${md(d)}, ${d.getFullYear()}` : md(d);
    const n = (g.strokes || []).length;
    return {
      index: g.index,
      day: g.day,
      label,
      title: `${md(d)}, ${d.getFullYear()} · ${n} ${plural(n, 'stroke')} · click to open this day in the Timeline`
    };
  });
}
