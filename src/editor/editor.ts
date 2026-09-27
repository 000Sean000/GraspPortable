import { Annotation, EditorSelection, EditorState, Facet, Prec, StateEffect, StateField, type Range, type Transaction } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, dropCursor, highlightActiveLine, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory, redo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree, syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import type { RuntimeResult, StructuredRecord, ValueResult } from '../domain/model';
import { executeQuery, parseQuery, safeLink, type RecordQuery } from './query';
import './editor.css';

export interface EditorAdapter {
  setDocument(markdown: string, documentKey?: string): void;
  getDocument(): string;
  insertText(text: string): void;
  setRuntime(result: RuntimeResult, records?: StructuredRecord[]): void;
  focusRange(from: number, to: number): void;
  setMode(mode: 'live' | 'source'): void;
  destroy(): void;
}
interface EditorOptions {
  onChange(markdown: string): void;
  onNavigate(name: string): void;
  onFindReferences(name: string): void;
  onOpenRecord?(id: string): void;
  onOpenQuery?(query: RecordQuery): void;
}
const editorOptions = Facet.define<EditorOptions, EditorOptions>({ combine: values => values[0] });
interface RuntimeState { result: RuntimeResult; records: StructuredRecord[] }
const emptyRuntime: RuntimeResult = { revision: 0, values: {}, definitions: [], references: [], diagnostics: [], metrics: { elapsedMs: 0, recalculated: 0, total: 0, affected: 0 } };
const updateRuntime = StateEffect.define<RuntimeState>();
const updateMode = StateEffect.define<'live' | 'source'>();
const externalChange = Annotation.define<boolean>();
const runtimeField = StateField.define<RuntimeState>({
  create: () => ({ result: emptyRuntime, records: [] }),
  update(value, tr) { for (const effect of tr.effects) if (effect.is(updateRuntime)) value = effect.value; return value; },
});
const modeField = StateField.define<'live' | 'source'>({
  create: () => 'live',
  update(value, tr) { for (const effect of tr.effects) if (effect.is(updateMode)) value = effect.value; return value; },
});

function intersectsSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(range => range.from <= to && range.to >= from);
}
function sourceAt(state: EditorState, from: number, to: number): boolean {
  return state.field(modeField) === 'source' || intersectsSelection(state, state.doc.lineAt(from).from, state.doc.lineAt(to).to);
}
function inCode(state: EditorState, position: number): boolean {
  let node = syntaxTree(state).resolveInner(position, 1);
  while (node.parent) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'Link', 'Image', 'Autolink'].includes(node.name)) return true;
    node = node.parent;
  }
  return false;
}
function renderLinkReferences(source: string, values: Record<string, ValueResult>): string {
  return source.replace(/\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g, (whole, name: string, offset: number) => {
    let slashes = 0;
    for (let before = offset - 1; before >= 0 && source[before] === '\\'; before--) slashes++;
    if (slashes % 2) return whole;
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    return value?.status === 'ok' ? value.value : `⟦${name}：未解析⟧`;
  });
}
function button(label: string, className: string, action: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button'; el.className = className; el.title = label; el.setAttribute('aria-label', label);
  el.addEventListener('mousedown', event => event.preventDefault());
  el.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); });
  return el;
}

class ValueWidget extends WidgetType {
  constructor(readonly name: string, readonly value: ValueResult | undefined, readonly declaration: boolean, readonly options: EditorOptions) { super(); }
  eq(other: ValueWidget): boolean { return other.name === this.name && other.declaration === this.declaration && other.value?.value === this.value?.value && other.value?.status === this.value?.status; }
  toDOM(view: EditorView): HTMLElement {
    const status = this.value?.status ?? 'missing';
    const el = document.createElement('span');
    el.className = `gp-value gp-value-${status}${this.declaration ? ' gp-declaration' : ''}`;
    el.setAttribute('data-identifier', this.name);
    el.title = `${this.name} · ${this.value?.message ?? (status === 'ok' ? '前往定義；右鍵尋找引用' : status)}`;
    if (this.declaration) {
      const label = document.createElement('span'); label.className = 'gp-declaration-name'; label.textContent = `@${this.name}`; el.append(label);
    }
    const value = button(`前往定義 ${this.name}`, 'gp-value-text', () => this.options.onNavigate(this.name));
    const display = status === 'ok' ? this.value!.value : `⟦${this.name}：${status === 'cycle' ? '循環依賴' : status === 'error' ? '計算錯誤' : '未解析'}⟧`;
    value.textContent = display.length > 1200 ? `${display.slice(0, 1200)}…` : display || '空字串';
    if (!display) value.classList.add('gp-empty-value');
    el.append(value);
    const references = button(`尋找引用 ${this.name}`, 'gp-value-references', () => this.options.onFindReferences(this.name));
    references.textContent = '↗'; el.append(references);
    el.addEventListener('contextmenu', event => { event.preventDefault(); this.options.onFindReferences(this.name); });
    return el;
  }
  ignoreEvent(): boolean { return true; }
}

class LinkWidget extends WidgetType {
  constructor(readonly label: string, readonly url: string, readonly image: boolean) { super(); }
  eq(other: LinkWidget): boolean { return this.label === other.label && this.url === other.url && this.image === other.image; }
  toDOM(view: EditorView): HTMLElement {
    const safe = safeLink(this.url);
    const element = document.createElement(safe ? 'a' : 'span');
    element.className = 'gp-link'; element.textContent = `${this.image ? '▧ ' : ''}${this.label}`;
    element.title = safe ?? '僅允許 http、https、mailto 連結';
    if (element instanceof HTMLAnchorElement && safe) {
      element.href = safe; element.target = '_blank'; element.rel = 'noopener noreferrer';
      if (this.image && /^https?:\/\//i.test(safe)) {
        const image = document.createElement('img'); image.src = safe; image.alt = this.label; image.loading = 'lazy'; image.className = 'gp-markdown-image';
        image.addEventListener('load', () => view.requestMeasure());
        image.addEventListener('error', () => { image.replaceWith(document.createTextNode(`▧ ${this.label}（圖片無法載入）`)); view.requestMeasure(); });
        element.replaceChildren(image);
      }
    }
    return element;
  }
  ignoreEvent(): boolean { return true; }
}
class MarkerWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: MarkerWidget): boolean { return this.text === other.text; }
  toDOM(): HTMLElement { const el = document.createElement('span'); el.className = 'gp-list-marker'; el.textContent = this.text; return el; }
}
class TaskWidget extends WidgetType {
  constructor(readonly from: number, readonly checked: boolean) { super(); }
  eq(other: TaskWidget): boolean { return this.from === other.from && this.checked === other.checked; }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = this.checked; box.className = 'gp-task'; box.setAttribute('aria-label', '切換待辦狀態');
    box.addEventListener('mousedown', event => event.preventDefault());
    box.addEventListener('change', () => view.dispatch({ changes: { from: this.from, to: this.from + 3, insert: box.checked ? '[x]' : '[ ]' }, userEvent: 'input' }));
    return box;
  }
  ignoreEvent(): boolean { return true; }
}

interface QueryBlock { from: number; to: number; source: string }
const queryFence = /^(?:`{3,}|~{3,})[ \t]*grasp-query[ \t]*\n([\s\S]*?)\n(?:`{3,}|~{3,})[ \t]*$/;
class QueryWidget extends WidgetType {
  constructor(readonly block: QueryBlock, readonly runtime: RuntimeState, readonly options: EditorOptions) { super(); }
  eq(other: QueryWidget): boolean { return this.block.from === other.block.from && this.block.source === other.block.source && this.runtime === other.runtime; }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('section'); el.className = 'gp-query'; el.setAttribute('aria-label', '資料查詢結果');
    const header = document.createElement('div'); header.className = 'gp-query-header';
    const label = document.createElement('strong'); header.append(label);
    const edit = button('編輯查詢', 'gp-query-edit', () => { view.dispatch({ selection: { anchor: Math.min(this.block.from + 15, this.block.to) }, scrollIntoView: true }); view.focus(); });
    edit.textContent = '編輯查詢'; header.append(edit); el.append(header);
    try {
      const query = parseQuery(this.block.source);
      const result = executeQuery(query, this.runtime.records, this.runtime.result);
      label.textContent = `${query.collection} · ${result.total} 筆`;
      if (this.options.onOpenQuery) { const all = button('開啟全部查詢結果', 'gp-query-edit', () => this.options.onOpenQuery!(query)); all.textContent = '開啟全部結果 ↗'; header.append(all); }
      if (!result.rows.length) { const empty = document.createElement('p'); empty.textContent = '沒有符合條件的資料。'; el.append(empty); }
      else {
        const wrapper = document.createElement('div'); wrapper.className = 'gp-query-scroll';
        const table = document.createElement('table'); const head = table.createTHead().insertRow();
        for (const name of ['名稱', ...result.columns]) { const th = document.createElement('th'); th.textContent = name; head.append(th); }
        const body = table.createTBody();
        for (const record of result.rows) {
          const row = body.insertRow(); row.dataset.recordId = record.id; const name = row.insertCell();
          if (this.options.onOpenRecord) { const open = button(`開啟資料 ${record.name}`, 'gp-query-record', () => this.options.onOpenRecord!(record.id)); open.textContent = record.name; name.append(open); } else name.textContent = record.name;
          for (const value of record.cells) { const cell = row.insertCell(); cell.textContent = value.status === 'ok' ? value.value : `⟦${value.status}⟧`; if (value.status !== 'ok') { cell.className = 'gp-query-error'; cell.title = value.message ?? value.status; } }
        }
        wrapper.append(table); el.append(wrapper);
        if (result.truncated) { const hint = document.createElement('p'); hint.textContent = `表格顯示前 ${result.rows.length} 筆；${this.options.onOpenQuery ? '開啟全部結果即可分頁瀏覽或編輯。' : '請加入 where 縮小範圍。'}`; el.append(hint); }
      }
    } catch (error) { label.textContent = '查詢格式錯誤'; const message = document.createElement('p'); message.className = 'gp-query-error'; message.textContent = error instanceof Error ? error.message : String(error); el.append(message); }
    return el;
  }
  ignoreEvent(): boolean { return true; }
}

function queryBlocks(state: EditorState): QueryBlock[] {
  const blocks: QueryBlock[] = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name === 'FencedCode') {
      const text = state.doc.sliceString(node.from, node.to);
      const match = queryFence.exec(text);
      if (match) blocks.push({ from: node.from, to: node.to, source: match[1] });
      return false;
    }
    // Paragraphs and inline syntax cannot contain fenced queries.
    if (/^(Paragraph|ATXHeading|SetextHeading|CodeBlock|Table)/.test(node.name)) return false;
  } });
  return blocks;
}
function mapQueries(tr: Transaction, blocks: QueryBlock[]): QueryBlock[] {
  let structural = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const oldLines = tr.startState.doc.sliceString(tr.startState.doc.lineAt(fromA).from, tr.startState.doc.lineAt(toA).to);
    const newLines = tr.state.doc.sliceString(tr.state.doc.lineAt(fromB).from, tr.state.doc.lineAt(toB).to);
    if (/`{3}|~{3}/.test(oldLines) || /`{3}|~{3}/.test(newLines)) structural = true;
  });
  if (structural) return queryBlocks(tr.state);
  // Ordinary prose/value edits map the small query index instead of walking the full note tree.
  return blocks.flatMap(block => {
    const from = tr.changes.mapPos(block.from, 1); const to = tr.changes.mapPos(block.to, -1);
    const match = from < to ? queryFence.exec(tr.state.doc.sliceString(from, to)) : null;
    return match ? [{ from, to, source: match[1] }] : [];
  });
}
interface QueryState { tree: ReturnType<typeof syntaxTree>; blocks: QueryBlock[]; decorations: DecorationSet }
function decorateQueries(state: EditorState, blocks: QueryBlock[]): DecorationSet {
  if (state.field(modeField) === 'source') return Decoration.none;
  const runtime = state.field(runtimeField);
  return Decoration.set(blocks.filter(block => !sourceAt(state, block.from, block.to)).map(block => Decoration.replace({ widget: new QueryWidget(block, runtime, state.facet(editorOptions)), block: true }).range(block.from, block.to)), true);
}
const queriesField = StateField.define<QueryState>({
  create(state) { const blocks = queryBlocks(state); return { tree: syntaxTree(state), blocks, decorations: decorateQueries(state, blocks) }; },
  update(value, tr) {
    const tree = syntaxTree(tr.state);
    const changedTree = tr.docChanged || tree !== value.tree;
    if (!changedTree && !tr.selection && !tr.effects.some(effect => effect.is(updateRuntime) || effect.is(updateMode))) return value;
    const blocks = tr.docChanged ? mapQueries(tr, value.blocks) : changedTree ? queryBlocks(tr.state) : value.blocks;
    return { tree, blocks, decorations: decorateQueries(tr.state, blocks) };
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

function inlineDecorations(view: EditorView, options: EditorOptions): DecorationSet {
  const state = view.state;
  if (state.field(modeField) === 'source') return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const hidden: Array<{ from: number; to: number }> = [];
  const declarations: Array<{ from: number; to: number }> = [];
  const seenLines = new Set<number>();
  const values = state.field(runtimeField).result.values;
  const lookupValue = (name: string): ValueResult | undefined => Object.hasOwn(values, name) ? values[name] : undefined;
  const add = (from: number, to: number, decoration: Decoration) => { if (from < to) ranges.push(decoration.range(from, to)); };
  const conceal = (from: number, to: number) => { if (hidden.some(range => range.from <= from && range.to >= to)) return; hidden.push({ from, to }); add(from, to, Decoration.replace({})); };
  for (const visible of view.visibleRanges) {
    for (let pos = state.doc.lineAt(visible.from).from; pos <= visible.to;) {
      const line = state.doc.lineAt(pos); pos = line.to + 1;
      if (seenLines.has(line.number)) continue; seenLines.add(line.number);
      if (sourceAt(state, line.from, line.to)) continue;
      const definition = /^\s*@([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/.exec(line.text);
      let validDefinition = false;
      if (definition) { try { validDefinition = typeof JSON.parse(definition[2]) === 'string'; } catch { /* Keep malformed declarations editable as source. */ } }
      if (definition && validDefinition && !inCode(state, line.from + line.text.indexOf('@'))) {
        declarations.push({ from: line.from, to: line.to });
        add(line.from, line.to, Decoration.replace({ widget: new ValueWidget(definition[1], lookupValue(definition[1]), true, options) }));
        continue;
      }
      for (const reference of line.text.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g)) {
        const from = line.from + reference.index!;
        let slashes = 0;
        for (let before = reference.index! - 1; before >= 0 && line.text[before] === '\\'; before--) slashes++;
        if (slashes % 2 === 0 && !inCode(state, from)) add(from, from + reference[0].length, Decoration.replace({ widget: new ValueWidget(reference[1], lookupValue(reference[1]), false, options) }));
      }
    }
    syntaxTree(state).iterate({ from: visible.from, to: visible.to, enter(node) {
      if (declarations.some(range => range.from <= node.from && range.to >= node.to)) return false;
      const editing = sourceAt(state, node.from, node.to);
      if (/^ATXHeading[1-6]$/.test(node.name)) {
        ranges.push(Decoration.line({ class: `gp-heading gp-h${node.name.slice(-1)}` }).range(state.doc.lineAt(node.from).from));
      }
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        for (let pos = state.doc.lineAt(Math.max(node.from, visible.from)).from; pos <= Math.min(node.to, visible.to);) { const line = state.doc.lineAt(pos); ranges.push(Decoration.line({ class: 'gp-code-line' }).range(line.from)); pos = line.to + 1; }
        return false;
      }
      if (node.name === 'Table') {
        for (let pos = state.doc.lineAt(Math.max(node.from, visible.from)).from; pos <= Math.min(node.to, visible.to);) { const line = state.doc.lineAt(pos); ranges.push(Decoration.line({ class: 'gp-markdown-table' }).range(line.from)); pos = line.to + 1; }
      }
      if (editing) return;
      if (node.name === 'StrongEmphasis') add(node.from, node.to, Decoration.mark({ class: 'gp-strong' }));
      if (node.name === 'Emphasis') add(node.from, node.to, Decoration.mark({ class: 'gp-emphasis' }));
      if (node.name === 'Strikethrough') add(node.from, node.to, Decoration.mark({ class: 'gp-strike' }));
      if (node.name === 'InlineCode') add(node.from, node.to, Decoration.mark({ class: 'gp-inline-code' }));
      if (['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'HeaderMark', 'QuoteMark'].includes(node.name)) {
        let end = node.to;
        if ((node.name === 'HeaderMark' || node.name === 'QuoteMark') && state.doc.sliceString(end, end + 1) === ' ') end++;
        conceal(node.from, end);
      }
      if (node.name === 'ListMark' && /^[-+*]$/.test(state.doc.sliceString(node.from, node.to))) add(node.from, node.to, Decoration.replace({ widget: new MarkerWidget('•') }));
      if (node.name === 'TaskMarker') add(node.from, node.to, Decoration.replace({ widget: new TaskWidget(node.from, /x/i.test(state.doc.sliceString(node.from, node.to))) }));
      if (node.name === 'Link' || node.name === 'Image') {
        const source = state.doc.sliceString(node.from, node.to);
        const match = /^!?\[([^\]]*)\]\((<?[^\s)]+>?)(?:\s+["'][^"']*["'])?\)$/.exec(source);
        if (match) { add(node.from, node.to, Decoration.replace({ widget: new LinkWidget(renderLinkReferences(match[1], values), renderLinkReferences(match[2].replace(/^<|>$/g, ''), values), node.name === 'Image') })); return false; }
      }
      if (node.name === 'HorizontalRule') add(node.from, node.to, Decoration.mark({ class: 'gp-horizontal-rule' }));
    } });
  }
  return Decoration.set(ranges, true);
}

function identifierAtSelection(state: EditorState): string | null {
  const position = state.selection.main.head; const line = state.doc.lineAt(position); const offset = position - line.from;
  for (const match of line.text.matchAll(/(?:\{\{?([A-Za-z_][A-Za-z0-9_.-]*)\}\}?|@([A-Za-z_][A-Za-z0-9_.-]*))/g)) {
    if (match.index! <= offset && match.index! + match[0].length >= offset) return match[1] ?? match[2];
  }
  return null;
}

/** Only this adapter knows CodeMirror types. Domain and application callers do not. */
export function createEditor(parent: HTMLElement, options: EditorOptions): EditorAdapter {
  let runtime: RuntimeState = { result: emptyRuntime, records: [] }; let mode: 'live' | 'source' = 'live';
  const preview = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = inlineDecorations(view, options); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.transactions.some(tr => tr.effects.some(effect => effect.is(updateRuntime) || effect.is(updateMode)))) {
        this.decorations = inlineDecorations(update.view, options);
      }
    }
  }, { decorations: value => value.decorations });
  const makeState = (doc: string): EditorState => {
    const state = EditorState.create({ doc, extensions: [
      runtimeField, modeField, markdown({ base: markdownLanguage }), history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle), highlightActiveLine(), highlightSelectionMatches(),
      EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': 'Markdown 筆記編輯器', spellcheck: 'false', autocapitalize: 'off' }),
      EditorState.tabSize.of(2), editorOptions.of(options), queriesField, preview,
      // Some input drivers/layouts report lowercase "z" even with Shift held.
      // CodeMirror's character fallback otherwise tries unshifted Ctrl+Z first.
      Prec.highest(EditorView.domEventHandlers({ keydown(event, view) {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') { redo(view); return true; }
        return false;
      } })),
      autocompletion({ override: [context => {
        const prefix = context.matchBefore(/\{\{[A-Za-z0-9_.-]*/);
        if (!prefix || inCode(context.state, prefix.from)) return null;
        const typed = prefix.text.slice(2).toLowerCase();
        return { from: prefix.from + 2, options: context.state.field(runtimeField).result.definitions.filter(def => def.name.toLowerCase().startsWith(typed)).slice(0, 1000).map(def => ({
          label: def.name, type: 'variable', detail: 'identifier',
          apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
            const suffix = view.state.doc.sliceString(to, to + 2) === '}}' ? '' : '}}';
            view.dispatch({ changes: { from, to, insert: def.name + suffix }, selection: { anchor: from + def.name.length + suffix.length }, userEvent: 'input.complete' });
          },
        })) };
      }] }),
      keymap.of([
        { key: 'Mod-Shift-z', run: redo, preventDefault: true },
        { key: 'F12', run: view => { const name = identifierAtSelection(view.state); if (!name) return false; options.onNavigate(name); return true; } },
        { key: 'Shift-F12', run: view => { const name = identifierAtSelection(view.state); if (!name) return false; options.onFindReferences(name); return true; } },
        ...defaultKeymap, ...historyKeymap, ...completionKeymap, ...searchKeymap, indentWithTab,
      ]),
      EditorView.updateListener.of(update => { if (update.docChanged && !update.transactions.some(tr => tr.annotation(externalChange))) options.onChange(update.state.doc.toString()); }),
    ] });
    return state.update({ effects: [updateRuntime.of(runtime), updateMode.of(mode)], annotations: externalChange.of(true) }).state;
  };
  const view = new EditorView({ state: makeState(''), parent });
  view.dom.classList.add('gp-editor');
  let documentKey: string | undefined;
  const recentStates = new Map<string, EditorState>();
  return {
    setDocument(markdown, nextKey) {
      if (documentKey === nextKey && view.state.doc.toString() === markdown) return;
      if (documentKey && documentKey !== nextKey) {
        recentStates.delete(documentKey); recentStates.set(documentKey, view.state);
        while (recentStates.size > 20) recentStates.delete(recentStates.keys().next().value!);
      }
      const previous = nextKey && recentStates.get(nextKey);
      // External import/recovery is a new document version; never resurrect stale undo.
      const state = previous && previous.doc.toString() === markdown ? previous.update({ effects: [updateRuntime.of(runtime), updateMode.of(mode)], annotations: externalChange.of(true) }).state : makeState(markdown);
      documentKey = nextKey; view.setState(state);
    },
    getDocument: () => view.state.doc.toString(),
    insertText(text) { view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input', annotations: isolateHistory.of('full'), scrollIntoView: true }); view.focus(); },
    setRuntime(result, records = []) { runtime = { result, records }; view.dispatch({ effects: updateRuntime.of(runtime) }); },
    focusRange(from, to) { const length = view.state.doc.length; const start = Math.max(0, Math.min(from, length)); const end = Math.max(start, Math.min(to, length)); view.dispatch({ selection: EditorSelection.range(start, end), effects: EditorView.scrollIntoView(start, { y: 'center' }) }); view.focus(); },
    setMode(next) { mode = next; view.dispatch({ effects: updateMode.of(next) }); },
    destroy() { recentStates.clear(); view.destroy(); },
  };
}
