import { markdownLanguage } from '@codemirror/lang-markdown';
import type { SyntaxNode } from '@lezer/common';
import { safeLink } from './query';

export interface MarkdownAtom { from: number; to: number; render(): HTMLElement }
export interface MarkdownRenderOptions {
  atoms?: readonly MarkdownAtom[];
  resolveAsset?(url: string): { url: string; name: string; inline: boolean } | undefined;
}

/** DOM-only GFM reading adapter. HTML source is text, never executable markup. */
export function renderMarkdown(source: string, options: MarkdownRenderOptions = {}): HTMLElement {
  const result = document.createElement('div'); result.className = 'gp-rendered-markdown';
  let tokenPrefix = '\ue000grasp:';
  while (source.includes(tokenPrefix)) tokenPrefix += ':';
  const atoms = [...(options.atoms ?? [])].sort((a, b) => a.from - b.from);
  let cursor = 0;
  const chunks: string[] = [];
  for (let index = 0; index < atoms.length; index++) {
    const atom = atoms[index];
    if (atom.from < cursor || atom.to <= atom.from || atom.to > source.length) throw new Error('Invalid reading atom range');
    chunks.push(source.slice(cursor, atom.from), `${tokenPrefix}${index}\ue001`); cursor = atom.to;
  }
  chunks.push(source.slice(cursor));
  const text = chunks.join('');
  const appendText = (parent: HTMLElement, value: string) => {
    let at = 0;
    for (;;) {
      const start = value.indexOf(tokenPrefix, at);
      if (start < 0) { parent.append(document.createTextNode(value.slice(at))); return; }
      parent.append(document.createTextNode(value.slice(at, start)));
      const end = value.indexOf('\ue001', start + tokenPrefix.length);
      if (end < 0) { parent.append(document.createTextNode(value.slice(start))); return; }
      const index = Number(value.slice(start + tokenPrefix.length, end));
      if (Number.isSafeInteger(index) && atoms[index]) parent.append(atoms[index].render());
      else parent.append(document.createTextNode(value.slice(start, end + 1)));
      at = end + 1;
    }
  };
  const children = (node: SyntaxNode, parent: HTMLElement, ignored: Set<string> = marks) => {
    let at = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      appendText(parent, text.slice(at, child.from));
      if (!ignored.has(child.name)) render(child, parent);
      at = child.to;
    }
    appendText(parent, text.slice(at, node.to));
  };
  const render = (node: SyntaxNode, parent: HTMLElement): void => {
    const raw = text.slice(node.from, node.to);
    const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
    const tags: Record<string, keyof HTMLElementTagNameMap> = {
      Paragraph: 'p', Blockquote: 'blockquote', BulletList: 'ul', OrderedList: 'ol', ListItem: 'li',
      StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 'del', Subscript: 'sub', Superscript: 'sup',
      Table: 'table', TableHeader: 'tr', TableRow: 'tr', TableCell: node.parent?.name === 'TableHeader' ? 'th' : 'td',
    };
    if (heading || tags[node.name]) {
      const element = document.createElement(heading ? `h${heading[1]}` : tags[node.name]);
      if (node.name === 'OrderedList') { const start = /^\s*(\d+)/.exec(raw); if (start) (element as HTMLOListElement).start = Number(start[1]); }
      children(node, element);
      if (heading) element.id = `gp-reading-${element.textContent!.trim().toLowerCase().replace(/\s+/g, '-')}`;
      parent.append(element); return;
    }
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      const pre = document.createElement('pre'), code = document.createElement('code');
      const codeText = node.getChildren('CodeText');
      code.textContent = codeText.length ? codeText.map(part => text.slice(part.from, part.to)).join('')
        : node.name === 'CodeBlock' ? raw.replace(/^ {4}/gm, '') : '';
      const info = node.getChild('CodeInfo'); if (info) code.dataset.language = text.slice(info.from, info.to);
      pre.append(code); parent.append(pre); return;
    }
    if (node.name === 'InlineCode') {
      const code = document.createElement('code'); const delimiter = /^`+/.exec(raw)![0];
      let content = raw.slice(delimiter.length, -delimiter.length).replace(/\r\n|\r|\n/g, ' ');
      if (/^ .* $/.test(content) && /[^ ]/.test(content)) content = content.slice(1, -1);
      code.textContent = content; parent.append(code); return;
    }
    if (node.name === 'Link' || node.name === 'Image' || node.name === 'Autolink') {
      const urlNode = node.getChild('URL');
      const url = urlNode ? text.slice(urlNode.from, urlNode.to).replace(/^<|>$/g, '') : '';
      const asset = options.resolveAsset?.(url);
      const href = asset?.url ?? safeLink(url) ?? (url.startsWith('#') ? `#gp-reading-${decodeURIComponentSafe(url.slice(1)).toLowerCase().replace(/\s+/g, '-')}` : null);
      const label = document.createElement('span');
      if (node.name === 'Autolink') label.textContent = raw.replace(/^<|>$/g, ''); else children(node, label, linkMarks);
      if (node.name === 'Image' && href && (asset?.inline || /^https?:\/\//i.test(href))) {
        const image = document.createElement('img'); image.src = href; image.alt = label.textContent ?? ''; image.loading = 'lazy'; parent.append(image); return;
      }
      if (href) {
        const link = document.createElement('a'); link.href = href; link.append(...Array.from(label.childNodes));
        if (href.startsWith('#')) link.addEventListener('click', event => {
          const target = [...result.querySelectorAll<HTMLElement>('[id]')].find(element => element.id === href.slice(1));
          if (target) { event.preventDefault(); target.scrollIntoView({ block: 'start' }); }
        });
        if (asset && !asset.inline) link.download = asset.name;
        else if (!href.startsWith('#')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        parent.append(link);
      } else parent.append(label);
      return;
    }
    if (node.name === 'Escape') { appendText(parent, raw.slice(1)); return; }
    if (node.name === 'Entity') { appendText(parent, decodeEntity(raw)); return; }
    if (node.name === 'HardBreak') { parent.append(document.createElement('br')); return; }
    if (node.name === 'HorizontalRule') { parent.append(document.createElement('hr')); return; }
    if (node.name === 'TaskMarker') {
      const box = document.createElement('input'); box.type = 'checkbox'; box.checked = /x/i.test(raw); box.disabled = true;
      box.setAttribute('aria-label', box.checked ? '已完成' : '未完成'); parent.append(box); return;
    }
    if (/HTML|CommentBlock|ProcessingInstructionBlock/.test(node.name)) { appendText(parent, raw); return; }
    if (node.firstChild) children(node, parent); else appendText(parent, raw);
  };
  children(markdownLanguage.parser.parse(text).topNode, result);
  return result;
}

const marks = new Set(['HeaderMark', 'QuoteMark', 'ListMark', 'EmphasisMark', 'StrikethroughMark', 'SubscriptMark', 'SuperscriptMark', 'TableDelimiter']);
const linkMarks = new Set([...marks, 'LinkMark', 'URL', 'LinkTitle']);
function decodeURIComponentSafe(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
function decodeEntity(value: string): string {
  const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' };
  if (Object.hasOwn(named, value)) return named[value];
  const match = /^&#(x[0-9a-f]+|[0-9]+);$/i.exec(value);
  if (!match) return value;
  const point = match[1][0].toLowerCase() === 'x' ? parseInt(match[1].slice(1), 16) : Number(match[1]);
  return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd';
}
