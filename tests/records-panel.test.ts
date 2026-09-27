import { describe, expect, it } from 'vitest';
import { RecordsIndex, qualifiedField, type RecordFilter } from '../src/app/records-panel';
import type { RuntimeResult, StructuredRecord } from '../src/domain/model';
const filter: RecordFilter = { search: '', collection: '', sort: 'name', sortField: '', descending: false };
const records: StructuredRecord[] = Array.from({ length: 10000 }, (_, i) => ({ id: `r${i}`, collection: i < 9800 ? 'bulk' : `extra${i}`, name: `record${i}`, fields: { element: '{shared}', label: i === 9999 ? '最後 中文 <script>' : `Label ${i}` }, revision: 1 }));
const runtime: RuntimeResult = { revision: 1, values: Object.fromEntries(records.flatMap((record, i) => [[qualifiedField(record, 'element'), { status: 'ok', value: i % 2 ? 'fire' : 'water' }], [qualifiedField(record, 'label'), { status: 'ok', value: record.fields.label }]])), definitions: [], references: [], diagnostics: [], metrics: { total: 20000, recalculated: 20000, affected: 20000, elapsedMs: 1 } };

describe('record browser derived index', () => {
  it('finds records beyond former caps among 10000 and sorts all results', () => {
    const index = new RecordsIndex(); index.update(records, runtime);
    expect(index.filter({ ...filter, search: '最後 中文' }).map(record => record.id)).toEqual(['r9999']);
    expect(index.filter({ ...filter, search: 'shared', collection: 'bulk' })).toHaveLength(9800);
    expect(index.filter({ ...filter, collection: 'bulk', descending: true })[0].id).toBe('r9799');
    expect(index.filter({ ...filter, sort: 'value', sortField: 'element' })[0].id).toBe('r1');
    expect(index.collections).toHaveLength(201);
  });
  it('matches only existing successfully resolved values with exact case and supports empty strings', () => {
    const index = new RecordsIndex(); const data = [records[0], records[1], { ...records[2], fields: {} }];
    index.update(data, { ...runtime, values: { [qualifiedField(data[0], 'element')]: { status: 'ok', value: '' }, [qualifiedField(data[1], 'element')]: { status: 'missing', value: '' } } });
    expect(index.filter({ ...filter, where: { field: 'element', equals: '' } }).map(record => record.id)).toEqual(['r0']);
    expect(index.filter({ ...filter, where: { field: 'absent', equals: '' } })).toEqual([]);
    index.update(records, runtime);
    expect(index.filter({ ...filter, collection: 'bulk', where: { field: 'element', equals: 'fire' } })).toHaveLength(4900);
    expect(index.filter({ ...filter, where: { field: 'element', equals: 'Fire' } })).toEqual([]);
    expect(index.filter({ ...filter, where: { field: 'element', equals: '{shared}' } })).toEqual([]);
  });
  it('refreshes edited content and calculated values while retaining dotted owner identity', () => {
    const index = new RecordsIndex(); const record = { ...records[0], collection: 'a.b', name: 'c.d' }; index.update([record]);
    expect(qualifiedField(record, 'x.y')).toBe('a.b.c.d.x.y');
    index.update([{ ...record, revision: 2, fields: { label: 'changed' } }]);
    expect(index.filter({ ...filter, search: 'changed' })).toHaveLength(1); expect(index.filter({ ...filter, search: 'shared' })).toEqual([]);
    index.update([], runtime); expect(index.filter(filter)).toEqual([]);
  });
});
