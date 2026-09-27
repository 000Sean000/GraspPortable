import type { Attachment, WorkspaceSnapshot } from '../domain/model';
import type { FileEntry, FilesStatus } from '../domain/files';
import { assetUrl, inlineAsset } from '../editor/query';
import './files-panel.css';

export interface FilesPanelCallbacks {
  getSnapshot(): WorkspaceSnapshot;
  getDatabasePath(): Promise<string>;
  getStatus(): Promise<FilesStatus>;
  list(path: string): Promise<FileEntry[]>;
  retryMirror(): Promise<FilesStatus>;
  openFolder(path: string): Promise<unknown>;
  revealFile(path: string): Promise<unknown>;
  reviewExternal(path: string): unknown;
  downloadFile(entry: FileEntry): unknown;
  stageMarkdown(files: File[]): Promise<unknown>;
  saveInbox(name: string, text: string): Promise<FileEntry>;
  reviewInbox(entry: FileEntry): unknown;
  uploadAttachments(files: File[]): Promise<unknown>;
  deleteAttachment(attachment: Attachment): Promise<unknown>;
  insertAttachment(attachment: Attachment, embed: boolean): unknown;
  onError?(message: string): void;
}
type FileTab = 'inbox' | 'outbox' | 'mirror' | 'assets';
const PAGE_SIZE = 50;
const MAX_FILE_SIZE = 64 * 1024 * 1024;
const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
const normalize = (text: string) => text.normalize('NFC').toLowerCase();
const bytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const pathJoin = (root: string, path: string) => `${root.replace(/[\\/]$/, '')}${root.includes('\\') ? '\\' : '/'}${root.includes('\\') ? path.replace(/\//g, '\\') : path}`;

/** One human-readable projection, controlled external changes and DB-owned attachments. */
export class FilesPanel {
  private surface = el('section', '', 'gp-files-panel');
  private callbacks?: FilesPanelCallbacks;
  private status?: FilesStatus;
  private databasePath = '';
  private entries: FileEntry[] = [];
  private tab: FileTab = 'mirror';
  private path = 'Markdown';
  private filter = '';
  private page = 0;
  private busy = false;
  private activity?: HTMLElement;
  private generation = 0;
  private poll?: ReturnType<typeof setTimeout>;
  private aiName = 'ai-return.md';
  private aiSource = '';
  private message = '';
  private failure = '';
  private deleteId?: string;
  private workspaceId?: string;
  private aiDrafts = new Map<string, { name: string; source: string }>();

  async show(container: HTMLElement, callbacks: FilesPanelCallbacks): Promise<void> {
    clearTimeout(this.poll); this.activity?.remove(); const generation = ++this.generation; this.callbacks = callbacks;
    if (this.workspaceId) this.aiDrafts.set(this.workspaceId, { name: this.aiName, source: this.aiSource });
    const workspaceId = callbacks.getSnapshot().id;
    if (this.workspaceId !== workspaceId) { const draft = this.aiDrafts.get(workspaceId); this.aiName = draft?.name ?? 'ai-return.md'; this.aiSource = draft?.source ?? ''; }
    this.workspaceId = workspaceId; this.busy = false; this.status = undefined; this.databasePath = ''; this.entries = [];
    this.surface = el('section', '', 'gp-files-panel'); container.replaceChildren(this.surface); this.surface.append(el('p', '讀取檔案狀態…'));
    this.tab = 'mirror'; this.path = 'Markdown'; this.page = 0; this.filter = ''; this.failure = ''; this.message = ''; this.deleteId = undefined;
    try {
      const [status, databasePath] = await Promise.all([callbacks.getStatus(), callbacks.getDatabasePath()]);
      if (!this.current(generation)) return;
      this.status = status; this.databasePath = databasePath; this.path = this.directory('mirror');
      const entries = await callbacks.list(this.path); if (!this.current(generation)) return;
      this.entries = entries; this.render(); this.pollMirror(generation);
    } catch (error) { if (!this.current(generation)) return; this.failure = error instanceof Error ? error.message : String(error); this.render(); callbacks.onError?.(this.failure); }
  }
  private current(generation: number) { return generation === this.generation && this.surface.isConnected; }
  private directory(key: Exclude<FileTab, 'assets'>): string {
    const fallback = key === 'mirror' ? 'Markdown' : `.grasp/exchange/${key}`;
    if (!this.status) return fallback;
    const root = this.status.root.replace(/\\/g, '/').replace(/\/$/, '') + '/', absolute = this.status.directories[key].replace(/\\/g, '/');
    return absolute.startsWith(root) ? absolute.slice(root.length) : fallback;
  }
  private async perform(action: () => unknown, label = '處理檔案') {
    if (this.busy || !this.callbacks) return; const generation = this.generation, surface = this.surface, callbacks = this.callbacks; this.busy = true; surface.inert = true; this.failure = ''; this.message = '';
    const activity = el('p', `◌ ${label}…`, 'gp-files-busy'); activity.setAttribute('role', 'status'); this.activity = activity; surface.before(activity); activity.scrollIntoView({ block: 'nearest' });
    try { await action(); }
    catch (error) { if (this.current(generation)) { this.failure = error instanceof Error ? error.message : String(error); callbacks.onError?.(this.failure); } }
    finally { activity.remove(); surface.inert = false; if (generation === this.generation) { this.activity = undefined; this.busy = false; if (this.surface.isConnected) this.render(); } }
  }
  private button(label: string, action: () => unknown, className = '') { const node = el('button', label, className); node.type = 'button'; node.onclick = () => { void this.perform(action, label); }; return node; }
  private async refresh(generation = this.generation) {
    if (!this.current(generation) || !this.callbacks) return; const callbacks = this.callbacks, path = this.path, tab = this.tab;
    const [status, entries] = await Promise.all([callbacks.getStatus(), tab !== 'assets' ? callbacks.list(path) : Promise.resolve(this.entries)]);
    if (!this.current(generation)) return;
    this.status = status; if (this.path === path && this.tab === tab) this.entries = entries; this.pollMirror(generation);
  }
  private async browse(path: string, tab = this.tab) {
    const generation = this.generation, callbacks = this.callbacks!;
    const entries = tab === 'assets' ? [] : await callbacks.list(path);
    if (!this.current(generation)) return;
    this.path = path; this.tab = tab; this.filter = ''; this.page = 0; this.entries = entries;
  }
  private pollMirror(generation: number, attempts = 0) {
    clearTimeout(this.poll); if (this.status?.mirror.state !== 'pending' || attempts >= 30) return;
    this.poll = setTimeout(async () => {
      if (!this.current(generation) || !this.callbacks) return;
      try { const status = await this.callbacks.getStatus(); if (!this.current(generation)) return; this.status = status; this.renderMirror(this.surface.querySelector('.gp-files-mirror')!); this.pollMirror(generation, attempts + 1); }
      catch { /* Explicit refresh reports persistent transport errors. */ }
    }, 1000);
  }
  private renderMirror(parent: HTMLElement) {
    if (!parent || !this.status) return; const mirror = this.status.mirror, callbacks = this.callbacks!;
    const state = { idle: '尚未建立', pending: '更新中', ready: '已更新', dirty: '有外部變更待審查', error: '更新失敗' }[mirror.state];
    parent.replaceChildren(el('strong', `Markdown 投影 · ${state}`), el('p', `投影修訂 ${mirror.revision ?? '—'} · 資料庫修訂 ${callbacks.getSnapshot().revision} · ${mirror.writtenFiles} 個新檔／${mirror.reusedFiles} 個沿用檔 · ${mirror.elapsedMs.toFixed(0)} ms`, 'muted'));
    if (mirror.error) parent.append(el('p', mirror.error, 'gp-files-error'));
    if (mirror.dirtyPaths.length) {
      const details = el('details', '', 'gp-files-dirty'); details.open = true;
      details.append(el('summary', `${mirror.dirtyPaths.length} 個檔案有外部變更或衝突`), el('p', '先審查差異，再決定是否更新資料庫。更新投影不會覆蓋未處理的外部內容。', 'muted'));
      const search = el('input'); search.type = 'search'; search.placeholder = '搜尋外部變更路徑'; search.setAttribute('aria-label', '搜尋外部變更路徑');
      const rows = el('div', '', 'gp-files-dirty-list'); const notePaths = new Set(this.status.projection.notes.map(note => note.path));
      const draw = () => {
        rows.replaceChildren(); const paths = mirror.dirtyPaths.filter(path => normalize(path).includes(normalize(search.value)));
        rows.append(el('p', `${paths.length} 個符合的變更${paths.length > PAGE_SIZE ? ' · 顯示前 50 個，請搜尋縮小範圍' : ''}`, 'muted'));
        for (const path of paths.slice(0, PAGE_SIZE)) {
          const row = el('section', '', 'gp-files-dirty-row'); row.append(el('code', pathJoin(this.status!.root, path)));
          const actions = el('div', '', 'gp-files-actions');
          if (notePaths.has(path)) actions.append(this.button('審查外部修改', () => callbacks.reviewExternal(path), 'primary'));
          else row.append(el('p', '此檔案不屬於可直接更新的既有筆記；附件或新增檔案請使用下方加入檔案。', 'muted'));
          actions.append(this.button('在檔案總管顯示', () => callbacks.revealFile(path)), this.button('複製完整路徑', () => this.copy(pathJoin(this.status!.root, path)))); row.append(actions); rows.append(row);
        }
      };
      search.oninput = draw; draw(); details.append(search, rows); parent.append(details);
    }
    const actions = el('div', '', 'gp-files-actions');
    actions.append(this.button('更新 Markdown 投影', async () => { const generation = this.generation; await callbacks.retryMirror(); await this.refresh(generation); }), this.button('在檔案總管開啟 Markdown', () => callbacks.openFolder(this.directory('mirror'))));
    parent.append(actions);
  }
  private downloadPath(path: string) { return this.callbacks!.downloadFile({ name: path.split('/').at(-1)!, path, absolutePath: pathJoin(this.status!.root, path), kind: 'file', size: 0, modifiedAt: '' }); }
  private async copy(path: string) { const generation = this.generation; await navigator.clipboard.writeText(path); if (this.current(generation)) this.message = '已複製完整路徑。'; }
  private async addFiles(files: File[], onlyAttachments = false) {
    if (!files.length) return;
    const callbacks = this.callbacks!, generation = this.generation, workspaceId = callbacks.getSnapshot().id;
    if (files.some(file => file.size > MAX_FILE_SIZE)) throw new Error('單一檔案上限為 64 MB；請先移除超過上限的檔案。');
    const markdown = onlyAttachments ? [] : files.filter(file => /\.(?:md|markdown)$/i.test(file.name));
    const attachments = onlyAttachments ? files : files.filter(file => !/\.(?:md|markdown)$/i.test(file.name));
    if (markdown.length) await callbacks.stageMarkdown(markdown);
    if (callbacks.getSnapshot().id !== workspaceId) throw new Error('Workspace 已切換，尚未加入的附件請重新選取。');
    if (attachments.length) await callbacks.uploadAttachments(attachments);
    if (!this.current(generation)) return;
    this.message = `${markdown.length} 份 Markdown 已放入 inbox 等待審查；${attachments.length} 個附件已保存至資料庫。`;
    this.tab = attachments.length && !markdown.length ? 'assets' : 'inbox'; this.path = this.directory('inbox'); this.filter = ''; this.page = 0; await this.refresh(generation);
  }
  private render() {
    if (!this.callbacks || !this.surface.isConnected) return;
    const focused = this.surface.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement ? document.activeElement : undefined;
    const focusId = focused?.id, selection = focused?.selectionStart, callbacks = this.callbacks; this.surface.replaceChildren();
    if (this.failure) { const alert = el('p', this.failure, 'gp-files-error'); alert.setAttribute('role', 'alert'); this.surface.append(alert); }
    if (this.message) { const status = el('p', this.message, 'gp-files-message'); status.setAttribute('role', 'status'); this.surface.append(status); }
    const locations = el('section', '', 'gp-files-locations');
    locations.append(el('p', 'Markdown 是唯一持續更新的可閱讀投影，可直接交給 AI 或用檔案總管閱讀；外部修改經審查後才更新資料庫。', 'muted'));
    for (const [label, path, relative] of [['Workspace', this.status?.root ?? '', ''], ['Markdown 投影', this.status?.directories.mirror ?? '', this.directory('mirror')]]) {
      const row = el('div', '', 'gp-files-location'); row.append(el('strong', label), el('code', path), this.button(`開啟 ${label} 資料夾`, () => callbacks.openFolder(relative)), this.button(`複製 ${label} 路徑`, () => this.copy(path))); locations.append(row);
    }
    this.surface.append(locations); const mirror = el('section', '', 'gp-files-mirror'); this.surface.append(mirror); this.renderMirror(mirror);
    const transfer = el('section', '', 'gp-files-transfer');
    const drop = el('div', '將多份 Markdown 或附件拖曳到這裡。Markdown 先進 inbox 等待審查；其他檔案保存為附件。', 'gp-files-drop'); drop.tabIndex = 0; drop.setAttribute('aria-label', '拖曳 Markdown 或附件');
    drop.ondragover = event => { event.preventDefault(); drop.classList.add('dragging'); }; drop.ondragleave = () => drop.classList.remove('dragging');
    drop.ondrop = event => { event.preventDefault(); drop.classList.remove('dragging'); const files = Array.from(event.dataTransfer?.files ?? []); void this.perform(() => this.addFiles(files)); };
    const upload = el('input'); upload.type = 'file'; upload.multiple = true; upload.setAttribute('aria-label', '加入 Markdown 或附件（可多選）'); upload.onchange = () => { const files = Array.from(upload.files ?? []); void this.perform(() => this.addFiles(files)); }; drop.append(upload);
    drop.onkeydown = event => { if (event.target === drop && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); upload.click(); } }; transfer.append(drop);
    const ai = el('details', '', 'gp-files-ai'); ai.append(el('summary', '貼上 AI 回傳的 Markdown'));
    const name = el('input'); name.value = this.aiName; name.setAttribute('aria-label', 'AI 回傳檔名'); name.oninput = () => this.aiName = name.value;
    const source = el('textarea'); source.rows = 8; source.value = this.aiSource; source.setAttribute('aria-label', 'AI 回傳 Markdown'); source.oninput = () => this.aiSource = source.value;
    const save = async (review: boolean) => { const generation = this.generation, entry = await callbacks.saveInbox(this.aiName, this.aiSource); if (!this.current(generation)) return; this.message = `已保存 ${entry.name} 到 inbox。`; this.tab = 'inbox'; this.path = this.directory('inbox'); this.page = 0; this.filter = ''; await this.refresh(generation); if (review && this.current(generation)) await callbacks.reviewInbox(entry); };
    ai.append(name, source, this.button('保存至 inbox', () => save(false)), this.button('保存並審查匯入', () => save(true), 'primary')); transfer.append(ai); this.surface.append(transfer);
    const advanced = el('details', '', 'gp-files-advanced'); advanced.append(el('summary', '受控匯入與復原檔案'));
    advanced.append(el('p', 'SQLite 是資料權威。.grasp 保存交換與復原資料；平常閱讀及 AI 作業請使用上方 Markdown。', 'muted'));
    for (const [label, path] of [['資料庫', this.databasePath], ['內部檔案', this.status?.directories.internal ?? '']]) { const row = el('div', '', 'gp-files-location'); row.append(el('strong', label), el('code', path), this.button(`複製${label}路徑`, () => this.copy(path))); advanced.append(row); }
    advanced.append(this.button('Inbox 待審查', () => this.browse(this.directory('inbox'), 'inbox')), this.button('既有 Outbox 檔案', () => this.browse(this.directory('outbox'), 'outbox')));
    if (this.status?.mirror.manifestPath) advanced.append(this.button('下載重建 manifest', () => this.downloadPath(this.status!.mirror.manifestPath!)));
    this.surface.append(advanced);
    const tabs = el('div', '', 'gp-files-tabs');
    for (const [tab, label] of [['mirror', 'Markdown'], ['assets', '附件']] as const) { const button = this.button(label, () => this.browse(tab === 'assets' ? '' : this.directory(tab), tab)); button.setAttribute('aria-pressed', String(tab === this.tab)); tabs.append(button); }
    this.surface.append(tabs);
    if (this.tab === 'inbox' || this.tab === 'outbox') this.surface.append(el('p', this.tab === 'inbox' ? 'Inbox · Markdown 待審查區' : 'Outbox · 既有交換檔案', 'muted'));
    const search = el('input'); search.type = 'search'; search.className = 'search'; search.id = 'files-search'; search.value = this.filter; search.placeholder = '搜尋目前列表…'; search.setAttribute('aria-label', '搜尋檔案或附件'); search.oninput = () => { this.filter = search.value; this.page = 0; this.render(); }; this.surface.append(search);
    if (this.tab === 'assets') this.renderAttachments(); else this.renderFiles();
    this.surface.append(this.button('重新整理檔案狀態', () => this.refresh()));
    if (focusId) { const input = this.surface.querySelector<HTMLInputElement>(`#${focusId}`); input?.focus(); if (selection !== null && selection !== undefined) input?.setSelectionRange(selection, selection); }
  }
  private renderFiles() {
    const paths = el('nav', '', 'gp-files-path'); paths.setAttribute('aria-label', '檔案目錄路徑');
    const base = this.directory(this.tab as Exclude<FileTab, 'assets'>), label = this.tab === 'mirror' ? 'Markdown' : this.tab === 'inbox' ? 'Inbox' : 'Outbox';
    paths.append(this.button(label, () => this.browse(base)));
    const components = this.path.slice(base.length).split('/').filter(Boolean);
    components.forEach((part, index) => paths.append(el('span', '/'), this.button(part, () => this.browse(`${base}/${components.slice(0, index + 1).join('/')}`))));
    paths.append(this.button('開啟此資料夾', () => this.callbacks!.openFolder(this.path))); this.surface.append(paths);
    const entries = this.entries.filter(entry => normalize(entry.name).includes(normalize(this.filter))).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) || collator.compare(a.name, b.name));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1)); this.surface.append(el('p', `${entries.length.toLocaleString()} 個檔案或資料夾`, 'gp-files-count'));
    const list = el('div', '', 'gp-files-list'), dirty = new Set(this.status?.mirror.dirtyPaths), notePaths = new Set(this.status?.projection.notes.map(note => note.path));
    for (const entry of entries.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
      const row = el('section', '', 'gp-file-row'); row.dataset.filePath = entry.path;
      row.append(el('strong', `${entry.kind === 'directory' ? '▸ ' : ''}${entry.name}`), el('code', entry.absolutePath), el('span', entry.kind === 'file' ? bytes(entry.size) : '資料夾', 'muted'));
      const actions = el('div', '', 'gp-files-actions');
      if (entry.kind === 'directory') actions.append(this.button('瀏覽', () => this.browse(entry.path)), this.button('在檔案總管開啟', () => this.callbacks!.openFolder(entry.path)));
      else { actions.append(this.button('在檔案總管顯示', () => this.callbacks!.revealFile(entry.path)), this.button('下載', () => this.callbacks!.downloadFile(entry))); if (entry.path.startsWith(this.directory('inbox') + '/') && /\.(?:md|markdown)$/i.test(entry.name)) actions.append(this.button('審查匯入', () => this.callbacks!.reviewInbox(entry))); if (dirty.has(entry.path) && notePaths.has(entry.path)) actions.append(this.button('審查外部修改', () => this.callbacks!.reviewExternal(entry.path), 'primary')); }
      actions.append(this.button('複製路徑', () => this.copy(entry.absolutePath))); row.append(actions); list.append(row);
    }
    if (!entries.length) list.append(el('p', '目前沒有符合的檔案。', 'empty')); this.surface.append(list); this.pager(entries.length);
  }
  private renderAttachments() {
    const snapshot = this.callbacks!.getSnapshot();
    const attachments = snapshot.attachments.filter(attachment => normalize(`${attachment.name} ${attachment.path} ${attachment.mimeType}`).includes(normalize(this.filter))).sort((a, b) => collator.compare(a.name, b.name));
    const published = new Map(this.status?.projection.attachments.map(asset => [asset.id, asset.path]));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(attachments.length / PAGE_SIZE) - 1)); this.surface.append(el('p', `${attachments.length.toLocaleString()} 個資料庫附件`, 'gp-files-count'));
    const upload = el('input'); upload.type = 'file'; upload.multiple = true; upload.setAttribute('aria-label', '上傳為附件（可多選）'); upload.onchange = () => { const files = Array.from(upload.files ?? []); void this.perform(() => this.addFiles(files, true)); }; this.surface.append(upload);
    const list = el('div', '', 'gp-files-list');
    for (const attachment of attachments.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
      const row = el('section', '', 'gp-file-row'); row.dataset.attachmentId = attachment.id; const path = published.get(attachment.id);
      row.append(el('strong', attachment.name), el('code', path ? pathJoin(this.status!.root, path) : attachment.path), el('p', `${bytes(attachment.size)} · ${attachment.mimeType} · r${attachment.revision}`, 'muted'));
      const actions = el('div', '', 'gp-files-actions');
      if (path) actions.append(this.button('在檔案總管顯示', () => this.callbacks!.revealFile(path)), this.button('複製路徑', () => this.copy(pathJoin(this.status!.root, path))));
      else row.append(el('p', '資料庫已保存；實際檔案位置將在投影完成後顯示。', 'muted'));
      if (inlineAsset(attachment.mimeType)) actions.append(this.button('插入圖片', () => this.callbacks!.insertAttachment(attachment, true)));
      actions.append(this.button('插入連結', () => this.callbacks!.insertAttachment(attachment, false)));
      const download = el('a', '下載附件', 'gp-files-download'); download.href = assetUrl(attachment.id, snapshot.id); download.download = attachment.name; actions.append(download);
      actions.append(this.button('刪除附件…', () => { this.deleteId = attachment.id; })); row.append(actions);
      if (this.deleteId === attachment.id) row.append(el('p', '刪除後，現有引用將無法顯示附件。可從復原紀錄找回。', 'gp-files-error'), this.button('取消刪除', () => { this.deleteId = undefined; }), this.button('確認刪除並保存復原點', async () => { const generation = this.generation; await this.callbacks!.deleteAttachment(attachment); if (!this.current(generation)) return; this.deleteId = undefined; await this.refresh(generation); }));
      list.append(row);
    }
    if (!attachments.length) list.append(el('p', '目前沒有符合的附件。', 'empty')); this.surface.append(list); this.pager(attachments.length);
  }
  private pager(total: number) {
    if (total <= PAGE_SIZE) return; const pager = el('div', '', 'gp-files-pager');
    const previous = this.button('檔案上一頁', () => { this.page--; }); previous.disabled = !this.page;
    const next = this.button('檔案下一頁', () => { this.page++; }); next.disabled = (this.page + 1) * PAGE_SIZE >= total;
    pager.append(previous, el('span', `${this.page * PAGE_SIZE + 1}–${Math.min((this.page + 1) * PAGE_SIZE, total)} / ${total}`), next); this.surface.append(pager);
  }
  destroy() { clearTimeout(this.poll); this.activity?.remove(); this.generation++; this.surface.remove(); this.callbacks = undefined; }
}