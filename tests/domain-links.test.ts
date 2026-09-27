import { describe, expect, it } from 'vitest';
import { buildLinkIndex, buildNoteCatalog, parseNoteLinks, type LinkFolder, type LinkNote } from '../src/domain/links';
import { buildKnowledge } from '../src/domain/knowledge';

const note = (id: string, markdown = '', folderId: string | null = null, title = id): LinkNote => ({ id, title, markdown, folderId });
const folders: LinkFolder[] = [
  { id: 'projects', name: 'Projects', parentId: null },
  { id: 'archive', name: 'Archive', parentId: null },
  { id: 'nested', name: 'Nested', parentId: 'projects' },
];

describe('note link source parsing', () => {
  it('preserves exact source spans, aliases, embeds, URLs and CRLF/Unicode line positions', () => {
    const markdown = '中文 😀\r\n[[Projects/Guide#Start|說明]] ![[images/chart.png|120]]\r\n[guide](../Guide%20Two.md#start "title") ![alt](<images/a b.png>)';
    const links = parseNoteLinks(note('source', markdown));
    expect(links.map(link => [link.syntax, link.embed, link.target, link.alias, link.location.line])).toEqual([
      ['wiki', false, 'Projects/Guide#Start', '說明', 2], ['wiki', true, 'images/chart.png', '120', 2],
      ['markdown', false, '../Guide%20Two.md#start', undefined, 3], ['markdown', true, 'images/a b.png', undefined, 3],
    ]);
    for (const link of links) {
      expect(markdown.slice(link.location.from, link.location.to)).toBe(link.raw);
      expect(markdown.slice(link.targetLocation.from, link.targetLocation.to)).toBe(link.target);
    }
  });

  it('excludes escaped wiki links, inline/indented code and nested Markdown code fences', () => {
    const markdown = ['\\[[escaped]]', '`[[inline]] [inline](x.md)`', '> ```md', '> [[quote]]', '> ```', '', '- item', '',
      '  ```', '  [[list]] [list](x.md)', '  ```', '', 'End list.', '', '    [[indent]]', '', '<!-- [[comment]] -->', '', '[[visible]]'].join('\n');
    expect(parseNoteLinks(note('source', markdown)).map(link => link.target)).toEqual(['visible']);
  });

  it('supports reference-style Markdown through its actual URL span and does not turn bracketed prose into a link', () => {
    const markdown = '[guide][DOC] [doc][] [doc] [plain]\n\n[doc]: <Folder/Guide.md> "title"';
    const links = parseNoteLinks(note('source', markdown));
    expect(links).toHaveLength(3);
    expect(links.map(link => link.raw)).toEqual(['[guide][DOC]', '[doc][]', '[doc]']);
    for (const link of links) expect(markdown.slice(link.targetLocation.from, link.targetLocation.to)).toBe('Folder/Guide.md');
  });

  it('handles long malformed delimiters and whitespace without interpreting nested wiki syntax', () => {
    const source = '['.repeat(100_000) + '\n' + ' '.repeat(100_000) + '\n\n[[valid]]';
    expect(parseNoteLinks(note('source', source)).map(link => link.target)).toEqual(['valid']);
  });

  it('does not add note links to identifier definitions, values, or dependencies', () => {
    const source = note('source', '@value = "hello"\n{{value}} [[value]]');
    const knowledge = buildKnowledge([{ ...source, folderId: null, revision: 1, updatedAt: '' }]);
    expect(knowledge.definitions.map(item => item.name)).toEqual(['value']);
    expect(knowledge.references.map(item => item.name)).toEqual(['value']);
    expect(parseNoteLinks(source).map(item => item.target)).toEqual(['value']);
  });
});

describe('logical paths, resolution and backlinks', () => {
  it('resolves root-qualified wiki paths, source-relative Markdown paths and explicit relative paths before basename', () => {
    const index = buildLinkIndex([
      note('source', '[[Projects/Guide]] [[../Guide]] [relative](../Guide.md) [[/Archive/Guide]] [[Unique]]', 'nested'),
      note('project-guide', '', 'projects', 'Guide'), note('archive-guide', '', 'archive', 'Guide'), note('unique', '', 'archive', 'Unique'),
    ], folders);
    expect(index.byNote.get('source')!.map(link => [link.status, link.targetNoteId])).toEqual([
      ['resolved', 'project-guide'], ['resolved', 'project-guide'], ['resolved', 'project-guide'], ['resolved', 'archive-guide'], ['resolved', 'unique'],
    ]);
    expect(index.catalog.notePaths.get('source')).toBe('Projects/Nested/source.md');
    expect(index.backlinks.get('project-guide')).toHaveLength(3);
    expect(index.links[0].destination).toEqual({ noteId: 'project-guide', from: 0, to: 0, line: 1 });
  });

  it('never guesses ambiguous basenames or falls back from an explicit wrong path', () => {
    const index = buildLinkIndex([note('source', '[[Guide]] [[Missing/Guide]] [[./Guide]]'),
      note('a', '', 'projects', 'Guide'), note('b', '', 'archive', 'Guide')], folders);
    expect(index.byNote.get('source')!.map(link => link.status)).toEqual(['ambiguous', 'missing', 'missing']);
    expect(index.links[0].candidates!.map(target => target.id)).toEqual(['a', 'b']);
    expect(index.backlinks.size).toBe(0);
    expect(index.diagnostics.map(item => item.kind)).toEqual(['ambiguous', 'missing', 'missing']);
  });

  it('does not create a self backlink from an empty wiki placeholder', () => {
    const index = buildLinkIndex([note('source', '[[]] [[ |label]]')]);
    expect(index.links.map(link => link.status)).toEqual(['unsupported', 'unsupported']);
    expect(index.backlinks.size).toBe(0);
  });

  it('prefers a source sibling and then a root note before a unique-basename lookup', () => {
    const index = buildLinkIndex([note('source', '[[Guide]] [[Root]]', 'projects'), note('sibling', '', 'projects', 'Guide'),
      note('root-guide', '', null, 'Guide'), note('other', '', 'archive', 'Guide'), note('root', '', null, 'Root'), note('other-root', '', 'archive', 'Root')], folders);
    expect(index.links.map(link => link.targetNoteId)).toEqual(['sibling', 'root']);
  });

  it('diagnoses case/Unicode path collisions and prototype names without corrupting the index', () => {
    const index = buildLinkIndex([note('source', '[[Guide]] [[constructor]] [[café]]'), note('a', '', null, 'Guide'), note('b', '', null, 'guide'),
      note('__proto__', '', null, 'constructor'), note('c', '', null, 'café'), note('d', '', null, 'cafe\u0301')]);
    expect(index.links.map(link => link.status)).toEqual(['ambiguous', 'resolved', 'ambiguous']);
    expect(index.backlinks.get('__proto__')).toHaveLength(1);
    expect(index.catalog.diagnostics.filter(item => item.kind === 'collision')).toHaveLength(2);
  });

  it('resolves heading and block positions, reports missing/duplicate anchors, and keeps backlinks to their note', () => {
    const markdown = '# Intro\r\n\r\n## A **formatted** heading\r\n\r\nparagraph ^block-1\r\n\r\n## Again\r\n\r\n## Again\r\n';
    const index = buildLinkIndex([note('source', '[[target#Intro]] [[target#a-formatted-heading]] [[target#^block-1]] [[target#no]] [[target#Again]] [[target#Intro#Child]]'), note('target', markdown)]);
    expect(index.links.map(link => link.status)).toEqual(['resolved', 'resolved', 'resolved', 'missing', 'ambiguous', 'unsupported']);
    expect(index.links.slice(0, 3).map(link => markdown.slice(link.destination!.from, link.destination!.to))).toEqual(['# Intro\r', '## A **formatted** heading\r', 'paragraph ^block-1\r']);
    expect(index.backlinks.get('target')).toHaveLength(6);
  });

  it('resolves self headings and Setext headings while ignoring block IDs inside code', () => {
    const index = buildLinkIndex([note('source', 'Title\n=====\n\n[#](#Title) [[#^real]] [[#^fake]]\n\n  body ^real\n\n```\nfake ^fake\n```')]);
    expect(index.links.map(link => link.status)).toEqual(['resolved', 'resolved', 'missing']);
    expect(index.links[0].destination!.line).toBe(1);
    expect(index.links[1].destination!.line).toBe(6);
  });

  it('keeps literal intraword underscores distinct from formatting when matching headings', () => {
    const index = buildLinkIndex([note('source', '[[target#A_b]] [[target#Ab]]'), note('target', '# A_b\n\n# Ab')]);
    expect(index.links.map(link => link.status)).toEqual(['resolved', 'resolved']);
    expect(index.links.map(link => link.destination!.line)).toEqual([1, 3]);
  });

  it('resolves asset metadata without conflating asset IDs with note IDs', () => {
    const index = buildLinkIndex([note('same', '[[target]] ![[images/chart.png]] [image](./images/chart.png)'), note('target')], [], [{ id: 'target', path: 'images/chart.png', mediaType: 'image/png' }]);
    expect(index.links.map(link => [link.status, link.resolvedTarget!.kind])).toEqual([['resolved', 'note'], ['resolved', 'asset'], ['resolved', 'asset']]);
    expect(index.backlinks.get('target')).toHaveLength(1);
    expect(index.assetBacklinks.get('target')).toHaveLength(2);
    expect(index.links[1].resolvedTarget!.mediaType).toBe('image/png');
  });

  it('resolves canonical grasp-asset addresses only against owned attachment metadata', () => {
    const index = buildLinkIndex([note('n', '![image](grasp-asset:owned) [missing](grasp-asset:absent)')], [], [{ id: 'owned', path: 'images/chart.png' }]);
    expect(index.links.map(link => link.status)).toEqual(['resolved', 'missing']);
    expect(index.links[0].resolvedTarget!.id).toBe('owned');
    expect(index.assetBacklinks.get('owned')).toHaveLength(1);
  });

  it('handles encoded filenames, literal percent/wiki titles, external links and unsafe traversal/schemes explicitly', () => {
    const markdown = '[one](A%20B.md) [hash](A%23B.md) [[100%]] [bad](bad%ZZ.md) [[../../outside]] [bad](javascript:alert) [site](https://example.com) [file](file:///tmp/x) [encoded](%6Aavascript:bad) [query](A.md?x=1)';
    const index = buildLinkIndex([note('source', markdown), note('a', '', null, 'A B'), note('hash', '', null, 'A#B'), note('pct', '', null, '100%')]);
    expect(index.links.map(link => link.status)).toEqual(['resolved', 'resolved', 'resolved', 'unsupported', 'unsafe', 'unsafe', 'external', 'unsafe', 'unsafe', 'unsupported']);
    expect(index.links.slice(0, 3).map(link => link.targetNoteId)).toEqual(['a', 'hash', 'pct']);
  });

  it('reuses parsing but recomputes resolution and anchors after note/folder moves and edits without mutating input', () => {
    const notes = [note('source', '[[Projects/Guide#Start]] [[Guide]]'), note('target', '# Start', 'projects', 'Guide')];
    const before = JSON.stringify({ notes, folders });
    const first = buildLinkIndex(notes, folders);
    const moved = folders.map(folder => folder.id === 'projects' ? { ...folder, name: 'Moved' } : folder);
    const second = buildLinkIndex(notes, moved, [], first);
    expect(second.parseCache.get('source')).toBe(first.parseCache.get('source'));
    expect(second.links.map(link => link.status)).toEqual(['missing', 'resolved']);
    expect(second.catalog.notePaths.get('target')).toBe('Moved/Guide.md');
    const third = buildLinkIndex([notes[0], { ...notes[1], markdown: '# Different' }], folders, [], second);
    expect(third.parseCache.get('target')).not.toBe(second.parseCache.get('target'));
    expect(third.links[0].status).toBe('missing');
    expect(first.links[0].status).toBe('resolved');
    expect(JSON.stringify({ notes, folders })).toBe(before);
  });

  it('rejects missing/cyclic folder ancestry and invalid note components without assigning false root paths', () => {
    const badFolders = [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }, { id: 'child', name: 'Child', parentId: 'a' }, { id: 'missing', name: 'Missing', parentId: 'unknown' }];
    const catalog = buildNoteCatalog([note('a', '', 'a'), note('b', '', 'child'), note('c', '', 'missing'), note('bad', '', null, '../escape'), note('ok')], badFolders);
    expect([...catalog.notePaths.keys()]).toEqual(['ok']);
    expect(catalog.diagnostics.filter(item => item.kind === 'invalid-folder')).toHaveLength(4);
  });

  it('handles a deep folder chain iteratively and excludes duplicated stable IDs', () => {
    const deep = Array.from({ length: 2_000 }, (_, i) => ({ id: `f${i}`, name: 'x', parentId: i ? `f${i - 1}` : null }));
    const catalog = buildNoteCatalog([note('deep', '', 'f1999'), note('duplicate'), note('duplicate')], [...deep].reverse());
    expect(catalog.notePaths.get('deep')!.split('/')).toHaveLength(2_001);
    expect(catalog.notePaths.has('duplicate')).toBe(false);
  });

  it('indexes 3,000 synthetic notes with 9,000 links and reuses all unchanged parses', () => {
    const notes = Array.from({ length: 3_000 }, (_, i) => note(`N${i}`, `# Heading\n[[N${(i + 1) % 3000}]] [[N${(i + 2) % 3000}#Heading]] [[N${(i + 3) % 3000}]]`));
    const start = performance.now();
    const first = buildLinkIndex(notes);
    const coldMs = performance.now() - start;
    const warmStart = performance.now();
    const second = buildLinkIndex(notes, [], [], first);
    const warmMs = performance.now() - warmStart;
    expect(first.links).toHaveLength(9_000);
    expect(first.diagnostics).toEqual([]);
    expect(first.backlinks.size).toBe(3_000);
    expect([...first.backlinks.values()].every(links => links.length === 3)).toBe(true);
    expect(notes.every(note => second.parseCache.get(note.id) === first.parseCache.get(note.id))).toBe(true);
    expect(second.links.map(link => link.status)).toEqual(first.links.map(link => link.status));
    console.info(JSON.stringify({ benchmark: 'note-links', notes: notes.length, links: first.links.length, coldMs: Number(coldMs.toFixed(2)), warmMs: Number(warmMs.toFixed(2)) }));
  });
});
