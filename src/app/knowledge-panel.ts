import type { Definition, Diagnostic, Reference, RuntimeResult, SourceLocation, WorkspaceSnapshot } from '../domain/model';

interface ReferenceEntry { reference: Reference; occurrence: number }
interface Entry { name: string; definitions: Definition[]; references: ReferenceEntry[]; dependencies: Set<string>; dependents: Set<string>; issues: Set<string> }
export interface KnowledgeActions {
  select(name?: string): void;
  definition(name: string): void;
  location(location: SourceLocation): void;
  reference(reference: Reference, occurrence: number): void;
  rename(name: string): void;
  edit?(name: string): void;
  retry(): void;
}
const el = (tag: string, className = '', value = '') => { const node = document.createElement(tag); node.className = className; node.textContent = value; return node; };
const button = (label: string, action: () => void, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = cls; b.onclick = action; return b; };

export function indexKnowledge(runtime?: RuntimeResult): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  const get = (name: string) => { let e = entries.get(name); if (!e) { e = { name, definitions: [], references: [], dependencies: new Set(), dependents: new Set(), issues: new Set() }; entries.set(name, e); } return e; };
  for (const name of Object.keys(runtime?.values ?? {})) get(name);
  for (const definition of runtime?.definitions ?? []) {
    const e = get(definition.name); e.definitions.push(definition);
    for (const dependency of definition.dependencies) { e.dependencies.add(dependency); get(dependency).dependents.add(definition.name); }
  }
  const occurrences = new Map<string, number>();
  for (const reference of runtime?.references ?? []) {
    const key = JSON.stringify([reference.name, reference.location.noteId, reference.kind]);
    const occurrence = occurrences.get(key) ?? 0; occurrences.set(key, occurrence + 1);
    get(reference.name).references.push({ reference, occurrence });
  }
  for (const diagnostic of runtime?.diagnostics ?? []) if (diagnostic.name) get(diagnostic.name).issues.add(diagnostic.kind);
  for (const entry of entries.values()) {
    if (!entry.definitions.length) entry.issues.add('missing');
    if (entry.definitions.length > 1) entry.issues.add('duplicate');
  }
  return entries;
}

export function dependentNames(entries: Map<string, Entry>, name: string): Set<string> {
  const found = new Set<string>(); const queue = [name];
  for (let i = 0; i < queue.length; i++) for (const target of entries.get(queue[i])?.dependents ?? []) if (!found.has(target) && target !== name) { found.add(target); queue.push(target); }
  return found;
}

/** Bounded all-result views over the runtime's existing plain-data contract. */
export class KnowledgePanel {
  private workspace = '';
  private previous?: RuntimeResult;
  private entries = new Map<string, Entry>();
  private query = '';
  private namespace = '';
  private source = '';
  private status = 'all';
  private page = 0;
  private referencePage = 0;
  private definitionPage = 0;
  private selected?: string;

  render(container: HTMLElement, snapshot: WorkspaceSnapshot, runtime: RuntimeResult | undefined, selected: string | undefined, mode: 'values' | 'issues', actions: KnowledgeActions) {
    if (this.workspace !== snapshot.id) { this.workspace = snapshot.id; this.query = ''; this.namespace = ''; this.source = ''; this.status = 'all'; this.page = this.referencePage = this.definitionPage = 0; }
    if (this.previous?.definitions !== runtime?.definitions || this.previous?.references !== runtime?.references || this.previous?.diagnostics !== runtime?.diagnostics || this.previous?.values !== runtime?.values) this.entries = indexKnowledge(runtime);
    this.previous = runtime;
    if (selected !== this.selected) { this.referencePage = this.definitionPage = 0; this.selected = selected; }
    const focused = document.activeElement as HTMLInputElement | null;
    const focusId = focused?.id; const cursor = focused?.tagName === 'INPUT' ? focused.selectionStart : null;
    const noteLabels = new Map(snapshot.notes.map(n => [n.id, n.title]));
    const sourceLabel = (loc: SourceLocation) => noteLabels.get(loc.noteId) ?? snapshot.records.find(r => `record:${r.id}` === loc.noteId)?.name ?? loc.noteId;
    const rerender = () => this.render(container, snapshot, runtime, selected, mode, actions);
    container.replaceChildren();
    const field = (id: string, label: string, value: string, update: (text: string) => void) => {
      const input = document.createElement('input'); input.type = 'search'; input.id = id; input.className = 'search'; input.placeholder = label; input.setAttribute('aria-label', label); input.value = value;
      input.oninput = () => { update(input.value); this.page = 0; rerender(); }; container.append(input);
    };
    field('value-search', mode === 'issues' ? '搜尋診斷' : '搜尋 identifier', this.query, value => this.query = value);
    field('namespace-search', 'Namespace 前綴', this.namespace, value => this.namespace = value);
    field('source-search', '來源筆記或 record', this.source, value => this.source = value);
    const status = document.createElement('select'); status.setAttribute('aria-label', '識別值狀態');
    for (const [value, label] of [['all', '全部狀態'], ['ok', '正常'], ['missing', '缺少定義'], ['duplicate', '重複定義'], ['cycle', '循環依賴'], ['error', '其他錯誤']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; status.append(option); }
    status.value = this.status; status.onchange = () => { this.status = status.value; this.page = 0; rerender(); }; container.append(status);

    if (mode === 'issues') {
      container.append(button('重新計算', actions.retry, 'wide'));
      const diagnostics = (runtime?.diagnostics ?? []).filter(issue => this.matchIssue(issue, sourceLabel));
      if (!runtime?.diagnostics.length) container.append(el('div', 'healthy', '✓ 目前沒有診斷問題'));
      this.page = clampPage(this.page, diagnostics.length, 60);
      container.append(el('p', 'section-caption', `${diagnostics.length} 個問題`));
      for (const issue of diagnostics.slice(this.page * 60, (this.page + 1) * 60)) {
        const card = el('section', 'issue-card'); card.append(el('strong', '', issue.kind), el('p', '', issue.message));
        if (issue.location) card.append(button('查看位置 ↗', () => actions.location(issue.location!)));
        if (issue.name) card.append(button('檢查依賴', () => actions.select(issue.name)));
        container.append(card);
      }
      container.append(pager(this.page, diagnostics.length, 60, value => { this.page = value; rerender(); }));
    } else {
      if (selected) this.detail(container, selected, sourceLabel, actions, rerender, runtime);
      const entries = [...this.entries.values()].filter(entry => {
        const value = runtime?.values[entry.name];
        const namespace = this.namespace.trim();
        return entry.name.toLowerCase().includes(this.query.toLowerCase())
          && (!namespace || entry.name === namespace || entry.name.startsWith(namespace + '.'))
          && (!this.source || [...entry.definitions.map(d => d.location), ...entry.references.map(r => r.reference.location)].some(loc => sourceLabel(loc).toLowerCase().includes(this.source.toLowerCase())))
          && (this.status === 'all' || this.status === 'ok' ? this.status === 'all' || (!entry.issues.size && value?.status === 'ok') : entry.issues.has(this.status) || value?.status === this.status);
      }).sort((a, b) => a.name.localeCompare(b.name));
      this.page = clampPage(this.page, entries.length, 60);
      container.append(el('div', 'section-caption', `${entries.length} 個識別值`));
      for (const entry of entries.slice(this.page * 60, (this.page + 1) * 60)) {
        const value = runtime?.values[entry.name];
        const state = entry.issues.has('duplicate') ? 'duplicate' : value?.status ?? 'missing';
        const card = el('div', 'value-card'); const heading = el('div', 'value-card-header'); heading.append(button(entry.name, () => actions.definition(entry.name), 'identifier-name'), el('span', `value-state ${state}`, state === 'ok' ? '●' : state));
        card.append(heading, el('div', 'value-text', value?.value || (value?.status === 'ok' ? '（空字串）' : value?.message || '未定義')));
        const controls = el('div', 'value-actions'); controls.append(button('定義 ↗', () => actions.definition(entry.name)), button('References', () => actions.select(entry.name)));
        if (actions.edit) controls.append(button('編輯共享值', () => actions.edit!(entry.name)));
        card.append(controls); container.append(card);
      }
      if (!entries.length) container.append(el('p', 'empty', '沒有符合的識別值。新筆記可寫 @Name = <|Hello|>，再用 [Hello](:ref:Name) 引用；舊筆記保留原有語法。'));
      container.append(pager(this.page, entries.length, 60, value => { this.page = value; rerender(); }));
    }
    if (focusId) { const input = container.querySelector<HTMLInputElement>(`#${focusId}`); if (input) { input.focus(); if (cursor !== null) input.setSelectionRange(cursor, cursor); } }
  }

  private matchIssue(issue: Diagnostic, sourceLabel: (location: SourceLocation) => string) {
    return `${issue.name ?? ''} ${issue.message}`.toLowerCase().includes(this.query.toLowerCase())
      && (!this.namespace || issue.name === this.namespace || issue.name?.startsWith(this.namespace + '.'))
      && (!this.source || (issue.location && sourceLabel(issue.location).toLowerCase().includes(this.source.toLowerCase())))
      && (this.status === 'all' || issue.kind === this.status || (this.status === 'error' && ['syntax', 'limit'].includes(issue.kind)));
  }

  private detail(container: HTMLElement, name: string, sourceLabel: (loc: SourceLocation) => string, actions: KnowledgeActions, redraw: () => void, runtime?: RuntimeResult) {
    const entry = this.entries.get(name); const card = el('section', 'reference-detail');
    card.append(button('← 所有識別值', () => actions.select(undefined), 'text-button'), el('h3', '', name));
    const value = runtime?.values[name]; card.append(el('p', 'current-value', value?.status === 'ok' ? value.value || '（空字串）' : value?.message || '未定義'), button('前往定義 ↗', () => actions.definition(name)), button('重新命名／移動 Namespace', () => actions.rename(name)));
    if (actions.edit) card.append(button('編輯共享值', () => actions.edit!(name)));
    const defs = entry?.definitions ?? []; this.definitionPage = clampPage(this.definitionPage, defs.length, 20);
    card.append(el('h4', '', `Definitions · ${defs.length}`));
    for (const definition of defs.slice(this.definitionPage * 20, (this.definitionPage + 1) * 20)) card.append(button(`${sourceLabel(definition.location)} · 第 ${definition.location.line} 行`, () => actions.location(definition.location), 'definition-link'));
    if (!defs.length) card.append(el('p', 'empty', '尚未有定義；可修正引用名稱或新增 declaration。'));
    if (defs.length > 20) card.append(pager(this.definitionPage, defs.length, 20, value => { this.definitionPage = value; redraw(); }));
    const dependencyList = (label: string, names: Iterable<string>) => {
      const all = [...names]; const section = document.createElement('details'); section.append(el('summary', '', `${label} · ${all.length}`));
      // Independent pagers keep high-fanout dependency views bounded and complete.
      let page = 0; const body = el('div'); section.append(body);
      const render = () => { body.replaceChildren(); for (const target of all.slice(page * 40, (page + 1) * 40)) body.append(button(target, () => actions.select(target), 'reference-link')); body.append(pager(page, all.length, 40, next => { page = next; render(); })); };
      section.addEventListener('toggle', () => { if (section.open) render(); }); card.append(section);
    };
    dependencyList('依賴哪些值', entry?.dependencies ?? []);
    dependencyList('直接影響', entry?.dependents ?? []);
    dependencyList('全部受影響識別值', dependentNames(this.entries, name));
    const refs = entry?.references ?? []; this.referencePage = clampPage(this.referencePage, refs.length, 50);
    card.append(el('h4', '', `References · ${refs.length}`));
    for (const { reference, occurrence } of refs.slice(this.referencePage * 50, (this.referencePage + 1) * 50)) card.append(button(`${sourceLabel(reference.location)} · 第 ${reference.location.line} 行${reference.kind === 'dependency' ? ' · 依賴' : ''}`, () => actions.reference(reference, occurrence), 'reference-link'));
    if (!refs.length) card.append(el('p', 'empty', '目前沒有其他引用。'));
    card.append(pager(this.referencePage, refs.length, 50, value => { this.referencePage = value; redraw(); })); container.append(card);
  }
}
const clampPage = (page: number, total: number, size: number) => Math.max(0, Math.min(page, Math.ceil(total / size) - 1));
function pager(page: number, total: number, size: number, change: (page: number) => void) {
  const row = el('div', 'gp-nav-pager'); const previous = button('上一頁', () => change(page - 1)); previous.disabled = page <= 0;
  const next = button('下一頁', () => change(page + 1)); next.disabled = (page + 1) * size >= total;
  row.append(previous, el('span', '', `${total ? page * size + 1 : 0}–${Math.min(total, (page + 1) * size)} / ${total}`), next); return row;
}
