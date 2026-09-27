import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../server/store';
import { sourceHash, sourcePatch, type SharedCommand, type SharedIntent } from '../server/semantic';
import { ExchangeService, exportMarkdown, parseExchange } from '../server/exchange';
import { createV1Workspace } from './fixtures/v1-workspace';

const dirs: string[] = [], stores: WorkspaceStore[] = [];
function file() { const dir = mkdtempSync(join(tmpdir(), 'grasp-shared-')); dirs.push(dir); return join(dir, 'workspace.db'); }
function open(path = ':memory:') { const store = new WorkspaceStore(path, { create: true }); stores.push(store); return store; }
function setup(path = ':memory:') {
  const store = open(path), note = store.snapshot().notes[0];
  store.updateNote(note.id, 'Shared', '@Fruit = <|Apple|>\r\n@Slogan = <|An |> + Fruit + <| a day|>\r\n\r\n[old](:ref:Fruit) [old](:ref:Fruit)\r\n[[@Slogan|old]]', note.revision, undefined, 'grasp-v1');
  return store;
}
function command(store: WorkspaceStore, intent: SharedIntent): SharedCommand { return { operationId: randomUUID(), workspaceId: store.id, baseSemanticRevision: store.semanticState().revision, intent }; }
function literal(store: WorkspaceStore, value: string, name = 'Fruit') {
  const binding = store.semanticState().bindings.find(b => b.name === name)!;
  return command(store, { kind: 'set-literal', bindingId: binding.id, bindingRevision: binding.revision, partIndex: 0, value });
}
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch { /* explicitly reopened */ } } for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('durable shared semantic transaction', () => {
  it('updates ordered bindings, nested values, all persisted caches and exact source together; restart retains identities', () => {
    const path = file(), store = setup(path); const before = store.sharedState();
    const edit = literal(store, 'Pear\n\n中文 😀'); const result = store.commitShared(edit);
    expect(result.semantic.results.find(r => r.name === 'Slogan')?.current).toEqual({ status: 'ok', value: 'An Pear\n\n中文 😀 a day' });
    expect(result.semantic.occurrences.map(o => o.id)).toEqual(before.semantic.occurrences.map(o => o.id));
    expect(result.semantic.bindings.map(b => b.id)).toEqual(before.semantic.bindings.map(b => b.id));
    expect(result.snapshot.notes[0].markdown).toContain('[Pear\n\n中文 😀](:ref:Fruit)');
    expect(result.snapshot.notes[0].markdown).toContain('[[@Slogan|An Pear\n\n中文 😀 a day]]');
    expect(result.receipt).toMatchObject({ operationId: edit.operationId, semanticRevision: result.semantic.revision, workspaceRevision: result.snapshot.revision });
    const patch = result.sourcePatches[0]; expect(patch.edits).toHaveLength(4); let raw = before.snapshot.notes[0].markdown;
    for (const e of [...patch.edits].reverse()) raw = raw.slice(0, e.from) + e.insert + raw.slice(e.to);
    expect(raw).toBe(result.snapshot.notes[0].markdown);
    store.close(); const reopened = open(path);
    expect(reopened.sharedState()).toEqual({ snapshot: result.snapshot, semantic: result.semantic, noteSources: result.noteSources });
    expect(reopened.operation(edit.operationId)).toEqual(result.receipt);
  });

  it('keeps incomplete drafts durable without changing committed data or semantic version, then commits an exact draft revision', () => {
    const path = file(), store = setup(path); const before = store.sharedState(), note = before.snapshot.notes[0];
    const draft = store.saveDraft('draft-1', { clientId: 'tab-1', noteId: note.id, title: note.title, markdown: '@Fruit = <|unfinished', syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: 0 });
    expect(draft.canCommit).toBe(false); expect(store.sharedState()).toEqual(before);
    expect(() => store.commitShared(command(store, { kind: 'commit-draft', draftId: draft.draft.id, draftRevision: 1 }))).toThrow(/draft/);
    expect(store.sharedState()).toEqual(before); expect(store.drafts()[0].markdown).toBe('@Fruit = <|unfinished');
    store.close(); const reopened = open(path); expect(reopened.drafts()).toEqual([draft.draft]);
    const valid = reopened.saveDraft('draft-1', { ...draft.draft, markdown: note.markdown.replace('Apple', 'Apricot') });
    const commit = command(reopened, { kind: 'commit-draft', draftId: valid.draft.id, draftRevision: valid.draft.revision });
    const saved = reopened.commitShared(commit);
    expect(saved.semantic.results.find(r => r.name === 'Fruit')?.current.value).toBe('Apricot'); expect(reopened.drafts()).toEqual([]);
    const acknowledgement = saved.draftAcknowledgement!;
    expect(acknowledgement).toMatchObject({ draftId: valid.draft.id, draftRevision: valid.draft.revision, noteId: note.id, submittedSourceHash: sourceHash(valid.draft.markdown) });
    expect(acknowledgement.edits).toHaveLength(3);
    let raw = valid.draft.markdown;
    for (const edit of [...acknowledgement.edits].reverse()) raw = raw.slice(0, edit.from) + edit.insert + raw.slice(edit.to);
    expect(raw).toBe(saved.snapshot.notes.find(n => n.id === note.id)!.markdown);
    expect(saved.receipt.draftAcknowledgement).toEqual(acknowledgement);
    reopened.close(); const restart = open(path); const replay = restart.commitShared(commit);
    expect(replay.draftAcknowledgement).toEqual(acknowledgement); expect(replay.receipt).toEqual(saved.receipt);
    expect(replay.snapshot).toEqual(saved.snapshot);
  });

  it('durably preserves a newly saved stale draft and refuses commit/discard of a different revision', () => {
    const store = setup(), old = store.snapshot().notes[0]; store.commitShared(literal(store, 'Pear'));
    const draft = store.saveDraft('stale', { clientId: 'other-tab', noteId: old.id, title: old.title, markdown: old.markdown + '\nmy text', syntaxVersion: 'grasp-v1', baseNoteRevision: old.revision, baseSourceHash: sourceHash(old.markdown), revision: 0 });
    expect(() => store.commitShared(command(store, { kind: 'commit-draft', draftId: draft.draft.id, draftRevision: draft.draft.revision }))).toThrow(/基底/);
    expect(() => store.deleteDraft(draft.draft.id, 0)).toThrow(/更新/); expect(store.drafts()).toHaveLength(1);
    expect(store.saveDraft(draft.draft.id, { ...draft.draft, markdown: 'more unfinished @Fruit = ' }).draft.revision).toBe(2);
  });

  it('replays an operation receipt across restart without a second commit and rejects reused IDs with different intent', () => {
    const path = file(), store = setup(path), edit = literal(store, 'Pear'); const result = store.commitShared(edit);
    store.close(); const reopened = open(path);
    const replay = reopened.commitShared(edit); expect(replay.receipt).toEqual(result.receipt); expect(replay.snapshot).toEqual(result.snapshot);
    expect(() => reopened.commitShared({ ...edit, intent: { ...edit.intent, value: 'changed replay' } })).toThrow(/不同內容/);
    expect(reopened.snapshot()).toEqual(result.snapshot);
  });

  it('rolls back note, caches, semantic state, consumed draft and receipt when a real SQL write fails', () => {
    const path = file(), store = setup(path); const note = store.snapshot().notes[0];
    const draft = store.saveDraft('fault', { clientId: 'tab', noteId: note.id, title: note.title, markdown: note.markdown.replace('Apple', 'Pear'), syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: 0 }).draft;
    const before = store.sharedState(); const edit = command(store, { kind: 'commit-draft', draftId: draft.id, draftRevision: draft.revision });
    const injector = new DatabaseSync(path); injector.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'receipt fault'); END"); injector.close();
    expect(() => store.commitShared(edit)).toThrow(/receipt fault/);
    expect(store.sharedState()).toEqual(before); expect(store.drafts()).toEqual([draft]); expect(() => store.operation(edit.operationId)).toThrow(/找不到/);
    const repair = new DatabaseSync(path); repair.exec('DROP TRIGGER fail_receipt'); repair.close();
    const retried = store.commitShared(edit);
    expect(retried.semantic.results.find(r => r.name === 'Slogan')?.current.value).toBe('An Pear a day');
    expect(retried.snapshot.notes[0].markdown).toContain('[Pear](:ref:Fruit)'); expect(store.drafts()).toEqual([]);
    expect(retried.draftAcknowledgement?.submittedSourceHash).toBe(sourceHash(draft.markdown));
    expect(retried.receipt.draftAcknowledgement).toEqual(retried.draftAcknowledgement);
  });

  it('keeps semantic revisions stable for settings and drafts; settings do not invalidate an explicit shared command', () => {
    const store = setup(), edit = literal(store, 'Pear'), before = store.semanticState();
    store.updateSettings({ mode: 'live', recent: 'note' }); expect(store.semanticState()).toEqual(before);
    expect(store.commitShared(edit).semantic.results.find(r => r.name === 'Fruit')?.current.value).toBe('Pear');
  });

  it('renames stable identity and reverses the entire shared operation with guards, without workspace history restore', () => {
    const store = setup(); store.createNote('Unchanged neighboring note', 'Keep note order.', null, 'grasp-v1');
    const before = store.sharedState(), fruit = before.semantic.identifiers.find(i => i.name === 'Fruit')!;
    const changed = store.commitShared(command(store, { kind: 'rename', identifierId: fruit.id, identifierRevision: fruit.revision, name: 'Produce.Fruit' }));
    expect(changed.semantic.identifiers.find(i => i.name === 'Produce.Fruit')?.id).toBe(fruit.id);
    expect(changed.semantic.occurrences.map(o => o.id)).toEqual(before.semantic.occurrences.map(o => o.id));
    const undone = store.commitShared(command(store, { kind: 'undo', operationId: changed.receipt.operationId }));
    expect(undone.snapshot.notes.map(n => n.markdown)).toEqual(before.snapshot.notes.map(n => n.markdown));
    expect(undone.snapshot.notes.map(n => n.id)).toEqual(before.snapshot.notes.map(n => n.id));
    expect(undone.semantic.bindings.map(b => b.id)).toEqual(before.semantic.bindings.map(b => b.id)); expect(store.history()).toEqual([]);
    const later = store.commitShared(literal(store, 'Cherry')); store.createNote('Elsewhere', 'Another committed edit', null, 'grasp-v1');
    expect(() => store.commitShared(command(store, { kind: 'undo', operationId: later.receipt.operationId }))).toThrow(/其他語義修改/);
  });

  it('commits complete missing/cyclic definitions with visible status and last-good values; invalid syntax is rejected', () => {
    const store = setup(); let note = store.snapshot().notes[0];
    store.updateNote(note.id, note.title, note.markdown.replace('@Fruit = <|Apple|>', '@Fruit = Slogan'), note.revision);
    const result = store.semanticState().results.find(r => r.name === 'Fruit')!;
    expect(result.current.status).toBe('cycle'); expect(result.lastGood?.value).toBe('Apple');
    expect(store.semanticState().occurrences.find(o => o.name === 'Fruit')?.cache.source).toBe('last-good');
    note = store.snapshot().notes[0]; store.updateNote(note.id, note.title, note.markdown.replace('@Fruit = Slogan', '@Fruit = Absent'), note.revision);
    expect(store.semanticState().results.find(r => r.name === 'Fruit')?.current.status).toBe('missing');
    note = store.snapshot().notes[0]; const before = store.sharedState();
    expect(() => store.updateNote(note.id, note.title, '@Fruit = <|not closed', note.revision)).toThrow(/draft/); expect(store.sharedState()).toEqual(before);
  });

  it('preserves syntax versions in exchange and blocks external cache observations from silent apply', () => {
    const store = setup(), snapshot = store.snapshot(), exported = exportMarkdown(snapshot);
    expect(parseExchange(exported, snapshot).notes[0].syntaxVersion).toBe('grasp-v1');
    const external = exported.replace('[Apple](:ref:Fruit)', '[An unauthorized value](:ref:Fruit)');
    const plan = new ExchangeService().plan(external, snapshot);
    expect(plan.canApply).toBe(false); expect(plan.classifications[0].kinds).toContain('cache-observation'); expect(store.snapshot()).toEqual(snapshot);
  });

  it('routes record changes, hierarchy deletion, controlled import and recovery through the same semantic authority', () => {
    const store = setup();
    store.updateRecord({ id: 'r', collection: 'people', name: 'one', fields: { favorite: '{Fruit}' }, revision: 0 }, 0);
    const binding = store.semanticState().bindings.find(b => b.name === 'people.one.favorite')!;
    const original = store.sharedState();
    const edited = store.commitShared(command(store, { kind: 'set-dependency', bindingId: binding.id, bindingRevision: binding.revision, partIndex: 0, targetIdentifierId: original.semantic.identifiers.find(i => i.name === 'Slogan')!.id }));
    expect(edited.snapshot.records[0].fields.favorite).toBe('{Slogan}');
    expect(edited.semantic.results.find(r => r.name === 'people.one.favorite')?.current.value).toBe('An Apple a day');
    const note = edited.snapshot.notes[0], folder = store.createFolder('To delete', null).folders[0];
    store.moveNote(note.id, folder.id, note.revision); const beforeDelete = store.sharedState();
    store.deleteFolder(folder.id, folder.revision, store.snapshot().revision, true);
    expect(store.semanticState().results.find(r => r.name === 'people.one.favorite')?.current.status).toBe('missing');
    const restored = store.restore(store.history()[0].id, store.snapshot().revision);
    expect(store.semanticState().bindings.map(b => b.id)).toEqual(beforeDelete.semantic.bindings.map(b => b.id));
    const imports = new ExchangeService(); const plan = imports.plan(exportMarkdown(restored).replace('<|Apple|>', '<|Plum|>'), restored);
    expect(plan.canApply).toBe(true); store.applyImport(imports.take(plan.token, plan.workspaceRevision, restored), plan.workspaceRevision);
    expect(store.semanticState().results.find(r => r.name === 'people.one.favorite')?.current.value).toBe('An Plum a day');
    expect(store.snapshot().notes[0].markdown).toContain('[Plum](:ref:Fruit)');
  });

  it('renames a record namespace with stable field identity and a complete guarded shared inverse', () => {
    const store = setup(); store.updateRecord({ id: 'r', collection: 'people', name: 'one', fields: { favorite: '{Fruit}', label: 'One' }, revision: 0 }, 0);
    const before = store.sharedState(), binding = before.semantic.bindings.find(b => b.name === 'people.one.favorite')!;
    const renamed = store.commitShared(command(store, { kind: 'rename-namespace', from: 'people.one', to: 'people.two' }));
    expect(renamed.snapshot.records[0].name).toBe('two'); expect(renamed.semantic.bindings.find(b => b.name === 'people.two.favorite')?.id).toBe(binding.id);
    const restored = store.commitShared(command(store, { kind: 'undo', operationId: renamed.receipt.operationId }));
    expect(restored.snapshot.records[0].name).toBe('one'); expect(restored.semantic.bindings.find(b => b.name === 'people.one.favorite')?.id).toBe(binding.id);
    expect(restored.semantic.results.find(r => r.name === 'people.one.favorite')?.current.value).toBe('Apple');
  });

  it.each([1, 2, 3])('upgrades schema %i with a verified independent backup, preserving legacy source and old recovery', version => {
    const path = file(), legacy = createV1Workspace(path);
    if (version > 1) {
      const db = new DatabaseSync(path);
      db.exec("CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, name_key TEXT NOT NULL, revision INTEGER NOT NULL); ALTER TABLE notes ADD COLUMN folder_id TEXT;");
      if (version > 2) db.exec('CREATE TABLE attachment_blobs (sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL); CREATE TABLE attachments (id TEXT PRIMARY KEY, name TEXT, path TEXT, path_key TEXT, mime_type TEXT, sha256 TEXT, size INTEGER, revision INTEGER, created_at TEXT);');
      db.exec(`PRAGMA user_version=${version}`); db.close();
    }
    const originalBytes = readFileSync(path); const store = open(path);
    expect(store.snapshot().notes[0].markdown).toBe(legacy.notes[0].markdown); expect(store.snapshot().notes[0].syntaxVersion).toBe('legacy-v0.2');
    const backup = new DatabaseSync(store.migrationBackupPath!, { readOnly: true });
    expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(version); expect(backup.prepare('PRAGMA quick_check').get()?.quick_check).toBe('ok'); backup.close();
    expect(originalBytes.byteLength).toBeGreaterThan(0); expect(store.semanticState().results.find(r => r.name === 'name')?.current.value).toBe('保存');
    const restored = store.restore(store.history()[0].id, store.snapshot().revision); expect(restored.notes[0].markdown).toBe(legacy.notes[0].markdown);
  });

  it('keeps source patch boundaries outside CRLF and surrogate pairs', () => {
    const store = open(), base = store.snapshot().notes[0];
    for (const [before, after] of [['a\r\nb', 'a\rX\nb'], ['a😀b', 'a😁b']]) {
      const patch = sourcePatch({ ...base, markdown: before }, { ...base, markdown: after, revision: base.revision + 1 });
      const e = patch.edits[0]; expect(before.slice(0, e.from) + e.insert + before.slice(e.to)).toBe(after);
      expect(e.from).toBe(1); expect(e.to).toBe(3);
    }
  });

  it('rejects non-scalar Unicode at SQLite text boundaries rather than silently replacing exact source', () => {
    const store = setup(), before = store.sharedState(), note = before.snapshot.notes[0];
    expect(() => store.updateNote(note.id, note.title, 'unpaired \ud800', note.revision)).toThrow(/Unicode/);
    expect(() => store.saveDraft('invalid-unicode', { clientId: 'tab', noteId: note.id, title: note.title, markdown: '\udfff', syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: 0 })).toThrow(/Unicode/);
    expect(store.sharedState()).toEqual(before); expect(store.drafts()).toEqual([]);
  });

  it('persists exact edit lineage across restart so prepending/appending repeated references preserves existing occurrence IDs', () => {
    const path = file(), store = setup(path), before = store.sharedState(), note = before.snapshot.notes[0];
    const at = note.markdown.indexOf('[Apple](:ref:Fruit)'); const insert = '[Apple](:ref:Fruit) ';
    const intermediate = note.markdown.slice(0, at) + insert + note.markdown.slice(at);
    const suffix = '\n[Apple](:ref:Fruit)';
    const sourceEdits = [[{ from: at, to: at, insert }], [{ from: intermediate.length, to: intermediate.length, insert: suffix }]];
    const saved = store.saveDraft('mapped', { clientId: 'editor', noteId: note.id, title: note.title, markdown: intermediate + suffix, syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, baseSourceHash: sourceHash(note.markdown), revision: 0, sourceEdits }).draft;
    store.close(); const reopened = open(path); expect(reopened.drafts()[0].sourceEdits).toEqual(sourceEdits);
    const result = reopened.commitShared(command(reopened, { kind: 'commit-draft', draftId: saved.id, draftRevision: saved.revision }));
    expect(result.snapshot.notes[0].markdown).toBe(intermediate + suffix);
    expect(result.semantic.occurrences.slice(1, 4).map(o => o.id)).toEqual(before.semantic.occurrences.map(o => o.id));
    expect(result.semantic.occurrences).toHaveLength(5); expect(new Set(result.semantic.occurrences.map(o => o.id)).size).toBe(5);
    expect(result.semantic.occurrences[0].id).not.toBe(before.semantic.occurrences[0].id);
  });

  it('rejects a forged source journal inside commit without consuming draft or changing semantic state', () => {
    const store = setup(), before = store.sharedState(), note = before.snapshot.notes[0];
    const saved = store.saveDraft('forged', { clientId: 'editor', noteId: note.id, title: note.title, markdown: note.markdown + '\n[Apple](:ref:Fruit)', syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: 0, sourceEdits: [] }).draft;
    expect(() => store.commitShared(command(store, { kind: 'commit-draft', draftId: saved.id, draftRevision: saved.revision }))).toThrow(/lineage/);
    expect(store.sharedState()).toEqual(before); expect(store.drafts()).toEqual([saved]);
    expect(() => store.saveDraft('malformed', { ...saved, revision: 0, sourceEdits: [[{ from: 4, to: 9, insert: '' }, { from: 3, to: 4, insert: 'overlap' }]] })).toThrow(/排序/);
    const titleOnly = store.saveDraft(saved.id, { ...saved, title: 'New title', markdown: note.markdown, sourceEdits: [] }).draft;
    const committed = store.commitShared(command(store, { kind: 'commit-draft', draftId: titleOnly.id, draftRevision: titleOnly.revision }));
    expect(committed.snapshot.notes[0].title).toBe('New title'); expect(committed.semantic.occurrences.map(o => o.id)).toEqual(before.semantic.occurrences.map(o => o.id));
    expect(committed.draftAcknowledgement?.edits).toEqual([]);
  });

  it('backs up an early schema4 database before additively introducing draft source lineage', () => {
    const path = file(), store = setup(path), note = store.snapshot().notes[0];
    const draft = store.saveDraft('old-draft', { clientId: 'old-tab', noteId: note.id, title: note.title, markdown: '@Fruit = <|unfinished', syntaxVersion: 'grasp-v1', baseNoteRevision: note.revision, revision: 0 }).draft;
    const before = store.sharedState(); store.close();
    const old = new DatabaseSync(path); old.exec('ALTER TABLE drafts DROP COLUMN source_edits_json; DROP TABLE projection_strategy; DROP TABLE projection_packages; DROP TABLE recovery_metadata; PRAGMA user_version=4'); old.close();
    const upgraded = open(path); expect(upgraded.migrationBackupPath).toContain('schema4-backup');
    expect(upgraded.sharedState()).toEqual(before); expect(upgraded.drafts()).toEqual([draft]);
    const backup = new DatabaseSync(upgraded.migrationBackupPath!, { readOnly: true });
    expect(backup.prepare('SELECT markdown FROM drafts WHERE id=?').get(draft.id)?.markdown).toBe(draft.markdown);
    expect(backup.prepare("PRAGMA table_info('drafts')").all().some(row => row.name === 'source_edits_json')).toBe(false); backup.close();
  });
});
