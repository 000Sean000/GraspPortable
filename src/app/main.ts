import { createEditor, type EditorAdapter } from '../editor/editor';
import { RuntimeClient } from '../runtime/client';
import { LinksPanel } from './links-panel';
import { createNavigator } from './navigation';
import { KnowledgePanel } from './knowledge-panel';
import { RecordsPanel } from './records-panel';
import { FilesPanel } from './files-panel';
import { ProjectionPanel, locateProjectionUnit } from './projection-panel';
import { attachmentMarkdown } from '../editor/query';
import type { FileEntry, FilesStatus } from '../domain/files';
import type { RecordQuery } from '../editor/query';
import type { RenamePlan } from '../domain/rename';
import type { RecoveryPreview } from '../../server/store';
import type { DurableDraft, SharedIntent, SharedCommand, SharedStateResponse, SharedCommitResponse, OperationReceipt, SharedSourcePatch } from '../../server/semantic';
import { request, ApiError, setWorkspaceId, workspaceHeaders } from './api';
import { serializeReference } from '../domain/reference-language';
import { rebaseSourceEdits } from '../domain/edit-rebase';
import type { WorkspaceSnapshot, RuntimeResult, ImportPlan, StructuredRecord, SourceLocation } from '../domain/model';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<aside class="sidebar">
  <div class="brand"><span class="brand-mark">g.</span><div>Grasp<span>PORTABLE / 02</span></div></div>
  <button class="workspace-button" id="workspace-open"><span class="tiny-label">WORKSPACE</span><strong id="workspace-name">開啟中…</strong><span class="workspace-hint">切換或建立資料庫 ↗</span></button>
  <section id="navigation" aria-label="筆記與資料夾"></section>
  <div class="sidebar-bottom"><button id="files">▧ 檔案與 Markdown</button><button id="projection">分組策略與 Fallback</button><button id="export">↗ 匯出 Markdown</button><button id="import">↙ 匯入與審查</button><button id="history">↶ 復原紀錄</button><button id="help">? 使用說明</button><p>Local knowledge, connected.<br><span>SQLite · 本機資料庫</span></p></div>
</aside>
<main class="main-pane">
  <header class="toolbar"><span id="breadcrumb">WORKSPACE / NOTES</span><div class="toolbar-actions"><button id="mode" aria-pressed="true">Live Preview</button><button id="reading" aria-pressed="false">閱讀</button><button id="reveal-note" title="在檔案總管顯示目前筆記">顯示筆記檔</button><button id="open-note-folder" title="在檔案總管開啟目前筆記的資料夾">開啟資料夾</button><button id="save" title="Ctrl / ⌘ + S">儲存</button><button id="delete-note" class="quiet" title="刪除目前筆記">刪除</button><button id="toggle-inspector" class="quiet" aria-label="切換知識面板">◫</button></div></header>
  <div class="document-heading"><div class="eyebrow">YOUR CONNECTED NOTEBOOK</div><input id="note-title" aria-label="筆記標題" placeholder="未命名筆記"><div class="document-meta"><span id="note-meta"></span><span class="mode-hint">游標所在行編輯原文，其他位置即時呈現</span></div></div>
  <div id="draft-status" class="workflow-status" role="status" hidden></div>
  <div id="shared-status" class="workflow-status" hidden><span id="shared-receipt"></span><button id="shared-undo">撤銷共享修改</button></div>
  <div id="editor" aria-label="Markdown 編輯區"></div>
  <footer class="statusbar"><span id="save-status" role="status">載入中</span><span id="runtime-status">準備計算…</span><span id="document-stats"></span></footer>
</main>
<aside class="inspector"><div class="inspector-heading"><span class="eyebrow">KNOWLEDGE</span><h2>筆記裡的連結</h2><p>從文字到值，保持同步。</p></div><div class="tabs" role="tablist"><button id="tab-values" role="tab" aria-selected="true">識別值</button><button id="tab-records" role="tab" aria-selected="false">資料</button><button id="tab-links" role="tab" aria-selected="false">連結</button><button id="tab-issues" role="tab" aria-selected="false">診斷 <span id="issue-count">0</span></button></div><div id="inspector-content"></div></aside>
<div id="toast" class="toast" role="alert" hidden></div>
<dialog id="modal"><div class="modal-header"><h2 id="modal-title"></h2><button id="modal-close" class="icon-button" aria-label="關閉對話框">×</button></div><div id="modal-body"></div></dialog>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const el = document.createElement(tag); el.className = className; el.textContent = text; return el; };
const button = (text: string, action: () => unknown, className = '') => { const el = element('button', className, text); el.type = 'button'; el.addEventListener('click', () => void run(action)); return el; };
let snapshot: WorkspaceSnapshot;
let runtime: RuntimeResult | undefined;
let runtimeFailure: string | undefined;
let activeId = '';
let mode: 'live' | 'source' | 'reading' = 'live';
let panel: 'values' | 'records' | 'issues' | 'links' = 'values';
const linksPanel = new LinksPanel();
const knowledgePanel = new KnowledgePanel();
const recordsPanel = new RecordsPanel();
const filesPanel = new FilesPanel();
const projectionPanel = new ProjectionPanel();
let valueFilter = '';
let selectedIdentifier: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | undefined;
let saveFailure: Error | undefined;
let draftSequence = 0;
interface LocalDraft {
  title: string; markdown: string; sequence: number; baseRevision: number;
  id: string; clientId: string; persistedRevision: number; baseSourceHash?: string;
  savedSequence?: number; diagnostics?: string[]; conflict?: string;
  sourceEdits?: { from: number; to: number; insert: string }[][];
}
const drafts = new Map<string, LocalDraft>();
const draftClientId = (() => { try { const previous = sessionStorage.getItem('grasp-draft-client'); const id = previous || crypto.randomUUID(); sessionStorage.setItem('grasp-draft-client', id); return id; } catch { return crypto.randomUUID(); } })();
let shared: SharedStateResponse | undefined;
let sharedRefresh: Promise<void> | undefined;
let lastSharedOperation: OperationReceipt | undefined;
let recoverableDrafts: DurableDraft[] = [];
let pendingSharedCommand: SharedCommand | undefined;
const retiredDraftIds = new Map<string, Set<string>>();
let discardReview: { noteId: string; id: string; sequence: number; revision: number } | undefined;
let pendingCommitDraft: { noteId: string; draft: LocalDraft } | undefined;
let modalEditor: EditorAdapter | undefined;
let editorBase: { workspaceId: string; noteId: string; revision: number } | undefined;
let pendingNavigation: { workspaceId: string; patch: Record<string, string> } | undefined;
let actionTail: Promise<unknown> = Promise.resolve();
const runtimeWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
const worker = new RuntimeClient(result => {
  if (!snapshot || result.revision !== snapshot.revision) return;
  runtime = result;
  runtimeFailure = undefined;
  for (const waiter of runtimeWaiters.splice(0)) waiter.resolve();
  editor.setRuntime(result, snapshot.records);
  updateWorkflowStatus();
  $('runtime-status').textContent = `${result.metrics.total} 個值 · 重算 ${result.metrics.recalculated} · ${result.metrics.elapsedMs.toFixed(1)} ms`;
  $('issue-count').textContent = String(result.diagnostics.length);
  renderInspector();
}, message => { runtimeFailure = message; $('runtime-status').textContent = '計算暫停'; for (const waiter of runtimeWaiters.splice(0)) waiter.reject(new Error(message)); toast(message, true); });
const editor = createEditor($('editor'), {
  onChange: (markdown, changes) => { if (snapshot && activeId) markDraft(markdown, changes); },
  onNavigate: name => void run(() => navigateIdentifier(name)),
  onFindReferences: name => { selectedIdentifier = name; panel = 'values'; renderInspector(); },
  onEditShared: name => void run(() => sharedValueDialog(name)),
  onOpenRecord: id => { recordsPanel.revealRecord(id); panel = 'records'; renderInspector(); const record = snapshot.records.find(r => r.id === id); if (record) recordDialog(record); },
  onOpenQuery: query => { recordsPanel.setQuery(query); panel = 'records'; renderInspector(); },
});
// The Navigator owns presentation and derived search state; all mutations still
// pass through this application's ordered save/command queue.
function navigationCommand<T>(action: () => Promise<T>): Promise<T> {
  const workspaceId = snapshot?.id;
  const next = actionTail.then(async () => { if (workspaceId !== snapshot?.id) throw new Error('Workspace 已切換，請重新操作。'); return action(); });
  actionTail = next.catch(() => {}); return next;
}
async function navigationMutation(path: string, method: 'POST' | 'PUT' | 'DELETE', payload: () => unknown) {
  await transition(async () => { await flush(); acceptSnapshot(await request<WorkspaceSnapshot>(path, method, payload()), true); setSaveStatus('✓ 已儲存至 SQLite'); });
}
function saveNavigationSettings(patch: Record<string, string>) {
  return navigationCommand(async () => {
    // Cosmetic recents must not invalidate a revision-bound review that is open.
    if (document.querySelector('dialog[open]')) { pendingNavigation = { workspaceId: snapshot.id, patch }; return; }
    await flush(); if (Object.entries(patch).every(([k, v]) => snapshot.settings[k] === v)) return;
    acceptSnapshot(await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, ...patch } }));
  });
}
const navigator = createNavigator($('navigation'), {
  onSelect: (id, range) => { const source = snapshot.notes.find(n => n.id === id)?.markdown; return navigationCommand(async () => { await flush(); await selectNote(id); if (range) { if (source !== snapshot.notes.find(n => n.id === id)?.markdown) throw new Error('文字已變更，搜尋結果已更新；請重新選取位置。'); if (mode === 'reading') setMode('live'); editor.focusRange(range.from, range.to); } }); },
  onCreateNote: folderId => navigationCommand(async () => { await createNote('未命名筆記', '', folderId); ($('note-title') as HTMLInputElement).focus(); ($('note-title') as HTMLInputElement).select(); }),
  onRenameNote: (id, title) => navigationCommand(() => navigationMutation(`/notes/${encodeURIComponent(id)}`, 'PUT', () => { const note = snapshot.notes.find(n => n.id === id)!; return { title, markdown: note.markdown, revision: note.revision }; })),
  onMoveNote: (id, folderId) => navigationCommand(() => navigationMutation(`/notes/${encodeURIComponent(id)}/move`, 'PUT', () => ({ folderId, revision: snapshot.notes.find(n => n.id === id)!.revision }))),
  onDeleteNote: id => navigationCommand(() => navigationMutation(`/notes/${encodeURIComponent(id)}`, 'DELETE', () => ({ revision: snapshot.notes.find(n => n.id === id)!.revision }))),
  onCreateFolder: (parentId, name) => navigationCommand(() => navigationMutation('/folders', 'POST', () => ({ parentId, name }))),
  onRenameFolder: (id, name) => navigationCommand(() => navigationMutation(`/folders/${encodeURIComponent(id)}`, 'PUT', () => { const folder = snapshot.folders.find(f => f.id === id)!; return { name, parentId: folder.parentId, revision: folder.revision }; })),
  onMoveFolder: (id, parentId) => navigationCommand(() => navigationMutation(`/folders/${encodeURIComponent(id)}`, 'PUT', () => { const folder = snapshot.folders.find(f => f.id === id)!; return { name: folder.name, parentId, revision: folder.revision }; })),
  onDeleteFolder: id => navigationCommand(() => navigationMutation(`/folders/${encodeURIComponent(id)}`, 'DELETE', () => ({ revision: snapshot.folders.find(f => f.id === id)!.revision, workspaceRevision: snapshot.revision, recursive: true }))),
  onRevealNote: id => navigationCommand(() => revealNote(id)),
  onOpenFolder: id => navigationCommand(() => openLogicalFolder(id)),
  onPersistSettings: saveNavigationSettings,
  onError: message => toast(message, true),
});

function toast(message: string, persistent = false) {
  const el = $('toast'); el.replaceChildren(element('span', '', message), button('×', () => { el.hidden = true; }, 'toast-close')); el.hidden = false;
  if (!persistent) setTimeout(() => { if (el.textContent?.startsWith(message)) el.hidden = true; }, 5500);
}
function run(action: () => unknown): Promise<void> {
  const next = actionTail.then(action).then(() => {}, error => { toast(error instanceof Error ? error.message : String(error), true); });
  actionTail = next; return next;
}
async function transition<T>(action: () => Promise<T>): Promise<T> {
  const main = document.querySelector<HTMLElement>('.main-pane')!;
  const wasInert = main.inert;
  // Explicit navigation/replace commands briefly lock the old document; ordinary autosave never does.
  main.inert = true;
  try { return await action(); } finally { main.inert = wasInert; }
}
async function currentRuntime() {
  if (runtime?.revision === snapshot.revision) return;
  if (runtimeFailure) throw new Error(runtimeFailure);
  await new Promise<void>((resolve, reject) => runtimeWaiters.push({ resolve, reject }));
}
function setSaveStatus(text: string, error = false) { $('save-status').textContent = text; $('save-status').classList.toggle('error', error); }
function hasUnsavedDrafts() { return [...drafts.values()].some(draft => draft.savedSequence !== draft.sequence); }
function setMode(next: typeof mode) {
  mode = next; editor.setMode(mode);
  document.querySelector('.mode-hint')!.textContent = mode === 'reading' ? '閱讀模式 · 點引用可前往定義或修改共享值' : mode === 'source' ? '編輯原文 · 未完成語法自動保存為草稿' : '游標所在行編輯原文，其他位置即時呈現';
  $('mode').textContent = mode === 'live' ? 'Live Preview' : mode === 'source' ? 'Source' : '回到編輯';
  $('mode').setAttribute('aria-pressed', String(mode === 'live'));
  $('reading').setAttribute('aria-pressed', String(mode === 'reading'));
}
function minimalSourceChange(before: string, after: string) {
  if (before === after) return [];
  let from = 0, to = before.length, end = after.length;
  while (from < to && from < end && before[from] === after[from]) from++;
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
  const split = (text: string, at: number) => at > 0 && at < text.length &&
    ((text[at - 1] === '\r' && text[at] === '\n') || (/^[\uD800-\uDBFF]$/.test(text[at - 1]) && /^[\uDC00-\uDFFF]$/.test(text[at])));
  if (split(before, from) || split(after, from)) from--;
  if (split(before, to) || split(after, end)) { to++; end++; }
  return [{ from, to, expected: before.slice(from, to), insert: after.slice(from, end) }];
}
async function refreshSharedState() {
  if (sharedRefresh) return sharedRefresh;
  const workspaceId = snapshot.id;
  sharedRefresh = (async () => {
    const next = await request<SharedStateResponse>('/shared/state');
    if (snapshot.id !== workspaceId || next.snapshot.id !== workspaceId || next.snapshot.revision < snapshot.revision) return;
    shared = next;
    if (next.snapshot.revision > snapshot.revision) acceptSnapshot(next.snapshot);
    updateWorkflowStatus();
  })();
  try { await sharedRefresh; } finally { sharedRefresh = undefined; }
}
function retiredDrafts(workspaceId = snapshot.id): Set<string> {
  let ids = retiredDraftIds.get(workspaceId);
  if (!ids) {
    ids = new Set<string>();
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(`grasp-retired-drafts:${workspaceId}`) ?? '[]');
      if (Array.isArray(stored)) for (const id of stored) if (typeof id === 'string') ids.add(id);
    } catch { /* This is only a UI recovery preference; all drafts remain in SQLite. */ }
    retiredDraftIds.set(workspaceId, ids);
  }
  return ids;
}
function markRetiredDraft(id: string, retired: boolean) {
  const ids = retiredDrafts(); if (retired) ids.add(id); else ids.delete(id);
  try { localStorage.setItem(`grasp-retired-drafts:${snapshot.id}`, JSON.stringify([...ids])); } catch { /* Keep the in-session pointer. */ }
}
async function refreshRecoverableDrafts() {
  const workspaceId = snapshot.id;
  const stored = await request<DurableDraft[]>('/drafts');
  if (snapshot.id !== workspaceId) return;
  recoverableDrafts = stored;
}
async function loadDurableDrafts() {
  const workspaceId = snapshot.id;
  const [, host] = await Promise.all([refreshRecoverableDrafts(), request<{ recoveredDraftIds?: string[] }>('/host')]);
  if (snapshot.id !== workspaceId) return;
  const recovered = new Set(host.recoveredDraftIds ?? []);
  for (const draft of recoverableDrafts.filter(draft => draft.clientId === draftClientId && !recovered.has(draft.id) && !retiredDrafts().has(draft.id) && snapshot.notes.some(note => note.id === draft.noteId))) {
    if (!drafts.has(draft.noteId)) restoreLocalDraft(draft);
  }
  showActiveNote(); updateWorkflowStatus();
}
function restoreLocalDraft(stored: DurableDraft) {
  const sequence = ++draftSequence;
  drafts.set(stored.noteId, { id: stored.id, clientId: stored.clientId, title: stored.title, markdown: stored.markdown,
    sequence, savedSequence: sequence, persistedRevision: stored.revision, baseRevision: stored.baseNoteRevision,
    baseSourceHash: stored.baseSourceHash, sourceEdits: stored.sourceEdits, diagnostics: ['已恢復保存的草稿；完成後可提交。'] });
}
function updateWorkflowStatus() {
  if (!snapshot) return;
  const status = $('draft-status'); status.replaceChildren();
  const current = drafts.get(activeId);
  const stored = [...drafts.values()].filter(draft => draft.savedSequence === draft.sequence);
  const available = recoverableDrafts.filter(item => !snapshot.notes.some(note => note.id === item.noteId) || ![...drafts.values()].some(draft => draft.id === item.id));
  status.hidden = !current && !stored.length && !available.length;
  status.classList.toggle('warning', !!current || !!stored.length);
  if (current) {
    status.append(element('span', '', current.conflict ?? (current.savedSequence === current.sequence
      ? `草稿已保存，尚未套用共享資料。${current.diagnostics?.join(' ') ?? ''}` : '正在編輯草稿；引用仍顯示上一個已提交值。')));
    if (current.savedSequence === current.sequence) status.append(button('提交草稿', async () => { current.savedSequence = undefined; await flush(); }));
    status.append(button('捨棄草稿', () => discardDraftDialog(activeId)));
    if (current.baseRevision !== snapshot.notes.find(note => note.id === activeId)?.revision) status.append(button('比較最新版本', () => reviewDraftBase(activeId)));
  } else if (stored.length) status.append(element('span', '', `另有 ${stored.length} 份未完成草稿；共享值顯示已提交版本 ${shared?.semantic.revision ?? snapshot.revision}。`));
  if (available.length) status.append(button(`恢復草稿（${available.length}）`, recoveryDraftDialog));
  const affected = new Set(runtime?.definitions.filter(definition => definition.owner?.kind === 'note' && drafts.has(definition.owner.noteId)).map(definition => definition.name) ?? []);
  const queue = [...affected];
  const dependents = new Map<string, string[]>();
  for (const definition of runtime?.definitions ?? []) for (const dependency of definition.dependencies) {
    const names = dependents.get(dependency) ?? []; names.push(definition.name); dependents.set(dependency, names);
  }
  for (let index = 0; index < queue.length; index++) for (const name of dependents.get(queue[index]) ?? []) if (!affected.has(name)) { affected.add(name); queue.push(name); }
  editor.setPendingValues([...affected]);
  $('shared-status').hidden = !lastSharedOperation && !pendingSharedCommand;
  $('shared-receipt').textContent = pendingSharedCommand ? `操作結果待確認：${pendingSharedCommand.operationId}`
    : lastSharedOperation ? `共享修改已提交 · 版本 ${lastSharedOperation.semanticRevision}` : '';
  $('shared-undo').textContent = pendingSharedCommand ? '確認／重試上次操作' : '撤銷共享修改';
}
function recoveryDraftDialog() {
  const body = openModal('恢復保存的草稿');
  body.append(element('p', '', '草稿不會直接改變已提交值。選取後可繼續編輯、比較最新版本，或明確捨棄。'));
  for (const stored of recoverableDrafts) {
    const row = element('div', 'history-row');
    if (!snapshot.notes.some(note => note.id === stored.noteId)) {
      row.append(element('span', '', `${stored.title} · 原筆記已刪除，下載草稿`), button('下載草稿', () => download(stored.markdown, `${stored.title || 'draft'}.md`)));
      body.append(row); continue;
    }
    row.append(element('span', '', `${stored.title} · ${new Date(stored.updatedAt).toLocaleString()} · 基底 ${stored.baseNoteRevision}`), button('恢復', async () => {
      await flush();
      if (drafts.has(stored.noteId)) throw new Error('這篇筆記已有開啟的草稿；請先完成或捨棄它。');
      restoreLocalDraft(stored); markRetiredDraft(stored.id, false); activeId = stored.noteId; showActiveNote(); updateWorkflowStatus(); closeModal();
    })); body.append(row);
  }
}
function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void run(() => { if (!discardReview) return flush(); }), 350);
}
async function discardDraftDialog(noteId: string) {
  if (pendingSharedCommand) throw new Error('前一項共享操作結果尚未確認；請先確認原操作，再決定是否捨棄草稿。');
  clearTimeout(saveTimer);
  if (saving) await saving;
  const draft = drafts.get(noteId); if (!draft) return;
  const review = { noteId, id: draft.id, sequence: draft.sequence, revision: draft.persistedRevision };
  discardReview = review;
  $('modal').addEventListener('close', () => {
    if (discardReview !== review) return;
    discardReview = undefined;
    if (hasUnsavedDrafts()) scheduleAutosave();
  }, { once: true });
  const body = openModal('捨棄這份草稿');
  body.append(element('p', '', `捨棄「${draft.title}」的未提交內容，回到資料庫目前版本？已提交共享值不受影響。`),
    button('取消', closeModal), button('確認捨棄草稿', () => transition(async () => {
      const current = drafts.get(noteId);
      if (!current || current.id !== review.id || current.sequence !== review.sequence || current.persistedRevision !== review.revision) throw new Error('確認期間草稿已變更；請取消後重新檢查要捨棄的版本。');
      if (review.revision) {
        try { await request(`/drafts/${encodeURIComponent(review.id)}`, 'DELETE', { revision: review.revision }); }
        catch (error) {
          // The delete may already have succeeded when its response was lost.
          const remaining = await request<DurableDraft[]>('/drafts');
          if (remaining.some(item => item.id === review.id)) throw error;
        }
      }
      drafts.delete(noteId); recoverableDrafts = recoverableDrafts.filter(item => item.id !== draft.id);
      markRetiredDraft(draft.id, false);
      saveFailure = undefined;
      setSaveStatus(hasUnsavedDrafts() ? '● 等待儲存' : drafts.size ? '✓ 草稿已保存 · 共享值使用已提交版本' : '✓ 已儲存至 SQLite');
      await refreshSharedState(); showActiveNote(); updateWorkflowStatus(); closeModal();
    }), 'danger'));
}
async function reviewDraftBase(noteId: string) {
  await flush(); await refreshSharedState(); const draft = drafts.get(noteId), note = snapshot.notes.find(item => item.id === noteId);
  if (!draft || !note) return;
  const body = openModal('比較草稿與最新版本');
  body.append(element('p', '', '這份草稿建立後，共享資料已更新。請比較整份內容；確認後將以右側草稿提出新的修改，引用快取會重新計算。原草稿仍可從恢復清單取得。'), diffCard(note.title, note.markdown, draft.markdown));
  body.append(button('保留原草稿', closeModal), button('以這份草稿重新審查', () => transition(async () => {
    if (snapshot.notes.find(item => item.id === noteId)?.revision !== note.revision) throw new Error('版本再次變更，請重新比較。');
    markRetiredDraft(draft.id, true);
    drafts.set(noteId, { ...draft, id: crypto.randomUUID(), clientId: draftClientId, persistedRevision: 0, baseRevision: note.revision,
      baseSourceHash: shared?.noteSources.find(item => item.noteId === noteId)?.sourceHash, sequence: ++draftSequence,
      sourceEdits: [[{ from: 0, to: note.markdown.length, insert: draft.markdown }]], savedSequence: undefined, conflict: undefined, diagnostics: undefined });
    closeModal();
    try { await flush(); }
    finally { await refreshRecoverableDrafts(); updateWorkflowStatus(); }
  }), 'primary'));
}
async function executeSharedCommand(command: SharedCommand): Promise<SharedCommitResponse> {
  if (pendingSharedCommand && (pendingSharedCommand.operationId !== command.operationId || JSON.stringify(pendingSharedCommand) !== JSON.stringify(command))) throw new Error('前一項共享操作結果尚未確認；請先確認或重試原操作。');
  pendingSharedCommand = command; updateWorkflowStatus();
  try {
    const result = await request<SharedCommitResponse>('/shared/commands', 'POST', command);
    pendingSharedCommand = undefined; return result;
  } catch (error) {
    // A definite rejected request cannot have committed. Unknown transport/5xx
    // results retain the exact operation for an idempotent retry.
    if (error instanceof ApiError && error.status < 500) pendingSharedCommand = undefined;
    else {
      try {
        const receipt = await request<OperationReceipt>(`/shared/operations/${encodeURIComponent(command.operationId)}`);
        const state = await request<SharedStateResponse>('/shared/state');
        pendingSharedCommand = undefined; return { ...state, receipt, sourcePatches: receipt.sourcePatches };
      } catch { /* Keep the same command; never invent a second operation ID. */ }
    }
    updateWorkflowStatus(); throw error;
  }
}
async function sharedCommand(intent: SharedIntent) {
  if (pendingSharedCommand) throw new Error('前一項共享操作結果尚未確認；請先使用「確認／重試上次操作」。');
  await refreshSharedState();
  if (!shared || shared.snapshot.id !== snapshot.id) throw new Error('共享資料尚未載入。');
  return executeSharedCommand({ operationId: crypto.randomUUID(), workspaceId: snapshot.id, baseSemanticRevision: shared.semantic.revision, intent });
}
function acceptSharedResult(result: SharedCommitResponse, remember = true) {
  if (result.snapshot.id !== snapshot.id) return;
  // A navigation-settings response may have advanced the workspace revision
  // while this content receipt was in flight. Still acknowledge the clean
  // editor against the newest snapshot after removing the committed draft.
  if (result.snapshot.revision < snapshot.revision) acceptSnapshot(snapshot, false, result.sourcePatches);
  else { shared = result; acceptSnapshot(result.snapshot, false, result.sourcePatches); }
  if (remember && result.receipt.kind !== 'commit-draft') {
    lastSharedOperation = result.receipt.kind === 'undo' ? undefined : result.receipt;
    try { const key = `grasp-shared-undo:${snapshot.id}`; if (lastSharedOperation) localStorage.setItem(key, lastSharedOperation.operationId); else localStorage.removeItem(key); } catch { /* Receipt remains durable in SQLite. */ }
  }
  updateWorkflowStatus();
}
async function acknowledgeDraft(noteId: string, submitted: LocalDraft, result: SharedCommitResponse) {
  const committed = result.snapshot.notes.find(item => item.id === noteId);
  if (!committed) throw new Error('提交回應缺少原筆記；請保留草稿並重新載入。');
  for (;;) {
    const newer = drafts.get(noteId);
    if (!newer || newer.sequence === submitted.sequence) { drafts.delete(noteId); break; }
    const acknowledgement = result.draftAcknowledgement ?? result.receipt.draftAcknowledgement;
    const pendingSteps = submitted.sourceEdits && newer.sourceEdits ? newer.sourceEdits.slice(submitted.sourceEdits.length) : undefined;
    const rebased = acknowledgement && pendingSteps ? rebaseSourceEdits(submitted.markdown, committed.markdown, acknowledgement.edits, pendingSteps) : undefined;
    if (rebased?.ok) {
      if (activeId === noteId) {
        const version = editor.getDocumentVersion();
        const applied = editor.applySemanticPatch({ expectedKey: version.key, expectedRevision: version.revision, nextRevision: committed.revision,
          expectedSource: newer.markdown, changes: minimalSourceChange(newer.markdown, rebased.rebasedSource) });
        if (applied.status === 'composing') { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
        if (applied.status !== 'applied') throw new Error('本地草稿在確認期間已變更，請保留內容後比較版本。');
        editorBase = { workspaceId: snapshot.id, noteId, revision: committed.revision };
      }
      newer.markdown = rebased.rebasedSource; newer.sourceEdits = rebased.rebasedSteps;
      newer.baseRevision = committed.revision; newer.baseSourceHash = result.noteSources.find(item => item.noteId === noteId)?.sourceHash;
    } else {
      // Preserve the old exact base/journal when concurrent edits overlap the
      // cache publication. A new durable draft can be saved against that base;
      // only explicit comparison may choose how to reconcile the content.
      newer.conflict = '輸入與已提交快取更新重疊；草稿保留，請比較最新版本後重新審查。';
    }
    newer.id = crypto.randomUUID(); newer.persistedRevision = 0; newer.savedSequence = undefined;
    break;
  }
  recoverableDrafts = recoverableDrafts.filter(item => item.id !== submitted.id);
  pendingCommitDraft = undefined;
}
async function sharedValueDialog(name: string) {
  await flush(); await refreshSharedState();
  const state = shared!.semantic, identifier = state.identifiers.find(item => item.name === name);
  if (!identifier) throw new Error(`找不到共享 identifier：${name}`);
  const definitions = state.bindings.filter(binding => binding.identifierId === identifier.id);
  const result = state.results.find(item => item.identifierId === identifier.id);
  const body = openModal(`共享值 · ${name}`);
  body.append(element('p', '', '修改會更新同一個共享定義及所有受影響的巢狀結果。組合值請選擇要修改的片段；不會從展開文字猜測或移除依賴。'));
  body.append(element('div', 'shared-result', result?.current.status === 'ok' ? result.current.value || '（空字串）' : result?.current.message ?? '尚未定義'));
  if (result?.current.status !== 'ok' && result?.lastGood) body.append(element('p', 'muted', `上一個成功值（版本 ${result.lastGood.semanticRevision}）：${result.lastGood.value}`));
  body.append(element('p', 'shared-identity', `Identifier ${identifier.id}`));
  if (definitions.length !== 1) { body.append(element('p', 'validation-error', definitions.length ? '有多個定義，請先從定義清單處理歧義。' : '尚未有 binding。請在筆記中建立定義。'), button('查看定義／引用', () => { selectedIdentifier = name; panel = 'values'; renderInspector(); closeModal(); })); return; }
  const binding = definitions[0];
  if (binding.owner.kind === 'note' && drafts.has(binding.owner.noteId)) body.append(element('p', 'validation-error', '定義所在筆記有未提交草稿；請先完成、比較或捨棄草稿。'));
  const ownerNoteId = binding.owner.kind === 'note' ? binding.owner.noteId : undefined;
  body.append(element('p', '', `${state.occurrences.filter(item => item.identifierId === identifier.id).length} 處正文引用；定義版本 ${binding.revision}。`));
  binding.parts.forEach((part, partIndex) => {
    const row = element('section', 'shared-part');
    row.append(element('strong', '', `${partIndex + 1}. ${part.kind === 'literal' ? 'Literal' : `取值 ${part.name}`}`));
    if (part.kind === 'literal') row.append(element('pre', 'shared-result', part.value || '（空字串）'));
    const edit = button(part.kind === 'literal' ? `編輯第 ${partIndex + 1} 段文字` : `修改第 ${partIndex + 1} 段依賴`, () => {
      const target = openModal(`${name} · 第 ${partIndex + 1} 段`);
      let literalValue = part.kind === 'literal' ? part.value : '';
      const field = part.kind === 'literal' ? element('div', 'shared-literal-editor') : input(part.name);
      if (part.kind === 'literal') {
        field.setAttribute('aria-label', 'Literal 內容');
        modalEditor = createEditor(field, { onChange: value => { literalValue = value; }, onNavigate() {}, onFindReferences() {} });
        modalEditor.setDocument(part.value, `literal:${binding.id}:${partIndex}`, binding.revision, 'legacy-v0.2');
        modalEditor.setMode('source');
      }
      const wrapper = element('div', 'shared-part'); wrapper.append(labeled(part.kind === 'literal' ? 'Literal 內容（保留空白與換行）' : '目標 Identifier（既有名稱）', field)); target.append(wrapper);
      target.append(element('p', '', '只修改這個片段；其他 literal 與依賴保持原順序。'), button('返回組成', () => sharedValueDialog(name)), button('提交共享修改', async () => {
        await flush();
        if (ownerNoteId && drafts.has(ownerNoteId)) throw new Error('定義仍有草稿，請先處理草稿。');
        const intent: SharedIntent = part.kind === 'literal'
          ? { kind: 'set-literal', bindingId: binding.id, bindingRevision: binding.revision, partIndex, value: literalValue }
          : { kind: 'set-dependency', bindingId: binding.id, bindingRevision: binding.revision, partIndex,
            targetIdentifierId: state.identifiers.find(item => item.name === (field as HTMLInputElement).value)?.id ?? '' };
        if (intent.kind === 'set-dependency' && !intent.targetIdentifierId) throw new Error('請輸入存在的 Identifier 名稱；新的定義可在筆記中建立。');
        const committed = await sharedCommand(intent); acceptSharedResult(committed); closeModal(); toast('共享定義、巢狀結果與引用快取已一起保存。');
      }, 'primary'));
    });
    edit.disabled = !!ownerNoteId && drafts.has(ownerNoteId); row.append(edit); body.append(row);
  });
  body.append(button('前往定義', async () => { closeModal(); await navigateIdentifier(name); }), button('重新命名', () => renameDialog(name)),
    button('在檔案總管顯示定義', async () => { const entry = await locateProjectionUnit(`binding:${binding.id}`); toast(entry.absolutePath); }));
}
function markDraft(markdown = editor.getDocument(), changes: readonly { from: number; to: number; insert: string }[] = []) {
  const previous = drafts.get(activeId);
  const baseRevision = previous?.baseRevision ?? (editorBase?.workspaceId === snapshot.id && editorBase.noteId === activeId ? editorBase.revision : snapshot.notes.find(n => n.id === activeId)!.revision);
  const source = shared?.noteSources.find(note => note.noteId === activeId && note.revision === baseRevision);
  drafts.set(activeId, { ...previous, id: previous?.id ?? crypto.randomUUID(), clientId: previous?.clientId ?? draftClientId,
    persistedRevision: previous?.persistedRevision ?? 0, baseSourceHash: previous?.baseSourceHash ?? source?.sourceHash,
    sourceEdits: previous && previous.sourceEdits === undefined ? undefined : [...(previous?.sourceEdits ?? []), ...(changes.length ? [[...changes]] : [])],
    title: ($('note-title') as HTMLInputElement).value, markdown, sequence: ++draftSequence, baseRevision, diagnostics: undefined, conflict: undefined });
  saveFailure = undefined; setSaveStatus('● 等待儲存'); updateStats();
  updateWorkflowStatus();
  scheduleAutosave();
}
function updateStats() { $('document-stats').textContent = `${editor.getDocument().length.toLocaleString()} 字元`; }
function updateEditorAssets() {
  const note = snapshot.notes.find(n => n.id === activeId);
  const links = snapshot.attachments.length && note && !drafts.has(activeId) ? (linksPanel.getIndex(snapshot).byNote.get(activeId) ?? []).flatMap(link => link.status === 'resolved' && link.resolvedTarget?.kind === 'asset' ? [{ from: link.location.from, to: link.location.to, raw: link.raw, id: link.resolvedTarget.id, embed: link.embed, label: link.alias }] : []) : [];
  editor.setAssets(snapshot.id, snapshot.attachments, links);
}
function acceptSnapshot(next: WorkspaceSnapshot, resetEditor = false, sourcePatches: SharedSourcePatch[] = []) {
  if (snapshot && next.id === snapshot.id && next.revision < snapshot.revision) return;
  const previousNote = snapshot?.id === next.id ? snapshot.notes.find(note => note.id === activeId) : undefined;
  const changedWorkspace = snapshot && next.id !== snapshot.id;
  snapshot = next;
  $('navigation').inert = false;
  for (const id of ['save', 'mode', 'reading', 'delete-note', 'export', 'import', 'history', 'files', 'reveal-note', 'open-note-folder']) ($<HTMLButtonElement>(id)).disabled = false;
  setWorkspaceId(next.id);
  if (changedWorkspace) {
    drafts.clear(); recoverableDrafts = []; lastSharedOperation = undefined;
    if (shared?.snapshot.id !== next.id) shared = undefined;
    runtime = undefined; selectedIdentifier = undefined; valueFilter = ''; ($('note-search') as HTMLInputElement).value = '';
    editor.setRuntime({ revision: next.revision, values: {}, definitions: [], references: [], diagnostics: [], metrics: { elapsedMs: 0, recalculated: 0, total: 0, affected: 0 } }, []);
    setMode(next.settings.mode === 'source' ? 'source' : next.settings.mode === 'reading' ? 'reading' : 'live');
    void loadDurableDrafts().catch(error => toast(`草稿載入失敗：${String(error)}`, true));
  }
  if (!snapshot.notes.some(n => n.id === activeId)) activeId = snapshot.settings.activeNoteId && snapshot.notes.some(n => n.id === snapshot.settings.activeNoteId) ? snapshot.settings.activeNoteId : snapshot.notes[0]?.id || '';
  $('workspace-name').textContent = snapshot.name;
  document.title = `${snapshot.name} · GraspPortable`;
  renderNotes();
  const current = snapshot.notes.find(n => n.id === activeId);
  const clean = !drafts.has(activeId);
  const version = editor.getDocumentVersion();
  if (!current || version.key !== `${snapshot.id}:${activeId}` || version.syntaxVersion !== (current.syntaxVersion ?? 'legacy-v0.2')) showActiveNote();
  else if (clean) {
    const before = editor.getDocument();
    const patch = before === previousNote?.markdown ? sourcePatches.find(item => item.noteId === current.id && item.baseRevision === version.revision && item.baseRevision === previousNote.revision) : undefined;
    const proposed = patch?.edits.map(edit => ({ ...edit, expected: before.slice(edit.from, edit.to) }));
    let patched = before;
    for (const edit of [...proposed ?? []].reverse()) patched = patched.slice(0, edit.from) + edit.insert + patched.slice(edit.to);
    const changes = proposed && patched === current.markdown ? proposed : minimalSourceChange(before, current.markdown);
    const applied = editor.applySemanticPatch({ expectedKey: version.key, expectedRevision: version.revision,
      nextRevision: current.revision, expectedSource: before, changes });
    if (applied.status === 'applied') {
      ($('note-title') as HTMLInputElement).value = current.title;
      editorBase = { workspaceId: snapshot.id, noteId: current.id, revision: current.revision };
    } else if (applied.status === 'composing') {
      const id = activeId; setTimeout(() => { if (activeId === id && !drafts.has(id)) acceptSnapshot(snapshot); }, 100);
    } else toast('編輯器基底已變更；目前文字保留，請比較最新版本。', true);
  } else if (resetEditor) showActiveNote();
  if (clean) updateEditorAssets();
  $('runtime-status').textContent = '背景計算中…';
  runtimeFailure = undefined;
  worker.update(snapshot);
  renderInspector();
  updateStats(); updateWorkflowStatus();
  if (shared?.snapshot.revision !== next.revision) void refreshSharedState().catch(error => toast(`共享資料載入失敗：${String(error)}`, true));
  if (current) {
    $('note-meta').textContent = `修訂 ${current.revision} · ${new Date(current.updatedAt).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    $('breadcrumb').textContent = `${snapshot.name} / ${navigator.notePath(activeId) || current.title}`;
  }
}
async function flush() {
  clearTimeout(saveTimer);
  if (saving) { await saving; if (hasUnsavedDrafts()) await flush(); return; }
  saving = (async () => {
    while (hasUnsavedDrafts()) {
      const [id, draft] = [...drafts.entries()].find(([, item]) => item.savedSequence !== item.sequence)!;
      const note = snapshot.notes.find(n => n.id === id);
      if (!note) throw new Error('筆記已不在目前 workspace；請先下載草稿。');
      setSaveStatus('◌ 保存草稿至 SQLite…');
      const payload = {
        clientId: draft.clientId, noteId: id, title: draft.title.trim() || '未命名筆記', markdown: draft.markdown,
        syntaxVersion: note.syntaxVersion ?? 'legacy-v0.2', baseNoteRevision: draft.baseRevision,
        baseSourceHash: draft.baseSourceHash, revision: draft.persistedRevision,
        sourceEdits: draft.sourceEdits,
      };
      type DraftResponse = { draft: DurableDraft; diagnostics: { message: string }[]; canCommit: boolean };
      let saved: DraftResponse;
      try { saved = await request<DraftResponse>(`/drafts/${encodeURIComponent(draft.id)}`, 'PUT', payload); }
      catch (error) {
        // A lost response must not discard a durable draft or blindly overwrite a
        // different revision. Recover only the exact request already persisted.
        const stored = (await request<DurableDraft[]>('/drafts')).find(item => item.id === draft.id);
        if (!stored || stored.clientId !== payload.clientId || stored.noteId !== payload.noteId || stored.title !== payload.title
          || stored.markdown !== payload.markdown || stored.syntaxVersion !== payload.syntaxVersion || stored.baseNoteRevision !== payload.baseNoteRevision
          || (payload.baseSourceHash && stored.baseSourceHash !== payload.baseSourceHash)) throw error;
        saved = await request<DraftResponse>(`/drafts/${encodeURIComponent(draft.id)}`, 'PUT', { ...payload, baseSourceHash: stored.baseSourceHash, revision: stored.revision });
      }
      const pending = drafts.get(id)!;
      pending.persistedRevision = saved.draft.revision; pending.baseSourceHash = saved.draft.baseSourceHash;
      pending.savedSequence = draft.sequence; pending.diagnostics = saved.diagnostics.map(item => item.message);
      if (saved.canCommit) {
        try {
          pendingCommitDraft = { noteId: id, draft };
          const committed = await sharedCommand({ kind: 'commit-draft', draftId: draft.id, draftRevision: saved.draft.revision });
          await acknowledgeDraft(id, draft, committed);
          acceptSharedResult(committed, false);
        } catch (error) {
          if (!pendingSharedCommand) pendingCommitDraft = undefined;
          pending.conflict = `草稿已保存；共享提交未完成：${error instanceof Error ? error.message : String(error)}`;
          if (!(error instanceof ApiError && error.status === 409)) throw error;
        }
      }
      saveFailure = undefined;
    }
    setSaveStatus(drafts.size ? '✓ 草稿已保存 · 共享值使用已提交版本' : '✓ 已儲存至 SQLite');
    updateWorkflowStatus();
  })();
  try { await saving; }
  catch (error) { saveFailure = error instanceof Error ? error : new Error(String(error)); setSaveStatus('儲存失敗 · 草稿仍保留', true); throw new Error(`${saveFailure.message}。草稿仍在編輯器；可在使用說明下載草稿，修正後再按儲存。`); }
  finally { saving = undefined; updateWorkflowStatus(); }
}
function renderNotes() {
  if (!snapshot) return;
  navigator.setWorkspace(snapshot, activeId);
}
function showActiveNote() {
  const note = snapshot.notes.find(n => n.id === activeId);
  const draft = drafts.get(activeId);
  ($('note-title') as HTMLInputElement).value = draft?.title ?? note?.title ?? '';
  ($('note-title') as HTMLInputElement).disabled = !note;
  $<HTMLButtonElement>('reveal-note').disabled = !note;
  $('editor').classList.toggle('no-note', !note);
  editor.setDocument(draft?.markdown ?? note?.markdown ?? '', `${snapshot.id}:${activeId}`, draft?.baseRevision ?? note?.revision ?? 0, note?.syntaxVersion ?? 'legacy-v0.2');
  editorBase = note ? { workspaceId: snapshot.id, noteId: note.id, revision: draft?.baseRevision ?? note.revision } : undefined;
  updateEditorAssets();
  if (runtime) editor.setRuntime(runtime, snapshot.records);
  $('breadcrumb').textContent = `${snapshot.name} / ${navigator.notePath(activeId) || note?.title || '建立筆記'}`;
  $('note-meta').textContent = note ? `修訂 ${note.revision} · ${new Date(note.updatedAt).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
  updateStats(); renderNotes(); updateWorkflowStatus();
}
async function selectNote(id: string) {
  if (id === activeId) return;
  await transition(async () => {
    await flush(); activeId = id; showActiveNote();
    const next = await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, activeNoteId: id } });
    acceptSnapshot(next);
  });
}
async function navigateLocation(location: SourceLocation, expectedMarkdown = snapshot.notes.find(n => n.id === location.noteId)?.markdown) {
  await flush();
  if (expectedMarkdown !== snapshot.notes.find(n => n.id === location.noteId)?.markdown) { renderInspector(); throw new Error('文字已變更，位置清單已更新；請重新選取。'); }
  if (location.noteId.startsWith('record:')) { panel = 'records'; renderInspector(); const record = snapshot.records.find(r => r.id === location.noteId.slice(7)); if (record) recordDialog(record); return; }
  await selectNote(location.noteId); if (mode === 'reading') setMode('live'); editor.focusRange(location.from, location.to);
}
async function navigateIdentifier(name: string) {
  const location = await transition(async () => {
    await flush(); await currentRuntime();
    const definition = runtime?.definitions.find(d => d.name === name);
    if (!definition) { selectedIdentifier = name; panel = 'values'; renderInspector(); toast(`尚未定義 ${name}`); return; }
    selectedIdentifier = name; panel = 'values'; renderInspector();
    return definition.location;
  });
  // Restore interaction before focusing the editor; inert elements cannot take focus.
  if (location) await navigateLocation(location);
}
async function navigateReference(name: string, noteId: string, kind: 'reference' | 'dependency', occurrence: number) {
  const location = await transition(async () => {
    await flush(); await currentRuntime();
    const reference = runtime?.references.filter(r => r.name === name && r.location.noteId === noteId && r.kind === kind)[occurrence];
    if (!reference) { renderInspector(); toast('引用位置已變更，請從更新後的列表選取。'); return; }
    return reference.location;
  });
  if (location) await navigateLocation(location);
}
function renderInspector() {
  if (!snapshot) return;
  for (const name of ['values', 'records', 'issues', 'links']) $(`tab-${name}`).setAttribute('aria-selected', String(panel === name));
  const content = $('inspector-content');
  if (panel !== 'records') content.classList.remove('gp-records-panel');
  const displayed = snapshot;
  if (panel === 'links') { linksPanel.render(content, snapshot, activeId, location => void run(() => navigateLocation(location, displayed.notes.find(n => n.id === location.noteId)?.markdown))); return; }
  if (panel === 'records') {
    recordsPanel.render(content, snapshot, runtime, {
      onEdit: record => recordDialog(record),
      onCreateQuery: query => void run(() => createQueryNote(query)),
      onReferences: name => { selectedIdentifier = name; panel = 'values'; renderInspector(); },
      onInsertReference: name => editor.insertText(snapshot.notes.find(note => note.id === activeId)?.syntaxVersion === 'grasp-v1'
        ? serializeReference({ kind: 'pure', identifier: name, value: runtime?.values[name]?.status === 'ok' ? runtime.values[name].value : '' }) : `{{${name}}}`),
      onRename: record => renameDialog(`${record.collection}.${record.name}`, 'namespace'),
      onError: message => toast(message, true),
    }); return;
  }
  knowledgePanel.render(content, snapshot, runtime, selectedIdentifier, panel, {
    select: name => { selectedIdentifier = name; panel = 'values'; renderInspector(); },
    definition: name => void run(() => navigateIdentifier(name)),
    location: location => void run(() => navigateLocation(location, displayed.notes.find(n => n.id === location.noteId)?.markdown)),
    reference: (reference, occurrence) => void run(() => navigateReference(reference.name, reference.location.noteId, reference.kind, occurrence)),
    rename: name => renameDialog(name),
    edit: name => void run(() => sharedValueDialog(name)),
    retry: () => worker.retry(),
  });
}
function openModal(title: string) { modalEditor?.destroy(); modalEditor = undefined; filesPanel.destroy(); projectionPanel.destroy(); $('modal-title').textContent = title; $('modal-body').replaceChildren(); if (!($('modal') as HTMLDialogElement).open) ($('modal') as HTMLDialogElement).showModal(); return $('modal-body'); }
function closeModal() { modalEditor?.destroy(); modalEditor = undefined; filesPanel.destroy(); projectionPanel.destroy(); ($('modal') as HTMLDialogElement).close(); }
function labeled(label: string, input: HTMLElement) { const group = element('label', 'field'); group.append(element('span', '', label), input); return group; }
function input(value = '', placeholder = '') { const el = element('input'); el.value = value; el.placeholder = placeholder; return el; }
function download(text: string, name: string, type = 'text/markdown;charset=utf-8') { const a = element('a'); const url = URL.createObjectURL(new Blob([text], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
async function upload<T>(path: string, bytes: Blob | string, type = 'text/markdown;charset=utf-8'): Promise<T> {
  const response = await fetch('/api' + path, { method: 'POST', headers: { ...workspaceHeaders(), 'Content-Type': type }, body: bytes });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || data.message || '檔案保存失敗'); return data as T;
}
function downloadFile(entry: FileEntry) {
  const link = element('a'); link.href = `/api/files/download?path=${encodeURIComponent(entry.path)}&workspace=${encodeURIComponent(snapshot.id)}`; link.download = entry.name; link.click();
}
async function projectionDialog(noteId?: string) {
  await flush(); const body = openModal('分組策略與可攜資料');
  await projectionPanel.show(body, { flush, accept: value => acceptSnapshot(value), download }, noteId);
}
async function revealNote(noteId = activeId) {
  await flush(); if (!noteId) throw new Error('請先選擇筆記。');
  const entry = await request<FileEntry>('/files/locate', 'POST', { kind: 'note', id: noteId });
  await request('/files/reveal', 'POST', { path: entry.path }); toast(entry.absolutePath);
}
async function openLogicalFolder(folderId: string | null) {
  await flush();
  const entry = folderId ? await request<FileEntry>('/files/locate', 'POST', { kind: 'folder', id: folderId }) : undefined;
  const path = entry?.path ?? (await request<FilesStatus>('/files/status')).projection.path;
  const opened = await request<{ path: string }>('/files/open-folder', 'POST', { path }); toast(opened.path);
}
async function filesDialog() {
  await flush();
  await filesPanel.show(openModal('檔案、附件與 Markdown'), {
    getSnapshot: () => snapshot,
    getDatabasePath: async () => (await request<{ path: string }>('/host')).path,
    getStatus: () => request<FilesStatus>('/files/status'),
    list: path => request<FileEntry[]>(`/files?path=${encodeURIComponent(path)}`),
    retryMirror: () => navigationCommand(async () => { await flush(); return request<FilesStatus>('/files/mirror/refresh', 'POST', {}); }),
    revealFile: path => request('/files/reveal', 'POST', { path }),
    reviewExternal: path => navigationCommand(async () => { await flush(); showImportPlan(await request<ImportPlan>('/files/external/plan', 'POST', { path })); }),
    openFolder: path => request('/files/open-folder', 'POST', { path }),
    downloadFile,
    stageMarkdown: files => navigationCommand(async () => { for (const file of files) await upload<FileEntry>(`/files/inbox?name=${encodeURIComponent(file.name)}`, file); }),
    saveInbox: (name, text) => navigationCommand(() => upload<FileEntry>(`/files/inbox?name=${encodeURIComponent(name)}`, text)),
    reviewInbox: entry => navigationCommand(async () => { await flush(); showImportPlan(await request<ImportPlan>('/files/import/plan', 'POST', { path: entry.path })); }),
    uploadAttachments: files => navigationCommand(async () => { await flush(); for (const file of files) acceptSnapshot(await upload<WorkspaceSnapshot>(`/assets?name=${encodeURIComponent(file.name)}`, file, file.type || 'application/octet-stream')); }),
    deleteAttachment: asset => navigationCommand(async () => { await flush(); acceptSnapshot(await request<WorkspaceSnapshot>(`/assets/${encodeURIComponent(asset.id)}`, 'DELETE', { revision: asset.revision })); }),
    insertAttachment: (asset, embed) => navigationCommand(async () => { if (!activeId) throw new Error('請先建立或選擇筆記。'); closeModal(); editor.insertText(attachmentMarkdown(asset, embed)); }),
    onError: message => toast(message, true),
  });
}
async function createNote(title = '未命名筆記', markdown = '', folderId = navigator.currentFolderId()) { await transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>('/notes', 'POST', { title, markdown, folderId, syntaxVersion: 'grasp-v1' }); const created = next.notes.find(n => !snapshot.notes.some(old => old.id === n.id)); activeId = created?.id || next.notes.at(-1)?.id || ''; acceptSnapshot(next, true); acceptSnapshot(await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, activeNoteId: activeId } })); setSaveStatus('✓ 已儲存至 SQLite'); }); }
async function createQueryNote(input: string | RecordQuery) { const query = typeof input === 'string' ? { collection: input } : input; await createNote(`${query.collection} · 資料檢視`, `# ${query.collection}\n\n此 table 使用資料庫中的同一組 records。將游標移入區塊可修改 query。\n\n\`\`\`grasp-query\n${JSON.stringify(query, null, 2)}\n\`\`\`\n`); }

function paged<T>(parent: HTMLElement, entries: T[], render: (entry: T) => HTMLElement, size = 30) {
  let page = 0; const list = element('div'); const controls = element('div', 'gp-nav-pager'); parent.append(list, controls);
  const draw = () => {
    list.replaceChildren(...entries.slice(page * size, (page + 1) * size).map(render));
    const previous = button('上一頁', () => { page--; draw(); }); previous.disabled = page === 0;
    const next = button('下一頁', () => { page++; draw(); }); next.disabled = (page + 1) * size >= entries.length;
    controls.replaceChildren(previous, element('span', '', `${entries.length ? page * size + 1 : 0}–${Math.min(entries.length, (page + 1) * size)} / ${entries.length}`), next);
  }; draw();
}
function diffCard(title: string, before: string, after: string) {
  const details = element('details', 'diff-card'); details.append(element('summary', '', title));
  const columns = element('div', 'diff-columns'); columns.append(element('pre', 'diff-before', before), element('pre', 'diff-after', after)); details.append(columns); return details;
}
function renameDialog(from: string, mode: 'identifier' | 'namespace' = 'identifier') {
  const body = openModal('重新命名與影響預覽');
  body.append(element('p', 'muted', '同步修改 definition 與真正的引用。程式碼和普通文字會保留；先檢查差異，再一次套用並保存復原點。'));
  const source = input(from); source.setAttribute('aria-label', '原 identifier 或 Namespace');
  const target = input('', '新的名稱'); target.setAttribute('aria-label', '新 identifier 或 Namespace');
  const scope = element('select'); scope.setAttribute('aria-label', '重新命名範圍');
  for (const [value, label] of [['identifier', '單一 identifier'], ['namespace', 'Namespace 前綴（含子項目）']]) { const option = element('option', '', label); option.value = value; scope.append(option); }
  scope.value = mode; body.append(labeled('原名稱', source), labeled('新名稱', target), labeled('範圍', scope));
  body.append(button('預覽重新命名', async () => { await flush(); const preview = await request<Omit<RenamePlan, 'notes' | 'records'> & { token: string }>('/rename/plan', 'POST', { from: source.value.trim(), to: target.value.trim(), mode: scope.value }); showRenamePlan(preview); }, 'primary'));
}
function showRenamePlan(plan: Omit<RenamePlan, 'notes' | 'records'> & { token: string }) {
  const body = openModal('審查重新命名');
  body.append(element('p', '', `${plan.request.from} → ${plan.request.to}`), element('p', 'muted', `${plan.renames.length} 個名稱 · 修改 ${plan.changes.length} 份筆記與 ${plan.recordChanges.length} 筆 records · 影響 ${plan.impact.transitive.length} 個後續識別值。基準修訂 ${plan.workspaceRevision}。`));
  for (const issue of plan.diagnostics) body.append(element('p', issue.severity === 'error' ? 'validation-error' : 'muted', issue.message));
  const names = element('details', 'diff-card'); names.append(element('summary', '', `名稱對應與引用數 · ${plan.renames.length}`));
  paged(names, plan.renames, rename => element('p', '', `${rename.from} → ${rename.to} · ${rename.definitions} 個定義 / ${rename.references} 個引用`)); body.append(names);
  const changes: Array<{ title: string; before: string; after: string }> = [
    ...plan.changes.map(change => ({ title: change.title, before: change.before, after: change.after })),
    ...plan.recordChanges.map(change => ({ title: `Record · ${change.before.collection}.${change.before.name}`, before: JSON.stringify(change.before, null, 2), after: JSON.stringify(change.after, null, 2) })),
  ];
  paged(body, changes, change => diffCard(change.title, change.before, change.after), 20);
  const affected = element('details', 'diff-card'); affected.append(element('summary', '', '依賴、缺少定義與循環的變化'), element('pre', 'syntax-example', `直接影響：${plan.impact.direct.join(', ') || '無'}\n後續影響：${plan.impact.transitive.join(', ') || '無'}\n缺少定義：${plan.impact.missingBefore.length} → ${plan.impact.missingAfter.length}\n循環識別值：${plan.impact.cyclesBefore.length} → ${plan.impact.cyclesAfter.length}`)); body.append(affected);
  const apply = button('確認重新命名', async () => transition(async () => {
    await flush(); await refreshSharedState();
    if (shared!.snapshot.revision !== plan.workspaceRevision) throw new Error('預覽後資料已變更，請重新預覽名稱及影響。');
    const identifier = shared!.semantic.identifiers.find(item => item.name === plan.request.from);
    if (plan.request.mode === 'identifier' && !identifier) throw new Error('Identifier 已變更，請重新預覽。');
    const intent: SharedIntent = plan.request.mode === 'namespace'
      ? { kind: 'rename-namespace', from: plan.request.from, to: plan.request.to }
      : { kind: 'rename', identifierId: identifier!.id, identifierRevision: identifier!.revision, name: plan.request.to };
    const result = await executeSharedCommand({ operationId: crypto.randomUUID(), workspaceId: snapshot.id, baseSemanticRevision: shared!.semantic.revision, intent });
    selectedIdentifier = plan.request.mode === 'identifier' ? plan.request.to : undefined; panel = 'values'; acceptSharedResult(result); closeModal(); toast('已更新定義與引用；可使用撤銷共享修改。');
  }), 'primary'); apply.disabled = !plan.canApply;
  body.append(button('返回修改', () => renameDialog(plan.request.from, plan.request.mode)), apply);
}

function workspaceDialog() {
  const body = openModal('開啟或建立 workspace');
  body.append(element('p', 'muted', '每個 workspace 是一個 SQLite 資料庫。輸入本機路徑；新建檔案可使用 .grasp.db 副檔名。'));
  const currentPath = element('p', 'muted', '目前路徑：讀取中…'); body.append(currentPath);
  void request<{ path: string; warning?: string; error?: string; migrationBackupPath?: string }>('/host').then(host => { currentPath.textContent = `目前路徑：${host.path}${host.migrationBackupPath ? `\n升級前備份：${host.migrationBackupPath}` : ''}${host.error ? `\n${host.error}` : ''}${host.warning ? `\n${host.warning}` : ''}`; }).catch(() => { currentPath.textContent = ''; });
  const path = input('', 'workspaces/MyKnowledge.grasp.db'); path.setAttribute('aria-label', '資料庫路徑');
  const name = input('', '我的知識庫'); name.setAttribute('aria-label', '新 workspace 名稱');
  body.append(labeled('資料庫路徑', path), labeled('新 workspace 名稱（建立時使用）', name));
  const action = async (create: boolean) => transition(async () => { await flush(); if (pendingSharedCommand) throw new Error('請先確認前一項共享操作，再切換 workspace。'); if (!path.value.trim()) throw new Error('請輸入資料庫路徑。'); const next = await request<WorkspaceSnapshot>('/workspace/open', 'POST', { path: path.value.trim(), create, name: name.value.trim() || '我的知識庫' }); activeId = ''; acceptSnapshot(next, true); setSaveStatus('✓ 已儲存至 SQLite'); closeModal(); });
  const actions = element('div', 'form-actions'); actions.append(button('開啟既有資料庫', () => action(false)), button('建立新 workspace', () => action(true), 'primary')); body.append(actions);
  const fallback = element('details', 'diff-card'); fallback.append(element('summary', '', '從 Markdown 投影重建到新的資料庫'));
  fallback.append(element('p', 'muted', '選擇完整 Markdown 資料夾內 .grasp-export/manifest.json 的路徑與尚不存在的 .db 路徑。必須保留隱藏的 .grasp-export 與附件。會驗證所有內容；原 DB 和檔案都會保留。重建產生新的 workspace，資料 ID 仍保留，恢復的草稿可再手動開啟。'));
  const manifest = input('', 'C:\\…\\MainVault-Grasp\\Markdown\\.grasp-export\\manifest.json'); manifest.setAttribute('aria-label', '重建 manifest 路徑');
  const target = input('', 'C:\\…\\Recovered.grasp.db'); target.setAttribute('aria-label', '重建的新資料庫路徑');
  fallback.append(labeled('重建 manifest', manifest), labeled('新的 .db 路徑', target), button('驗證並重建新 workspace', async () => transition(async () => {
    if (pendingSharedCommand) throw new Error('請先確認前一項共享操作，再重建並切換 workspace。');
    await flush(); if (!manifest.value.trim() || !target.value.trim()) throw new Error('請填寫 manifest 與新的資料庫路徑。');
    const next = await request<WorkspaceSnapshot>('/workspace/rebuild', 'POST', { manifestPath: manifest.value.trim(), newPath: target.value.trim() });
    activeId = ''; acceptSnapshot(next, true); setSaveStatus('✓ 已儲存至 SQLite'); closeModal(); toast('已驗證 Markdown 投影並重建至新資料庫；原檔保留。');
  }), 'primary')); body.append(fallback);
}
function recordDialog(record?: StructuredRecord) {
  const body = openModal(record ? '編輯結構化資料' : '新增結構化資料');
  if (record) body.append(button('在檔案總管顯示 Record', async () => { const entry = await locateProjectionUnit(`recordInfo:${record.id}`); toast(entry.absolutePath); }));
  body.append(element('p', 'muted', '以 collection.name.field 引用欄位；值中可用 {identifier} 組合文字。名稱使用英數字、底線、點或連字號。'));
  const collection = input(record?.collection || 'aura'); collection.setAttribute('aria-label', 'Collection');
  const name = input(record?.name || ''); name.setAttribute('aria-label', 'Record 名稱');
  if (record) { collection.readOnly = true; name.readOnly = true; body.append(element('p', 'muted', '名稱會影響引用。請使用「重新命名」先審查所有依賴。移除欄位後，其引用會顯示缺少定義。'), button('重新命名 record／collection', () => { if (recordHasEdits()) throw new Error('請先儲存欄位修改，再重新命名。'); renameDialog(`${record.collection}.${record.name}`, 'namespace'); })); }
  body.append(labeled('Collection', collection), labeled('Record 名稱', name));
  const fields = element('div', 'record-fields');
  function recordHasEdits() { const rows = Array.from(fields.children).map(row => Array.from(row.querySelectorAll('input')).map(i => i.value)); return rows.length !== Object.keys(record?.fields ?? {}).length || rows.some(([key, value]) => !Object.hasOwn(record!.fields, key) || record!.fields[key] !== value); }
  function addField(key = '', value = '') {
    const row = element('div', 'record-field-row'); const k = input(key, '欄位名稱'); k.setAttribute('aria-label', '欄位名稱'); const v = input(value, '字串值 / {identifier}'); v.setAttribute('aria-label', '欄位值');
    const existing = Boolean(record && Object.hasOwn(record.fields, key)); k.readOnly = existing;
    const rename = existing ? button('名稱↗', () => { if (recordHasEdits()) throw new Error('請先儲存欄位修改，再重新命名。'); renameDialog(`${record!.collection}.${record!.name}.${key}`); }) : element('span');
    if (existing) rename.setAttribute('aria-label', `重新命名欄位 ${key}`);
    row.append(k, v, rename, button('×', () => row.remove(), 'icon-button')); fields.append(row);
  }
  for (const [key, value] of Object.entries(record?.fields || { name: '', element: '' })) addField(key, value);
  body.append(fields, button('＋ 新增欄位', () => addField(), 'text-button'));
  const actions = element('div', 'form-actions');
  if (record) actions.append(button('刪除（可復原）', async () => { await flush(); const next = await request<WorkspaceSnapshot>(`/records/${encodeURIComponent(record.id)}`, 'DELETE', { revision: record.revision }); acceptSnapshot(next); closeModal(); }, 'danger'));
  actions.append(button('儲存 record', async () => {
    const values: Record<string, string> = Object.create(null);
    for (const row of fields.children) { const [k, v] = Array.from(row.querySelectorAll('input')); if (!k.value.trim()) throw new Error('欄位名稱不能留白。'); if (Object.hasOwn(values, k.value.trim())) throw new Error('欄位名稱不能重複。'); values[k.value.trim()] = v.value; }
    await flush(); const id = record?.id || crypto.randomUUID();
    const next = await request<WorkspaceSnapshot>(`/records/${id}`, 'PUT', { record: { id, collection: collection.value.trim(), name: name.value.trim(), fields: values, revision: record?.revision || 0 }, revision: record?.revision || 0 });
    acceptSnapshot(next); closeModal(); panel = 'records'; renderInspector();
  }, 'primary')); body.append(actions);
}
function importDialog() {
  const body = openModal('Markdown 匯入 · 先審查，再套用');
  body.append(element('p', 'muted', '匯出檔保留 note IDs 與 records；一般 Markdown 會新增一份筆記。選取檔案或貼上文字後，先建立匯入計畫。'));
  const file = element('input'); file.type = 'file'; file.accept = '.md,.markdown,text/markdown,text/plain'; file.setAttribute('aria-label', '選取 Markdown 匯入檔案');
  const source = element('textarea', 'import-source'); source.rows = 10; source.placeholder = '貼上 AI 回傳的 Markdown…'; source.setAttribute('aria-label', '匯入 Markdown');
  let loadedFile: { raw: string; displayed: string } | undefined;
  file.onchange = () => void run(async () => { const selected = file.files?.[0]; if (selected) { const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await selected.arrayBuffer()); source.value = raw; loadedFile = { raw, displayed: source.value }; } });
  body.append(file, source, button('驗證並檢視差異', async () => { await flush(); const markdown = loadedFile && source.value === loadedFile.displayed ? loadedFile.raw : source.value; const plan = await request<ImportPlan>('/import/plan', 'POST', { markdown }); showImportPlan(plan); }, 'primary'));
}
function showImportPlan(plan: ImportPlan) {
  const body = openModal('審查匯入計畫');
  const projectionFiles = (plan as ImportPlan & { projectionFiles?: string[] }).projectionFiles;
  if (projectionFiles?.length) {
    body.append(element('p', 'muted', `此次審查包含同一份 projection 的 ${projectionFiles.length} 個已修改檔案；確認後會一起套用，避免分次匯入造成來源版本衝突。`));
    for (const path of projectionFiles) body.append(element('code', 'projection-import-path', path));
  }
  const changed = plan.changes.filter(c => c.kind !== 'unchanged');
  const oldRecords = new Map(snapshot.records.map(record => [record.id, JSON.stringify(record)]));
  const incomingIds = new Set(plan.records.map(record => record.id));
  const recordChanges = plan.records.filter(record => oldRecords.get(record.id) !== JSON.stringify(record)).length + snapshot.records.filter(record => !incomingIds.has(record.id)).length;
  body.append(element('p', 'muted', `影響 ${changed.length} 份筆記 · ${recordChanges} 筆 records 變更 · 以 workspace 修訂 ${plan.workspaceRevision} 為基準。套用前會保存可復原版本。`));
  const folderNames = new Map([...snapshot.folders, ...plan.folders].map(f => [f.id, f.name]));
  const folderLabel = (id: string | null) => id === null ? '根資料夾' : folderNames.get(id) || id;
  for (const folder of plan.folders) {
    const before = snapshot.folders.find(f => f.id === folder.id);
    if (!before || before.name !== folder.name || before.parentId !== folder.parentId) body.append(element('p', 'diff-card', `資料夾：${before ? `${folderLabel(before.parentId)} / ${before.name}` : '（新增）'} → ${folderLabel(folder.parentId)} / ${folder.name}`));
  }
  for (const issue of plan.diagnostics) body.append(element('p', 'validation-error', `${issue.kind}: ${issue.message}`));
  for (const change of changed) {
    const details = element('details', 'diff-card'); details.open = true; details.append(element('summary', '', `${change.kind === 'create' ? '新增' : '修改'} · ${change.title}`));
    const oldTitle = snapshot.notes.find(n => n.id === change.id)?.title;
    if (oldTitle && oldTitle !== change.title) details.append(element('p', 'muted', `標題：${oldTitle} → ${change.title}`));
    if (change.beforeFolderId !== change.afterFolderId) details.append(element('p', 'muted', `位置：${folderLabel(change.beforeFolderId)} → ${folderLabel(change.afterFolderId)}`));
    const diff = element('div', 'diff-columns'); const before = element('div'); before.append(element('h4', '', '資料庫目前內容'), element('pre', 'diff-before', change.before)); const after = element('div'); after.append(element('h4', '', '匯入後內容'), element('pre', 'diff-after', change.after)); diff.append(before, after); details.append(diff); body.append(details);
  }
  if (JSON.stringify(plan.records) !== JSON.stringify(snapshot.records)) { const details = element('details', 'diff-card'); details.append(element('summary', '', '結構化資料差異')); const diff = element('div', 'diff-columns'); diff.append(element('pre', 'diff-before', JSON.stringify(snapshot.records, null, 2)), element('pre', 'diff-after', JSON.stringify(plan.records, null, 2))); details.append(diff); body.append(details); }
  if (!changed.length) body.append(element('p', 'empty', '沒有筆記文字變更。請同時檢查資料夾與結構化資料。'));
  const actions = element('div', 'form-actions'); actions.append(button('返回修改', importDialog)); const apply = button('確認套用至資料庫', async () => transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>('/import/apply', 'POST', { token: plan.token, workspaceRevision: plan.workspaceRevision }); acceptSnapshot(next, true); closeModal(); toast('已套用匯入。原內容可從復原紀錄找回。'); }), 'primary'); apply.disabled = !plan.canApply; actions.append(apply); body.append(actions);
}
async function historyDialog() {
  await flush(); const records = await request<Array<{ id: string; createdAt: string; reason: string; workspaceRevision: number }>>('/history');
  const body = openModal('復原紀錄'); body.append(element('p', 'muted', '刪除、匯入與復原前均保存 workspace 快照。復原會取代目前內容，並保留復原前的版本。'));
  if (!records.length) body.append(element('p', 'empty', '還沒有需要復原的操作。'));
  for (const record of records) { const row = element('div', 'history-row'); row.append(element('div', '', `${new Date(record.createdAt).toLocaleString('zh-TW')} · ${record.reason} · r${record.workspaceRevision}`), button('檢查復原', async () => {
    await flush(); const preview = await request<RecoveryPreview>(`/history/${encodeURIComponent(record.id)}/preview`);
    const confirm = openModal('確認復原 workspace'); confirm.append(element('p', '', `將復原至 ${new Date(record.createdAt).toLocaleString('zh-TW')} 的快照。整個 workspace 的筆記、資料夾、records 與附件都會替換；目前版本會另存於復原紀錄。`));
    confirm.append(element('p', 'muted', `筆記 ${preview.current.notes} → ${preview.target.notes} · 資料夾 ${preview.current.folders} → ${preview.target.folders} · records ${preview.current.records} → ${preview.target.records} · 附件 ${preview.current.attachments} → ${preview.target.attachments}${preview.settingsChanged ? ' · Workspace 設定也會回復' : ''}`));
    const changes = [
      ...preview.changes.notes.map(c => `筆記 · ${c.kind} · ${c.before?.title || '（無）'} → ${c.after?.title || '（無）'}${c.contentChanged ? ' · 內容變更' : ''}`),
      ...preview.changes.folders.map(c => `資料夾 · ${c.kind} · ${c.before?.name || '（無）'} → ${c.after?.name || '（無）'}`),
      ...preview.changes.records.map(c => `Record · ${c.kind} · ${c.before ? `${c.before.collection}.${c.before.name}` : '（無）'} → ${c.after ? `${c.after.collection}.${c.after.name}` : '（無）'} · 欄位：${c.changedFields.join(', ')}`),
      ...preview.changes.attachments.map(c => `附件 · ${c.kind} · ${c.before?.path || '（無）'} → ${c.after?.path || '（無）'}`),
    ];
    paged(confirm, changes, text => element('p', 'diff-card', text));
    confirm.append(button('取消', closeModal), button('確認復原', async () => transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>(`/history/${encodeURIComponent(record.id)}/restore`, 'POST', { workspaceRevision: preview.workspaceRevision }); acceptSnapshot(next, true); closeModal(); toast('已復原 workspace。'); }), 'primary'));
  })); body.append(row); }
}
function helpDialog() {
  const body = openModal('開始使用 GraspPortable');
  body.append(element('p', '', '新筆記使用下列語法。Live Preview 可直接寫作；Source 顯示原文；閱讀模式呈現完整 Markdown。舊 workspace 筆記維持原有語法，不會開檔就改寫。'),
    element('pre', 'syntax-example', '@Fruit = <|apple|>\n@Slogan = <|An |> + Fruit + <| a day|>\n\n[Fruit 的目前值](:ref:Fruit)\n[[@Slogan|Slogan 的目前值]]'),
    element('p', '', '完整 binding 會提交至資料庫，巢狀結果與引用中的 cached value 一起保存。打到一半會保存為草稿，其他引用明示上一個已提交值。點 reference 的「編輯共享值」選擇 literal 或依賴；不會從展開文字猜測 composition。'),
    element('p', '', '輸入 <| 可補上結尾；多行 literal 可把內容放在 opener／closer 之間。真正 code fence 與 inline code 不啟用 binding。空 literal <||> 是已指定的空字串。'),
    element('pre', 'syntax-example', '@Paragraph = <|\n第一段\n\n第二段\n|>\n\n```grasp-query\n{"collection":"aura","where":{"field":"element","equals":"fire"}}\n```'),
    element('p', '', 'Ctrl/⌘ + Z 撤銷本地文字輸入；已提交的共享命令使用「撤銷共享修改」。未完成草稿可重新啟動後恢復。外部 Markdown 修改必須 Review／Import，不能直接改資料庫或把 cache 當作共享定義。'),
    button('下載目前筆記草稿', () => download(editor.getDocument(), `${($('note-title') as HTMLInputElement).value || 'draft'}.md`)),
    element('p', 'muted', '資料庫是執行中的資料來源；Markdown projection 可閱讀、拖給 AI 及作 fallback。關閉程式後再搬動整個 workspace。'));
}
$('note-title').oninput = () => markDraft();
$('save').onclick = () => void run(flush);
$('workspace-open').onclick = workspaceDialog;
$('mode').onclick = () => void run(async () => { setMode(mode === 'live' ? 'source' : 'live'); await flush(); acceptSnapshot(await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, mode } })); });
$('reading').onclick = () => void run(async () => { await flush(); setMode(mode === 'reading' ? 'live' : 'reading'); acceptSnapshot(await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, mode } })); });
$('shared-undo').onclick = () => void run(async () => {
  if (pendingSharedCommand) {
    const command = pendingSharedCommand; const result = await executeSharedCommand(command);
    if (command.intent.kind === 'commit-draft' && pendingCommitDraft) await acknowledgeDraft(pendingCommitDraft.noteId, pendingCommitDraft.draft, result);
    acceptSharedResult(result); toast('操作結果已確認。'); return;
  }
  if (!lastSharedOperation) return;
  await flush(); const result = await sharedCommand({ kind: 'undo', operationId: lastSharedOperation.operationId });
  acceptSharedResult(result); toast('共享修改已完整撤銷，相關值已重新計算。');
});
$('toggle-inspector').onclick = () => document.body.classList.toggle('inspector-hidden');
$('delete-note').onclick = () => void run(async () => { await flush(); const note = snapshot.notes.find(n => n.id === activeId); if (!note) return; const body = openModal('刪除筆記'); body.append(element('p', '', `刪除「${note.title}」？可從復原紀錄找回。`), button('取消', closeModal), button('刪除並保存復原點', async () => transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>(`/notes/${note.id}`, 'DELETE', { revision: snapshot.notes.find(n => n.id === note.id)?.revision ?? note.revision }); acceptSnapshot(next, true); closeModal(); }), 'danger')); });
for (const name of ['values', 'records', 'issues', 'links'] as const) $(`tab-${name}`).onclick = () => { panel = name; renderInspector(); };
$('files').onclick = () => void run(filesDialog);
$('projection').onclick = () => void run(() => projectionDialog());
$('reveal-note').onclick = () => void run(() => revealNote());
$('open-note-folder').onclick = () => void run(() => openLogicalFolder(snapshot.notes.find(n => n.id === activeId)?.folderId ?? null));
$('export').onclick = () => void run(() => projectionDialog(activeId));
$('import').onclick = importDialog;
$('history').onclick = () => void run(historyDialog);
$('help').onclick = helpDialog;
$('modal-close').onclick = closeModal;
document.addEventListener('close', event => {
  if (event.target === $('modal')) { modalEditor?.destroy(); modalEditor = undefined; projectionPanel.destroy(); }
  filesPanel.destroy();
  if (!pendingNavigation || document.querySelector('dialog[open]')) return;
  const pending = pendingNavigation; pendingNavigation = undefined;
  if (pending.workspaceId === snapshot?.id) void saveNavigationSettings(pending.patch).catch(error => toast(String(error), true));
}, true);
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!discardReview) void run(flush); } });
window.addEventListener('beforeunload', event => { if (hasUnsavedDrafts() || saving || saveFailure || pendingSharedCommand) { event.preventDefault(); event.returnValue = ''; } });
void run(async () => {
  let initial: WorkspaceSnapshot;
  try { shared = await request<SharedStateResponse>('/shared/state'); initial = shared.snapshot; }
  catch (error) {
    $('workspace-name').textContent = '選擇可用的 Workspace'; $('runtime-status').textContent = '尚未開啟資料庫';
    ($('note-title') as HTMLInputElement).disabled = true;
    setSaveStatus('資料庫未開啟 · 原檔保留', true); $('navigation').inert = true; $('editor').classList.add('no-note');
    for (const id of ['save', 'mode', 'reading', 'delete-note', 'export', 'projection', 'import', 'history', 'files', 'reveal-note', 'open-note-folder']) ($<HTMLButtonElement>(id)).disabled = true;
    workspaceDialog(); toast(error instanceof Error ? error.message : String(error), true); return;
  }
  setMode(initial.settings.mode === 'source' ? 'source' : initial.settings.mode === 'reading' ? 'reading' : 'live');
  acceptSnapshot(initial, true); setSaveStatus('✓ 已儲存至 SQLite');
  await loadDurableDrafts();
  try { const operationId = localStorage.getItem(`grasp-shared-undo:${snapshot.id}`); if (operationId) lastSharedOperation = await request<OperationReceipt>(`/shared/operations/${encodeURIComponent(operationId)}`); } catch { /* An old UI pointer is not authority. */ }
  updateWorkflowStatus();
  const host = await request<{ path: string; warning?: string }>('/host');
  if (host.warning) toast(host.warning, true);
});
