/**
 * tag-details — the Manage tags Details form (v3.22.0) as pure functions: a
 * tag's info record → the form's fields, and the fields → the record to store.
 * The record is normalized by lib/tags.js `normalizeTagInfo()`, which owns the
 * format; this module only maps form text to it. Pure: no DOM, no stores.
 *
 * Tested in `src/lib/__tests__/tag-details.test.js`.
 */

import { tagTypeOf, projectKind, infoOf, normalizeTagInfo } from './tags.js';

/**
 * The form for one tag.
 * @param {string} tag  normalized tag
 * @param {Record<string, object>} info  the info map
 * @returns {{type: 'project'|'person'|'topic', kind: 'job'|'proposal'|null, label: string, aliases: string,
 *   company: string, name: string, client: string, active: boolean|null, job: string, note: string}}
 *   `aliases` is one comma-separated string; `active` null = not set.
 */
export function detailsDraft(tag, info) {
  const rec = infoOf(info, tag);
  return {
    type: tagTypeOf(tag, info),
    kind: projectKind(tag),
    label: rec.label || '',
    aliases: (rec.aliases || []).join(', '),
    company: rec.company || '',
    name: rec.name || '',
    client: rec.client || '',
    active: typeof rec.active === 'boolean' ? rec.active : null,
    job: rec.job || '',
    note: rec.note || ''
  };
}

/**
 * The record a form stores, normalized, or null when it holds nothing (the
 * tag's entry is then removed). The type is the form's own for a keyword
 * (Person or Topic) and ignored for a project number.
 */
export function detailsRecord(tag, draft) {
  const d = draft || {};
  return normalizeTagInfo(tag, {
    type: d.type === 'person' ? 'person' : undefined,
    label: d.label,
    aliases: d.aliases,
    company: d.company,
    name: d.name,
    client: d.client,
    active: typeof d.active === 'boolean' ? d.active : undefined,
    job: d.job,
    note: d.note
  });
}

/** True when saving the form would change what is stored. */
export function detailsChanged(tag, info, draft) {
  return JSON.stringify(detailsRecord(tag, draft)) !== JSON.stringify(normalizeTagInfo(tag, infoOf(info, tag)) || null);
}
