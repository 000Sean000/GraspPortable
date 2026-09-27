import { describe, expect, it } from 'vitest';
import { buildKnowledge } from '../src/domain/knowledge';
import { ValueGraph } from '../src/domain/graph';
import { planRename } from '../src/domain/rename';
import type { Note, StructuredRecord, WorkspaceSnapshot } from '../src/domain/model';

const note = (id: string, markdown: string): Note => ({ id, title: id, markdown, folderId: null, revision: 1, updatedAt: '' });
const record = (id: string, collection: string, name: string, fields: Record<string, string>): StructuredRecord => ({ id, collection, name, fields, revision: 1 });
const snapshot = (notes: Note[], records: StructuredRecord[] = []): WorkspaceSnapshot => ({ id: 'workspace', name: 'Test', revision: 7, notes, records, folders: [], settings: {} });
const rename = (from: string, to: string, mode: 'identifier' | 'namespace' = 'identifier') => ({ from, to, mode });

describe('semantic identifier rename', () => {
  it('rewrites only exact parsed declaration/dependency/body tokens, preserving unrelated bytes and whitespace', () => {
    const source = '  @ old \t = "first"\r\n@label = "\\u4f60 {old} \\" quote"\r\n{{old}} plain old [[old]] `{{old}}` \\{{old}}\r\n\r\n```\n@old = "code"\n{{old}}\n```\n';
    const input = snapshot([note('n', source)]);
    const plan = planRename(input, rename('old', 'new'));
    expect(plan.canApply).toBe(true);
    expect(plan.notes[0].markdown).toBe(source.replace('@ old', '@ new').replace('{old} \\"', '{new} \\"').replace('{{old}} plain', '{{new}} plain'));
    expect(plan.renames).toEqual([{ from: 'old', to: 'new', definitions: 1, references: 2 }]);
    expect(input.notes[0].markdown).toBe(source);
    expect(plan.changes[0].edits.map(edit => edit.kind)).toEqual(['declaration', 'dependency', 'reference']);
    for (const edit of plan.changes[0].edits) expect(source.slice(edit.from, edit.to)).toBe(edit.before);
  });

  it('maps decoded JSON unicode offsets while preserving escaped braces, backslashes and surrounding escapes verbatim', () => {
    const source = '@old = "V"\r\n@label = "\\u4f60\\n\\\"\\u007bold\\u007d {o\\u006cd} {{old}} \\\\ end"\r\n{{label}}';
    const plan = planRename(snapshot([note('n', source)]), rename('old', 'fresh'));
    expect(plan.canApply).toBe(true);
    expect(plan.notes[0].markdown).toBe('@fresh = "V"\r\n@label = "\\u4f60\\n\\\"\\u007bfresh\\u007d {fresh} {{old}} \\\\ end"\r\n{{label}}');
    const edits = plan.changes[0].edits;
    expect(edits.map(edit => edit.before)).toEqual(['old', 'old', 'o\\u006cd']);
    const result = new ValueGraph().update(buildKnowledge(plan.notes, plan.records), 1);
    expect(result.values.label.status).toBe('ok');
    expect(result.values.label.value).toContain('V V {old}');
  });

  it('moves only an exact namespace and its dot-boundary descendants', () => {
    const source = '@app = "root"\n@app.one = "{app}"\n@app.one.two = "{app.one}"\n@apple = "untouched"\n{{app.one.two}} {{apple}}';
    const plan = planRename(snapshot([note('n', source)]), rename('app', 'new.space', 'namespace'));
    expect(plan.canApply).toBe(true);
    expect(plan.renames.map(item => item.to)).toEqual(['new.space', 'new.space.one', 'new.space.one.two']);
    expect(plan.notes[0].markdown).toContain('@apple = "untouched"');
    expect(plan.notes[0].markdown).toContain('@new.space.one.two = "{new.space.one}"');
  });

  it('reports direct and transitive impacts including unchanged notes that display downstream values', () => {
    const input = snapshot([note('a', '@old = "v"\n@direct = "{old}"\n@later = "{direct}"'), note('b', '{{later}}')], [record('r', 'c', 'n', { shown: '{later}' })]);
    const plan = planRename(input, rename('old', 'next'));
    expect(plan.impact.direct).toEqual(['direct', 'next']);
    expect(plan.impact.transitive).toEqual(['c.n.shown', 'later']);
    expect(plan.impact.noteIds).toEqual(['a', 'b']);
    expect(plan.impact.recordIds).toEqual(['r']);
    expect(plan.changes.map(change => change.id)).toEqual(['a']);
  });

  it('blocks duplicate source definitions, destination collisions and invalid/no-op requests', () => {
    expect(planRename(snapshot([note('n', '@a = "x"\n@a = "y"')]), rename('a', 'b')).diagnostics.some(item => item.kind === 'ambiguous-definition')).toBe(true);
    const collision = planRename(snapshot([note('n', '@a = "x"\n@b = "y"')]), rename('a', 'b'));
    expect(collision.canApply).toBe(false);
    expect(collision.diagnostics.some(item => item.kind === 'definition-collision')).toBe(true);
    for (const request of [rename('a', 'bad value'), rename('a', 'a'), rename('not_found', 'b')]) expect(planRename(snapshot([note('n', '@a = "x"')]), request).canApply).toBe(false);
  });

  it('allows explicit missing-reference repair and reports target rebinding and existing errors', () => {
    const repair = planRename(snapshot([note('n', '@present = "x"\n{{missing}}')]), rename('missing', 'present'));
    expect(repair.canApply).toBe(true);
    expect(repair.diagnostics.some(item => item.kind === 'reference-only')).toBe(true);
    expect(repair.impact.missingBefore).toEqual(['missing']);
    expect(repair.impact.missingAfter).toEqual([]);
    const bind = planRename(snapshot([note('n', '@old = "x"\n{{next}} {{old}}')]), rename('old', 'next'));
    expect(bind.canApply).toBe(true);
    expect(bind.diagnostics.some(item => item.kind === 'reference-rebound')).toBe(true);
    const untouched = planRename(snapshot([note('n', '@old = "x"\n@bad = nope\n{{unrelated}}')]), rename('old', 'next'));
    expect(untouched.canApply).toBe(true);
    expect(untouched.diagnostics.map(item => item.kind)).toContain('existing-syntax');
    expect(untouched.impact.missingAfter).toEqual(['unrelated']);
  });

  it('blocks newly created cycles caused by binding missing target names and preserves existing cycles', () => {
    const introduced = planRename(snapshot([note('n', '@old = "{next}"\n{{old}}')]), rename('old', 'next'));
    expect(introduced.canApply).toBe(false);
    expect(introduced.impact.cyclesBefore).toEqual([]);
    expect(introduced.impact.cyclesAfter).toEqual(['next']);
    const existing = planRename(snapshot([note('n', '@old = "{other}"\n@other = "{old}"')]), rename('old', 'next'));
    expect(existing.canApply).toBe(true);
    expect(existing.impact.cyclesAfter).toEqual(['next', 'other']);
    expect(existing.diagnostics.some(item => item.kind === 'existing-cycle')).toBe(true);
  });

  it('keeps fenced, nested-fenced, inline code and escaped references untouched', () => {
    const source = '@old = "x"\n\n> ```\n> {{old}}\n> ```\n\n- item\n\n  ```\n  {{old}}\n  ```\n\n`{{old}}` \\{{old}} {{old}}';
    const plan = planRename(snapshot([note('n', source)]), rename('old', 'next'));
    expect(plan.canApply).toBe(true);
    expect(plan.renames[0].references).toBe(1);
    expect(plan.notes[0].markdown).toBe(source.replace('@old', '@next').replace(/\{\{old\}\}$/, '{{next}}'));
  });
});

describe('record ownership and query safety', () => {
  it('renames a field using actual dotted owners and updates note and record dependencies', () => {
    const input = snapshot([note('n', '{{game.aura.fire.blue.display.name}}')], [record('r', 'game.aura', 'fire.blue', { 'display.name': 'fire', other: '{game.aura.fire.blue.display.name}' })]);
    const plan = planRename(input, rename('game.aura.fire.blue.display.name', 'game.aura.fire.blue.label.long'));
    expect(plan.canApply).toBe(true);
    expect(plan.records[0]).toMatchObject({ collection: 'game.aura', name: 'fire.blue', fields: { 'label.long': 'fire', other: '{game.aura.fire.blue.label.long}' } });
    expect(Object.hasOwn(plan.records[0].fields, 'display.name')).toBe(false);
    const dependency = buildKnowledge(input.notes, input.records).references.find(reference => reference.kind === 'dependency')!;
    expect(dependency.owner).toEqual({ kind: 'record', recordId: 'r', collection: 'game.aura', recordName: 'fire.blue', field: 'other' });
    expect(dependency.nameLocation!.from).toBe(1);
    expect(JSON.parse(JSON.stringify(plan)).records).toEqual(plan.records);
  });

  it('moves known collection and record-name namespaces, including empty records and dotted names', () => {
    const input = snapshot([note('n', '{{game.aura.fire.blue.label}}')], [record('r', 'game.aura', 'fire.blue', { label: 'x' }), record('empty', 'game.aura', 'empty', {})]);
    const collection = planRename(input, rename('game', 'archive', 'namespace'));
    expect(collection.canApply).toBe(true);
    expect(collection.records.map(item => item.collection)).toEqual(['archive.aura', 'archive.aura']);
    const recordName = planRename(input, rename('game.aura.fire', 'game.aura.ice', 'namespace'));
    expect(recordName.canApply).toBe(true);
    expect(recordName.records[0].name).toBe('ice.blue');
    expect(recordName.records[1]).toBe(input.records[1]);
    const empty = planRename(snapshot([], [record('empty', 'old', 'name', {})]), rename('old', 'new', 'namespace'));
    expect(empty.canApply).toBe(true);
    expect(empty.recordChanges).toHaveLength(1);
  });

  it('renames dotted field prefixes within the existing owner and refuses guessed cross-owner moves', () => {
    const input = snapshot([], [record('r', 'c', 'n', { 'color.red': 'R', 'color.blue': 'B' })]);
    const fields = planRename(input, rename('c.n.color', 'c.n.palette', 'namespace'));
    expect(fields.canApply).toBe(true);
    expect(Object.keys(fields.records[0].fields)).toEqual(['palette.red', 'palette.blue']);
    for (const request of [rename('c.n.color.red', 'd.n.red'), rename('c.n', 'd.n', 'namespace')]) {
      const plan = planRename(input, request);
      expect(plan.canApply).toBe(false);
      expect(plan.diagnostics.some(item => item.kind === 'record-ownership')).toBe(true);
    }
  });

  it('blocks record tuple and field collisions, including ambiguous dotted qualified definitions', () => {
    const tuple = planRename(snapshot([], [record('a', 'old', 'n', { f: 'x' }), record('b', 'new', 'n', {})]), rename('old', 'new', 'namespace'));
    expect(tuple.canApply).toBe(false); expect(tuple.diagnostics.some(item => item.kind === 'record-collision')).toBe(true);
    const field = planRename(snapshot([], [record('r', 'c', 'n', { a: 'x', b: 'y' })]), rename('c.n.a', 'c.n.b'));
    expect(field.canApply).toBe(false); expect(field.diagnostics.some(item => item.kind === 'field-collision')).toBe(true);
    const dotted = planRename(snapshot([], [record('a', 'a.b', 'c', { d: 'x' }), record('b', 'a', 'b.c', { d: 'y' })]), rename('a.b.c.d', 'a.b.c.e'));
    expect(dotted.canApply).toBe(false); expect(dotted.diagnostics.some(item => item.kind === 'ambiguous-definition')).toBe(true);
  });

  it('keeps prototype-shaped field names as own data properties', () => {
    const input = snapshot([], [record('r', 'c', 'n', { original: 'x', dependency: '{c.n.original}' })]);
    const plan = planRename(input, rename('c.n.original', 'c.n.__proto__'));
    expect(plan.canApply).toBe(true);
    expect(Object.hasOwn(plan.records[0].fields, '__proto__')).toBe(true);
    expect(plan.records[0].fields.__proto__).toBe('x');
    expect(Object.getPrototypeOf(plan.records[0].fields)).toBe(Object.prototype);
  });

  it('blocks collection or filtered field changes that would silently break grasp-query, preserving code text', () => {
    const query = '```grasp-query\n{"collection":"aura","where":{"field":"color","equals":"red"}}\n```';
    const input = snapshot([note('n', query)], [record('r', 'aura', 'fire', { color: 'red' })]);
    for (const request of [rename('aura', 'inventory', 'namespace'), rename('aura.fire.color', 'aura.fire.hue')]) {
      const plan = planRename(input, request);
      expect(plan.canApply).toBe(false);
      expect(plan.diagnostics.some(item => item.kind === 'query-impact' && item.location?.noteId === 'n')).toBe(true);
      expect(plan.notes[0].markdown).toBe(query);
    }
    expect(planRename(input, rename('aura.fire', 'aura.flame', 'namespace')).canApply).toBe(true);
  });

  it('handles deep dependency impact and cycles iteratively', () => {
    const count = 12_000;
    const text = Array.from({ length: count }, (_, i) => `@v${i} = "${i ? `{v${i - 1}}` : 'value'}"`).join('\n');
    const plan = planRename(snapshot([note('n', text)]), rename('v0', 'root'));
    expect(plan.canApply).toBe(true);
    expect(plan.impact.direct).toEqual(['root', 'v1']);
    expect(plan.impact.transitive).toHaveLength(count - 2);
    expect(plan.impact.cyclesAfter).toEqual([]);
  });

  it('preserves computed values across a namespace move spanning notes and dotted records', () => {
    const source = Array.from({ length: 100 }, (_, i) => `@ns.v${i} = "${i ? `{ns.v${i - 1}}` : 'literal ns.v0'}"`).join('\n');
    const input = snapshot([note('n', source + '\n{{ns.r.n.field.label}}')], [record('r', 'ns.r', 'n.field', { label: '{ns.v99}' })]);
    const before = new ValueGraph().update(buildKnowledge(input.notes, input.records), 1);
    const plan = planRename(input, rename('ns', 'archive.ns', 'namespace'));
    expect(plan.canApply).toBe(true);
    const after = new ValueGraph().update(buildKnowledge(plan.notes, plan.records), 1);
    for (const [name, value] of Object.entries(before.values)) expect(after.values[`archive.${name}`]).toEqual(value);
    expect(after.values['archive.ns.v99'].value).toBe('literal ns.v0');
  });

  it('reports every member of a deep existing cycle without marking an ordinary rename as a new cycle', () => {
    const count = 12_000;
    const text = Array.from({ length: count }, (_, i) => `@v${i} = "{v${(i + count - 1) % count}}"`).join('\n');
    const plan = planRename(snapshot([note('n', text)]), rename('v0', 'root'));
    expect(plan.canApply).toBe(true);
    expect(plan.impact.cyclesBefore).toHaveLength(count);
    expect(plan.impact.cyclesAfter).toHaveLength(count);
    expect(plan.impact.cyclesAfter).toContain('root');
    expect(plan.diagnostics.some(item => item.kind === 'new-cycle')).toBe(false);
  });
});
