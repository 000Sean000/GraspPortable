import { describe, expect, it } from 'vitest';
import { indexKnowledge, dependentNames } from '../src/app/knowledge-panel';
import { ValueGraph } from '../src/domain/graph';
import { buildKnowledge } from '../src/domain/knowledge';
import type { Note } from '../src/domain/model';

const note = (id: string, markdown: string): Note => ({ id, title: id, markdown, folderId: null, revision: 1, updatedAt: '' });
describe('complete knowledge management index', () => {
  it('retains all duplicate sources and missing references, and separates occurrence kinds', () => {
    const knowledge = buildKnowledge([note('a', '@name = "A"\n@label = "{name} {name}"\n{{name}} {{unknown}}'), note('b', '@name = "B"\n{{name}}')]);
    const index = indexKnowledge(new ValueGraph().update(knowledge, 1));
    expect(index.get('name')!.definitions.map(d => d.location.noteId)).toEqual(['a', 'b']);
    expect(index.get('name')!.issues.has('duplicate')).toBe(true);
    expect(index.get('unknown')!.issues.has('missing')).toBe(true);
    expect(index.get('name')!.references.map(r => [r.reference.location.noteId, r.reference.kind, r.occurrence])).toEqual([['a', 'dependency', 0], ['a', 'dependency', 1], ['a', 'reference', 0], ['b', 'reference', 0]]);
    expect([...dependentNames(index, 'name')]).toEqual(['label']);
  });
  it('keeps all high-fanout references and traverses cyclic downstream impact without recursion', () => {
    const source = '@root = "x"\n@a = "{root}{b}"\n@b = "{a}"\n' + Array.from({ length: 1500 }, () => '{{root}}').join(' ');
    const index = indexKnowledge(new ValueGraph().update(buildKnowledge([note('n', source)]), 1));
    expect(index.get('root')!.references).toHaveLength(1501);
    expect([...dependentNames(index, 'root')].sort()).toEqual(['a', 'b']);
    expect(index.get('root')!.references.at(-1)!.occurrence).toBe(1499);
  });
});
