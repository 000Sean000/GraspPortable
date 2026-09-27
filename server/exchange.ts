import { randomUUID } from 'node:crypto';
import type { Diagnostic, Folder, ImportPlan, Note, StructuredRecord, WorkspaceSnapshot } from '../src/domain/model.js';
import { buildKnowledge } from '../src/domain/knowledge.js';
import { ValueGraph } from '../src/domain/graph.js';
import { StoreError, requireRevision, requireString, validateFolder, validateHierarchy, validateNote, validateRecord, type ImportPayload } from './store.js';

interface ExchangeHeader { format: 'grasp-markdown'; version: 2; workspaceId: string; workspaceRevision: number; notes: string[]; folders: Folder[]; records: StructuredRecord[] }
const PREAMBLE = '# GraspPortable · Markdown Exchange\n\n修改筆記正文或 metadata 中的 title / records，保留 workspace、note ID 與邊界。匯入會先顯示差異；此檔案不會自動同步回資料庫。';
// Escaping HTML punctuation makes metadata safe even for titles/record values containing comment terminators.
function metadata(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
export function exportMarkdown(snapshot: WorkspaceSnapshot): string {
  const header: ExchangeHeader = { format: 'grasp-markdown', version: 2, workspaceId: snapshot.id, workspaceRevision: snapshot.revision, notes: snapshot.notes.map(n => n.id), folders: snapshot.folders, records: snapshot.records };
  const sections = snapshot.notes.map(n => {
    let end = randomUUID();
    while (n.markdown.includes(`<!-- grasp-end ${end} -->`)) end = randomUUID();
    return `<!-- grasp-note ${metadata({ id: n.id, title: n.title, revision: n.revision, folderId: n.folderId, end })} -->\n${n.markdown}\n<!-- grasp-end ${end} -->`;
  });
  return `<!-- grasp-workspace ${metadata(header)} -->\n\n${PREAMBLE}\n\n${sections.join('\n\n')}\n`;
}

function parseJson(text: string, description: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new StoreError(`${description} 不是有效的 JSON。`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoreError(`${description} 必須是 JSON object。`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], description: string): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new StoreError(`${description} 含有未知欄位；請把新增內容放入筆記正文或 records.fields，避免遺漏。`);
}
function checkOutsideNotes(text: string, allowPreamble: boolean): void {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized && !(allowPreamble && normalized === PREAMBLE)) throw new StoreError('筆記邊界外有新增或修改的文字；請把內容移入 note 區塊，避免匯入時遺漏。');
}

export function parseExchange(markdown: string, snapshot: WorkspaceSnapshot): ImportPayload {
  requireString(markdown, '匯入 Markdown', 32 * 1024 * 1024);
  if (!markdown.trim()) throw new StoreError('匯入內容不得為空。');
  const first = /^\uFEFF?\s*<!-- grasp-workspace (\{[^\r\n]*\}) -->\r?\n/.exec(markdown);
  if (!first) {
    if (/<!--\s*grasp-(?:workspace|note|end)\b/.test(markdown)) throw new StoreError('Grasp metadata 或邊界毀損，請保留原始匯出標記。');
    const title = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim().slice(0, 500) || '匯入的筆記';
    return { notes: [{ id: randomUUID(), title, markdown, folderId: null }] };
  }
  const h = parseJson(first[1]!, 'Workspace metadata');
  if (h.format !== 'grasp-markdown' || (h.version !== 1 && h.version !== 2)) throw new StoreError('不支援的 Markdown exchange 格式版本。');
  exactKeys(h, ['format', 'version', 'workspaceId', 'workspaceRevision', 'notes', 'records', ...(h.version === 2 ? ['folders'] : [])], 'Workspace metadata');
  if (h.workspaceId !== snapshot.id) throw new StoreError('這份匯出來自另一個 workspace；請先開啟原 workspace。一般 Markdown 可作為新筆記匯入。');
  requireRevision(h.workspaceRevision);
  if (!Array.isArray(h.notes) || !h.notes.every(id => typeof id === 'string') || new Set(h.notes).size !== h.notes.length) throw new StoreError('筆記 ID 清單不完整或重複。');
  if (!Array.isArray(h.records)) throw new StoreError('Record metadata 不完整。');
  const records = h.records.map(record => {
    const validated = validateRecord(record);
    exactKeys(record as Record<string, unknown>, ['id', 'collection', 'name', 'fields', 'revision'], 'Record metadata');
    requireRevision((record as Record<string, unknown>).revision);
    return validated;
  });
  if (new Set(records.map(r => r.id)).size !== records.length || new Set(records.map(r => `${r.collection}\0${r.name}`)).size !== records.length) throw new StoreError('Record metadata 有重複 ID 或 name。');
  let folders: Folder[] | undefined;
  if (h.version === 2) {
    if (!Array.isArray(h.folders)) throw new StoreError('資料夾 metadata 不完整。');
    folders = h.folders.map(f => {
      const validated = validateFolder(f);
      exactKeys(f as Record<string, unknown>, ['id', 'parentId', 'name', 'revision'], 'Folder metadata');
      requireRevision((f as Record<string, unknown>).revision);
      return validated;
    });
    validateHierarchy(folders, []);
  }
  const notes: ImportPayload['notes'] = [];
  const startPattern = /<!-- grasp-note (\{[^\r\n]*\}) -->\r?\n/g;
  startPattern.lastIndex = first[0].length;
  let next: RegExpExecArray | null;
  let lastEnd = first[0].length;
  while ((next = startPattern.exec(markdown))) {
    checkOutsideNotes(markdown.slice(lastEnd, next.index), notes.length === 0);
    const n = parseJson(next[1]!, 'Note metadata');
    exactKeys(n, ['id', 'title', 'revision', 'end', ...(h.version === 2 ? ['folderId'] : [])], 'Note metadata');
    if (h.version === 2 && !Object.hasOwn(n, 'folderId')) throw new StoreError('Note metadata 缺少 folderId。');
    const end = requireString(n.end, 'Note boundary', 100);
    if (!/^[0-9a-f-]{36}$/.test(end)) throw new StoreError('Note boundary 不合法。');
    requireRevision(n.revision);
    const endMarker = `<!-- grasp-end ${end} -->`;
    const bodyStart = startPattern.lastIndex;
    const bodyEnd = markdown.indexOf(endMarker, bodyStart);
    if (bodyEnd < 0 || markdown[bodyEnd - 1] !== '\n') throw new StoreError('缺少完整 note 結束標記；沒有套用任何內容。');
    // Follow the structural opening line's EOL. A literal trailing CR in note
    // source must not be mistaken for our export's LF separator and discarded.
    const separatorLength = next[0].endsWith('\r\n') && markdown.slice(bodyEnd - 2, bodyEnd) === '\r\n' ? 2 : 1;
    const body = markdown.slice(bodyStart, bodyEnd - separatorLength);
    notes.push(validateNote({ id: n.id, title: n.title, markdown: body, ...(h.version === 2 ? { folderId: n.folderId } : {}) }));
    startPattern.lastIndex = bodyEnd + endMarker.length;
    lastEnd = startPattern.lastIndex;
  }
  checkOutsideNotes(markdown.slice(lastEnd), notes.length === 0);
  const ids = new Set(notes.map(n => n.id));
  if (ids.size !== notes.length || notes.length !== h.notes.length || !h.notes.every(id => ids.has(id as string))) throw new StoreError('匯出筆記的 ID 或數量不一致；本版不會把缺失區塊當成刪除。');
  if (folders) validateHierarchy(folders, notes);
  return { notes, records, ...(folders ? { folders } : {}) };
}

interface PendingImport { plan: ImportPlan; payload: ImportPayload; workspaceId: string; createdAt: number }
export class ExchangeService {
  private pending = new Map<string, PendingImport>();
  plan(markdown: string, snapshot: WorkspaceSnapshot): ImportPlan {
    let payload: ImportPayload;
    let proposedFolders: Folder[];
    try {
      payload = parseExchange(markdown, snapshot);
      const byFolder = new Map(snapshot.folders.map(f => [f.id, f]));
      for (const f of payload.folders ?? []) byFolder.set(f.id, f);
      proposedFolders = [...byFolder.values()];
      const byNote = new Map(snapshot.notes.map(n => [n.id, n]));
      for (const n of payload.notes) byNote.set(n.id, { ...n, folderId: n.folderId === undefined ? byNote.get(n.id)?.folderId ?? null : n.folderId, revision: 0, updatedAt: '' });
      validateHierarchy(proposedFolders, [...byNote.values()]);
    }
    catch (error) {
      return { token: '', workspaceRevision: snapshot.revision, changes: [], folders: [], records: [], diagnostics: [{ kind: 'syntax', message: error instanceof Error ? error.message : '匯入驗證失敗。' }], canApply: false };
    }
    const originals = new Map(snapshot.notes.map(n => [n.id, n]));
    const changes: ImportPlan['changes'] = payload.notes.map(n => {
      const old = originals.get(n.id);
      const afterFolderId = n.folderId === undefined ? old?.folderId ?? null : n.folderId;
      return { id: n.id, title: n.title, before: old?.markdown ?? '', after: n.markdown, beforeFolderId: old?.folderId ?? null, afterFolderId, kind: !old ? 'create' : old.markdown === n.markdown && old.title === n.title && old.folderId === afterFolderId ? 'unchanged' : 'update' };
    });
    const combined = new Map(snapshot.notes.map(n => [n.id, n]));
    for (const n of payload.notes) combined.set(n.id, { ...n, folderId: n.folderId === undefined ? originals.get(n.id)?.folderId ?? null : n.folderId, revision: 0, updatedAt: '' } as Note);
    const parsed = buildKnowledge([...combined.values()], payload.records ?? snapshot.records);
    const diagnostics: Diagnostic[] = new ValueGraph().update(parsed, snapshot.revision).diagnostics;
    const token = randomUUID();
    const plan: ImportPlan = { token, workspaceRevision: snapshot.revision, changes, folders: proposedFolders, records: payload.records ?? snapshot.records, diagnostics, canApply: !diagnostics.some(d => d.kind === 'syntax' || d.kind === 'duplicate' || d.kind === 'limit') };
    const now = Date.now();
    for (const [key, p] of this.pending) if (now - p.createdAt > 30 * 60_000) this.pending.delete(key);
    while (this.pending.size >= 10) this.pending.delete(this.pending.keys().next().value!);
    if (plan.canApply) this.pending.set(token, { plan, payload, workspaceId: snapshot.id, createdAt: now });
    return plan;
  }
  take(token: string, workspaceRevision: number, snapshot: WorkspaceSnapshot): ImportPayload {
    const pending = this.pending.get(token);
    if (!pending) throw new StoreError('匯入預覽已失效，請重新預覽。', 409);
    if (Date.now() - pending.createdAt > 30 * 60_000) { this.pending.delete(token); throw new StoreError('匯入預覽已過期，請重新預覽。', 409); }
    if (pending.workspaceId !== snapshot.id || pending.plan.workspaceRevision !== workspaceRevision || snapshot.revision !== workspaceRevision) throw new StoreError('Workspace 已變更，請重新預覽差異。', 409);
    this.pending.delete(token);
    return pending.payload;
  }
  clear(): void { this.pending.clear(); }
}
