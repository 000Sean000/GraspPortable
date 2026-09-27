import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parser as markdownParser } from '@lezer/markdown';
import { serializeBinding } from '../src/domain/binding-language';
import { serializeReference } from '../src/domain/reference-language';
import { createSourceBundle, restoreSourceBundle, serializeSourceBundle } from '../src/domain/source-bundle';
import { exportSourceBundleMarkdown } from '../src/domain/markdown-value-export';

// Synthetic examples only. The caller chooses a Scratch output folder outside Git.
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node --import tsx scripts/m1-reading-fixture.ts <Scratch output folder>');
const root = resolve(destination);
const value = '\r\n**Apple** [guide](https://example.com)\\tail | [square]\n\n- first\n- second\n\n```text\n@Fake = <|inert|>\n```\n';
const definitions = [
  serializeBinding('Fruit', [{ kind: 'literal', value }]),
  serializeBinding('Slogan', [{ kind: 'literal', value: 'Before\n' }, { kind: 'identifier', name: 'Fruit' }, { kind: 'literal', value: '\nAfter' }]),
].join('\n\n');
const examples = [
  { name: 'paragraph', surround: (ref: string) => `Before ${ref} after.` },
  { name: 'heading', surround: (ref: string) => `## Before ${ref} after` },
  { name: 'list', surround: (ref: string) => `- Before ${ref} after\n- Next item` },
  { name: 'quote', surround: (ref: string) => `> Before ${ref} after\n\nFollowing paragraph.` },
  { name: 'table', surround: (ref: string) => `| Value | Note |\n| --- | --- |\n| ${ref} | after |` },
];
await mkdir(root, { recursive: true });
const results: Array<Record<string, unknown>> = [];
for (const example of examples) for (const kind of ['pure', 'wiki'] as const) {
  const name = `${example.name}-${kind}`;
  const source = '\uFEFF' + definitions + '\n\n' + example.surround(serializeReference({ kind, identifier: 'Fruit', value })) + '\n';
  const bundle = await createSourceBundle({ noteId: `fixture-${name}`, revision: 1, source });
  const restored = await restoreSourceBundle(serializeSourceBundle(bundle));
  assert.equal(restored.source, source);
  assert.equal(restored.parsed.bindings.length, 2);
  assert.deepEqual(restored.parsed.bindings[1].dependencies, ['Fruit']);
  assert.equal(restored.parsed.references.length, 1);
  assert.equal(restored.parsed.references[0].value, value);
  const output = await exportSourceBundleMarkdown(bundle, {
    filePath: `${name}.md`,
    renderedBindings: [
      { slot: bundle.bindings[0].slot, sourceRevision: 1, status: 'ok', value },
      { slot: bundle.bindings[1].slot, sourceRevision: 1, status: 'ok', value: 'Before\n' + value + '\nAfter' },
    ],
  });
  await writeFile(resolve(root, `${name}.canonical.md`), source, 'utf8');
  await writeFile(resolve(root, `${name}.md`), output.markdown, 'utf8');
  await writeFile(resolve(root, output.sourceBundlePath), output.sourceBundleJson, 'utf8');
  results.push({ name, bindings: 2, references: 1, dependencies: ['Fruit'], sourceUtf16: source.length,
    exactSourceRestored: true, logicalValueRestored: true,
    canonicalHostAst: markdownParser.parse(source).toString(), readableHostAst: markdownParser.parse(output.markdown).toString(),
    desktopReading: 'not verified' });
}
await writeFile(resolve(root, 'checks.json'), JSON.stringify({ kind: 'synthetic-M1-representation', generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
await writeFile(resolve(root, 'README.md'), '# M1 reading fixtures\n\nSynthetic data only. Open this folder as an Obsidian vault to inspect the ten reading files (`paragraph-pure.md`, etc.). Each has a matching `.canonical.md` original and `.source.json` exact source/structure bundle.\n\nThe generator checks raw-source equality, two bindings, the ordered dependency and the complete cached value after bundle restoration. Rendered binding observations are known fixture expectations, not evidence of a runtime evaluator. These are single-note representations, not a workspace fallback or fresh-database rebuild. Desktop reading, link navigation and native IME still require actual UI verification.\n');
console.log(JSON.stringify({ directory: root, examples: results.length, exactSourceAndLogicalValue: 'passed', desktopReading: 'not verified' }));
