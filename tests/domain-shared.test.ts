import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildKnowledge } from '../src/domain/knowledge';
import { ValueGraph } from '../src/domain/graph';
import { applySharedIntent, prepareSharedWorkspace, replaySourceEditProof, type PreparedSharedWorkspace, type RawSourceChange } from '../src/domain/shared';
import { planRename } from '../src/domain/rename';
import type { Note, WorkspaceSnapshot } from '../src/domain/model';

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
let serial = 0;
const newId = (kind: string) => `${kind}-${++serial}`;
const note = (id: string, markdown: string, legacy = false): Note => ({ id, title: id, markdown, revision: 1, updatedAt: '2026-09-28T00:00:00Z', folderId: null,
  ...(legacy ? {} : { syntaxVersion: 'grasp-v1' }) });
const workspace = (...notes: Note[]): WorkspaceSnapshot => ({ id: 'workspace', name: 'Test', revision: 1, notes, folders: [], attachments: [], records: [], settings: {} });
function initial(snapshot: WorkspaceSnapshot) {
  const prepared = prepareSharedWorkspace(snapshot, { hash, newId });
  return { snapshot: { ...snapshot, notes: prepared.notes }, prepared };
}
function next(before: WorkspaceSnapshot, previous: PreparedSharedWorkspace, candidate: WorkspaceSnapshot, hints = {}) {
  return prepareSharedWorkspace({ ...candidate, revision: before.revision + 1 }, {
    hash, newId, previous: previous.state, previousSnapshot: before, graph: previous.graph, identityHints: hints,
  });
}

describe('versioned knowledge and detached graphs', () => {
  it('keeps absent version legacy and feeds v1 ordered literal fragments directly into ValueGraph', () => {
    const parsed = buildKnowledge([
      note('legacy', '@old-name = "hello {Missing}"\n{{old-name}}', true),
      note('v1', '@A = <|{Missing} {{Other}}|>\n@B = A + <| and |> + A\n[cached](:ref:B)'),
    ]);
    const result = new ValueGraph().update(parsed, 1);
    expect(result.values['old-name'].status).toBe('missing');
    expect(result.values.A).toEqual({ status: 'ok', value: '{Missing} {{Other}}' });
    expect(result.values.B.value).toBe('{Missing} {{Other}} and {Missing} {{Other}}');
    expect(parsed.definitions.find(item => item.name === 'B')?.parts?.map(part => part.kind)).toEqual(['identifier', 'literal', 'identifier']);
  });

  it('never reinterprets an unversioned note as new syntax', () => {
    const parsed = buildKnowledge([note('old', '@A = <|x|>\n[x](:ref:A)', true)]);
    expect(parsed.definitions).toEqual([]);
    expect(parsed.references).toEqual([]);
    expect(parsed.diagnostics.some(item => item.kind === 'syntax')).toBe(true);
  });

  it('forked calculation and source reindexing cannot mutate the committed graph', () => {
    const committed = new ValueGraph();
    committed.update(buildKnowledge([note('n', '@A = <|old|>\n@B = A')]), 1);
    const candidate = committed.fork();
    candidate.update(buildKnowledge([note('n', '@A = <|new|>\n@B = A')]), 2);
    candidate.reindex(buildKnowledge([note('n', 'prose\n@A = <|new|>\n@B = A')]));
    expect(committed.getValue('A').value).toBe('old');
    expect(committed.getDefinition('A')?.location.from).toBe(0);
    expect(candidate.getValue('B').value).toBe('new');
  });

  it('evaluates a deep v1 graph without template reinterpretation or recursive stack growth', () => {
    const lines = ['@N0 = <|{raw}|>'];
    for (let index = 1; index < 12000; index++) lines.push(`@N${index} = N${index - 1}`);
    const result = new ValueGraph().update(buildKnowledge([note('deep', lines.join('\n'))]), 1);
    expect(result.values.N11999.value).toBe('{raw}');
    expect(result.metrics.recalculated).toBe(12000);
  });
});

describe('shared semantic preparation', () => {
  it('prepares both cached source forms with exact multiline values, stable IDs and provenance', () => {
    const input = workspace(note('definitions', '@Fruit = <|apple|>\r\n@Slogan = <|Eat |> + Fruit'),
      note('references', 'before\r\n[stale](:ref:Slogan)\n[[@Fruit|old]]\r\nafter'));
    const { prepared, snapshot } = initial(input);
    expect(prepared.canCommit).toBe(true);
    expect(prepared.patches).toHaveLength(2);
    expect(snapshot.notes[1].markdown).toBe('before\r\n[Eat apple](:ref:Slogan)\n[[@Fruit|apple]]\r\nafter');
    expect(snapshot.notes[1].revision).toBe(1);
    for (const occurrence of prepared.state.occurrences) {
      expect(occurrence.sourceHash).toBe(hash(snapshot.notes[1].markdown));
      expect(occurrence.sourceRevision).toBe(1);
      expect(occurrence.cache.source).toBe('computed');
      expect(snapshot.notes[1].markdown.slice(occurrence.location.from, occurrence.location.to)).toContain(occurrence.cache.renderedValue);
    }
    const fruit = prepared.state.bindings.find(binding => binding.name === 'Fruit')!;
    const edit = applySharedIntent(snapshot, prepared.state, { kind: 'set-literal', bindingId: fruit.id, value: '\r\nnew |]\\\nfruit\r' }, { hash });
    const changed = next(snapshot, prepared, { ...edit.snapshot, notes: edit.snapshot.notes.map(n => n.id === 'definitions' ? { ...n, revision: n.revision + 1 } : n) });
    expect(changed.canCommit).toBe(true);
    expect(changed.runtime.values.Slogan.value).toBe('Eat \r\nnew |]\\\nfruit\r');
    expect(changed.state.bindings.find(binding => binding.name === 'Fruit')?.id).toBe(fruit.id);
    expect(changed.state.occurrences.map(item => item.id)).toEqual(prepared.state.occurrences.map(item => item.id));
    expect(prepared.graph.getValue('Fruit').value).toBe('apple');
    expect(changed.runtime.metrics.recalculated).toBe(2);
    expect(changed.runtime.values).toEqual(new ValueGraph().update(buildKnowledge(changed.notes), 2).values);
  });

  it('retains last good cache through missing and cycle states without claiming current success', () => {
    const { prepared, snapshot } = initial(workspace(note('n', '@A = <|last good|>\n[old](:ref:A)')));
    const candidate = { ...snapshot, notes: snapshot.notes.map(n => ({ ...n, markdown: n.markdown.replace('<|last good|>', 'Missing'), revision: n.revision + 1 })) };
    const missing = next(snapshot, prepared, candidate);
    expect(missing.canCommit).toBe(true);
    expect(missing.state.results.find(item => item.name === 'A')).toMatchObject({ current: { status: 'missing' }, lastGood: { value: 'last good', semanticRevision: 1 } });
    expect(missing.state.occurrences[0].cache).toMatchObject({ current: { status: 'missing' }, renderedValue: 'last good', source: 'last-good' });
    expect(missing.notes[0].markdown).toContain('[last good](:ref:A)');
    const cycle = next(snapshot, prepared, { ...candidate, notes: candidate.notes.map(n => ({ ...n, markdown: n.markdown.replace('= Missing', '= A') })) });
    expect(cycle.canCommit).toBe(true);
    expect(cycle.state.occurrences[0].cache.current.status).toBe('cycle');
  });

  it('retains the host-assigned revision when a newly created note receives its first cache patch', () => {
    const { snapshot, prepared } = initial(workspace());
    const created = { ...note('new', '@A = <|saved|>\n[stale](:ref:A)'), revision: 2 };
    const changed = next(snapshot, prepared, { ...snapshot, notes: [created] });
    expect(changed.notes[0].revision).toBe(2);
    expect(changed.state.sources[0].revision).toBe(2);
    expect(changed.state.bindings[0].sourceRevision).toBe(2);
    expect(changed.state.occurrences[0].sourceRevision).toBe(2);
    expect(changed.notes[0].markdown).toContain('[saved](:ref:A)');
  });

  it('distinguishes empty success from missing observations and does not grant cache binding authority', () => {
    const prepared = prepareSharedWorkspace(workspace(note('n', '@Empty = <||>\n[old](:ref:Empty)\n[external value](:ref:Unknown)')), { hash, newId });
    expect(prepared.notes[0].markdown).toContain('[](:ref:Empty)');
    expect(prepared.state.results.find(result => result.name === 'Unknown')?.current.status).toBe('missing');
    expect(prepared.state.bindings.some(binding => binding.name === 'Unknown')).toBe(false);
    expect(prepared.state.occurrences[1].cache).toMatchObject({ source: 'observation', renderedValue: 'external value' });
  });

  it('invalid v1 edits are uncommittable drafts while unchanged invalid legacy notes survive migration', () => {
    const { prepared, snapshot } = initial(workspace(note('legacy', '@Broken = not-a-json-value', true), note('new', '@A = <|ok|>')));
    expect(prepared.canCommit).toBe(true);
    const candidate = { ...snapshot, notes: snapshot.notes.map(n => n.id === 'new' ? { ...n, markdown: '@A = <|unfinished', revision: 2 } : n) };
    expect(next(snapshot, prepared, candidate).canCommit).toBe(false);
    const valid = { ...snapshot, notes: snapshot.notes.map(n => n.id === 'new' ? { ...n, markdown: '@A = <|changed|>', revision: 2 } : n) };
    expect(next(snapshot, prepared, valid).canCommit).toBe(true);
  });

  it('uses exact source movement to preserve repeated occurrence identities and does not change binding revision for prose', () => {
    const { prepared, snapshot } = initial(workspace(note('n', '@A = <|x|>\n[x](:ref:A) first [x](:ref:A) second [x](:ref:A)')));
    const candidate = { ...snapshot, notes: snapshot.notes.map(n => ({ ...n, markdown: 'preface\r\n' + n.markdown, revision: n.revision + 1 })) };
    const changed = next(snapshot, prepared, candidate);
    expect(changed.canCommit).toBe(true);
    expect(changed.state.occurrences.map(item => item.id)).toEqual(prepared.state.occurrences.map(item => item.id));
    expect(changed.state.bindings[0].revision).toBe(prepared.state.bindings[0].revision);
    expect(changed.state.bindings[0].sourceRevision).toBeGreaterThan(prepared.state.bindings[0].sourceRevision);
  });

  it('does not reuse a binding identity across distinct owners with the same name', () => {
    const { prepared, snapshot } = initial(workspace(note('one', '@A = <|x|>')));
    const changed = next(snapshot, prepared, { ...snapshot, notes: [note('two', '@A = <|x|>')] });
    expect(changed.state.bindings[0].id).not.toBe(prepared.state.bindings[0].id);
    expect(changed.state.identifiers[0].id).toBe(prepared.state.identifiers[0].id);
  });

  it('diagnoses ambiguous repeated occurrence remapping instead of assigning identities by order', () => {
    const { prepared, snapshot } = initial(workspace(note('n', '@A = <|x|>\n[x](:ref:A) middle [x](:ref:A)')));
    const candidate = { ...snapshot, notes: snapshot.notes.map(n => ({ ...n, markdown: '@A = <|x|>\n[changed](:ref:A) totally changed [changed](:ref:A)', revision: n.revision + 1 })) };
    const changed = next(snapshot, prepared, candidate);
    expect(changed.canCommit).toBe(false);
    expect(changed.diagnostics.some(item => item.message.includes('Occurrence identity is ambiguous'))).toBe(true);
  });

  it('creates a new occurrence before an existing one without stealing its identity', () => {
    const { prepared, snapshot } = initial(workspace(note('definition', '@A = <|x|>'), note('reading', '[x](:ref:A)')));
    const candidate = { ...snapshot, notes: snapshot.notes.map(n => n.id === 'reading' ? { ...n, markdown: '[x](:ref:A)\ninserted separator\n' + n.markdown, revision: 2 } : n) };
    expect(next(snapshot, prepared, candidate).canCommit).toBe(false);
    const changed = next(snapshot, prepared, candidate, { occurrences: [{ occurrenceId: prepared.state.occurrences[0].id,
      noteId: 'reading', from: candidate.notes[1].markdown.lastIndexOf('[x]') }] });
    expect(changed.canCommit).toBe(true);
    expect(changed.state.occurrences[1].id).toBe(prepared.state.occurrences[0].id);
    expect(changed.state.occurrences[0].id).not.toBe(prepared.state.occurrences[0].id);
  });

  it('preserves an original binding when a same-name duplicate is inserted before it', () => {
    const { prepared, snapshot } = initial(workspace(note('n', '@A = <|original|>')));
    const candidate = { ...snapshot, notes: snapshot.notes.map(n => ({ ...n, markdown: '@A = <|new duplicate|>\n' + n.markdown, revision: 2 })) };
    const changed = next(snapshot, prepared, candidate);
    expect(changed.state.bindings[1].id).toBe(prepared.state.bindings[0].id);
    expect(changed.state.bindings[0].id).not.toBe(prepared.state.bindings[0].id);
    expect(changed.runtime.values.A.status).toBe('error');
  });

  it('reconciles a repeated-reference workload by indexed source ranges', () => {
    const source = '@A = <|x|>\n' + '[x](:ref:A) '.repeat(2000);
    const { prepared, snapshot } = initial(workspace(note('n', source)));
    const changed = next(snapshot, prepared, { ...snapshot, notes: snapshot.notes.map(n => ({ ...n, markdown: 'prefix\n' + n.markdown, revision: n.revision + 1 })) });
    expect(changed.canCommit).toBe(true);
    expect(changed.state.occurrences.map(item => item.id)).toEqual(prepared.state.occurrences.map(item => item.id));
    expect(changed.runtime.metrics.recalculated).toBe(0);
  });
});

describe('explicit shared edit intents', () => {
  it('requires fragment choice for a composition and supplies a minimal source inverse', () => {
    const { prepared, snapshot } = initial(workspace(note('n', '@A = <|one|>\n@B = A + <| two|>')));
    const b = prepared.state.bindings.find(item => item.name === 'B')!;
    expect(() => applySharedIntent(snapshot, prepared.state, { kind: 'set-literal', bindingId: b.id, value: 'flattened' }, { hash })).toThrow(/explicit/);
    const edited = applySharedIntent(snapshot, prepared.state, { kind: 'set-literal', bindingId: b.id, partIndex: 1, value: ' three' }, { hash });
    expect(edited.snapshot.notes[0].markdown).toBe('@A = <|one|>\n@B = A + <| three|>');
    expect(edited.inverse.notes).toEqual([{ id: 'n', markdown: snapshot.notes[0].markdown, syntaxVersion: 'grasp-v1' }]);
    expect(() => applySharedIntent(snapshot, prepared.state, { kind: 'set-literal', bindingId: b.id, partIndex: 1, value: 'x', expectedSourceHash: 'stale' }, { hash })).toThrow(/stale/);
  });

  it('renames v1 exact name tokens and explicitly preserves identifiers, bindings and repeated occurrences', () => {
    const { prepared, snapshot } = initial(workspace(note('n', '@A = <|A stays literal|>\n@B = A\n[x](:ref:A) [y](:ref:A)\n`[z](:ref:A)`')));
    const edited = applySharedIntent(snapshot, prepared.state, { kind: 'rename', from: 'A', to: 'Person.Fruit' }, { hash });
    const changed = next(snapshot, prepared, edited.snapshot, edited.identityHints);
    expect(changed.canCommit).toBe(true);
    expect(changed.state.identifiers.find(item => item.name === 'Person.Fruit')?.id).toBe(prepared.state.identifiers.find(item => item.name === 'A')?.id);
    expect(changed.state.bindings.map(item => item.id)).toEqual(prepared.state.bindings.map(item => item.id));
    const originalDependency = prepared.state.bindings.find(item => item.name === 'B')!;
    const renamedDependency = changed.state.bindings.find(item => item.name === 'B')!;
    expect(renamedDependency.dependencyIds).toEqual(originalDependency.dependencyIds);
    expect(renamedDependency.parts[0]).toMatchObject({ kind: 'identifier', name: 'Person.Fruit', identifierId: originalDependency.dependencyIds[0] });
    expect(changed.state.occurrences.map(item => item.id)).toEqual(prepared.state.occurrences.map(item => item.id));
    expect(changed.notes[0].markdown).toContain('<|A stays literal|>');
    expect(changed.notes[0].markdown).toContain('`[z](:ref:A)`');
    expect(planRename(snapshot, { from: 'A', to: 'bad-name', mode: 'identifier' }).canApply).toBe(false);
  });

  it('persists ordered fragment target IDs and graph dependency IDs for defined and missing targets', () => {
    const { prepared } = initial(workspace(note('n', '@A = <|x|>\n@B = A + <|/|> + Missing + A\n[old](:ref:B)')));
    const binding = prepared.state.bindings.find(item => item.name === 'B')!;
    const a = prepared.state.identifiers.find(item => item.name === 'A')!.id;
    const missing = prepared.state.identifiers.find(item => item.name === 'Missing')!.id;
    expect(binding.dependencyIds).toEqual([a, missing]);
    expect(binding.parts.filter(part => part.kind === 'identifier').map(part => part.identifierId)).toEqual([a, missing, a]);
    expect(prepared.state.bindings.some(item => item.identifierId === missing)).toBe(false);
    expect(prepared.state.results.find(item => item.identifierId === missing)?.current.status).toBe('missing');
    expect(JSON.parse(JSON.stringify(prepared.state)).bindings.find((item: { name: string }) => item.name === 'B').dependencyIds).toEqual([a, missing]);
  });

  it('can edit a legacy literal without switching its language or interpreting new raw markers', () => {
    const { prepared, snapshot } = initial(workspace(note('old', '@old-name = "{{literal}} and {Other}"\r\n@Other = "x"', true)));
    const binding = prepared.state.bindings.find(item => item.name === 'old-name')!;
    const edited = applySharedIntent(snapshot, prepared.state, { kind: 'set-literal', bindingId: binding.id, partIndex: 0, value: '{new} <|raw|> ' }, { hash });
    const changed = next(snapshot, prepared, edited.snapshot);
    expect(changed.canCommit).toBe(true);
    expect(changed.runtime.values['old-name'].value).toBe('{new} <|raw|> x');
    expect(changed.notes[0].syntaxVersion).toBeUndefined();
    expect(changed.notes[0].markdown).toContain('\r\n');
  });

  it('edits empty legacy literals and explicit record owners, retaining identity on field rename', () => {
    const input = workspace(note('old', '@Empty = ""', true));
    input.records = [{ id: 'record-1', collection: 'People', name: 'Sam', fields: { Job: 'doctor' }, revision: 1 }];
    const { prepared, snapshot } = initial(input);
    const empty = prepared.state.bindings.find(item => item.name === 'Empty')!;
    expect(applySharedIntent(snapshot, prepared.state, { kind: 'set-literal', bindingId: empty.id, value: 'not empty' }, { hash }).snapshot.notes[0].markdown).toBe('@Empty = "not empty"');
    const recordBinding = prepared.state.bindings.find(item => item.owner.kind === 'record')!;
    const edit = applySharedIntent(snapshot, prepared.state, { kind: 'set-literal', bindingId: recordBinding.id, value: '{literal}' }, { hash });
    expect(edit.snapshot.records[0].fields.Job).toBe('{{literal}}');
    const rename = applySharedIntent(snapshot, prepared.state, { kind: 'rename', from: 'People.Sam.Job', to: 'People.Sam.Role' }, { hash });
    const changed = next(snapshot, prepared, rename.snapshot, rename.identityHints);
    expect(changed.state.bindings.find(item => item.name === 'People.Sam.Role')?.id).toBe(recordBinding.id);
  });
});

describe('proved editor occurrence mappings', () => {
  function edit(before: ReturnType<typeof initial>, steps: RawSourceChange[][], after: string) {
    const reading = before.snapshot.notes.find(item => item.id === 'reading')!;
    const candidate = { ...before.snapshot, notes: before.snapshot.notes.map(item => item.id === reading.id
      ? { ...item, markdown: after, revision: item.revision + 1 } : item) };
    const proof = { noteId: reading.id, baseRevision: reading.revision, baseHash: hash(reading.markdown), steps };
    return { candidate, proof, prepared: next(before.snapshot, before.prepared, candidate, { sourceEdits: [proof] }) };
  }

  it.each(['prepend', 'append'])('preserves the original ID through ordinary duplicate %s without guessing equal text', where => {
    const source = '[x](:ref:A)';
    const before = initial(workspace(note('definition', '@A = <|x|>'), note('reading', source)));
    const at = where === 'prepend' ? 0 : source.length;
    const insert = where === 'prepend' ? source + '\n' : '\n' + source;
    const { prepared } = edit(before, [[{ from: at, to: at, insert, expected: '' }]], source.slice(0, at) + insert + source.slice(at));
    expect(prepared.canCommit).toBe(true);
    expect(prepared.state.occurrences[where === 'prepend' ? 1 : 0].id).toBe(before.prepared.state.occurrences[0].id);
    expect(new Set(prepared.state.occurrences.map(item => item.id)).size).toBe(2);
  });

  it('replays multiple transactions in raw UTF16 coordinates across mixed EOL and literal emoji', () => {
    const source = '[x](:ref:A)\r\n[x](:ref:A)';
    const before = initial(workspace(note('definition', '@A = <|x|>'), note('reading', source)));
    const prefix = '😀\r';
    const intermediate = prefix + source;
    const insertAt = intermediate.indexOf('\r\n');
    const after = intermediate.slice(0, insertAt) + '\n[x](:ref:A)' + intermediate.slice(insertAt);
    const { prepared } = edit(before, [[{ from: 0, to: 0, insert: prefix }],
      [{ from: insertAt, to: insertAt, insert: '\n[x](:ref:A)' }]], after);
    expect(prepared.canCommit).toBe(true);
    expect([prepared.state.occurrences[0].id, prepared.state.occurrences[2].id]).toEqual(before.prepared.state.occurrences.map(item => item.id));
  });

  it('retires edited or deleted occurrences and never steals an untouched duplicate identity', () => {
    const token = '[x](:ref:A)';
    const source = token + '\n' + token + '\n' + token;
    const before = initial(workspace(note('definition', '@A = <|x|>'), note('reading', source)));
    const last = source.lastIndexOf(token);
    const { prepared } = edit(before, [[{ from: 0, to: token.length + 1, insert: '' },
      { from: last, to: last + token.length, insert: token }]], token + '\n' + token);
    expect(prepared.canCommit).toBe(true);
    expect(prepared.state.occurrences[0].id).toBe(before.prepared.state.occurrences[1].id);
    expect(before.prepared.state.occurrences.map(item => item.id)).not.toContain(prepared.state.occurrences[1].id);
  });

  it('retires raw tokens removed from semantic scope by a real code fence', () => {
    const token = '[x](:ref:A)', source = token + '\n\n' + token;
    const before = initial(workspace(note('definition', '@A = <|x|>'), note('reading', source)));
    const { prepared } = edit(before, [[{ from: 0, to: 0, insert: '```\n' }, { from: token.length, to: token.length, insert: '\n```' }]],
      '```\n' + token + '\n```\n\n' + token);
    expect(prepared.canCommit).toBe(true);
    expect(prepared.state.occurrences.map(item => item.id)).toEqual([before.prepared.state.occurrences[1].id]);
  });

  it('rejects stale bases, missing edits, wrong expected bytes and contradictory explicit hints', () => {
    const before = initial(workspace(note('definition', '@A = <|x|>'), note('reading', '[x](:ref:A)')));
    const source = before.snapshot.notes[1].markdown;
    const valid = { noteId: 'reading', baseRevision: 1, baseHash: hash(source), steps: [] as RawSourceChange[][] };
    for (const proof of [{ ...valid, baseHash: 'forged' }, { ...valid, baseRevision: 0 },
      { ...valid, steps: [[{ from: 0, to: 1, insert: '[', expected: 'wrong' }]] },
      { ...valid, steps: [[{ from: 0, to: 0, insert: 'unreported' }]] }]) {
      expect(() => next(before.snapshot, before.prepared, before.snapshot, { sourceEdits: [proof] })).toThrow(/Source edit proof/);
    }
    expect(() => next(before.snapshot, before.prepared, before.snapshot, { sourceEdits: [valid], occurrences: [{
      occurrenceId: before.prepared.state.occurrences[0].id, noteId: 'reading', from: 0,
    }] })).toThrow(/cannot override/);
    expect(() => next(before.snapshot, before.prepared, before.snapshot, { occurrences: [{ occurrenceId: 'unknown', noteId: 'reading', from: 0 }] })).toThrow(/identity hint/);
  });

  it('rejects overlapping, reordered and out-of-range transactions without mutating the prior state', () => {
    const before = initial(workspace(note('reading', '[unknown](:ref:A)')));
    const source = before.snapshot.notes[0].markdown;
    for (const steps of [
      [[{ from: 0, to: 4, insert: '' }, { from: 3, to: 5, insert: '' }]],
      [[{ from: 2, to: 2, insert: '' }, { from: 1, to: 1, insert: '' }]],
      [[{ from: -1, to: 0, insert: '' }]], [[{ from: 0, to: source.length + 1, insert: '' }]],
    ]) expect(() => replaySourceEditProof(source, source, { noteId: 'reading', baseRevision: 1, baseHash: hash(source), steps }, before.prepared.state.occurrences)).toThrow(/raw ranges/);
    expect(before.prepared.state.occurrences).toHaveLength(1);
  });
});
