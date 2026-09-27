import { describe, expect, it } from 'vitest';
import { parser } from '@lezer/markdown';
import { markdownLanguage } from '@codemirror/lang-markdown';

// These assert observed host limitations, not Grasp reference conformance.
// markdownLanguage is the same base passed to markdown() by editor.ts.
const hosts = [
  { name: 'CommonMark (@lezer/markdown)', parser },
  { name: 'current editor base (@codemirror/lang-markdown)', parser: markdownLanguage.parser },
];
const forms = [
  { name: 'pure', wrap: (value: string) => `[${value}](:ref:Text)` },
  { name: 'managed wiki', wrap: (value: string) => `[[@Text|${value}]]` },
];

function inspect(source: string, host: typeof hosts[number]) {
  const tree = host.parser.parse(source);
  const nodes: Array<{ name: string; from: number; to: number; source: string }> = [];
  tree.iterate({ enter(node) { nodes.push({ name: node.name, from: node.from, to: node.to, source: source.slice(node.from, node.to) }); } });
  const blocks = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) blocks.push(node.name);
  return { tree: tree.toString(), blocks, nodes,
    fullLink: nodes.some(node => node.name === 'Link' && node.from === 0 && node.to === source.length),
    managedDestination: nodes.some(node => node.name === 'URL' && node.source === ':ref:Text'),
  };
}

for (const host of hosts) describe(host.name, () => {
  it('keeps a pure reference with one ordinary line ending in one Link (not proof of a visible hard break)', () => {
    const result = inspect(forms[0].wrap('first\nsecond'), host);
    expect(result.blocks).toEqual(['Paragraph']);
    expect(result.fullLink).toBe(true);
    expect(result.managedDestination).toBe(true);
    expect(result.nodes.some(node => node.name === 'HardBreak')).toBe(false);
  });

  for (const form of forms) describe(form.name, () => {
    it.each(['\n', '\r\n'])('splits a blank-line value into two paragraphs for line ending %j', newline => {
      const source = form.wrap(`first${newline}${newline}second`);
      const result = inspect(source, host);
      expect(result.blocks).toEqual(['Paragraph', 'Paragraph']);
      expect(result.nodes.filter(node => node.name === 'Link')).toEqual([]);
      expect(result.managedDestination).toBe(false);
      expect(result.fullLink).toBe(false);
    });

    it('allows a list to become a sibling block rather than content of the managed reference', () => {
      const result = inspect(form.wrap('first\n\n- one\n- two'), host);
      expect(result.blocks).toEqual(['Paragraph', 'BulletList']);
      expect(result.fullLink).toBe(false);
      expect(result.managedDestination).toBe(false);
      const list = result.nodes.find(node => node.name === 'BulletList')!;
      expect(list.source).toBe(`- one\n- two${form.name === 'pure' ? '](:ref:Text)' : ']]'}`);
    });

    it('allows a code fence to become a sibling block and leaves closing reference syntax in another paragraph', () => {
      const result = inspect(form.wrap('first\n\n```ts\nconst n=1;\n```\nlast'), host);
      expect(result.blocks).toEqual(['Paragraph', 'FencedCode', 'Paragraph']);
      expect(result.nodes.find(node => node.name === 'FencedCode')?.source).toBe('```ts\nconst n=1;\n```');
      expect(result.fullLink).toBe(false);
      expect(result.managedDestination).toBe(false);
    });

    it('keeps the inner ordinary link but has no complete outer managed reference', () => {
      const result = inspect(form.wrap('outer [inner](https://example.com)'), host);
      expect(result.nodes.filter(node => node.name === 'Link').map(node => node.source)).toEqual(['[inner](https://example.com)']);
      expect(result.nodes.filter(node => node.name === 'URL').map(node => node.source)).toEqual(['https://example.com']);
      expect(result.fullLink).toBe(false);
      expect(result.managedDestination).toBe(false);
    });

    it('recognizes escaped brackets, pipe and backslash as host Escape nodes without claiming logical-value reconstruction', () => {
      const result = inspect(form.wrap(String.raw`a \[bracket\] \| C:\\tmp`), host);
      expect(result.blocks).toEqual(['Paragraph']);
      expect(result.nodes.filter(node => node.name === 'Escape').map(node => node.source)).toEqual(['\\[', '\\]', '\\|', '\\\\']);
      expect(result.fullLink).toBe(form.name === 'pure');
      expect(result.managedDestination).toBe(form.name === 'pure');
    });
  });

  it('does not treat a single-line managed wiki candidate as a complete wikilink node', () => {
    const source = forms[1].wrap('first');
    const result = inspect(source, host);
    expect(result.fullLink).toBe(false);
    expect(result.managedDestination).toBe(false);
    // Lezer emits an unresolved shortcut-Link candidate for the inner brackets.
    // This is not an Obsidian wikilink parser or proof of a rendered link.
    expect(result.nodes.filter(node => node.name === 'Link').map(node => node.source)).toEqual(['[@Text|first]']);
  });
});

describe('current editor GFM table boundary', () => {
  const host = hosts[1];
  it.each([
    { label: 'pure unescaped value pipe', reference: '[a|b](:ref:Text)', cells: 2, managed: false },
    { label: 'pure escaped value pipe', reference: String.raw`[a\|b](:ref:Text)`, cells: 1, managed: true },
    { label: 'wiki unescaped alias separator', reference: '[[@Text|a]]', cells: 2, managed: false },
    { label: 'wiki escaped alias separator', reference: String.raw`[[@Text\|a]]`, cells: 1, managed: false },
  ])('$label has $cells table cells', ({ reference, cells, managed }) => {
    const source = `| Value |\n| --- |\n| ${reference} |`;
    const result = inspect(source, host);
    const row = result.nodes.find(node => node.name === 'TableRow')!;
    expect(result.blocks).toEqual(['Table']);
    expect(result.nodes.filter(node => node.name === 'TableCell' && node.from >= row.from && node.to <= row.to)).toHaveLength(cells);
    expect(result.managedDestination).toBe(managed);
  });
});
