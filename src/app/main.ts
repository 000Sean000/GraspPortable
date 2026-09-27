import { createEditor } from '../editor/editor';
import { RuntimeClient } from '../runtime/client';
import { LinksPanel } from './links-panel';
import { createNavigator } from './navigation';
import { KnowledgePanel } from './knowledge-panel';
import { RecordsPanel } from './records-panel';
import type { RecordQuery } from '../editor/query';
import type { RenamePlan } from '../domain/rename';
import type { RecoveryPreview } from '../../server/store';
import { request, setWorkspaceId, workspaceHeaders } from './api';
import type { WorkspaceSnapshot, RuntimeResult, ImportPlan, StructuredRecord, SourceLocation } from '../domain/model';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<aside class="sidebar">
  <div class="brand"><span class="brand-mark">g.</span><div>Grasp<span>PORTABLE / 01</span></div></div>
  <button class="workspace-button" id="workspace-open"><span class="tiny-label">WORKSPACE</span><strong id="workspace-name">開啟中…</strong><span class="workspace-hint">切換或建立資料庫 ↗</span></button>
  <section id="navigation" aria-label="筆記與資料夾"></section>
  <div class="sidebar-bottom"><button id="export">↗ 匯出 Markdown</button><button id="import">↙ 匯入與審查</button><button id="history">↶ 復原紀錄</button><button id="help">? 使用說明</button><p>Local knowledge, connected.<br><span>SQLite · 本機資料庫</span></p></div>
</aside>
<main class="main-pane">
  <header class="toolbar"><span id="breadcrumb">WORKSPACE / NOTES</span><div class="toolbar-actions"><button id="mode" aria-pressed="true">Live Preview</button><button id="save" title="Ctrl / ⌘ + S">儲存</button><button id="delete-note" class="quiet" title="刪除目前筆記">刪除</button><button id="toggle-inspector" class="quiet" aria-label="切換知識面板">◫</button></div></header>
  <div class="document-heading"><div class="eyebrow">YOUR CONNECTED NOTEBOOK</div><input id="note-title" aria-label="筆記標題" placeholder="未命名筆記"><div class="document-meta"><span id="note-meta"></span><span class="mode-hint">游標所在行編輯原文，其他位置即時呈現</span></div></div>
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
let mode: 'live' | 'source' = 'live';
let panel: 'values' | 'records' | 'issues' | 'links' = 'values';
const linksPanel = new LinksPanel();
const knowledgePanel = new KnowledgePanel();
const recordsPanel = new RecordsPanel();
let valueFilter = '';
let selectedIdentifier: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | undefined;
let saveFailure: Error | undefined;
let draftSequence = 0;
const drafts = new Map<string, { title: string; markdown: string; sequence: number; baseRevision: number }>();
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
  $('runtime-status').textContent = `${result.metrics.total} 個值 · 重算 ${result.metrics.recalculated} · ${result.metrics.elapsedMs.toFixed(1)} ms`;
  $('issue-count').textContent = String(result.diagnostics.length);
  renderInspector();
}, message => { runtimeFailure = message; $('runtime-status').textContent = '計算暫停'; for (const waiter of runtimeWaiters.splice(0)) waiter.reject(new Error(message)); toast(message, true); });
const editor = createEditor($('editor'), {
  onChange: markdown => { if (snapshot && activeId) markDraft(markdown); },
  onNavigate: name => void run(() => navigateIdentifier(name)),
  onFindReferences: name => { selectedIdentifier = name; panel = 'values'; renderInspector(); },
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
  onSelect: (id, range) => { const source = snapshot.notes.find(n => n.id === id)?.markdown; return navigationCommand(async () => { await flush(); await selectNote(id); if (range) { if (source !== snapshot.notes.find(n => n.id === id)?.markdown) throw new Error('文字已變更，搜尋結果已更新；請重新選取位置。'); editor.focusRange(range.from, range.to); } }); },
  onCreateNote: folderId => navigationCommand(async () => { await createNote('未命名筆記', '', folderId); ($('note-title') as HTMLInputElement).focus(); ($('note-title') as HTMLInputElement).select(); }),
  onRenameNote: (id, title) => navigationCommand(() => navigationMutation(`/notes/${encodeURIComponent(id)}`, 'PUT', () => { const note = snapshot.notes.find(n => n.id === id)!; return { title, markdown: note.markdown, revision: note.revision }; })),
  onMoveNote: (id, folderId) => navigationCommand(() => navigationMutation(`/notes/${encodeURIComponent(id)}/move`, 'PUT', () => ({ folderId, revision: snapshot.notes.find(n => n.id === id)!.revision }))),
  onDeleteNote: id => navigationCommand(() => navigationMutation(`/notes/${encodeURIComponent(id)}`, 'DELETE', () => ({ revision: snapshot.notes.find(n => n.id === id)!.revision }))),
  onCreateFolder: (parentId, name) => navigationCommand(() => navigationMutation('/folders', 'POST', () => ({ parentId, name }))),
  onRenameFolder: (id, name) => navigationCommand(() => navigationMutation(`/folders/${encodeURIComponent(id)}`, 'PUT', () => { const folder = snapshot.folders.find(f => f.id === id)!; return { name, parentId: folder.parentId, revision: folder.revision }; })),
  onMoveFolder: (id, parentId) => navigationCommand(() => navigationMutation(`/folders/${encodeURIComponent(id)}`, 'PUT', () => { const folder = snapshot.folders.find(f => f.id === id)!; return { name: folder.name, parentId, revision: folder.revision }; })),
  onDeleteFolder: id => navigationCommand(() => navigationMutation(`/folders/${encodeURIComponent(id)}`, 'DELETE', () => ({ revision: snapshot.folders.find(f => f.id === id)!.revision, workspaceRevision: snapshot.revision, recursive: true }))),
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
function markDraft(markdown = editor.getDocument()) {
  const baseRevision = drafts.get(activeId)?.baseRevision ?? (editorBase?.workspaceId === snapshot.id && editorBase.noteId === activeId ? editorBase.revision : snapshot.notes.find(n => n.id === activeId)!.revision);
  drafts.set(activeId, { title: ($('note-title') as HTMLInputElement).value, markdown, sequence: ++draftSequence, baseRevision });
  saveFailure = undefined; setSaveStatus('● 等待儲存'); updateStats();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => void run(flush), 350);
}
function updateStats() { $('document-stats').textContent = `${editor.getDocument().length.toLocaleString()} 字元`; }
function acceptSnapshot(next: WorkspaceSnapshot, resetEditor = false) {
  if (snapshot && next.id === snapshot.id && next.revision < snapshot.revision) return;
  const changedWorkspace = snapshot && next.id !== snapshot.id;
  snapshot = next;
  setWorkspaceId(next.id);
  if (changedWorkspace) {
    runtime = undefined; selectedIdentifier = undefined; valueFilter = ''; ($('note-search') as HTMLInputElement).value = '';
    editor.setRuntime({ revision: next.revision, values: {}, definitions: [], references: [], diagnostics: [], metrics: { elapsedMs: 0, recalculated: 0, total: 0, affected: 0 } }, []);
    mode = next.settings.mode === 'source' ? 'source' : 'live'; editor.setMode(mode); $('mode').textContent = mode === 'live' ? 'Live Preview' : 'Source'; $('mode').setAttribute('aria-pressed', String(mode === 'live'));
  }
  if (!snapshot.notes.some(n => n.id === activeId)) activeId = snapshot.settings.activeNoteId && snapshot.notes.some(n => n.id === snapshot.settings.activeNoteId) ? snapshot.settings.activeNoteId : snapshot.notes[0]?.id || '';
  $('workspace-name').textContent = snapshot.name;
  document.title = `${snapshot.name} · GraspPortable`;
  renderNotes();
  const current = snapshot.notes.find(n => n.id === activeId);
  const clean = !drafts.has(activeId);
  if (resetEditor || (clean && current && (editor.getDocument() !== current.markdown || ($('note-title') as HTMLInputElement).value !== current.title))) showActiveNote();
  else if (clean && current) editorBase = { workspaceId: snapshot.id, noteId: current.id, revision: current.revision };
  $('runtime-status').textContent = '背景計算中…';
  runtimeFailure = undefined;
  worker.update(snapshot);
  renderInspector();
  if (current) $('note-meta').textContent = `修訂 ${current.revision} · ${new Date(current.updatedAt).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}
async function flush() {
  clearTimeout(saveTimer);
  if (saving) { await saving; if (drafts.size) await flush(); return; }
  saving = (async () => {
    while (drafts.size) {
      const [id, draft] = drafts.entries().next().value!;
      const note = snapshot.notes.find(n => n.id === id);
      if (!note) throw new Error('筆記已不在目前 workspace；請先下載草稿。');
      setSaveStatus('◌ 儲存至 SQLite…');
      const next = await request<WorkspaceSnapshot>(`/notes/${encodeURIComponent(id)}`, 'PUT', { title: draft.title.trim() || '未命名筆記', markdown: draft.markdown, revision: draft.baseRevision });
      if (drafts.get(id)?.sequence === draft.sequence) drafts.delete(id);
      else { const pending = drafts.get(id); const committed = next.notes.find(n => n.id === id); if (pending && committed) pending.baseRevision = committed.revision; }
      acceptSnapshot(next);
      saveFailure = undefined;
    }
    setSaveStatus('✓ 已儲存至 SQLite');
  })();
  try { await saving; }
  catch (error) { saveFailure = error instanceof Error ? error : new Error(String(error)); setSaveStatus('儲存失敗 · 草稿仍保留', true); throw new Error(`${saveFailure.message}。草稿仍在編輯器；可在使用說明下載草稿，修正後再按儲存。`); }
  finally { saving = undefined; }
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
  $('editor').classList.toggle('no-note', !note);
  editor.setDocument(draft?.markdown ?? note?.markdown ?? '', `${snapshot.id}:${activeId}`);
  editorBase = note ? { workspaceId: snapshot.id, noteId: note.id, revision: draft?.baseRevision ?? note.revision } : undefined;
  if (runtime) editor.setRuntime(runtime, snapshot.records);
  $('breadcrumb').textContent = `${snapshot.name} / ${navigator.notePath(activeId) || note?.title || '建立筆記'}`;
  $('note-meta').textContent = note ? `修訂 ${note.revision} · ${new Date(note.updatedAt).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
  updateStats(); renderNotes();
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
  await selectNote(location.noteId); editor.focusRange(location.from, location.to);
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
      onInsertReference: name => editor.insertText(`{{${name}}}`),
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
    retry: () => worker.retry(),
  });
}
function openModal(title: string) { $('modal-title').textContent = title; $('modal-body').replaceChildren(); if (!($('modal') as HTMLDialogElement).open) ($('modal') as HTMLDialogElement).showModal(); return $('modal-body'); }
function closeModal() { ($('modal') as HTMLDialogElement).close(); }
function labeled(label: string, input: HTMLElement) { const group = element('label', 'field'); group.append(element('span', '', label), input); return group; }
function input(value = '', placeholder = '') { const el = element('input'); el.value = value; el.placeholder = placeholder; return el; }
function download(text: string, name: string, type = 'text/markdown;charset=utf-8') { const a = element('a'); const url = URL.createObjectURL(new Blob([text], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
async function createNote(title = '未命名筆記', markdown = '', folderId = navigator.currentFolderId()) { await transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>('/notes', 'POST', { title, markdown, folderId }); const created = next.notes.find(n => !snapshot.notes.some(old => old.id === n.id)); activeId = created?.id || next.notes.at(-1)?.id || ''; acceptSnapshot(next, true); acceptSnapshot(await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, activeNoteId: activeId } })); setSaveStatus('✓ 已儲存至 SQLite'); }); }
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
    await flush(); const next = await request<WorkspaceSnapshot>('/rename/apply', 'POST', { token: plan.token, workspaceRevision: plan.workspaceRevision });
    selectedIdentifier = plan.request.mode === 'identifier' ? plan.request.to : undefined; panel = 'values'; acceptSnapshot(next, true); closeModal(); toast('已更新定義與引用；可從復原紀錄回復。');
  }), 'primary'); apply.disabled = !plan.canApply;
  body.append(button('返回修改', () => renameDialog(plan.request.from, plan.request.mode)), apply);
}

function workspaceDialog() {
  const body = openModal('開啟或建立 workspace');
  body.append(element('p', 'muted', '每個 workspace 是一個 SQLite 資料庫。輸入本機路徑；新建檔案可使用 .grasp.db 副檔名。'));
  const currentPath = element('p', 'muted', '目前路徑：讀取中…'); body.append(currentPath);
  void request<{ path: string; warning?: string; migrationBackupPath?: string }>('/host').then(host => { currentPath.textContent = `目前路徑：${host.path}${host.migrationBackupPath ? `\n升級前備份：${host.migrationBackupPath}` : ''}${host.warning ? `\n${host.warning}` : ''}`; }).catch(() => { currentPath.textContent = ''; });
  const path = input('', 'workspaces/MyKnowledge.grasp.db'); path.setAttribute('aria-label', '資料庫路徑');
  const name = input('', '我的知識庫'); name.setAttribute('aria-label', '新 workspace 名稱');
  body.append(labeled('資料庫路徑', path), labeled('新 workspace 名稱（建立時使用）', name));
  const action = async (create: boolean) => transition(async () => { await flush(); if (!path.value.trim()) throw new Error('請輸入資料庫路徑。'); const next = await request<WorkspaceSnapshot>('/workspace/open', 'POST', { path: path.value.trim(), create, name: name.value.trim() || '我的知識庫' }); activeId = ''; acceptSnapshot(next, true); setSaveStatus('✓ 已儲存至 SQLite'); closeModal(); });
  const actions = element('div', 'form-actions'); actions.append(button('開啟既有資料庫', () => action(false)), button('建立新 workspace', () => action(true), 'primary')); body.append(actions);
}
function recordDialog(record?: StructuredRecord) {
  const body = openModal(record ? '編輯結構化資料' : '新增結構化資料');
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
  file.onchange = () => void run(async () => { const selected = file.files?.[0]; if (selected) source.value = await selected.text(); });
  body.append(file, source, button('驗證並檢視差異', async () => { await flush(); const plan = await request<ImportPlan>('/import/plan', 'POST', { markdown: source.value }); showImportPlan(plan); }, 'primary'));
}
function showImportPlan(plan: ImportPlan) {
  const body = openModal('審查匯入計畫');
  const changed = plan.changes.filter(c => c.kind !== 'unchanged');
  body.append(element('p', 'muted', `影響 ${changed.length} 份筆記 · ${plan.records.length} 筆匯入 records · 以 workspace 修訂 ${plan.workspaceRevision} 為基準。套用前會保存可復原版本。`));
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
    const confirm = openModal('確認復原 workspace'); confirm.append(element('p', '', `將復原至 ${new Date(record.createdAt).toLocaleString('zh-TW')} 的快照。整個 workspace 的筆記、資料夾與 records 都會替換；目前版本會另存於復原紀錄。`));
    confirm.append(element('p', 'muted', `筆記 ${preview.current.notes} → ${preview.target.notes} · 資料夾 ${preview.current.folders} → ${preview.target.folders} · records ${preview.current.records} → ${preview.target.records}${preview.settingsChanged ? ' · Workspace 設定也會回復' : ''}`));
    const changes = [
      ...preview.changes.notes.map(c => `筆記 · ${c.kind} · ${c.before?.title || '（無）'} → ${c.after?.title || '（無）'}${c.contentChanged ? ' · 內容變更' : ''}`),
      ...preview.changes.folders.map(c => `資料夾 · ${c.kind} · ${c.before?.name || '（無）'} → ${c.after?.name || '（無）'}`),
      ...preview.changes.records.map(c => `Record · ${c.kind} · ${c.before ? `${c.before.collection}.${c.before.name}` : '（無）'} → ${c.after ? `${c.after.collection}.${c.after.name}` : '（無）'} · 欄位：${c.changedFields.join(', ')}`),
    ];
    paged(confirm, changes, text => element('p', 'diff-card', text));
    confirm.append(button('取消', closeModal), button('確認復原', async () => transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>(`/history/${encodeURIComponent(record.id)}/restore`, 'POST', { workspaceRevision: preview.workspaceRevision }); acceptSnapshot(next, true); closeModal(); toast('已復原 workspace。'); }), 'primary'));
  })); body.append(row); }
}
function helpDialog() {
  const body = openModal('開始使用 GraspPortable');
  body.append(element('p', '', '直接寫 Markdown。Live Preview 在同一編輯區呈現內容；游標或選取範圍所在行會顯示原文。可切換 Source 完整查看語法。'), element('pre', 'syntax-example', '@first_name = "Sean"\n@last_name = "Wu"\n@full_name = "{first_name} {last_name}"\n@greeting = "你好，{full_name}！"\n\n今天的名字是 {{full_name}}。\n{{greeting}}'), element('p', '', '修改字串後會自動儲存並重算受影響的值。點擊 value 可前往定義；右側 References 列出引用位置。值的更新只改顯示，不會偷偷覆寫原始 Markdown。'), element('pre', 'syntax-example', '```grasp-query\n{"collection":"aura","where":{"field":"element","equals":"fire"}}\n```'), element('p', '', 'Records 由右側「資料」集中維護。query table 和 collection.name.field 引用都使用同一資料來源。模板中 {{ 和 }} 表示文字大括號。code fence 與 inline code 不解析識別值。'), element('p', '', 'Ctrl/⌘ + S 儲存 · Ctrl/⌘ + Z 復原編輯 · Ctrl/⌘ + F 搜尋。離開前確認左下角「已儲存至 SQLite」。匯出檔不會背景同步，外部修改只能透過匯入審查進入資料庫。'), button('下載目前筆記草稿', () => download(editor.getDocument(), `${($('note-title') as HTMLInputElement).value || 'draft'}.md`)), element('p', 'muted', '第一版在本機瀏覽器執行；關閉伺服器後再攜帶 workspace 的 .grasp.db 檔。Apple mobile host 尚未打包。'));
}
$('note-title').oninput = () => markDraft();
$('save').onclick = () => void run(flush);
$('workspace-open').onclick = workspaceDialog;
$('mode').onclick = () => void run(async () => { mode = mode === 'live' ? 'source' : 'live'; editor.setMode(mode); $('mode').textContent = mode === 'live' ? 'Live Preview' : 'Source'; $('mode').setAttribute('aria-pressed', String(mode === 'live')); await flush(); acceptSnapshot(await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, mode } })); });
$('toggle-inspector').onclick = () => document.body.classList.toggle('inspector-hidden');
$('delete-note').onclick = () => void run(async () => { await flush(); const note = snapshot.notes.find(n => n.id === activeId); if (!note) return; const body = openModal('刪除筆記'); body.append(element('p', '', `刪除「${note.title}」？可從復原紀錄找回。`), button('取消', closeModal), button('刪除並保存復原點', async () => transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>(`/notes/${note.id}`, 'DELETE', { revision: snapshot.notes.find(n => n.id === note.id)?.revision ?? note.revision }); acceptSnapshot(next, true); closeModal(); }), 'danger')); });
for (const name of ['values', 'records', 'issues', 'links'] as const) $(`tab-${name}`).onclick = () => { panel = name; renderInspector(); };
$('export').onclick = () => void run(async () => { await flush(); const response = await fetch('/api/export', { headers: workspaceHeaders() }); if (!response.ok) throw new Error('匯出失敗；workspace 可能已被其他分頁切換，請重新載入。'); download(await response.text(), `${snapshot.name.replace(/[\\/:*?"<>|]/g, '_')}.grasp.md`); toast('Markdown 已下載。外部修改後可透過匯入審查套用。'); });
$('import').onclick = importDialog;
$('history').onclick = () => void run(historyDialog);
$('help').onclick = helpDialog;
$('modal-close').onclick = closeModal;
document.addEventListener('close', () => {
  if (!pendingNavigation || document.querySelector('dialog[open]')) return;
  const pending = pendingNavigation; pendingNavigation = undefined;
  if (pending.workspaceId === snapshot?.id) void saveNavigationSettings(pending.patch).catch(error => toast(String(error), true));
}, true);
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void run(flush); } });
window.addEventListener('beforeunload', event => { if (drafts.size || saving || saveFailure) { event.preventDefault(); event.returnValue = ''; } });
void run(async () => {
  const initial = await request<WorkspaceSnapshot>('/workspace');
  mode = initial.settings.mode === 'source' ? 'source' : 'live'; editor.setMode(mode); $('mode').textContent = mode === 'live' ? 'Live Preview' : 'Source'; $('mode').setAttribute('aria-pressed', String(mode === 'live'));
  acceptSnapshot(initial, true); setSaveStatus('✓ 已儲存至 SQLite');
  const host = await request<{ path: string; warning?: string }>('/host');
  if (host.warning) toast(host.warning, true);
});
