import { resolve } from 'node:path';
import type { WorkspaceSnapshot } from '../../src/domain/model';

/** Synthetic workspaces belong outside the source repository and Acceptance. */
export function testDirectory(suite: string): string {
  return resolve(process.cwd(), '..', 'Scratch', 'AutomatedTests', suite, `${Date.now()}-${process.pid}`);
}

/** These regression suites deliberately exercise the versioned v0.2 contract. */
export async function markLegacyFixture(origin: string, noteId?: string): Promise<void> {
  const snapshot: WorkspaceSnapshot = await (await fetch(origin + '/api/workspace')).json();
  const note = snapshot.notes.find(note => note.id === (noteId ?? snapshot.settings.activeNoteId)) ?? snapshot.notes[0];
  if (!note) throw new Error('A legacy fixture requires an existing synthetic note');
  const response = await fetch(`${origin}/api/notes/${note.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Grasp-Workspace': snapshot.id },
    body: JSON.stringify({ title: note.title, markdown: note.markdown, revision: note.revision, syntaxVersion: 'legacy-v0.2' }),
  });
  if (!response.ok) throw new Error(await response.text());
}
