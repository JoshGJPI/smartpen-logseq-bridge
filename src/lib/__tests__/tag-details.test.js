/**
 * lib/tag-details.js (v3.22.0): the Manage tags Details form, mapped to and
 * from a tag's info record.
 *
 * What matters: a keyword's form switches between Person and Topic; a project
 * number's type is fixed whatever the form says; capitals in names and aliases
 * survive; an empty form removes the record; "changed" agrees with what Save
 * would write.
 */
import { describe, it, expect } from 'vitest';
import { detailsDraft, detailsRecord, detailsChanged } from '$lib/tag-details.js';

const info = {
  tom: { type: 'person', label: 'Tom', aliases: ['Thomas', 'TB'], company: 'Burnell', note: 'PM' },
  'P2026-141': { name: 'Stair', client: 'Acme', active: true, job: '2327-018' }
};

describe('detailsDraft', () => {
  it('a person', () => {
    expect(detailsDraft('tom', info)).toEqual({
      type: 'person', kind: null, label: 'Tom', aliases: 'Thomas, TB', company: 'Burnell',
      name: '', client: '', active: null, job: '', note: 'PM'
    });
  });

  it('a proposal, and a tag with no info', () => {
    expect(detailsDraft('P2026-141', info)).toMatchObject({ type: 'project', kind: 'proposal', name: 'Stair', active: true, job: '2327-018' });
    expect(detailsDraft('2327-018', info)).toMatchObject({ type: 'project', kind: 'job', active: null });
    expect(detailsDraft('sketch', info)).toMatchObject({ type: 'topic', label: '', aliases: '' });
  });
});

describe('detailsRecord', () => {
  it('round-trips a stored record', () => {
    expect(detailsRecord('tom', detailsDraft('tom', info))).toEqual(info.tom);
    expect(detailsRecord('P2026-141', detailsDraft('P2026-141', info))).toEqual(info['P2026-141']);
  });

  it('Person → Topic drops the type and the company', () => {
    const d = { ...detailsDraft('tom', info), type: 'topic' };
    expect(detailsRecord('tom', d)).toEqual({ label: 'Tom', aliases: ['Thomas', 'TB'], note: 'PM' });
  });

  it('Topic → Person, with aliases typed as one line (capitals kept)', () => {
    const d = { ...detailsDraft('rich', {}), type: 'person', label: 'Rich', aliases: 'Richard,  RICH , Richard' };
    expect(detailsRecord('rich', d)).toEqual({ type: 'person', label: 'Rich', aliases: ['Richard', 'RICH'] });
  });

  it('a project number never takes a type from the form', () => {
    expect(detailsRecord('5444-006', { type: 'person', label: 'X', name: 'Lot 4' })).toEqual({ name: 'Lot 4' });
    expect(detailsRecord('5444-006', { type: 'project', active: false })).toEqual({ active: false });
  });

  it('an empty form is no record', () => {
    expect(detailsRecord('sketch', detailsDraft('sketch', {}))).toBeNull();
    expect(detailsRecord('sketch', null)).toBeNull();
  });
});

describe('detailsChanged', () => {
  it('only when Save would write something different', () => {
    expect(detailsChanged('tom', info, detailsDraft('tom', info))).toBe(false);
    expect(detailsChanged('tom', info, { ...detailsDraft('tom', info), aliases: 'Thomas,TB' })).toBe(false);
    expect(detailsChanged('tom', info, { ...detailsDraft('tom', info), note: 'PM2' })).toBe(true);
    expect(detailsChanged('sketch', {}, detailsDraft('sketch', {}))).toBe(false);
    expect(detailsChanged('sketch', {}, { ...detailsDraft('sketch', {}), type: 'person' })).toBe(true);
  });
});
