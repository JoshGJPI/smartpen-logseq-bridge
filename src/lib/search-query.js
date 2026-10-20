/**
 * search-query — what a global-search query means (reading-first package E).
 * Pure: no DOM, no stores.
 *
 * A query can name days and notebooks as well as words:
 *   "Oct 14", "October 14th", "14 Oct 2025", "2026-10-14", "10/14", "10/14/26",
 *   "today", "yesterday"  → days (local day keys)
 *   "Study Notes", "B390", "390v2"                         → notebooks
 *   everything else                                         → transcript words
 *
 * Numeric dates are read month first (10/14), the way Josh writes them. A date
 * with no year is its most recent occurrence on or before today, so in October
 * "Dec 3" means last December. A month alone ("may") or a bare number is NOT a
 * date: both are ordinary words in notes.
 *
 * Tested in `src/lib/__tests__/search-query.test.js`.
 */

import { dayKey } from './timeline.js';
import { tokenize } from './transcript-search.js';

const MONTH_RE =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const PATTERNS = [
  // 2026-10-14
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/gi, parts: (m) => [+m[1], +m[2], +m[3]] },
  // Oct 14, October 14th, Oct 14 2025, Oct. 14, 2025
  {
    re: new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`, 'gi'),
    parts: (m) => [m[3] ? +m[3] : null, monthOf(m[1]), +m[2]]
  },
  // 14 Oct, 14th October 2025
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\b\\.?(?:,?\\s+(\\d{4})\\b)?`, 'gi'),
    parts: (m) => [m[3] ? +m[3] : null, monthOf(m[2]), +m[1]]
  },
  // 10/14, 10/14/26, 10/14/2026 (month first)
  {
    re: /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g,
    parts: (m) => [m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, +m[1], +m[2]]
  }
];

function monthOf(name) {
  return MONTHS.indexOf(String(name).slice(0, 3).toLowerCase()) + 1;
}

/** A local day key for y/m/d, or null when it is not a real date. */
function validDay(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1970 && y <= 9999)) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return dayKey(date);
}

/** No year given: the most recent such day on or before today. */
function resolveYear(m, d, now) {
  const today = dayKey(now);
  const y = now.getFullYear();
  const thisYear = validDay(y, m, d);
  if (thisYear && thisYear <= today) return thisYear;
  // Feb 29 in a non-leap year walks back to the last leap year.
  for (let back = 1; back <= 8; back++) {
    const k = validDay(y - back, m, d);
    if (k) return k;
  }
  return null;
}

/**
 * Split a query into days, notebook-ish text and words.
 *
 * @param {string} input
 * @param {{now?: Date}} [opts]
 * @returns {{raw: string, text: string, tokens: string[], days: string[]}}
 *   `text` is the query with the dates taken out; `tokens` are its search words
 *   (same tokenizer as Transcripts → Search); `days` are unique, in query order.
 */
export function parseSearchQuery(input, { now = new Date() } = {}) {
  const raw = typeof input === 'string' ? input : '';
  let text = raw;
  const days = [];
  const add = (k) => { if (k && !days.includes(k)) days.push(k); };

  for (const { re, parts } of PATTERNS) {
    text = text.replace(re, (...args) => {
      const [y, m, d] = parts(args);
      const k = y == null ? resolveYear(m, d, now) : validDay(y, m, d);
      if (!k) return args[0];
      add(k);
      return ' ';
    });
  }

  text = text.replace(/\b(today|yesterday)\b/gi, (w) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (w.toLowerCase() === 'yesterday') d.setDate(d.getDate() - 1);
    add(dayKey(d));
    return ' ';
  });

  text = text.replace(/\s+/g, ' ').trim();
  return { raw, text, tokens: [...tokenize(text)], days };
}

/**
 * Notebooks a query names: by book key ("390", "B390", "390v2") or by name
 * (case-insensitive, every query word found in the name). Exact and prefix
 * matches first.
 *
 * @param {string} text  the query with dates removed (`parseSearchQuery().text`)
 * @param {Array<{book: string, name: string}>} notebooks
 * @returns {Array<{book: string, name: string, exact: boolean}>}
 */
export function matchNotebooks(text, notebooks) {
  const q = String(text || '').trim().toLowerCase();
  if (q.length < 2 || !Array.isArray(notebooks)) return [];
  const key = q.match(/^b?\s*(\d+(?:v\d+)?)$/);
  const words = q.split(/\s+/);
  const out = [];
  for (const nb of notebooks) {
    const name = String(nb.name || '').toLowerCase();
    if (key) {
      if (nb.book === key[1]) out.push({ ...nb, exact: true, rank: 0 });
      continue;
    }
    if (!words.every((w) => name.includes(w))) continue;
    const rank = name === q ? 0 : name.startsWith(q) ? 1 : 2;
    out.push({ ...nb, exact: rank === 0, rank });
  }
  return out
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map(({ rank, ...nb }) => nb);
}
