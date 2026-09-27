import type { Attachment, WorkspaceSnapshot } from '../domain/model';
import type { FileEntry, FileExportResult, FilesStatus } from '../domain/files';
import { assetUrl, inlineAsset } from '../editor/query';
import './files-panel.css';

export interface FilesPanelCallbacks {
  getSnapshot(): WorkspaceSnapshot;
  getDatabasePath(): Promise<string>;
  getStatus(): Promise<FilesStatus>;
  list(path: string): Promise<FileEntry[]>;
  retryMirror(): Promise<FilesStatus>;
  buildExport(): Promise<FileExportResult>;
  openFolder(path: string): Promise<unknown>;
  downloadFile(entry: FileEntry): unknown;
  stageMarkdown(files: File[]): Promise<unknown>;
  saveInbox(name: string, text: string): Promise<FileEntry>;
  reviewInbox(entry: FileEntry): unknown;
  uploadAttachments(files: File[]): Promise<unknown>;
  deleteAttachment(attachment: Attachment): Promise<unknown>;
  insertAttachment(attachment: Attachment, embed: boolean): unknown;
  onError?(message: string): void;
}
const PAGE_SIZE = 50;
const MAX_FILE_SIZE = 64 * 1024 * 1024;
const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
const normalize = (text: string) => text.normalize('NFC').toLowerCase();
const bytes = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const pathJoin = (root: string, path: string) => `${root.replace(/[\\/]$/, '')}/${path}`;

/** Filesystem projections, inbox exchange and DB-owned assets meet only at host callbacks. */
export class FilesPanel {
  private surface = el('section', '', 'gp-files-panel');
  private callbacks?: FilesPanelCallbacks;
  private status?: FilesStatus;
  private databasePath = '';
  private entries: FileEntry[] = [];
  private tab: 'inbox' | 'outbox' | 'mirror' | 'assets' = 'inbox';
  private path = 'exchange/inbox';
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
  private lastExport?: FileExportResult;
  private deleteId?: string;
  private workspaceId?: string;
  private aiDrafts = new Map<string, { name: string; source: string }>();

  async show(container: HTMLElement, callbacks: FilesPanelCallbacks): Promise<void> {
    clearTimeout(this.poll); this.activity?.remove(); const generation = ++this.generation; this.callbacks = callbacks;
    if (this.workspaceId) this.aiDrafts.set(this.workspaceId, { name: this.aiName, source: this.aiSource });
    const workspaceId = callbacks.getSnapshot().id;
    if (this.workspaceId !== workspaceId) { const draft = this.aiDrafts.get(workspaceId); this.aiName = draft?.name ?? 'ai-return.md'; this.aiSource = draft?.source ?? ''; this.lastExport = undefined; }
    this.workspaceId = workspaceId; this.busy = false; this.status = undefined; this.databasePath = ''; this.entries = [];
    this.surface = el('section', '', 'gp-files-panel'); container.replaceChildren(this.surface); this.surface.append(el('p', '讀取檔案狀態…'));
    this.tab = 'inbox'; this.path = 'exchange/inbox'; this.page = 0; this.filter = ''; this.failure = ''; this.message = ''; this.deleteId = undefined;
    try {
      const [status, databasePath] = await Promise.all([callbacks.getStatus(), callbacks.getDatabasePath()]);
      if (generation !== this.generation || !this.surface.isConnected) return;
      this.status = status; this.databasePath = databasePath; this.path = this.directory('inbox'); const entries = await callbacks.list(this.path);
      if (generation !== this.generation || !this.surface.isConnected) return;
      this.entries = entries;
      this.render(); this.pollMirror(generation);
    } catch (error) { if (generation !== this.generation || !this.surface.isConnected) return; this.failure = error instanceof Error ? error.message : String(error); this.render(); callbacks.onError?.(this.failure); }
  }
  private directory(key: 'inbox' | 'outbox' | 'mirror'): string {
    if (!this.status) return key === 'mirror' ? key : `exchange/${key}`;
    const root = this.status.root.replace(/\\/g, '/').replace(/\/$/, '') + '/', absolute = this.status.directories[key].replace(/\\/g, '/');
    return absolute.startsWith(root) ? absolute.slice(root.length) : key === 'mirror' ? key : `exchange/${key}`;
  }
  private async perform(action: () => unknown, label = '處理檔案') {
    if (this.busy || !this.callbacks) return; const generation = this.generation, surface = this.surface, callbacks = this.callbacks; this.busy = true; this.surface.inert = true; this.failure = ''; this.message = '';
    const activity = el('p', `◌ ${label}…`, 'gp-files-busy'); activity.setAttribute('role', 'status'); this.activity = activity; surface.before(activity); activity.scrollIntoView({ block: 'nearest' });
    try { await action(); }
    catch (error) { if (generation === this.generation) { this.failure = error instanceof Error ? error.message : String(error); callbacks.onError?.(this.failure); } }
    finally { activity.remove(); surface.inert = false; if (generation === this.generation) { this.activity = undefined; this.busy = false; if (this.surface.isConnected) this.render(); } }
  }
  private button(label: string, action: () => unknown, className = '') { const node = el('button', label, className); node.type = 'button'; node.onclick = () => { void this.perform(action, label); }; return node; }
  private async refresh() {
    if (!this.callbacks) return; const generation = this.generation, callbacks = this.callbacks, path = this.path, tab = this.tab;
    const [status, entries] = await Promise.all([callbacks.getStatus(), tab !== 'assets' ? callbacks.list(path) : Promise.resolve(this.entries)]);
    if (generation !== this.generation || !this.surface.isConnected) return;
    this.status = status; if (this.path === path && this.tab === tab) this.entries = entries; this.pollMirror(generation);
  }
  private pollMirror(generation: number, attempts = 0) {
    clearTimeout(this.poll); if (this.status?.mirror.state !== 'pending' || attempts >= 30) return;
    this.poll = setTimeout(async () => {
      if (generation !== this.generation || !this.surface.isConnected || !this.callbacks) return;
      try { const status = await this.callbacks.getStatus(); if (generation !== this.generation || !this.surface.isConnected) return; this.status = status; this.renderMirror(this.surface.querySelector('.gp-files-mirror')!); this.pollMirror(generation, attempts + 1); }
      catch { /* The explicit refresh action reports persistent transport errors. */ }
    }, 1000);
  }
  private renderMirror(parent: HTMLElement) {
    if (!parent || !this.status) return; const mirror = this.status.mirror;
    const state = { idle: '尚未建立', pending: '更新中', ready: '已更新', error: '更新失敗' }[mirror.state];
    parent.replaceChildren(el('strong', `Markdown 鏡像 · ${state}`), el('p', `鏡像修訂 ${mirror.revision ?? '—'} · 資料庫修訂 ${this.callbacks!.getSnapshot().revision} · ${mirror.writtenFiles} 個新檔／${mirror.reusedFiles} 個沿用檔 · ${mirror.elapsedMs.toFixed(0)} ms`, 'muted'));
    if (mirror.error) parent.append(el('p', mirror.error, 'gp-files-error'));
    if (mirror.dirtyPaths.length) { const details = el('details'); details.append(el('summary', `${mirror.dirtyPaths.length} 個檔案有外部變更或衝突`), el('p', '外部內容不會自動寫入資料庫。請將要採用的 Markdown 加入 inbox 並審查。', 'muted')); for (const path of mirror.dirtyPaths.slice(0, PAGE_SIZE)) details.append(el('code', path)); if (mirror.dirtyPaths.length > PAGE_SIZE) details.append(el('p', '其他路徑可在檔案目錄中檢查。')); parent.append(details); }
    const actions = el('div', '', 'gp-files-actions');
    actions.append(this.button('重新建立／重試鏡像', async () => { this.status = await this.callbacks!.retryMirror(); await this.refresh(); }), this.button('開啟鏡像資料夾', () => this.callbacks!.openFolder(this.directory('mirror'))));
    if (mirror.indexPath) actions.append(this.button('開啟最新筆記索引', () => this.downloadPath(mirror.indexPath!)));
    if (mirror.manifestPath) actions.append(this.button('下載重建 manifest', () => this.downloadPath(mirror.manifestPath!)));
    parent.append(actions);
  }
  private downloadPath(path: string) { const entry: FileEntry = { name: path.split('/').at(-1)!, path, absolutePath: pathJoin(this.status!.root, path), kind: 'file', size: 0, modifiedAt: '' }; return this.callbacks!.downloadFile(entry); }
  private async copy(path: string) { await navigator.clipboard.writeText(path); this.message = '已複製完整路徑。'; }
  private async addFiles(files: File[], onlyAttachments = false) {
    if (!files.length) return;
    const callbacks = this.callbacks!; const generation = this.generation, workspaceId = callbacks.getSnapshot().id;
    if (files.some(file => file.size > MAX_FILE_SIZE)) throw new Error('單一檔案上限為 64 MB；請先移除超過上限的檔案。');
    const markdown = onlyAttachments ? [] : files.filter(file => /\.(?:md|markdown)$/i.test(file.name));
    const attachments = onlyAttachments ? files : files.filter(file => !/\.(?:md|markdown)$/i.test(file.name));
    if (markdown.length) await callbacks.stageMarkdown(markdown);
    if (callbacks.getSnapshot().id !== workspaceId) throw new Error('Workspace 已切換，尚未加入的附件請重新選取。');
    if (attachments.length) await callbacks.uploadAttachments(attachments);
    if (generation !== this.generation || !this.surface.isConnected) return;
    this.message = `${markdown.length} 份 Markdown 已放入 inbox 等待審查；${attachments.length} 個附件已保存至資料庫。`;
    this.tab = attachments.length && !markdown.length ? 'assets' : 'inbox'; this.path = this.directory('inbox'); this.filter = ''; this.page = 0; await this.refresh();
  }
  private render() {
    if (!this.callbacks || !this.surface.isConnected) return;
    const focused = this.surface.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement ? document.activeElement : undefined;
    const focusId = focused?.id; const selection = focused?.selectionStart;
    const callbacks = this.callbacks; this.surface.replaceChildren();
    if (this.failure) { const alert = el('p', this.failure, 'gp-files-error'); alert.setAttribute('role', 'alert'); this.surface.append(alert); }
    if (this.message) { const status = el('p', this.message, 'gp-files-message'); status.setAttribute('role', 'status'); this.surface.append(status); }
    const locations = el('details', '', 'gp-files-locations'); locations.append(el('summary', '資料庫與檔案位置'));
    locations.append(el('p', 'SQLite 保存筆記與附件。Mirror 是可重建的閱讀副本；inbox 是外部編輯的待審查區；outbox 保存匯出成果。', 'muted'));
    for (const [label, path] of [['資料庫', this.databasePath], ['檔案目錄', this.status?.root ?? '']]) { const row = el('div', '', 'gp-files-location'); row.append(el('strong', label), el('code', path), this.button(`複製${label}路徑`, () => this.copy(path))); locations.append(row); }
    locations.append(this.button('開啟檔案目錄', () => callbacks.openFolder(''))); this.surface.append(locations);
    const mirror = el('section', '', 'gp-files-mirror'); this.surface.append(mirror); this.renderMirror(mirror);
    const transfer = el('section', '', 'gp-files-transfer');
    transfer.append(this.button('建立給 AI 的資料夾匯出', async () => { this.lastExport = await callbacks.buildExport(); this.message = `已建立 ${this.lastExport.files} 個檔案 · ${bytes(this.lastExport.bytes)}。`; this.tab = 'outbox'; this.path = this.directory('outbox'); this.filter = ''; this.page = 0; await this.refresh(); }, 'primary'));
    if (this.lastExport) transfer.append(el('code', this.lastExport.absolutePath), this.button('開啟剛匯出的資料夾', () => callbacks.openFolder(this.lastExport!.path)), this.button('複製匯出路徑', () => this.copy(this.lastExport!.absolutePath)));
    const drop = el('div', '將多份 Markdown 或附件拖曳到這裡。Markdown 先進 inbox；其他檔案保存為附件。', 'gp-files-drop'); drop.tabIndex = 0; drop.setAttribute('aria-label', '拖曳 Markdown 或附件');
    drop.ondragover = event => { event.preventDefault(); drop.classList.add('dragging'); }; drop.ondragleave = () => drop.classList.remove('dragging');
    drop.ondrop = event => { event.preventDefault(); drop.classList.remove('dragging'); const files = Array.from(event.dataTransfer?.files ?? []); void this.perform(() => this.addFiles(files)); };
    const upload = el('input'); upload.type = 'file'; upload.multiple = true; upload.setAttribute('aria-label', '加入 Markdown 或附件（可多選）'); upload.onchange = () => { const files = Array.from(upload.files ?? []); void this.perform(() => this.addFiles(files)); }; drop.append(upload);
    drop.onkeydown = event => { if (event.target === drop && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); upload.click(); } }; transfer.append(drop);
    const ai = el('details', '', 'gp-files-ai'); ai.append(el('summary', '貼上 AI 回傳的 Markdown'));
    const name = el('input'); name.value = this.aiName; name.setAttribute('aria-label', 'AI 回傳檔名'); name.oninput = () => this.aiName = name.value;
    const source = el('textarea'); source.rows = 8; source.value = this.aiSource; source.setAttribute('aria-label', 'AI 回傳 Markdown'); source.oninput = () => this.aiSource = source.value;
    const save = async (review: boolean) => { const entry = await callbacks.saveInbox(this.aiName, this.aiSource); this.message = `已保存 ${entry.name} 到 inbox。`; this.tab = 'inbox'; this.path = this.directory('inbox'); this.page = 0; this.filter = ''; await this.refresh(); if (review) await callbacks.reviewInbox(entry); };
    ai.append(name, source, this.button('保存至 inbox', () => save(false)), this.button('保存並審查匯入', () => save(true), 'primary')); transfer.append(ai); this.surface.append(transfer);
    const tabs = el('div', '', 'gp-files-tabs');
    for (const [tab, label] of [['inbox', 'Inbox'], ['outbox', 'Outbox'], ['mirror', 'Mirror'], ['assets', '附件']] as const) {
      const button = this.button(label, async () => { this.tab = tab; this.path = tab === 'assets' ? '' : this.directory(tab); this.filter = ''; this.page = 0; if (tab !== 'assets') this.entries = await callbacks.list(this.path); }); button.setAttribute('aria-pressed', String(tab === this.tab)); tabs.append(button);
    }
    this.surface.append(tabs);
    const search = el('input'); search.type = 'search'; search.className = 'search'; search.id = 'files-search'; search.value = this.filter; search.placeholder = '搜尋目前列表…'; search.setAttribute('aria-label', '搜尋檔案或附件'); search.oninput = () => { this.filter = search.value; this.page = 0; this.render(); }; this.surface.append(search);
    if (this.tab === 'assets') this.renderAttachments(); else this.renderFiles();
    this.surface.append(this.button('重新整理檔案狀態', () => this.refresh()));
    if (focusId) { const input = this.surface.querySelector<HTMLInputElement>(`#${focusId}`); input?.focus(); if (selection !== null && selection !== undefined) input?.setSelectionRange(selection, selection); }
  }
  private renderFiles() {
    const paths = el('nav', '', 'gp-files-path'); paths.setAttribute('aria-label', '檔案目錄路徑');
    paths.append(this.button('檔案根目錄', async () => { this.path = ''; this.page = 0; this.filter = ''; this.entries = await this.callbacks!.list(''); }));
    const components = this.path.split('/').filter(Boolean);
    components.forEach((part, index) => paths.append(el('span', '/'), this.button(part, async () => { this.path = components.slice(0, index + 1).join('/'); this.page = 0; this.filter = ''; this.entries = await this.callbacks!.list(this.path); })));
    paths.append(this.button('開啟此資料夾', () => this.callbacks!.openFolder(this.path))); this.surface.append(paths);
    const entries = this.entries.filter(entry => normalize(entry.name).includes(normalize(this.filter))).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) || collator.compare(a.name, b.name));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1)); this.surface.append(el('p', `${entries.length.toLocaleString()} 個檔案或資料夾`, 'gp-files-count'));
    const list = el('div', '', 'gp-files-list');
    for (const entry of entries.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
      const row = el('section', '', 'gp-file-row'); row.dataset.filePath = entry.path;
      row.append(el('strong', `${entry.kind === 'directory' ? '▸ ' : ''}${entry.name}`), el('code', entry.absolutePath), el('span', entry.kind === 'file' ? bytes(entry.size) : '資料夾', 'muted'));
      const actions = el('div', '', 'gp-files-actions');
      if (entry.kind === 'directory') actions.append(this.button('瀏覽', async () => { this.path = entry.path; this.page = 0; this.filter = ''; this.entries = await this.callbacks!.list(entry.path); }));
      else { actions.append(this.button('下載', () => this.callbacks!.downloadFile(entry))); if (entry.path.startsWith(this.directory('inbox') + '/') && /\.(?:md|markdown)$/i.test(entry.name)) actions.append(this.button('審查匯入', () => this.callbacks!.reviewInbox(entry))); }
      actions.append(this.button('複製路徑', () => this.copy(entry.absolutePath))); row.append(actions); list.append(row);
    }
    if (!entries.length) list.append(el('p', '目前沒有符合的檔案。', 'empty')); this.surface.append(list); this.pager(entries.length);
  }
  private renderAttachments() {
    const snapshot = this.callbacks!.getSnapshot();
    const attachments = snapshot.attachments.filter(attachment => normalize(`${attachment.name} ${attachment.path} ${attachment.mimeType}`).includes(normalize(this.filter))).sort((a, b) => collator.compare(a.name, b.name));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(attachments.length / PAGE_SIZE) - 1)); this.surface.append(el('p', `${attachments.length.toLocaleString()} 個資料庫附件`, 'gp-files-count'));
    const upload = el('input'); upload.type = 'file'; upload.multiple = true; upload.setAttribute('aria-label', '上傳為附件（可多選）'); upload.onchange = () => { const files = Array.from(upload.files ?? []); void this.perform(() => this.addFiles(files, true)); }; this.surface.append(upload);
    const list = el('div', '', 'gp-files-list');
    for (const attachment of attachments.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
      const row = el('section', '', 'gp-file-row'); row.dataset.attachmentId = attachment.id;
      row.append(el('strong', attachment.name), el('code', attachment.path), el('p', `${bytes(attachment.size)} · ${attachment.mimeType} · r${attachment.revision}`, 'muted'));
      const actions = el('div', '', 'gp-files-actions');
      if (inlineAsset(attachment.mimeType)) actions.append(this.button('插入圖片', () => this.callbacks!.insertAttachment(attachment, true)));
      actions.append(this.button('插入連結', () => this.callbacks!.insertAttachment(attachment, false)));
      const download = el('a', '下載附件', 'gp-files-download'); download.href = assetUrl(attachment.id, snapshot.id); download.download = attachment.name; actions.append(download);
      actions.append(this.button('刪除附件…', () => { this.deleteId = attachment.id; })); row.append(actions);
      if (this.deleteId === attachment.id) row.append(el('p', '刪除後，現有引用將無法顯示附件。可從復原紀錄找回。', 'gp-files-error'), this.button('取消刪除', () => { this.deleteId = undefined; }), this.button('確認刪除並保存復原點', async () => { await this.callbacks!.deleteAttachment(attachment); this.deleteId = undefined; await this.refresh(); }));
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
