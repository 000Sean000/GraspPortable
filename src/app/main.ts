import { createEditor } from '../editor/editor';
import { RuntimeClient } from '../runtime/client';
import { request, setWorkspaceId, workspaceHeaders } from './api';
import type { WorkspaceSnapshot, RuntimeResult, ImportPlan, StructuredRecord, SourceLocation } from '../domain/model';
import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<aside class="sidebar">
  <div class="brand"><span class="brand-mark">g.</span><div>Grasp<span>PORTABLE / 01</span></div></div>
  <button class="workspace-button" id="workspace-open"><span class="tiny-label">WORKSPACE</span><strong id="workspace-name">開啟中…</strong><span class="workspace-hint">切換或建立資料庫 ↗</span></button>
  <div class="nav-heading"><span>筆記</span><button id="new-note" class="icon-button" aria-label="新增筆記" title="新增筆記">＋</button></div>
  <input id="note-search" class="search" type="search" placeholder="搜尋筆記與內容…" aria-label="搜尋筆記">
  <nav id="note-list" aria-label="筆記列表"></nav>
  <div class="sidebar-bottom"><button id="export">↗ 匯出 Markdown</button><button id="import">↙ 匯入與審查</button><button id="history">↶ 復原紀錄</button><button id="help">? 使用說明</button><p>Local knowledge, connected.<br><span>SQLite · 本機資料庫</span></p></div>
</aside>
<main class="main-pane">
  <header class="toolbar"><span id="breadcrumb">WORKSPACE / NOTES</span><div class="toolbar-actions"><button id="mode" aria-pressed="true">Live Preview</button><button id="save" title="Ctrl / ⌘ + S">儲存</button><button id="delete-note" class="quiet" title="刪除目前筆記">刪除</button><button id="toggle-inspector" class="quiet" aria-label="切換知識面板">◫</button></div></header>
  <div class="document-heading"><div class="eyebrow">YOUR CONNECTED NOTEBOOK</div><input id="note-title" aria-label="筆記標題" placeholder="未命名筆記"><div class="document-meta"><span id="note-meta"></span><span class="mode-hint">游標所在行編輯原文，其他位置即時呈現</span></div></div>
  <div id="editor" aria-label="Markdown 編輯區"></div>
  <footer class="statusbar"><span id="save-status" role="status">載入中</span><span id="runtime-status">準備計算…</span><span id="document-stats"></span></footer>
</main>
<aside class="inspector"><div class="inspector-heading"><span class="eyebrow">KNOWLEDGE</span><h2>筆記裡的連結</h2><p>從文字到值，保持同步。</p></div><div class="tabs" role="tablist"><button id="tab-values" role="tab" aria-selected="true">識別值</button><button id="tab-records" role="tab" aria-selected="false">資料</button><button id="tab-issues" role="tab" aria-selected="false">診斷 <span id="issue-count">0</span></button></div><div id="inspector-content"></div></aside>
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
let panel: 'values' | 'records' | 'issues' = 'values';
let valueFilter = '';
let selectedIdentifier: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | undefined;
let saveFailure: Error | undefined;
let draftSequence = 0;
const drafts = new Map<string, { title: string; markdown: string; sequence: number }>();
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
  drafts.set(activeId, { title: ($('note-title') as HTMLInputElement).value, markdown, sequence: ++draftSequence });
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
    runtime = undefined; selectedIdentifier = undefined;
    editor.setRuntime({ revision: next.revision, values: {}, definitions: [], references: [], diagnostics: [], metrics: { elapsedMs: 0, recalculated: 0, total: 0, affected: 0 } }, []);
    mode = next.settings.mode === 'source' ? 'source' : 'live'; editor.setMode(mode); $('mode').textContent = mode === 'live' ? 'Live Preview' : 'Source'; $('mode').setAttribute('aria-pressed', String(mode === 'live'));
  }
  if (!snapshot.notes.some(n => n.id === activeId)) activeId = snapshot.settings.activeNoteId && snapshot.notes.some(n => n.id === snapshot.settings.activeNoteId) ? snapshot.settings.activeNoteId : snapshot.notes[0]?.id || '';
  $('workspace-name').textContent = snapshot.name;
  document.title = `${snapshot.name} · GraspPortable`;
  renderNotes();
  if (resetEditor) showActiveNote();
  $('runtime-status').textContent = '背景計算中…';
  runtimeFailure = undefined;
  worker.update(snapshot);
  renderInspector();
  const current = snapshot.notes.find(n => n.id === activeId);
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
      const next = await request<WorkspaceSnapshot>(`/notes/${encodeURIComponent(id)}`, 'PUT', { title: draft.title.trim() || '未命名筆記', markdown: draft.markdown, revision: note.revision });
      if (drafts.get(id)?.sequence === draft.sequence) drafts.delete(id);
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
  const query = ($('note-search') as HTMLInputElement).value.toLowerCase();
  const list = $('note-list'); list.replaceChildren();
  const notes = snapshot.notes.filter(n => `${n.title}\n${n.markdown}`.toLowerCase().includes(query));
  for (const note of notes) {
    const item = button('', () => selectNote(note.id), 'note-item' + (note.id === activeId ? ' active' : ''));
    item.dataset.noteId = note.id; item.append(element('span', 'note-icon', '≡'), element('span', 'note-item-title', drafts.get(note.id)?.title || note.title));
    list.append(item);
  }
  if (!notes.length) list.append(element('p', 'empty', query ? '沒有符合的筆記' : '按 ＋ 開始第一份筆記。'));
}
function showActiveNote() {
  const note = snapshot.notes.find(n => n.id === activeId);
  const draft = drafts.get(activeId);
  ($('note-title') as HTMLInputElement).value = draft?.title ?? note?.title ?? '';
  ($('note-title') as HTMLInputElement).disabled = !note;
  $('editor').classList.toggle('no-note', !note);
  editor.setDocument(draft?.markdown ?? note?.markdown ?? '');
  if (runtime) editor.setRuntime(runtime, snapshot.records);
  $('breadcrumb').textContent = `${snapshot.name} / ${note?.title || '建立筆記'}`;
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
async function navigateLocation(location: SourceLocation) {
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
  for (const name of ['values', 'records', 'issues']) $(`tab-${name}`).setAttribute('aria-selected', String(panel === name));
  const content = $('inspector-content');
  const focused = document.activeElement?.id;
  const selection = focused === 'value-search' ? ($('value-search') as HTMLInputElement).selectionStart : null;
  content.replaceChildren();
  if (panel === 'values') {
    const input = element('input', 'search'); input.id = 'value-search'; input.type = 'search'; input.placeholder = '搜尋 identifier…'; input.setAttribute('aria-label', '搜尋 identifier'); input.value = valueFilter;
    input.oninput = () => { valueFilter = input.value; renderInspector(); };
    content.append(input);
    if (selectedIdentifier) {
      const card = element('section', 'reference-detail');
      card.append(button('← 所有識別值', () => { selectedIdentifier = undefined; renderInspector(); }, 'text-button'), element('h3', '', selectedIdentifier));
      const value = runtime?.values[selectedIdentifier]; card.append(element('p', 'current-value', value?.value || value?.message || '未定義'));
      card.append(button('前往定義 ↗', () => navigateIdentifier(selectedIdentifier!)));
      const refs = runtime?.references.filter(r => r.name === selectedIdentifier) || [];
      card.append(element('h4', '', `References · ${refs.length}`));
      for (const ref of refs.slice(0, 150)) {
        const note = snapshot.notes.find(n => n.id === ref.location.noteId);
        const occurrence = refs.filter(r => r.location.noteId === ref.location.noteId && r.kind === ref.kind).indexOf(ref);
        card.append(button(`${note?.title || '結構化資料'} · 第 ${ref.location.line} 行${ref.kind === 'dependency' ? ' · 依賴' : ''}`, () => navigateReference(ref.name, ref.location.noteId, ref.kind, occurrence), 'reference-link'));
      }
      if (!refs.length) card.append(element('p', 'empty', '目前沒有其他引用。'));
      if (refs.length > 150) card.append(element('p', 'empty', '顯示前 150 個位置。'));
      content.append(card);
    }
    const entries = Object.entries(runtime?.values || {}).filter(([name]) => name.toLowerCase().includes(valueFilter.toLowerCase()));
    content.append(element('div', 'section-caption', `${entries.length} 個識別值`));
    for (const [name, value] of entries.slice(0, 120)) {
      const card = element('div', 'value-card');
      const row = element('div', 'value-card-header'); row.append(button(name, () => navigateIdentifier(name), 'identifier-name'), element('span', `value-state ${value.status}`, value.status === 'ok' ? '●' : value.status));
      card.append(row, element('div', 'value-text', value.value || (value.status === 'ok' ? '（空字串）' : value.message || '')));
      const actions = element('div', 'value-actions'); actions.append(button('定義 ↗', () => navigateIdentifier(name)), button('References', () => { selectedIdentifier = name; renderInspector(); })); card.append(actions); content.append(card);
    }
    if (!entries.length) content.append(element('p', 'empty', '寫下 @name = "Hello"，再用 {{name}} 引用。'));
    if (entries.length > 120) content.append(element('p', 'empty', '顯示前 120 個；輸入名稱縮小範圍。'));
    if (focused === 'value-search') { input.focus(); if (selection !== null) input.setSelectionRange(selection, selection); }
  } else if (panel === 'records') {
    content.append(element('p', 'panel-intro', '一組資料，一份來源。欄位可直接由 identifier 引用，也能在筆記顯示 table。'), button('＋ 新增 record', () => recordDialog(), 'primary wide'));
    for (const record of snapshot.records.slice(0, 150)) {
      const card = element('div', 'record-card'); card.append(element('span', 'section-caption', record.collection), element('h3', '', record.name));
      for (const [key, raw] of Object.entries(record.fields)) { const value = runtime?.values[`${record.collection}.${record.name}.${key}`]; card.append(element('p', 'record-field', `${key}  ${value?.value ?? raw}`)); }
      card.append(button('編輯', () => recordDialog(record)), button('建立 table 筆記', () => createQueryNote(record.collection), 'text-button')); content.append(card);
    }
    if (!snapshot.records.length) content.append(element('p', 'empty', '集中保存人物、物品或其他資料，不必一筆一個檔案。'));
    if (snapshot.records.length > 150) content.append(element('p', 'empty', '側欄顯示前 150 筆；使用筆記 query 篩選更多資料。'));
  } else {
    content.append(button('重新計算', () => worker.retry(), 'wide'));
    const diagnostics = runtime?.diagnostics || [];
    if (!diagnostics.length) content.append(element('div', 'healthy', '✓ 目前沒有診斷問題'), element('p', 'panel-intro', '缺少定義、重複名稱與循環依賴會顯示在這裡。錯誤不會阻止正常筆記儲存。'));
    for (const issue of diagnostics.slice(0, 200)) { const card = element('div', 'issue-card'); card.append(element('strong', '', issue.kind), element('p', '', issue.message)); if (issue.location) card.append(button('查看位置 ↗', () => navigateLocation(issue.location!))); content.append(card); }
    if (diagnostics.length > 200) content.append(element('p', 'empty', `共 ${diagnostics.length} 個問題，顯示前 200 個。`));
  }
}
function openModal(title: string) { $('modal-title').textContent = title; $('modal-body').replaceChildren(); if (!($('modal') as HTMLDialogElement).open) ($('modal') as HTMLDialogElement).showModal(); return $('modal-body'); }
function closeModal() { ($('modal') as HTMLDialogElement).close(); }
function labeled(label: string, input: HTMLElement) { const group = element('label', 'field'); group.append(element('span', '', label), input); return group; }
function input(value = '', placeholder = '') { const el = element('input'); el.value = value; el.placeholder = placeholder; return el; }
function download(text: string, name: string, type = 'text/markdown;charset=utf-8') { const a = element('a'); const url = URL.createObjectURL(new Blob([text], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
async function createNote(title = '未命名筆記', markdown = '') { await transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>('/notes', 'POST', { title, markdown }); const created = next.notes.find(n => !snapshot.notes.some(old => old.id === n.id)); activeId = created?.id || next.notes.at(-1)?.id || ''; acceptSnapshot(next, true); acceptSnapshot(await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, activeNoteId: activeId } })); setSaveStatus('✓ 已儲存至 SQLite'); }); }
async function createQueryNote(collection: string) { await createNote(`${collection} · 資料檢視`, `# ${collection}\n\n此 table 使用資料庫中的同一組 records。將游標移入區塊可修改 query。\n\n\`\`\`grasp-query\n${JSON.stringify({ collection }, null, 2)}\n\`\`\`\n`); }

function workspaceDialog() {
  const body = openModal('開啟或建立 workspace');
  body.append(element('p', 'muted', '每個 workspace 是一個 SQLite 資料庫。輸入本機路徑；新建檔案可使用 .grasp.db 副檔名。'));
  const currentPath = element('p', 'muted', '目前路徑：讀取中…'); body.append(currentPath);
  void request<{ path: string; warning?: string }>('/host').then(host => { currentPath.textContent = `目前路徑：${host.path}${host.warning ? `\n${host.warning}` : ''}`; }).catch(() => { currentPath.textContent = ''; });
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
  body.append(labeled('Collection', collection), labeled('Record 名稱', name));
  const fields = element('div', 'record-fields');
  function addField(key = '', value = '') { const row = element('div', 'record-field-row'); const k = input(key, '欄位名稱'); k.setAttribute('aria-label', '欄位名稱'); const v = input(value, '字串值 / {identifier}'); v.setAttribute('aria-label', '欄位值'); row.append(k, v, button('×', () => row.remove(), 'icon-button')); fields.append(row); }
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
  for (const issue of plan.diagnostics) body.append(element('p', 'validation-error', `${issue.kind}: ${issue.message}`));
  for (const change of changed) {
    const details = element('details', 'diff-card'); details.open = true; details.append(element('summary', '', `${change.kind === 'create' ? '新增' : '修改'} · ${change.title}`));
    const oldTitle = snapshot.notes.find(n => n.id === change.id)?.title;
    if (oldTitle && oldTitle !== change.title) details.append(element('p', 'muted', `標題：${oldTitle} → ${change.title}`));
    const diff = element('div', 'diff-columns'); const before = element('div'); before.append(element('h4', '', '資料庫目前內容'), element('pre', 'diff-before', change.before)); const after = element('div'); after.append(element('h4', '', '匯入後內容'), element('pre', 'diff-after', change.after)); diff.append(before, after); details.append(diff); body.append(details);
  }
  if (JSON.stringify(plan.records) !== JSON.stringify(snapshot.records)) { const details = element('details', 'diff-card'); details.append(element('summary', '', '結構化資料差異')); const diff = element('div', 'diff-columns'); diff.append(element('pre', 'diff-before', JSON.stringify(snapshot.records, null, 2)), element('pre', 'diff-after', JSON.stringify(plan.records, null, 2))); details.append(diff); body.append(details); }
  if (!changed.length) body.append(element('p', 'empty', '沒有筆記文字變更。請同時檢查結構化資料。'));
  const actions = element('div', 'form-actions'); actions.append(button('返回修改', importDialog)); const apply = button('確認套用至資料庫', async () => transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>('/import/apply', 'POST', { token: plan.token, workspaceRevision: plan.workspaceRevision }); acceptSnapshot(next, true); closeModal(); toast('已套用匯入。原內容可從復原紀錄找回。'); }), 'primary'); apply.disabled = !plan.canApply; actions.append(apply); body.append(actions);
}
async function historyDialog() {
  await flush(); const records = await request<Array<{ id: string; createdAt: string; reason: string; workspaceRevision: number }>>('/history');
  const body = openModal('復原紀錄'); body.append(element('p', 'muted', '刪除、匯入與復原前均保存 workspace 快照。復原會取代目前內容，並保留復原前的版本。'));
  if (!records.length) body.append(element('p', 'empty', '還沒有需要復原的操作。'));
  for (const record of records) { const row = element('div', 'history-row'); row.append(element('div', '', `${new Date(record.createdAt).toLocaleString('zh-TW')} · ${record.reason} · r${record.workspaceRevision}`), button('檢查復原', () => {
    const confirm = openModal('確認復原 workspace'); confirm.append(element('p', '', `將復原至 ${new Date(record.createdAt).toLocaleString('zh-TW')} 的快照。整個 workspace 的筆記與 records 都會替換；目前版本會另存於復原紀錄。`), button('取消', closeModal), button('確認復原', async () => transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>(`/history/${encodeURIComponent(record.id)}/restore`, 'POST', { workspaceRevision: snapshot.revision }); acceptSnapshot(next, true); closeModal(); toast('已復原 workspace。'); }), 'primary'));
  })); body.append(row); }
}
function helpDialog() {
  const body = openModal('開始使用 GraspPortable');
  body.append(element('p', '', '直接寫 Markdown。Live Preview 在同一編輯區呈現內容；游標或選取範圍所在行會顯示原文。可切換 Source 完整查看語法。'), element('pre', 'syntax-example', '@first_name = "Sean"\n@last_name = "Wu"\n@full_name = "{first_name} {last_name}"\n@greeting = "你好，{full_name}！"\n\n今天的名字是 {{full_name}}。\n{{greeting}}'), element('p', '', '修改字串後會自動儲存並重算受影響的值。點擊 value 可前往定義；右側 References 列出引用位置。值的更新只改顯示，不會偷偷覆寫原始 Markdown。'), element('pre', 'syntax-example', '```grasp-query\n{"collection":"aura","where":{"field":"element","equals":"fire"}}\n```'), element('p', '', 'Records 由右側「資料」集中維護。query table 和 collection.name.field 引用都使用同一資料來源。模板中 {{ 和 }} 表示文字大括號。code fence 與 inline code 不解析識別值。'), element('p', '', 'Ctrl/⌘ + S 儲存 · Ctrl/⌘ + Z 復原編輯 · Ctrl/⌘ + F 搜尋。離開前確認左下角「已儲存至 SQLite」。匯出檔不會背景同步，外部修改只能透過匯入審查進入資料庫。'), button('下載目前筆記草稿', () => download(editor.getDocument(), `${($('note-title') as HTMLInputElement).value || 'draft'}.md`)), element('p', 'muted', '第一版在本機瀏覽器執行；關閉伺服器後再攜帶 workspace 的 .grasp.db 檔。Apple mobile host 尚未打包。'));
}
$('new-note').onclick = () => void run(async () => { await createNote(); ($('note-title') as HTMLInputElement).focus(); ($('note-title') as HTMLInputElement).select(); });
$('note-search').oninput = renderNotes;
$('note-title').oninput = () => markDraft();
$('save').onclick = () => void run(flush);
$('workspace-open').onclick = workspaceDialog;
$('mode').onclick = () => void run(async () => { mode = mode === 'live' ? 'source' : 'live'; editor.setMode(mode); $('mode').textContent = mode === 'live' ? 'Live Preview' : 'Source'; $('mode').setAttribute('aria-pressed', String(mode === 'live')); await flush(); acceptSnapshot(await request<WorkspaceSnapshot>('/settings', 'PUT', { settings: { ...snapshot.settings, mode } })); });
$('toggle-inspector').onclick = () => document.body.classList.toggle('inspector-hidden');
$('delete-note').onclick = () => void run(async () => { await flush(); const note = snapshot.notes.find(n => n.id === activeId); if (!note) return; const body = openModal('刪除筆記'); body.append(element('p', '', `刪除「${note.title}」？可從復原紀錄找回。`), button('取消', closeModal), button('刪除並保存復原點', async () => transition(async () => { await flush(); const next = await request<WorkspaceSnapshot>(`/notes/${note.id}`, 'DELETE', { revision: snapshot.notes.find(n => n.id === note.id)?.revision ?? note.revision }); acceptSnapshot(next, true); closeModal(); }), 'danger')); });
for (const name of ['values', 'records', 'issues'] as const) $(`tab-${name}`).onclick = () => { panel = name; renderInspector(); };
$('export').onclick = () => void run(async () => { await flush(); const response = await fetch('/api/export', { headers: workspaceHeaders() }); if (!response.ok) throw new Error('匯出失敗；workspace 可能已被其他分頁切換，請重新載入。'); download(await response.text(), `${snapshot.name.replace(/[\\/:*?"<>|]/g, '_')}.grasp.md`); toast('Markdown 已下載。外部修改後可透過匯入審查套用。'); });
$('import').onclick = importDialog;
$('history').onclick = () => void run(historyDialog);
$('help').onclick = helpDialog;
$('modal-close').onclick = closeModal;
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void run(flush); } });
window.addEventListener('beforeunload', event => { if (drafts.size || saving || saveFailure) { event.preventDefault(); event.returnValue = ''; } });
void run(async () => {
  const initial = await request<WorkspaceSnapshot>('/workspace');
  mode = initial.settings.mode === 'source' ? 'source' : 'live'; editor.setMode(mode); $('mode').textContent = mode === 'live' ? 'Live Preview' : 'Source'; $('mode').setAttribute('aria-pressed', String(mode === 'live'));
  acceptSnapshot(initial, true); setSaveStatus('✓ 已儲存至 SQLite');
  const host = await request<{ path: string; warning?: string }>('/host');
  if (host.warning) toast(host.warning, true);
});
