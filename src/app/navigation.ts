import type { Note } from '../domain/model';
import './navigation.css';

export interface NavigationFolder { id: string; parentId: string | null; name: string; revision: number }
export type NavigationNote = Note & { folderId?: string | null };
export interface NavigationSnapshot { id: string; name: string; notes: readonly NavigationNote[]; folders?: readonly NavigationFolder[]; settings: Record<string, string> }
export interface NavigationRange { from: number; to: number }
export interface NavigationCallbacks {
  onSelect(noteId: string, range?: NavigationRange): Promise<unknown> | unknown;
  onCreateNote(folderId: string | null): Promise<unknown> | unknown;
  onRenameNote(noteId: string, title: string): Promise<unknown> | unknown;
  onMoveNote(noteId: string, folderId: string | null): Promise<unknown> | unknown;
  onDeleteNote(noteId: string): Promise<unknown> | unknown;
  onCreateFolder(parentId: string | null, name: string): Promise<unknown> | unknown;
  onRenameFolder(folderId: string, name: string): Promise<unknown> | unknown;
  onMoveFolder(folderId: string, parentId: string | null): Promise<unknown> | unknown;
  /** Deletion is explicit, recursive, and protected by a current workspace revision in the host. */
  onDeleteFolder(folderId: string): Promise<unknown> | unknown;
  /** Merge this patch into the latest settings, never a captured older settings object. */
  onPersistSettings(patch: Record<string, string>): Promise<unknown> | unknown;
  onError?(message: string): void;
}
export interface NavigationHit { note: NavigationNote; path: string; snippet: string; range?: NavigationRange; score: number }
interface IndexedNote { note: NavigationNote; path: string; titleKey: string; pathKey: string; bodyKey: string }
const PAGE_SIZE = 80;
const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
const normalized = (text: string) => text.normalize('NFC').toLowerCase();
const folderOf = (note: NavigationNote) => note.folderId ?? null;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Plain-data navigation/search index; no DOM, editor state, SQLite, or calculation dependencies. */
export class NavigationIndex {
  notes = new Map<string, NavigationNote>();
  folders = new Map<string, NavigationFolder>();
  private indexed = new Map<string, IndexedNote>();
  private paths = new Map<string, string>();
  update(notes: readonly NavigationNote[], folders: readonly NavigationFolder[] = []): void {
    this.notes = new Map(notes.map(note => [note.id, note]));
    this.folders = new Map(folders.map(folder => [folder.id, folder]));
    this.paths.clear();
    const next = new Map<string, IndexedNote>();
    for (const note of notes) {
      const path = this.notePath(note.id); const previous = this.indexed.get(note.id);
      next.set(note.id, {
        note, path,
        titleKey: previous?.note.title === note.title ? previous.titleKey : normalized(note.title),
        pathKey: previous?.path === path ? previous.pathKey : normalized(path),
        bodyKey: previous?.note.markdown === note.markdown ? previous.bodyKey : normalized(note.markdown),
      });
    }
    this.indexed = next;
  }
  ancestors(folderId: string | null): NavigationFolder[] {
    const result: NavigationFolder[] = []; const seen = new Set<string>();
    while (folderId && !seen.has(folderId)) {
      seen.add(folderId); const folder = this.folders.get(folderId); if (!folder) break;
      result.unshift(folder); folderId = folder.parentId;
    }
    return result;
  }
  folderPath(folderId: string | null): string {
    if (!folderId) return '';
    let path = this.paths.get(folderId);
    if (path === undefined) { path = this.ancestors(folderId).map(folder => folder.name).join(' / '); this.paths.set(folderId, path); }
    return path;
  }
  notePath(noteId: string): string {
    const note = this.notes.get(noteId); if (!note) return '';
    return [this.folderPath(folderOf(note)), note.title].filter(Boolean).join(' / ');
  }
  descendants(folderId: string): Set<string> {
    const result = new Set([folderId]); const children = new Map<string, string[]>();
    for (const folder of this.folders.values()) if (folder.parentId) { const list = children.get(folder.parentId) ?? []; list.push(folder.id); children.set(folder.parentId, list); }
    const queue = [folderId];
    for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i]) ?? []) if (!result.has(child)) { result.add(child); queue.push(child); }
    return result;
  }
  folderScope(folderId: string): { folders: number; notes: number } {
    const descendants = this.descendants(folderId);
    return { folders: descendants.size, notes: [...this.notes.values()].filter(note => folderOf(note) !== null && descendants.has(folderOf(note)!)).length };
  }
  children(folderId: string | null): NavigationFolder[] { return [...this.folders.values()].filter(folder => folder.parentId === folderId).sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)); }
  noteList(folderId?: string | null): NavigationNote[] {
    return [...this.notes.values()].filter(note => folderId === undefined || folderOf(note) === folderId).sort((a, b) => collator.compare(a.title, b.title) || collator.compare(this.notePath(a.id), this.notePath(b.id)) || a.id.localeCompare(b.id));
  }
  search(query: string, titlesOnly = false): NavigationHit[] {
    const terms = normalized(query.trim()).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hits: NavigationHit[] = [];
    for (const entry of this.indexed.values()) {
      if (!terms.every(term => entry.titleKey.includes(term) || entry.pathKey.includes(term) || (!titlesOnly && entry.bodyKey.includes(term)))) continue;
      let range: NavigationRange | undefined;
      if (!titlesOnly) for (const term of terms) {
        const match = new RegExp(escapeRegex(term), 'iu').exec(entry.note.markdown);
        if (match) { range = { from: match.index, to: match.index + match[0].length }; break; }
      }
      const start = range ? Math.max(0, range.from - 35) : 0;
      const snippet = entry.note.markdown.slice(start, Math.min(entry.note.markdown.length, start + 130)).replace(/\s+/g, ' ').trim();
      const score = entry.titleKey === normalized(query.trim()) ? 0 : terms.every(term => entry.titleKey.includes(term)) ? 1 : terms.every(term => entry.pathKey.includes(term)) ? 2 : 3;
      hits.push({ note: entry.note, path: entry.path, snippet: (start ? '…' : '') + snippet, range, score });
    }
    return hits.sort((a, b) => a.score - b.score || collator.compare(a.path, b.path) || a.note.id.localeCompare(b.note.id));
  }
}

/** Session back/forward is distinct from the DB's destructive-operation recovery history. */
export class NavigationHistory {
  private visits: string[] = [];
  private cursor = -1;
  get canBack() { return this.cursor > 0; }
  get canForward() { return this.cursor >= 0 && this.cursor < this.visits.length - 1; }
  get current() { return this.visits[this.cursor]; }
  visit(id: string) { if (this.current === id) return; this.visits = this.visits.slice(0, this.cursor + 1); this.visits.push(id); if (this.visits.length > 100) this.visits.shift(); this.cursor = this.visits.length - 1; }
  destination(direction: -1 | 1) { return this.visits[this.cursor + direction]; }
  move(direction: -1 | 1) { if (!this.destination(direction)) return; this.cursor += direction; return this.current; }
  prune(valid: Set<string>) {
    const before = this.visits.slice(0, this.cursor + 1).filter(id => valid.has(id)).length;
    this.visits = this.visits.filter(id => valid.has(id));
    this.cursor = this.visits.length ? Math.max(0, before - 1) : -1;
  }
  clear() { this.visits = []; this.cursor = -1; }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function readIds(value?: string): string[] { try { const parsed: unknown = JSON.parse(value ?? '[]'); return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))].slice(0, 20) : []; } catch { return []; } }
type NavMode = 'folder' | 'all' | 'recent';
type ListRow = { kind: 'folder'; folder: NavigationFolder } | { kind: 'note'; note: NavigationNote; hit?: NavigationHit };

export class Navigator {
  readonly index = new NavigationIndex();
  private history = new NavigationHistory();
  private snapshot?: NavigationSnapshot;
  private activeId = '';
  private folderId: string | null = null;
  private mode: NavMode = 'folder';
  private recent: string[] = [];
  private page = 0;
  private busy = false;
  private pendingHistory?: { id: string; direction: -1 | 1 };
  private persistTimer?: ReturnType<typeof setTimeout>;
  private searchInput = el('input', 'search');
  private list = el('nav', 'gp-nav-list');
  private crumbs = el('nav', 'gp-nav-breadcrumb');
  private tabs = el('div', 'gp-nav-tabs');
  private pager = el('div', 'gp-nav-pager');
  private caption = el('div', 'gp-nav-caption');
  private status = el('div', 'gp-nav-error');
  private backButton: HTMLButtonElement;
  private forwardButton: HTMLButtonElement;
  private dialog = el('dialog', 'gp-nav-dialog');
  private destroyed = false;
  private onKeydown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'p' && !document.querySelector('dialog[open]')) { event.preventDefault(); this.openQuickSwitch(); }
  };

  constructor(private parent: HTMLElement, private callbacks: NavigationCallbacks) {
    parent.classList.add('gp-navigator');
    const toolbar = el('div', 'gp-nav-toolbar');
    this.backButton = this.button('←', () => this.travel(-1), '返回上一份筆記');
    this.forwardButton = this.button('→', () => this.travel(1), '前往下一份筆記');
    toolbar.append(this.backButton, this.forwardButton, this.button('⌕', () => this.openQuickSwitch(), '快速切換筆記（Ctrl / ⌘ + P）'));
    const create = this.button('＋筆記', () => this.callbacks.onCreateNote(this.folderId), '新增筆記'); create.id = 'new-note';
    toolbar.append(create, this.button('＋資料夾', () => this.folderNameDialog(), '新增資料夾'));
    this.searchInput.id = 'note-search'; this.searchInput.type = 'search'; this.searchInput.placeholder = '搜尋標題、路徑、內容…'; this.searchInput.setAttribute('aria-label', '搜尋筆記');
    this.searchInput.addEventListener('input', () => { this.page = 0; this.render(); });
    this.searchInput.addEventListener('keydown', event => { if (event.key === 'Escape') { this.searchInput.value = ''; this.page = 0; this.render(); } });
    this.tabs.setAttribute('aria-label', '筆記檢視');
    for (const [mode, title] of [['folder', '資料夾'], ['all', '全部'], ['recent', '最近']] as const) {
      const tab = this.button(title, () => { this.mode = mode; this.searchInput.value = ''; this.page = 0; this.render(); this.persistSoon(); }); tab.dataset.mode = mode; this.tabs.append(tab);
    }
    this.crumbs.setAttribute('aria-label', '資料夾路徑');
    this.list.id = 'note-list'; this.list.setAttribute('aria-label', '筆記列表');
    this.status.setAttribute('role', 'alert'); this.status.hidden = true;
    parent.replaceChildren(toolbar, this.searchInput, this.tabs, this.crumbs, this.caption, this.list, this.pager, this.status);
    this.dialog.addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    document.body.append(this.dialog); document.addEventListener('keydown', this.onKeydown);
  }
  private button(text: string, action: () => unknown, label = text): HTMLButtonElement {
    const button = el('button', '', text); button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
    button.addEventListener('click', () => { void this.perform(action); }); return button;
  }
  private async perform(action: () => unknown) {
    if (this.busy || this.destroyed) return;
    this.busy = true; this.parent.setAttribute('aria-busy', 'true'); this.status.hidden = true;
    try { await action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error); this.status.textContent = message; this.status.hidden = false;
      if (this.dialog.open) { const error = this.dialog.querySelector<HTMLElement>('.gp-nav-action-error') ?? el('p', 'gp-nav-error gp-nav-action-error'); error.setAttribute('role', 'alert'); error.textContent = message; this.dialog.querySelector('.gp-nav-dialog-body')?.append(error); }
      this.callbacks.onError?.(message);
    }
    finally { this.busy = false; this.parent.removeAttribute('aria-busy'); }
  }
  /** Call after each accepted committed snapshot and after active-note changes. */
  setWorkspace(snapshot: NavigationSnapshot, activeNoteId: string, options: { revealActive?: boolean; reset?: boolean } = {}): void {
    if (this.destroyed) return;
    const changedWorkspace = snapshot.id !== this.snapshot?.id;
    const previousFolder = this.index.notes.get(activeNoteId)?.folderId ?? null;
    const wasKnown = this.index.notes.has(activeNoteId);
    const changedActive = activeNoteId !== this.activeId;
    this.snapshot = snapshot; this.index.update(snapshot.notes, snapshot.folders);
    if (changedWorkspace) {
      clearTimeout(this.persistTimer); this.history.clear(); this.pendingHistory = undefined;
      this.recent = readIds(snapshot.settings['navigation.recent']);
      const savedFolder = snapshot.settings['navigation.folder']; this.folderId = savedFolder && this.index.folders.has(savedFolder) ? savedFolder : null;
      this.mode = 'folder'; this.searchInput.value = ''; this.page = 0; this.dialog.close();
    }
    this.activeId = this.index.notes.has(activeNoteId) ? activeNoteId : '';
    const valid = new Set(this.index.notes.keys()); this.recent = this.recent.filter(id => valid.has(id)); this.history.prune(valid);
    if (this.activeId && (changedActive || changedWorkspace)) {
      if (this.pendingHistory?.id === this.activeId) this.history.move(this.pendingHistory.direction); else this.history.visit(this.activeId);
      this.pendingHistory = undefined;
      this.recent = [this.activeId, ...this.recent.filter(id => id !== this.activeId)].slice(0, 20);
      this.persistSoon();
    }
    if (this.folderId && !this.index.folders.has(this.folderId)) this.folderId = null;
    const note = this.index.notes.get(this.activeId);
    const moved = note && previousFolder !== folderOf(note);
    if (options.reset || options.revealActive || changedWorkspace || (note && !wasKnown) || moved) this.revealNote(this.activeId);
    else {
      if (changedActive && note && this.mode === 'folder' && !this.searchInput.value) this.folderId = folderOf(note);
      this.render(changedActive);
    }
  }
  currentFolderId(): string | null { return this.folderId; }
  notePath(noteId: string): string { return this.index.notePath(noteId); }
  revealNote(noteId = this.activeId): void {
    const note = this.index.notes.get(noteId);
    this.searchInput.value = ''; this.mode = 'folder'; this.folderId = note ? folderOf(note) : null; this.page = 0; this.render(true);
  }
  private persistSoon() {
    clearTimeout(this.persistTimer); const workspaceId = this.snapshot?.id;
    this.persistTimer = setTimeout(() => {
      if (this.destroyed || this.snapshot?.id !== workspaceId) return;
      // Root serializes this patch with its current settings and other commands.
      Promise.resolve().then(() => this.callbacks.onPersistSettings({ 'navigation.recent': JSON.stringify(this.recent), 'navigation.folder': this.folderId ?? '' })).catch(error => this.callbacks.onError?.(String(error)));
    }, 500);
  }
  private openFolder(id: string | null) { this.folderId = id; this.mode = 'folder'; this.searchInput.value = ''; this.page = 0; this.render(); this.persistSoon(); }
  private async choose(id: string, range?: NavigationRange) { this.dialog.close(); await this.callbacks.onSelect(id, range); }
  private async travel(direction: -1 | 1) {
    const id = this.history.destination(direction); if (!id) return;
    this.pendingHistory = { id, direction };
    try { await this.choose(id); } finally { this.pendingHistory = undefined; }
  }
  private rows(): ListRow[] {
    const query = this.searchInput.value.trim();
    if (query) return this.index.search(query).map(hit => ({ kind: 'note', note: hit.note, hit }));
    if (this.mode === 'recent') return this.recent.flatMap(id => { const note = this.index.notes.get(id); return note ? [{ kind: 'note' as const, note }] : []; });
    if (this.mode === 'all') return this.index.noteList().map(note => ({ kind: 'note', note }));
    return [...this.index.children(this.folderId).map(folder => ({ kind: 'folder' as const, folder })), ...this.index.noteList(this.folderId).map(note => ({ kind: 'note' as const, note }))];
  }
  private render(revealActive = false) {
    if (!this.snapshot) return;
    this.backButton.disabled = !this.history.canBack; this.forwardButton.disabled = !this.history.canForward;
    for (const button of this.tabs.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
    this.crumbs.replaceChildren(this.button('⌂', () => this.openFolder(null), '開啟根資料夾'));
    for (const folder of this.index.ancestors(this.folderId)) this.crumbs.append(el('span', '', '/'), this.button(folder.name, () => this.openFolder(folder.id), `開啟資料夾 ${this.index.folderPath(folder.id)}`));
    if (this.folderId) this.crumbs.append(this.button('⋯', () => this.folderActions(this.folderId!), '目前資料夾操作'));
    const rows = this.rows();
    if (revealActive) { const active = rows.findIndex(row => row.kind === 'note' && row.note.id === this.activeId); if (active >= 0) this.page = Math.floor(active / PAGE_SIZE); }
    this.page = Math.max(0, Math.min(this.page, Math.ceil(rows.length / PAGE_SIZE) - 1));
    this.caption.replaceChildren(el('span', '', `${this.searchInput.value.trim() ? '全庫搜尋' : this.mode === 'recent' ? '最近開啟' : this.mode === 'all' ? '全部筆記' : '目前資料夾'} · ${rows.length.toLocaleString()} 項`), this.button('◎', () => this.revealNote(), '定位目前筆記'));
    const from = this.page * PAGE_SIZE;
    this.list.replaceChildren();
    for (const row of rows.slice(from, from + PAGE_SIZE)) {
      const container = el('div', 'gp-nav-row');
      if (row.kind === 'folder') {
        const folder = row.folder;
        const item = this.button(`▸ ${folder.name}`, () => this.openFolder(folder.id), `開啟資料夾 ${this.index.folderPath(folder.id)}`); item.className = 'gp-folder-item'; item.dataset.folderId = folder.id;
        container.append(item, this.button('⋯', () => this.folderActions(folder.id), `資料夾操作 ${folder.name}`));
      } else {
        const note = row.note; const item = this.button('', () => this.choose(note.id, row.hit?.range), `開啟筆記 ${this.index.notePath(note.id)}`);
        item.className = 'note-item' + (note.id === this.activeId ? ' active' : ''); item.dataset.noteId = note.id; item.setAttribute('aria-current', note.id === this.activeId ? 'page' : 'false');
        const title = el('span', 'note-item-title', note.title); item.append(title);
        if (this.searchInput.value.trim() || this.mode !== 'folder') item.append(el('span', 'gp-nav-path', this.index.folderPath(folderOf(note)) || '根資料夾'));
        if (row.hit?.snippet) item.append(el('span', 'gp-nav-snippet', row.hit.snippet));
        container.append(item, this.button('⋯', () => this.noteActions(note.id), `筆記操作 ${note.title}`));
      }
      this.list.append(container);
    }
    if (!rows.length) this.list.append(el('p', 'empty', this.searchInput.value.trim() ? '沒有符合的筆記。搜尋包含全部資料夾與已保存內容。' : '這裡還沒有筆記。按「＋筆記」開始。'));
    this.pager.replaceChildren();
    if (rows.length > PAGE_SIZE) {
      const previous = this.button('上一頁', () => { this.page--; this.render(); }); previous.disabled = this.page === 0;
      const next = this.button('下一頁', () => { this.page++; this.render(); }); next.disabled = from + PAGE_SIZE >= rows.length;
      this.pager.append(previous, el('span', '', `${from + 1}–${Math.min(from + PAGE_SIZE, rows.length)} / ${rows.length}`), next);
    }
  }
  private openDialog(title: string): HTMLDivElement {
    const heading = el('div', 'gp-nav-dialog-heading'); const text = el('h2', '', title); text.id = 'gp-nav-dialog-title'; this.dialog.setAttribute('aria-labelledby', text.id);
    heading.append(text, this.button('×', () => this.dialog.close(), '關閉導航對話框'));
    const body = el('div', 'gp-nav-dialog-body'); this.dialog.replaceChildren(heading, body);
    if (!this.dialog.open) this.dialog.showModal(); return body;
  }
  private nameDialog(title: string, initial: string, commit: (value: string) => unknown) {
    const body = this.openDialog(title); const input = el('input'); input.value = initial; input.setAttribute('aria-label', title);
    const form = el('form'); const submit = el('button', 'primary', '儲存'); submit.type = 'submit';
    const error = el('p', 'gp-nav-error'); error.setAttribute('role', 'alert');
    form.append(input, error, submit); form.addEventListener('submit', event => { event.preventDefault(); void this.perform(async () => {
      if (!input.value.trim()) { error.textContent = '名稱不能留白。'; return; }
      try { await commit(input.value.trim()); this.dialog.close(); } catch (failure) { error.textContent = failure instanceof Error ? failure.message : String(failure); }
    }); });
    body.append(form); queueMicrotask(() => { input.focus(); input.select(); });
  }
  private folderNameDialog(folder?: NavigationFolder) {
    this.nameDialog(folder ? '重新命名資料夾' : '新增資料夾', folder?.name ?? '', name => folder ? this.callbacks.onRenameFolder(folder.id, name) : this.callbacks.onCreateFolder(this.folderId, name));
  }
  private noteActions(id: string) {
    const note = this.index.notes.get(id); if (!note) return;
    const body = this.openDialog(note.title); body.append(el('p', 'muted', this.index.notePath(id)),
      this.button('重新命名筆記', () => this.nameDialog('重新命名筆記', note.title, title => this.callbacks.onRenameNote(id, title))),
      this.button('移動筆記', () => this.folderPicker('移動筆記', new Set(), target => this.callbacks.onMoveNote(id, target))),
      this.button('刪除筆記…', () => this.confirmDelete(`刪除「${note.title}」？內容可從復原紀錄取回。`, () => this.callbacks.onDeleteNote(id))));
  }
  private folderActions(id: string) {
    const folder = this.index.folders.get(id); if (!folder) return;
    const body = this.openDialog(folder.name); body.append(el('p', 'muted', this.index.folderPath(id)),
      this.button('在這裡新增筆記', async () => { this.dialog.close(); await this.callbacks.onCreateNote(id); }),
      this.button('重新命名資料夾', () => this.folderNameDialog(folder)),
      this.button('移動資料夾', () => this.folderPicker('移動資料夾', this.index.descendants(id), target => this.callbacks.onMoveFolder(id, target))),
      this.button('刪除資料夾…', () => { const scope = this.index.folderScope(id); this.confirmDelete(`刪除「${folder.name}」及其中 ${scope.folders - 1} 個子資料夾、${scope.notes} 份筆記？整個操作可從復原紀錄取回。`, () => this.callbacks.onDeleteFolder(id)); }));
  }
  private confirmDelete(message: string, commit: () => unknown) {
    const body = this.openDialog('確認刪除'); body.append(el('p', '', message), this.button('取消', () => this.dialog.close()), this.button('刪除並保存復原點', async () => { await commit(); this.dialog.close(); }));
  }
  private folderPicker(title: string, excluded: Set<string>, commit: (target: string | null) => unknown) {
    const body = this.openDialog(title); const search = el('input', 'search'); search.type = 'search'; search.placeholder = '搜尋目標資料夾…'; search.setAttribute('aria-label', '搜尋目標資料夾');
    const results = el('div', 'gp-nav-picker-results'); const pager = el('div', 'gp-nav-pager'); let page = 0;
    const choose = async (id: string | null) => { await commit(id); this.dialog.close(); };
    const render = () => {
      const folders = [...this.index.folders.values()].filter(folder => !excluded.has(folder.id) && normalized(this.index.folderPath(folder.id)).includes(normalized(search.value))).sort((a, b) => collator.compare(this.index.folderPath(a.id), this.index.folderPath(b.id)));
      page = Math.max(0, Math.min(page, Math.ceil(folders.length / PAGE_SIZE) - 1)); results.replaceChildren(this.button('⌂ 根資料夾', () => choose(null)));
      for (const folder of folders.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) results.append(this.button(this.index.folderPath(folder.id), () => choose(folder.id)));
      pager.replaceChildren(el('span', '', `${folders.length} 個可選資料夾`));
      if (page) pager.append(this.button('上一頁', () => { page--; render(); }));
      if ((page + 1) * PAGE_SIZE < folders.length) pager.append(this.button('下一頁', () => { page++; render(); }));
    };
    search.addEventListener('input', () => { page = 0; render(); }); body.append(search, results, pager); render(); queueMicrotask(() => search.focus());
  }
  openQuickSwitch(): void {
    if (!this.snapshot || this.destroyed) return;
    const body = this.openDialog('快速切換筆記'); const input = el('input', 'search'); input.type = 'search'; input.placeholder = '輸入標題或路徑，Enter 開啟'; input.setAttribute('aria-label', '快速切換搜尋');
    const results = el('div', 'gp-nav-picker-results'); const hint = el('p', 'muted'); let matches: NavigationNote[] = []; let selected = 0;
    const render = () => {
      const all = input.value.trim() ? this.index.search(input.value, true).map(hit => hit.note) : this.recent.flatMap(id => { const note = this.index.notes.get(id); return note ? [note] : []; });
      matches = all.slice(0, PAGE_SIZE); selected = Math.max(0, Math.min(selected, matches.length - 1)); results.replaceChildren();
      for (let index = 0; index < matches.length; index++) { const note = matches[index]; const button = this.button(this.index.notePath(note.id), () => this.choose(note.id)); button.classList.toggle('selected', selected === index); results.append(button); }
      hint.textContent = all.length > PAGE_SIZE ? `${all.length} 筆符合，顯示前 ${PAGE_SIZE} 筆；繼續輸入縮小範圍，或使用側欄搜尋瀏覽全部。` : `${all.length} 筆 · ↑↓ 選擇 · Enter 開啟 · Esc 關閉`;
    };
    input.addEventListener('input', () => { selected = 0; render(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(0, Math.min(matches.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))); render(); results.children[selected]?.scrollIntoView({ block: 'nearest' }); }
      else if (event.key === 'Enter' && matches[selected]) { event.preventDefault(); void this.perform(() => this.choose(matches[selected].id)); }
    });
    body.append(input, hint, results); render(); queueMicrotask(() => input.focus());
  }
  destroy(): void { this.destroyed = true; clearTimeout(this.persistTimer); document.removeEventListener('keydown', this.onKeydown); this.dialog.remove(); this.parent.replaceChildren(); }
}

export function createNavigator(parent: HTMLElement, callbacks: NavigationCallbacks): Navigator { return new Navigator(parent, callbacks); }
