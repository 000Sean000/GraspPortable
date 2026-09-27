import { buildLinkIndex, type NoteLinkIndex, type ResolvedNoteLink } from '../domain/links';
import type { SourceLocation, WorkspaceSnapshot } from '../domain/model';

const labels = { resolved: '已連結', missing: '找不到目標', ambiguous: '多個同名目標', external: '外部連結', unsafe: '不允許的路徑', unsupported: '保留原文' };
const text = (tag: string, value: string, className = '') => { const e = document.createElement(tag); e.textContent = value; e.className = className; return e; };
const action = (label: string, callback: () => void) => { const b = document.createElement('button'); b.textContent = label; b.type = 'button'; b.onclick = callback; return b; };

/** Presentation and a disposable derived index. Neither owns note data. */
export class LinksPanel {
  private previous?: WorkspaceSnapshot;
  private index?: NoteLinkIndex;
  private view = 'outgoing';
  private filter = '';
  private page = 0;
  private noteId = '';

  render(container: HTMLElement, snapshot: WorkspaceSnapshot, activeId: string, navigate: (location: SourceLocation) => void) {
    const old = this.previous;
    const unchanged = old?.id === snapshot.id && old.notes.length === snapshot.notes.length && old.folders.length === snapshot.folders.length
      && snapshot.notes.every((n, i) => { const p = old.notes[i]; return p.id === n.id && p.markdown === n.markdown && p.title === n.title && p.folderId === n.folderId; })
      && snapshot.folders.every((f, i) => { const p = old.folders[i]; return p.id === f.id && p.name === f.name && p.parentId === f.parentId; });
    if (!unchanged) this.index = buildLinkIndex(snapshot.notes, snapshot.folders, [], old?.id === snapshot.id ? this.index : undefined);
    if (old?.id !== snapshot.id) { this.view = 'outgoing'; this.filter = ''; }
    if (this.noteId !== activeId) { this.page = 0; this.noteId = activeId; }
    this.previous = snapshot;
    const index = this.index!;
    const focus = document.activeElement?.id === 'link-search';
    const selection = focus ? (document.activeElement as HTMLInputElement).selectionStart : null;
    container.replaceChildren(text('p', '筆記路徑連結與 identifier 分開管理。修改標題或移動後，失效的文字連結會明確顯示。', 'panel-intro'));
    const modes = document.createElement('select'); modes.setAttribute('aria-label', '筆記連結範圍');
    for (const [value, name] of [['outgoing', '目前筆記的連結'], ['backlinks', '連到目前筆記'], ['issues', '全 workspace 的連結問題']]) { const option = document.createElement('option'); option.value = value; option.textContent = name; modes.append(option); }
    modes.value = this.view; modes.onchange = () => { this.view = modes.value; this.page = 0; redraw(); };
    const search = document.createElement('input'); search.id = 'link-search'; search.className = 'search'; search.type = 'search'; search.placeholder = '搜尋路徑或連結…'; search.setAttribute('aria-label', '搜尋筆記連結'); search.value = this.filter;
    search.oninput = () => { this.filter = search.value; this.page = 0; redraw(); };
    container.append(modes, search);
    const entries = (this.view === 'outgoing' ? index.byNote.get(activeId) ?? [] : this.view === 'backlinks' ? index.backlinks.get(activeId) ?? [] : index.links.filter(l => l.status !== 'resolved' && l.status !== 'external'))
      .filter(l => `${l.target}\n${l.alias ?? ''}\n${index.catalog.notePaths.get(l.location.noteId) ?? ''}`.toLowerCase().includes(this.filter.toLowerCase()));
    this.page = Math.min(this.page, Math.max(0, Math.ceil(entries.length / 60) - 1));
    container.append(text('p', `${entries.length} 個位置 · 第 ${this.page + 1} / ${Math.max(1, Math.ceil(entries.length / 60))} 頁`, 'section-caption'));
    for (const link of entries.slice(this.page * 60, (this.page + 1) * 60)) this.card(container, link, index, navigate);
    if (!entries.length) container.append(text('p', '這個範圍沒有連結。可在筆記寫 [[另一份筆記]] 或 [標籤](資料夾/筆記.md)。', 'empty'));
    const previous = action('上一頁', () => { this.page--; redraw(); }); previous.disabled = this.page === 0;
    const next = action('下一頁', () => { this.page++; redraw(); }); next.disabled = (this.page + 1) * 60 >= entries.length;
    container.append(previous, next);
    if (focus) { search.focus(); if (selection !== null) search.setSelectionRange(selection, selection); }
    function redraw() { panel.render(container, snapshot, activeId, navigate); }
    const panel = this;
  }

  private card(container: HTMLElement, link: ResolvedNoteLink, index: NoteLinkIndex, navigate: (location: SourceLocation) => void) {
    const card = text('section', '', 'record-card');
    card.append(text('strong', link.alias || link.target || '本頁'), text('p', `${labels[link.status]}${link.embed ? ' · embed' : ''}`, 'section-caption'), text('p', index.catalog.notePaths.get(link.location.noteId) || '', 'record-field'));
    if (link.resolvedTarget) card.append(text('p', link.resolvedTarget.path, 'record-field'));
    if (link.message) card.append(text('p', link.message, 'record-field'));
    if (link.candidates) card.append(text('p', link.candidates.map(t => t.path).join(' / '), 'record-field'));
    card.append(action('查看原文', () => navigate(link.location)));
    if (link.destination) card.append(action('前往目標 ↗', () => navigate(link.destination!)));
    container.append(card);
  }
}
