import { parser as markdownParser } from '@lezer/markdown';
import type { SourceLocation } from './model';

/** Note links and asset paths are independent of the Value Language namespace. */
export interface LinkNote { id: string; title: string; markdown: string; folderId?: string | null }
export interface LinkFolder { id: string; name: string; parentId: string | null }
export interface LinkAsset { id: string; path: string; mediaType?: string }
export interface LinkTarget { kind: 'note' | 'asset'; id: string; path: string; title: string; mediaType?: string }
export interface ParsedNoteLink {
  syntax: 'wiki' | 'markdown'; embed: boolean; raw: string; target: string; alias?: string;
  location: SourceLocation; targetLocation: SourceLocation; unsupportedReason?: string;
}
export type LinkStatus = 'resolved' | 'missing' | 'ambiguous' | 'external' | 'unsafe' | 'unsupported';
export interface ResolvedNoteLink extends ParsedNoteLink {
  status: LinkStatus; targetNoteId?: string; resolvedTarget?: LinkTarget;
  destination?: SourceLocation; candidates?: LinkTarget[]; message?: string;
}
export interface LinkDiagnostic {
  kind: 'invalid-folder' | 'invalid-path' | 'collision' | 'missing' | 'ambiguous' | 'unsafe' | 'unsupported';
  message: string; location?: SourceLocation; noteId?: string; folderId?: string;
}
interface Anchor { text: string; slug: string; level: number; location: SourceLocation; block: boolean }
interface NoteLinkParse { markdown: string; links: ParsedNoteLink[]; anchors: Anchor[] }
export interface NoteCatalog {
  notePaths: Map<string, string>; folderPaths: Map<string, string>; targets: LinkTarget[];
  byPath: Map<string, LinkTarget[]>; byBasename: Map<string, LinkTarget[]>; diagnostics: LinkDiagnostic[];
}
export interface NoteLinkIndex {
  catalog: NoteCatalog; links: ResolvedNoteLink[]; byNote: Map<string, ResolvedNoteLink[]>;
  backlinks: Map<string, ResolvedNoteLink[]>; assetBacklinks: Map<string, ResolvedNoteLink[]>;
  diagnostics: LinkDiagnostic[]; parseCache: Map<string, NoteLinkParse>;
}

const key = (value: string): string => value.normalize('NFC').toLowerCase();
const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const directory = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const withoutMd = (path: string): string => path.replace(/\.md$/i, '');
const markdownUnescape = (value: string): string => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');

function append<K, V>(map: Map<K, V[]>, name: K, value: V): void {
  const existing = map.get(name);
  if (existing) existing.push(value); else map.set(name, [value]);
}
function escaped(source: string, at: number): boolean {
  let slashes = 0;
  while (at > 0 && source[--at] === '\\') slashes++;
  return slashes % 2 === 1;
}
function lineLocator(noteId: string, source: string): (from: number, to: number) => SourceLocation {
  const starts = [0];
  for (let at = 0; at < source.length; at++) if (source[at] === '\n') starts.push(at + 1);
  return (from, to) => {
    let lo = 0, hi = starts.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (starts[mid] <= from) lo = mid; else hi = mid; }
    return { noteId, from, to, line: lo + 1 };
  };
}
function headingText(value: string): string {
  return markdownUnescape(value.replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]+)`+/g, '$1').replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(?<!\w)([*_])(?=\S)(.*?)\1(?!\w)/g, '$2')).trim();
}
function slug(value: string): string {
  return key(value).replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-');
}

function parseLinksAndAnchors(note: LinkNote): NoteLinkParse {
  const source = note.markdown;
  const location = lineLocator(note.id, source);
  const mask = new Uint8Array(source.length);
  const links: ParsedNoteLink[] = [];
  const anchors: Anchor[] = [];
  const markdownLinks: { from: number; to: number; embed: boolean; url?: { from: number; to: number }; label?: string }[] = [];
  const definitions = new Map<string, { from: number; to: number }>();
  const normalizeLabel = (label: string): string => key(markdownUnescape(label).trim().replace(/\s+/g, ' '));
  const tree = markdownParser.parse(source);
  tree.iterate({ enter(node) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag', 'Comment', 'CommentBlock', 'ProcessingInstruction', 'ProcessingInstructionBlock'].includes(node.name)) {
      mask.fill(1, node.from, node.to);
      return false;
    }
    if (/^(ATX|Setext)Heading[1-6]$/.test(node.name)) {
      const raw = source.slice(node.from, node.to);
      const text = headingText(node.name.startsWith('ATX') ? raw.replace(/^#{1,6}\s*/, '').replace(/\s+#+\s*$/, '') : raw.replace(/\r?\n[=-]+\s*$/, ''));
      anchors.push({ text, slug: slug(text), level: Number(node.name.at(-1)), location: location(node.from, node.to), block: false });
    }
    if (node.name === 'LinkReference') {
      const label = node.node.getChild('LinkLabel');
      const url = node.node.getChild('URL');
      if (label && url) {
        const name = normalizeLabel(source.slice(label.from + 1, label.to - 1));
        if (!definitions.has(name)) definitions.set(name, { from: url.from, to: url.to });
      }
      mask.fill(1, node.from, node.to);
      return false;
    }
    if (node.name === 'Link' || node.name === 'Image') {
      const url = node.node.getChild('URL');
      const label = node.node.getChild('LinkLabel');
      const raw = source.slice(node.from, node.to);
      // Lezer also represents bare [text] and the inside of [[wikilinks]] as Link nodes.
      const reference = label ? source.slice(label.from + 1, label.to - 1) : undefined;
      const visible = /^!?\[([^\]]*)\]/.exec(raw)?.[1];
      markdownLinks.push({ from: node.from, to: node.to, embed: node.name === 'Image',
        url: url ? { from: url.from, to: url.to } : undefined,
        label: normalizeLabel(reference || visible || '') });
    }
  } });
  // Wiki syntax is deliberately separate from the Markdown parser adapter.
  // Excluding a nested '[' also prevents quadratic rescans of malformed openers.
  const wiki = /(!?)\[\[([^\[\]\r\n]*)\]\]/g;
  for (const match of source.matchAll(wiki)) {
    const from = match.index;
    if (mask[from] || escaped(source, from)) continue;
    const body = match[2];
    let divider = -1;
    for (let at = 0; at < body.length; at++) if (body[at] === '|' && !escaped(body, at)) { divider = at; break; }
    const rawTarget = divider < 0 ? body : body.slice(0, divider);
    const targetFrom = from + match[1].length + 2;
    links.push({ syntax: 'wiki', embed: !!match[1], raw: match[0], target: markdownUnescape(rawTarget.trim()),
      alias: divider < 0 ? undefined : markdownUnescape(body.slice(divider + 1)),
      location: location(from, from + match[0].length), targetLocation: location(targetFrom, targetFrom + rawTarget.length) });
    mask.fill(1, from, from + match[0].length);
  }
  for (const link of markdownLinks) {
    if (mask[link.from]) continue;
    const url = link.url ?? definitions.get(link.label ?? '');
    if (!url) continue; // Plain bracketed prose is not a static link.
    let { from, to } = url;
    if (source[from] === '<' && source[to - 1] === '>') { from++; to--; }
    links.push({ syntax: 'markdown', embed: link.embed, raw: source.slice(link.from, link.to),
      target: markdownUnescape(source.slice(from, to)), location: location(link.from, link.to), targetLocation: location(from, to) });
  }
  // A block ID selects its containing source line. Code/HTML and link syntax cannot define blocks.
  const block = /\^([A-Za-z0-9-]+)[ \t]*\r?$/gm;
  for (const match of source.matchAll(block)) {
    const from = source.lastIndexOf('\n', match.index) + 1;
    if (!mask[match.index] && /[ \t]/.test(source[match.index - 1] ?? '')) anchors.push({ text: match[1], slug: match[1], level: 0, block: true, location: location(from, match.index + match[0].length) });
  }
  links.sort((a, b) => a.location.from - b.location.from);
  return { markdown: source, links, anchors };
}

/** Exact UTF-16 spans; this function never rewrites or evaluates Markdown. */
export function parseNoteLinks(note: LinkNote): ParsedNoteLink[] { return parseLinksAndAnchors(note).links; }

function validComponent(name: string): boolean {
  return !!name.trim() && name !== '.' && name !== '..' && !/[\\/\u0000-\u001f]/.test(name);
}
/** Resolve dot segments lexically, rejecting traversal outside the logical workspace. */
function normalizePath(path: string, base = ''): string | undefined {
  const parts = path.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return undefined; parts.pop(); }
    else if (/[\u0000-\u001f]/.test(part)) return undefined;
    else parts.push(part.normalize('NFC'));
  }
  return parts.join('/');
}

/** Stable IDs produce logical paths; invalid ancestry never silently puts a note in the root. */
export function buildNoteCatalog(notes: readonly LinkNote[], folders: readonly LinkFolder[] = [], assets: readonly LinkAsset[] = []): NoteCatalog {
  const catalog: NoteCatalog = { notePaths: new Map(), folderPaths: new Map(), targets: [], byPath: new Map(), byBasename: new Map(), diagnostics: [] };
  const folderMap = new Map<string, LinkFolder>();
  const invalid = new Set<string>();
  for (const folder of folders) {
    if (folderMap.has(folder.id)) { invalid.add(folder.id); catalog.diagnostics.push({ kind: 'invalid-folder', folderId: folder.id, message: 'Duplicate folder ID.' }); }
    folderMap.set(folder.id, folder);
  }
  for (const folder of folders) {
    if (catalog.folderPaths.has(folder.id) || invalid.has(folder.id)) continue;
    const chain: LinkFolder[] = [], visited = new Set<string>();
    let at: string | null = folder.id;
    let failure = '';
    while (at !== null && !catalog.folderPaths.has(at)) {
      if (invalid.has(at)) { failure = 'Folder ancestry is invalid.'; break; }
      if (visited.has(at)) { failure = 'Folder ancestry contains a cycle.'; break; }
      const item = folderMap.get(at);
      if (!item) { failure = 'Parent folder is missing.'; break; }
      visited.add(at); chain.push(item);
      if (!validComponent(item.name)) { failure = 'Folder name is not a single valid path component.'; break; }
      at = item.parentId;
    }
    if (failure) {
      for (const item of chain) { invalid.add(item.id); catalog.diagnostics.push({ kind: 'invalid-folder', folderId: item.id, message: failure }); }
      continue;
    }
    let path = at === null ? '' : catalog.folderPaths.get(at)!;
    for (let i = chain.length - 1; i >= 0; i--) {
      path = path ? `${path}/${chain[i].name}` : chain[i].name;
      catalog.folderPaths.set(chain[i].id, path);
    }
  }
  const seenNoteIds = new Set<string>();
  const duplicateNoteIds = new Set<string>();
  for (const note of notes) { if (seenNoteIds.has(note.id)) duplicateNoteIds.add(note.id); seenNoteIds.add(note.id); }
  const addTarget = (target: LinkTarget): void => {
    catalog.targets.push(target);
    append(catalog.byPath, key(target.path), target);
    append(catalog.byBasename, key(target.kind === 'note' ? withoutMd(basename(target.path)) : basename(target.path)), target);
  };
  for (const note of notes) {
    if (duplicateNoteIds.has(note.id) || !validComponent(note.title) || (note.folderId != null && !catalog.folderPaths.has(note.folderId))) {
      catalog.diagnostics.push({ kind: 'invalid-path', noteId: note.id, message: 'Note has a duplicate ID, invalid title, or invalid folder ancestry.' });
      continue;
    }
    const prefix = note.folderId == null ? '' : catalog.folderPaths.get(note.folderId)!;
    const filename = /\.md$/i.test(note.title) ? note.title : `${note.title}.md`;
    const path = prefix ? `${prefix}/${filename}` : filename;
    catalog.notePaths.set(note.id, path);
    addTarget({ kind: 'note', id: note.id, title: note.title, path });
  }
  const assetIds = new Set<string>();
  const duplicateAssetIds = new Set<string>();
  for (const asset of assets) { if (assetIds.has(asset.id)) duplicateAssetIds.add(asset.id); assetIds.add(asset.id); }
  for (const asset of assets) {
    const path = normalizePath(asset.path);
    if (!path || duplicateAssetIds.has(asset.id) || /^[a-z][a-z\d+.-]*:/i.test(path)) {
      catalog.diagnostics.push({ kind: 'invalid-path', message: 'Asset has an invalid path or duplicate ID.' }); continue;
    }
    addTarget({ kind: 'asset', id: asset.id, path, title: basename(path), mediaType: asset.mediaType });
  }
  for (const targets of catalog.byPath.values()) if (targets.length > 1) catalog.diagnostics.push({ kind: 'collision', message: `More than one target has the path “${targets[0].path}”.` });
  return catalog;
}

function candidatesAt(catalog: NoteCatalog, path: string): LinkTarget[] {
  const matches = [...catalog.byPath.get(key(path)) ?? []];
  if (!/\.md$/i.test(path)) for (const target of catalog.byPath.get(key(`${path}.md`)) ?? []) if (target.kind === 'note') matches.push(target);
  return matches;
}
function resolveAnchor(target: LinkTarget, fragment: string, cache: Map<string, NoteLinkParse>): Pick<ResolvedNoteLink, 'status' | 'destination' | 'message'> {
  if (!fragment) return { status: 'resolved', destination: target.kind === 'note' ? { noteId: target.id, from: 0, to: 0, line: 1 } : undefined };
  if (target.kind === 'asset') return { status: 'unsupported', message: 'Asset fragments are preserved but are not navigable yet.' };
  if (fragment.includes('#')) return { status: 'unsupported', message: 'Nested heading fragments are preserved but are not navigable yet.' };
  const block = fragment.startsWith('^');
  const name = block ? fragment.slice(1) : headingText(fragment);
  const anchors = cache.get(target.id)?.anchors ?? [];
  let matches = anchors.filter(anchor => anchor.block === block && key(anchor.text) === key(name));
  if (!matches.length && !block) matches = anchors.filter(anchor => !anchor.block && anchor.slug === key(fragment));
  if (matches.length === 1) return { status: 'resolved', destination: matches[0].location };
  return { status: matches.length ? 'ambiguous' : 'missing', message: matches.length ? 'Heading or block anchor is ambiguous.' : 'Heading or block anchor is missing.' };
}

function resolveLink(link: ParsedNoteLink, catalog: NoteCatalog, cache: Map<string, NoteLinkParse>): ResolvedNoteLink {
  const result: ResolvedNoteLink = { ...link, status: 'missing' };
  const input = link.target.trim();
  if (!input) return { ...result, status: 'unsupported', message: 'Link destination is empty.' };
  if (input.startsWith('grasp-asset:')) {
    const id = input.slice('grasp-asset:'.length);
    const candidates = catalog.targets.filter(target => target.kind === 'asset' && target.id === id);
    if (candidates.length === 1) return { ...result, status: 'resolved', resolvedTarget: candidates[0] };
    return { ...result, status: candidates.length ? 'ambiguous' : 'missing', message: 'Owned attachment ID is missing or ambiguous.', ...(candidates.length ? { candidates } : {}) };
  }
  if (/[\u0000-\u001f]/.test(input)) return { ...result, status: 'unsafe', message: 'Control characters are not allowed in links.' };
  if (/^[a-z][a-z\d+.-]*:/i.test(input) || input.startsWith('//')) {
    const safe = /^(https?:\/\/|mailto:)/i.test(input) || input.startsWith('//');
    return { ...result, status: safe ? 'external' : 'unsafe', message: safe ? undefined : 'This URL scheme is not navigable.' };
  }
  if (/[{}]/.test(input)) return { ...result, status: 'unsupported', message: 'Dynamic link destinations are not resolved as note paths.' };
  const hash = input.indexOf('#');
  let path = hash < 0 ? input : input.slice(0, hash);
  let fragment = hash < 0 ? '' : input.slice(hash + 1);
  try { path = decodeURIComponent(path); fragment = decodeURIComponent(fragment); }
  catch { if (link.syntax === 'markdown') return { ...result, status: 'unsupported', message: 'Malformed URL encoding.' }; }
  path = path.replace(/\\/g, '/');
  if (/[\u0000-\u001f]/.test(path + fragment) || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('//')) return { ...result, status: 'unsafe', message: 'Link contains an unsafe path or encoded URL scheme.' };
  if (path.includes('?')) return { ...result, status: 'unsupported', message: 'Local links with query parameters are not supported.' };
  const sourcePath = catalog.notePaths.get(link.location.noteId);
  if (!sourcePath) return { ...result, message: 'Source note has no valid logical path.' };
  const relative = path.startsWith('./') || path.startsWith('../');
  const root = path.startsWith('/');
  const qualified = path.includes('/');
  let candidates: LinkTarget[] = [];
  if (!path) candidates = catalog.byPath.get(key(sourcePath))?.filter(item => item.kind === 'note' && item.id === link.location.noteId) ?? [];
  else if (relative || root || (qualified && link.syntax === 'markdown')) {
    const normalized = normalizePath(path, root ? '' : directory(sourcePath));
    if (normalized === undefined) return { ...result, status: 'unsafe', message: 'Link escapes the workspace root.' };
    candidates = candidatesAt(catalog, normalized);
  } else if (qualified) {
    const normalized = normalizePath(path);
    if (normalized === undefined) return { ...result, status: 'unsafe', message: 'Link escapes the workspace root.' };
    candidates = candidatesAt(catalog, normalized);
  } else {
    const normalized = normalizePath(path, directory(sourcePath));
    if (normalized === undefined) return { ...result, status: 'unsafe', message: 'Link escapes the workspace root.' };
    candidates = candidatesAt(catalog, normalized);
    if (!candidates.length) candidates = candidatesAt(catalog, path);
    if (!candidates.length) candidates = catalog.byBasename.get(key(withoutMd(path))) ?? [];
  }
  if (candidates.length !== 1) return { ...result, status: candidates.length ? 'ambiguous' : 'missing', candidates: candidates.length ? candidates : undefined,
    message: candidates.length ? 'Multiple targets match this link; qualify its path.' : 'Link target is missing.' };
  const target = candidates[0];
  return { ...result, resolvedTarget: target, targetNoteId: target.kind === 'note' ? target.id : undefined, ...resolveAnchor(target, fragment, cache) };
}

/** Reuse the previous index to parse only changed Markdown. Resolution always uses current paths. */
export function buildLinkIndex(notes: readonly LinkNote[], folders: readonly LinkFolder[] = [], assets: readonly LinkAsset[] = [], previous?: NoteLinkIndex): NoteLinkIndex {
  const catalog = buildNoteCatalog(notes, folders, assets);
  const index: NoteLinkIndex = { catalog, links: [], byNote: new Map(), backlinks: new Map(), assetBacklinks: new Map(), diagnostics: [...catalog.diagnostics], parseCache: new Map() };
  for (const note of notes) {
    const cached = previous?.parseCache.get(note.id);
    index.parseCache.set(note.id, cached?.markdown === note.markdown ? cached : parseLinksAndAnchors(note));
  }
  for (const note of notes) {
    const resolved: ResolvedNoteLink[] = [];
    for (const link of index.parseCache.get(note.id)!.links) {
      const entry = resolveLink(link, catalog, index.parseCache);
      resolved.push(entry); index.links.push(entry);
      if (entry.resolvedTarget) append(entry.resolvedTarget.kind === 'note' ? index.backlinks : index.assetBacklinks, entry.resolvedTarget.id, entry);
      if (entry.status !== 'resolved' && entry.status !== 'external') index.diagnostics.push({ kind: entry.status, message: entry.message ?? entry.status, location: entry.location });
    }
    index.byNote.set(note.id, resolved);
  }
  return index;
}
