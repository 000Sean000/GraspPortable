import { randomUUID } from 'node:crypto';
import type { WorkspaceSnapshot } from '../src/domain/model.js';
import { planRename, type RenamePlan, type RenameRequest } from '../src/domain/rename.js';
import type { SemanticIdentityHints, SharedSemanticState } from '../src/domain/shared.js';
import { requireString, StoreError, validateNote, validateRecord, type ImportPayload } from './store.js';

export type RenamePreview = Omit<RenamePlan, 'notes' | 'records'> & { token: string };
interface PendingRename { workspaceId: string; workspaceRevision: number; createdAt: number; payload: ImportPayload; reason: string; identityHints: SemanticIdentityHints }

/** The reviewed payload stays on the host; clients authorize only a short-lived token. */
export class RenameService {
  private pending = new Map<string, PendingRename>();

  plan(input: unknown, snapshot: WorkspaceSnapshot, semantic?: SharedSemanticState): RenamePreview {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreError('Rename request 必須是物件。');
    const value = input as Record<string, unknown>;
    if (value.mode !== 'identifier' && value.mode !== 'namespace') throw new StoreError('Rename mode 必須是 identifier 或 namespace。');
    const request: RenameRequest = { from: requireString(value.from, '原名稱', 500), to: requireString(value.to, '新名稱', 500), mode: value.mode };
    const result = planRename(snapshot, request);
    // Semantic validity does not imply the resulting source fits persistence
    // limits. Reject an uncommittable proposal before offering an apply token.
    if (result.canApply) {
      try {
        const changedIds = new Set(result.changes.map(change => change.id));
        for (const note of result.notes) if (changedIds.has(note.id)) validateNote(note);
        for (const change of result.recordChanges) validateRecord(change.after);
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        result.canApply = false;
        result.diagnostics.push({ severity: 'error', kind: 'storage-limit', message: `重新命名結果無法儲存：${error.message}` });
      }
    }
    const { notes, records, ...preview } = result;
    const now = Date.now();
    for (const [key, entry] of this.pending) if (now - entry.createdAt > 30 * 60_000) this.pending.delete(key);
    const token = result.canApply ? randomUUID() : '';
    if (result.canApply) {
      while (this.pending.size >= 10) this.pending.delete(this.pending.keys().next().value!);
      const changedIds = new Set(result.changes.map(change => change.id));
      this.pending.set(token, {
        workspaceId: snapshot.id, workspaceRevision: snapshot.revision, createdAt: now,
        payload: { notes: notes.filter(n => changedIds.has(n.id)), ...(result.recordChanges.length ? { records } : {}) },
        reason: `${request.mode === 'namespace' ? '移動 Namespace' : '重新命名 Identifier'}：${request.from} → ${request.to}`,
        identityHints: { renames: result.renames.map(({ from, to }) => ({ from, to })), bindingOwners: (semantic?.bindings ?? []).flatMap(binding => {
          if (binding.owner.kind !== 'record') return [];
          const owner = binding.owner; const changed = result.recordChanges.find(change => change.id === owner.recordId);
          if (!changed) return [];
          const field = changed.edits.find(edit => edit.kind === 'record-field' && edit.before === owner.field)?.after ?? owner.field;
          return [{ bindingId: binding.id, owner: { ...owner, collection: changed.after.collection, recordName: changed.after.name, field } }];
        }) },
      });
    }
    return { ...preview, token };
  }

  take(token: string, workspaceRevision: number, snapshot: WorkspaceSnapshot): { payload: ImportPayload; reason: string; identityHints: SemanticIdentityHints } {
    const pending = this.pending.get(token);
    if (!pending) throw new StoreError('重新命名預覽已失效，請重新預覽。', 409);
    if (Date.now() - pending.createdAt > 30 * 60_000) { this.pending.delete(token); throw new StoreError('重新命名預覽已過期，請重新預覽。', 409); }
    if (pending.workspaceId !== snapshot.id || pending.workspaceRevision !== workspaceRevision || snapshot.revision !== workspaceRevision) throw new StoreError('Workspace 已變更，請重新預覽重新命名的影響。', 409);
    this.pending.delete(token);
    return { payload: pending.payload, reason: pending.reason, identityHints: pending.identityHints };
  }

  clear(): void { this.pending.clear(); }
}
