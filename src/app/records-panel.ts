import type { RuntimeResult, StructuredRecord, ValueResult, WorkspaceSnapshot } from '../domain/model';
import type { RecordQuery } from '../editor/query';
import './records-panel.css';

export interface RecordsPanelCallbacks {
  onEdit(record?: StructuredRecord): unknown;
  onCreateQuery(query: RecordQuery): unknown;
  onReferences(identifier: string): unknown;
  onInsertReference?(identifier: string): unknown;
  onRename?(record: StructuredRecord): unknown;
  onError?(message: string): void;
}
export interface RecordFilter { search: string; collection: string; where?: { field: string; equals: string }; sort: 'name' | 'collection' | 'value'; descending: boolean; sortField: string }
const PAGE_SIZE = 40;
const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
const normalize = (text: string) => text.normalize('NFC').toLowerCase();
export const qualifiedField = (record: StructuredRecord, field: string) => `${record.collection}.${record.name}.${field}`;
export function resolvedField(record: StructuredRecord, field: string, runtime?: RuntimeResult): ValueResult {
  const name = qualifiedField(record, field);
  return runtime && Object.hasOwn(runtime.values, name) ? runtime.values[name] : { status: 'missing', value: record.fields[field] ?? '', message: '等待計算' };
}

/** Disposable plain-data index. Records and calculated values remain owned by their existing boundaries. */
export class RecordsIndex {
  records: StructuredRecord[] = [];
  collections: Array<{ name: string; count: number }> = [];
  private entries = new Map<string, { record: StructuredRecord; searchable: string }>();
  private runtime?: RuntimeResult;
  update(records: StructuredRecord[], runtime?: RuntimeResult): void {
    const unchangedValues = this.runtime?.values === runtime?.values; const next = new Map<string, { record: StructuredRecord; searchable: string }>();
    const counts = new Map<string, number>(); this.records = records;
    for (const record of records) {
      counts.set(record.collection, (counts.get(record.collection) ?? 0) + 1);
      const previous = this.entries.get(record.id);
      const sameRecord = previous?.record.revision === record.revision && previous.record.collection === record.collection && previous.record.name === record.name;
      const searchable = sameRecord && unchangedValues ? previous.searchable : normalize([record.collection, record.name, ...Object.entries(record.fields).flatMap(([field, raw]) => [field, raw, resolvedField(record, field, runtime).value])].join('\n'));
      next.set(record.id, { record, searchable });
    }
    this.entries = next; this.runtime = runtime;
    this.collections = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => collator.compare(a.name, b.name));
  }
  filter(filter: RecordFilter): StructuredRecord[] {
    const terms = normalize(filter.search).trim().split(/\s+/).filter(Boolean);
    const records = [...this.entries.values()].filter(entry => {
      const record = entry.record;
      if (filter.collection && record.collection !== filter.collection) return false;
      if (!terms.every(term => entry.searchable.includes(term))) return false;
      if (!filter.where) return true;
      if (!Object.hasOwn(record.fields, filter.where.field)) return false;
      const value = resolvedField(record, filter.where.field, this.runtime);
      return value.status === 'ok' && value.value === filter.where.equals;
    }).map(entry => entry.record);
    const key = (record: StructuredRecord) => filter.sort === 'collection' ? record.collection : filter.sort === 'value' ? resolvedField(record, filter.sortField, this.runtime).value : record.name;
    return records.sort((a, b) => (filter.descending ? -1 : 1) * (collator.compare(key(a), key(b)) || collator.compare(a.collection, b.collection) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id)));
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, value = '', className = ''): HTMLElementTagNameMap[K] { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; }
function input(id: string, label: string, value: string, placeholder = '') { const node = el('input'); node.id = id; node.value = value; node.placeholder = placeholder; node.setAttribute('aria-label', label); return node; }
function select(label: string, choices: string[][], value: string) { const node = el('select'); node.setAttribute('aria-label', label); for (const [key, label] of choices) { const option = el('option', label); option.value = key; node.append(option); } node.value = value; return node; }
const emptyFilter = (): RecordFilter => ({ search: '', collection: '', sort: 'name', descending: false, sortField: '' });

export class RecordsPanel {
  readonly index = new RecordsIndex();
  private workspaceId?: string;
  private filter = emptyFilter();
  private page = 0;
  private selectedId?: string;
  private fieldPage = 0;
  private collectionsOpen = false;
  private collectionSearch = '';
  private collectionPage = 0;
  private pendingQuery?: RecordQuery;
  private pendingRecord?: string;
  private exactEquals = '';
  private filtersOpen = false;
  setQuery(query: RecordQuery): void { this.pendingQuery = { collection: query.collection, ...(query.where ? { where: { ...query.where } } : {}) }; }
  revealRecord(id: string): void { this.pendingRecord = id; }
  render(container: HTMLElement, snapshot: WorkspaceSnapshot, runtime: RuntimeResult | undefined, callbacks: RecordsPanelCallbacks): void {
    if (snapshot.id !== this.workspaceId) { this.workspaceId = snapshot.id; this.filter = emptyFilter(); this.page = 0; this.selectedId = undefined; this.collectionsOpen = false; this.collectionSearch = ''; this.collectionPage = 0; this.exactEquals = ''; this.filtersOpen = false; }
    this.index.update(snapshot.records, runtime);
    if (this.pendingQuery) { this.filter = { ...emptyFilter(), collection: this.pendingQuery.collection, where: this.pendingQuery.where, sortField: this.pendingQuery.where?.field ?? '' }; this.exactEquals = this.pendingQuery.where?.equals ?? ''; this.pendingQuery = undefined; this.page = 0; this.selectedId = undefined; this.collectionsOpen = false; }
    if (this.pendingRecord) {
      const record = snapshot.records.find(record => record.id === this.pendingRecord);
      this.filter = { ...emptyFilter(), collection: record?.collection ?? '' }; this.selectedId = record?.id; this.fieldPage = 0; this.collectionsOpen = false;
      this.page = Math.max(0, Math.floor(this.index.filter(this.filter).findIndex(row => row.id === this.selectedId) / PAGE_SIZE)); this.pendingRecord = undefined;
    }
    const focused = document.activeElement instanceof HTMLInputElement && container.contains(document.activeElement) ? document.activeElement : undefined;
    const focusedId = focused?.id; const selection = focused?.selectionStart;
    container.replaceChildren(); container.classList.add('gp-records-panel');
    const redraw = () => this.render(container, snapshot, runtime, callbacks);
    const action = (label: string, callback: () => unknown, className = '') => { const button = el('button', label, className); button.type = 'button'; button.onclick = () => { void Promise.resolve().then(callback).catch(error => { const message = error instanceof Error ? error.message : String(error); callbacks.onError?.(message); const alert = el('p', message, 'gp-record-error'); alert.setAttribute('role', 'alert'); container.prepend(alert); }); }; return button; };
    container.append(el('p', '瀏覽全部資料，或以已計算的欄位值精確篩選。點選欄位可查看筆記引用。', 'panel-intro'), action('＋ 新增 record', () => callbacks.onEdit(), 'primary wide'));
    const collectionBar = el('div', '', 'gp-record-controls');
    collectionBar.append(action(this.filter.collection || `全部 collections · ${this.index.collections.length}`, () => { this.collectionsOpen = !this.collectionsOpen; redraw(); }));
    if (this.filter.collection) collectionBar.append(action('全部', () => { this.filter.collection = ''; this.page = 0; redraw(); }));
    container.append(collectionBar);
    if (this.collectionsOpen) {
      const search = input('record-collection-search', '搜尋 collections', this.collectionSearch, '搜尋 collection…'); search.oninput = () => { this.collectionSearch = search.value; this.collectionPage = 0; redraw(); }; container.append(search);
      const matches = this.index.collections.filter(item => normalize(item.name).includes(normalize(this.collectionSearch)));
      this.collectionPage = Math.min(this.collectionPage, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
      const list = el('div', '', 'gp-record-collections');
      for (const item of matches.slice(this.collectionPage * PAGE_SIZE, (this.collectionPage + 1) * PAGE_SIZE)) list.append(action(`${item.name} · ${item.count}`, () => { this.filter.collection = item.name; this.collectionsOpen = false; this.page = 0; redraw(); }));
      container.append(list); this.pager(container, matches.length, this.collectionPage, action, page => { this.collectionPage = page; redraw(); }, 'collections');
    }
    const search = input('record-search', '搜尋 records', this.filter.search, '搜尋名稱、欄位、原值或計算值…'); search.className = 'search'; search.oninput = () => { this.filter.search = search.value; this.page = 0; redraw(); }; container.append(search);
    const filters = el('details', '', 'gp-record-filters'); filters.open = this.filtersOpen || Boolean(this.filter.where) || Boolean(this.filter.sortField); filters.ontoggle = () => { if (filters.isConnected) this.filtersOpen = filters.open; }; filters.append(el('summary', '精確欄位篩選與排序'));
    const field = input('record-field-filter', '篩選欄位', this.filter.where?.field ?? this.filter.sortField, '欄位名稱');
    const equals = input('record-equals-filter', '欄位計算值完全等於', this.filter.where?.equals ?? this.exactEquals, '計算值（可留空字串）');
    const exactLabel = el('label', '', 'gp-record-exact'); const exact = el('input'); exact.type = 'checkbox'; exact.checked = Boolean(this.filter.where); exact.setAttribute('aria-label', '啟用精確欄位篩選'); exactLabel.append(exact, document.createTextNode('計算值完全相等（區分大小寫）'));
    const changeWhere = () => { this.filter.sortField = field.value; this.exactEquals = equals.value; this.filter.where = exact.checked ? { field: field.value, equals: equals.value } : undefined; this.page = 0; redraw(); };
    field.oninput = changeWhere; equals.oninput = changeWhere; exact.onchange = changeWhere;
    const sort = select('Record 排序', [['name', '依名稱'], ['collection', '依 collection'], ['value', '依指定欄位計算值']], this.filter.sort); sort.onchange = () => { this.filter.sort = sort.value as RecordFilter['sort']; this.page = 0; redraw(); };
    const direction = select('Record 排序方向', [['ascending', '由小到大'], ['descending', '由大到小']], this.filter.descending ? 'descending' : 'ascending'); direction.onchange = () => { this.filter.descending = direction.value === 'descending'; this.page = 0; redraw(); };
    filters.append(field, equals, exactLabel, sort, direction); container.append(filters);
    if (this.filter.collection) container.append(action('建立目前篩選的 table 筆記', () => callbacks.onCreateQuery({ collection: this.filter.collection, ...(this.filter.where ? { where: { ...this.filter.where } } : {}) }), 'text-button'));
    const rows = this.index.filter(this.filter); this.page = Math.min(this.page, Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
    container.append(el('p', `${rows.length.toLocaleString()} / ${snapshot.records.length.toLocaleString()} 筆資料`, 'section-caption'));
    const selected = snapshot.records.find(record => record.id === this.selectedId);
    if (selected) {
      const detail = el('section', '', 'gp-record-detail'); detail.dataset.recordId = selected.id;
      detail.append(el('h3', `${selected.collection}.${selected.name}`), action('編輯這筆資料', () => callbacks.onEdit(selected)), action('關閉詳細資料', () => { this.selectedId = undefined; redraw(); }));
      if (callbacks.onRename) detail.append(action('重新命名／移動 namespace…', () => callbacks.onRename!(selected)));
      detail.append(el('p', '欄位名稱連到 identifier 引用；一般編輯保留 collection 與 record 名稱。', 'muted'));
      const fields = Object.keys(selected.fields).sort(collator.compare); this.fieldPage = Math.min(this.fieldPage, Math.max(0, Math.ceil(fields.length / PAGE_SIZE) - 1));
      for (const key of fields.slice(this.fieldPage * PAGE_SIZE, (this.fieldPage + 1) * PAGE_SIZE)) {
        const name = qualifiedField(selected, key), value = resolvedField(selected, key, runtime); const row = el('div', '', 'gp-record-field');
        row.append(action(name, () => callbacks.onReferences(name), 'identifier-name'), el('div', value.status === 'ok' ? value.value || '（空字串）' : `⟦${value.status}⟧ ${value.message ?? ''}`, `gp-record-value ${value.status}`), el('code', selected.fields[key], 'gp-record-raw'));
        if (callbacks.onInsertReference) row.append(action('插入引用', () => callbacks.onInsertReference!(name), 'text-button')); detail.append(row);
      }
      this.pager(detail, fields.length, this.fieldPage, action, page => { this.fieldPage = page; redraw(); }, '欄位'); container.append(detail);
    }
    for (const record of rows.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
      const card = el('section', '', 'record-card'); card.dataset.recordId = record.id; card.classList.toggle('selected', record.id === this.selectedId);
      card.append(el('span', record.collection, 'section-caption'), el('h3', record.name));
      for (const field of Object.keys(record.fields).slice(0, 3)) { const value = resolvedField(record, field, runtime); card.append(el('p', `${field}  ${value.status === 'ok' ? value.value : `⟦${value.status}⟧`}`, 'record-field')); }
      if (Object.keys(record.fields).length > 3) card.append(el('p', `共 ${Object.keys(record.fields).length} 個欄位`, 'muted'));
      card.append(action('欄位與引用', () => { this.selectedId = record.id; this.fieldPage = 0; redraw(); container.querySelector('.gp-record-detail')?.scrollIntoView({ block: 'nearest' }); }), action('編輯', () => callbacks.onEdit(record)), action('建立 table 筆記', () => callbacks.onCreateQuery({ collection: record.collection }), 'text-button')); container.append(card);
    }
    if (!rows.length) container.append(el('p', '沒有符合的資料。精確篩選只匹配存在且成功計算的欄位。', 'empty'));
    this.pager(container, rows.length, this.page, action, page => { this.page = page; redraw(); container.scrollTop = 0; }, 'records');
    if (focusedId) { const restored = container.querySelector<HTMLInputElement>(`#${focusedId}`); restored?.focus(); if (selection !== null && selection !== undefined) restored?.setSelectionRange(selection, selection); }
  }
  private pager(container: HTMLElement, total: number, page: number, action: (label: string, callback: () => unknown, className?: string) => HTMLButtonElement, change: (page: number) => void, scope: string) {
    if (total <= PAGE_SIZE) return;
    const pager = el('div', '', 'gp-record-pager'); const previous = action('上一頁', () => change(page - 1)); previous.disabled = page === 0; previous.setAttribute('aria-label', `${scope} 上一頁`);
    const next = action('下一頁', () => change(page + 1)); next.disabled = (page + 1) * PAGE_SIZE >= total; next.setAttribute('aria-label', `${scope} 下一頁`);
    pager.append(previous, el('span', `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / ${total}`), next); container.append(pager);
  }
}
