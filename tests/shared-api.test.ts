import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApi } from '../server/api';
import type { DurableDraft, SharedCommitResponse, SharedStateResponse } from '../server/semantic';
import type { WorkspaceSnapshot } from '../src/domain/model';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function host() {
  const dir = mkdtempSync(join(tmpdir(), 'grasp-shared-api-')); const path = join(dir, 'workspace.db');
  const start = async () => {
    const api = createApi({ defaultPath: path });
    const server = createServer((req, res) => { void api.handle(req, res).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    let closed = false;
    const stop = async () => { if (closed) return; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await api.close(); closed = true; };
    const base = `http://127.0.0.1:${address.port}/api`;
    const get = (route: string, workspace?: string) => fetch(base + route, { headers: workspace ? { 'x-grasp-workspace': workspace } : {} });
    const send = (route: string, method: string, payload: unknown, workspace?: string) => fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(workspace ? { 'x-grasp-workspace': workspace } : {}) }, body: JSON.stringify(payload) });
    cleanup.push(stop); return { stop, get, send };
  };
  cleanup.push(async () => rmSync(dir, { recursive: true, force: true })); return { ...await start(), start, path };
}

describe('shared HTTP command and durable draft lifecycle', () => {
  it('hydrates one committed state, saves an incomplete draft across restart, commits valid source and resolves unknown results by receipt', async () => {
    const first = await host();
    const initial = await (await first.get('/shared/state')).json() as SharedStateResponse;
    expect(initial.semantic.workspaceId).toBe(initial.snapshot.id); expect(initial.noteSources).toHaveLength(initial.snapshot.notes.length);
    const response = await first.send('/notes', 'POST', { title: 'New grammar', markdown: '@Fruit = <|Apple|>\n\n[old](:ref:Fruit)', syntaxVersion: 'grasp-v1' }, initial.snapshot.id);
    expect(response.status).toBe(200); const created = await response.json() as WorkspaceSnapshot;
    const note = created.notes.find(n => n.title === 'New grammar')!;
    expect(note.syntaxVersion).toBe('grasp-v1'); expect(note.markdown).toContain('[Apple](:ref:Fruit)');
    const state = await (await first.get('/shared/state')).json() as SharedStateResponse;
    const draftResponse = await first.send('/drafts/durable-one', 'PUT', { clientId: 'browser-tab', noteId: note.id, title: note.title, markdown: '@Fruit = <|unfinished', syntaxVersion: 'grasp-v1', revision: 0, baseNoteRevision: note.revision }, created.id);
    expect(draftResponse.status).toBe(200); const draft = await draftResponse.json() as { draft: DurableDraft; canCommit: boolean };
    expect(draft.canCommit).toBe(false); expect(await (await first.get('/shared/state')).json()).toEqual(state);
    await first.stop(); const reopened = await first.start();
    expect(await (await reopened.get('/drafts')).json()).toEqual([draft.draft]);
    const changed = await reopened.send('/drafts/durable-one', 'PUT', { ...draft.draft, markdown: '@Fruit = <|Pear|>\n\n[old](:ref:Fruit)' }, created.id);
    const saved = await changed.json() as { draft: DurableDraft; canCommit: boolean }; expect(saved.canCommit).toBe(true);
    const command = { operationId: randomUUID(), workspaceId: created.id, baseSemanticRevision: state.semantic.revision, intent: { kind: 'commit-draft', draftId: saved.draft.id, draftRevision: saved.draft.revision } };
    const resultResponse = await reopened.send('/shared/commands', 'POST', command, created.id); expect(resultResponse.status).toBe(200);
    const result = await resultResponse.json() as SharedCommitResponse;
    expect(result.snapshot.notes.find(n => n.id === note.id)?.markdown).toContain('[Pear](:ref:Fruit)');
    expect(result.draftAcknowledgement).toMatchObject({ draftId: saved.draft.id, draftRevision: saved.draft.revision, noteId: note.id });
    expect(result.draftAcknowledgement?.edits).toHaveLength(1); expect(result.receipt.draftAcknowledgement).toEqual(result.draftAcknowledgement);
    expect(await (await reopened.get('/shared/operations/' + command.operationId)).json()).toEqual(result.receipt);
    expect(await (await reopened.get('/drafts')).json()).toEqual([]);
    const replay = await (await reopened.send('/shared/commands', 'POST', command, created.id)).json() as SharedCommitResponse;
    expect(replay.receipt).toEqual(result.receipt); expect(replay.snapshot).toEqual(result.snapshot); expect(replay.draftAcknowledgement).toEqual(result.draftAcknowledgement);
    expect((await reopened.send('/shared/commands', 'POST', { ...command, baseSemanticRevision: 999 }, created.id)).status).toBe(409);
    expect((await reopened.get('/shared/state', 'another-workspace')).status).toBe(409);
  });

  it('preserves stale tab drafts, protects shared undo versions, and refuses external cache-only authority', async () => {
    const app = await host();
    await app.send('/notes', 'POST', { title: 'Fruit', markdown: '@Fruit = <|Apple|>\n\n[old](:ref:Fruit)', syntaxVersion: 'grasp-v1' });
    const before = await (await app.get('/shared/state')).json() as SharedStateResponse;
    const binding = before.semantic.bindings.find(b => b.name === 'Fruit')!; const note = before.snapshot.notes.find(n => n.title === 'Fruit')!;
    const edit = { operationId: randomUUID(), workspaceId: before.snapshot.id, baseSemanticRevision: before.semantic.revision, intent: { kind: 'set-literal', bindingId: binding.id, bindingRevision: binding.revision, partIndex: 0, value: 'Cherry' } };
    const result = await (await app.send('/shared/commands', 'POST', edit)).json() as SharedCommitResponse;
    expect(result.receipt.undoable).toBe(true);
    expect(result.draftAcknowledgement).toBeUndefined(); expect(result.receipt.draftAcknowledgement).toBeUndefined();
    const savedDraft = await app.send('/drafts/stale-tab', 'PUT', { clientId: 'stale-tab', noteId: note.id, title: note.title, markdown: note.markdown + '\nLocal edits survive', syntaxVersion: 'grasp-v1', revision: 0, baseNoteRevision: note.revision, baseSourceHash: before.noteSources.find(s => s.noteId === note.id)!.sourceHash });
    expect(savedDraft.status).toBe(200); const draft = (await savedDraft.json() as { draft: DurableDraft }).draft;
    expect((await app.send('/shared/commands', 'POST', { operationId: randomUUID(), workspaceId: before.snapshot.id, baseSemanticRevision: result.semantic.revision, intent: { kind: 'commit-draft', draftId: draft.id, draftRevision: draft.revision } })).status).toBe(409);
    expect(await (await app.get('/drafts')).json()).toEqual([draft]);
    const exported = await (await app.get('/export')).text();
    const plan = await (await app.send('/import/plan', 'POST', { markdown: exported.replace('[Cherry](:ref:Fruit)', '[external](:ref:Fruit)') })).json() as { canApply: boolean; classifications: { kinds: string[] }[] };
    expect(plan.canApply).toBe(false); expect(plan.classifications.some(c => c.kinds.includes('cache-observation'))).toBe(true);
    const undo = await app.send('/shared/commands', 'POST', { operationId: randomUUID(), workspaceId: before.snapshot.id, baseSemanticRevision: result.semantic.revision, intent: { kind: 'undo', operationId: result.receipt.operationId } });
    expect(undo.status).toBe(200); const undone = await undo.json() as SharedCommitResponse;
    expect(undone.snapshot.notes.find(n => n.id === note.id)?.markdown).toBe(note.markdown);
    expect((await app.send('/shared/commands', 'POST', { operationId: randomUUID(), workspaceId: before.snapshot.id, baseSemanticRevision: undone.semantic.revision, intent: { kind: 'undo', operationId: result.receipt.operationId } })).status).toBe(409);
  });
});
