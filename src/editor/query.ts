import type { RuntimeResult, StructuredRecord, ValueResult } from '../domain/model';

export interface RecordQuery { collection: string; where?: { field: string; equals: string } }
export interface QueryRow { id: string; name: string; cells: ValueResult[] }
export interface QueryView { columns: string[]; rows: QueryRow[]; total: number; truncated: boolean }
const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Deliberately data-only: query text never becomes JavaScript, SQL, or HTML. */
export function parseQuery(source: string): RecordQuery {
  const query: unknown = JSON.parse(source);
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Query 必須是 JSON object。');
  const q = query as Record<string, unknown>;
  if (Object.keys(q).some(key => key !== 'collection' && key !== 'where')) throw new Error('Query 僅支援 collection 與 where。');
  if (typeof q.collection !== 'string' || !identifier.test(q.collection)) throw new Error('請指定有效的 collection。');
  if (q.where === undefined) return { collection: q.collection };
  if (!q.where || typeof q.where !== 'object' || Array.isArray(q.where)) throw new Error('where 必須包含 field 與 equals。');
  const where = q.where as Record<string, unknown>;
  if (Object.keys(where).some(key => key !== 'field' && key !== 'equals') || typeof where.field !== 'string' || !identifier.test(where.field) || typeof where.equals !== 'string') {
    throw new Error('where 必須是 {"field":"欄位","equals":"值"}。');
  }
  return { collection: q.collection, where: { field: where.field, equals: where.equals } };
}

export function executeQuery(query: RecordQuery, records: StructuredRecord[], runtime: RuntimeResult, limit = 200): QueryView {
  const value = (record: StructuredRecord, field: string): ValueResult => runtime.values[`${record.collection}.${record.name}.${field}`]
    ?? { value: record.fields[field] ?? '', status: 'missing', message: '等待計算' };
  const matched = records.filter(record => {
    if (record.collection !== query.collection) return false;
    if (!query.where) return true;
    if (!Object.hasOwn(record.fields, query.where.field)) return false;
    const actual = value(record, query.where.field);
    return actual.status === 'ok' && actual.value === query.where.equals;
  });
  const columns = [...new Set(matched.flatMap(record => Object.keys(record.fields)))].sort();
  return {
    columns,
    rows: matched.slice(0, limit).map(record => ({ id: record.id, name: record.name, cells: columns.map(field => value(record, field)) })),
    total: matched.length,
    truncated: matched.length > limit,
  };
}

export function safeLink(url: string): string | null {
  const value = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(value)) return value;
  return null;
}

export function assetIdentifier(url: string): string | null { return /^grasp-asset:([A-Za-z0-9_-]+)$/.exec(url.trim())?.[1] ?? null; }
export function inlineAsset(mimeType: string): boolean { return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType.toLowerCase()); }
export function assetUrl(id: string, workspaceId: string): string { return `/api/assets/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspaceId)}`; }
export function attachmentMarkdown(attachment: { id: string; name: string; mimeType: string }, embed = inlineAsset(attachment.mimeType)): string {
  const label = attachment.name.replace(/[\r\n]/g, ' ').replace(/[\\\[\]]/g, '\\$&');
  return `${embed && inlineAsset(attachment.mimeType) ? '!' : ''}[${label}](grasp-asset:${attachment.id})`;
}
