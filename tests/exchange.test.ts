import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceStore } from '../server/store.js';
import { ExchangeService, exportMarkdown, parseExchange } from '../server/exchange.js';

const stores: WorkspaceStore[] = [];
function workspace(): WorkspaceStore { const s = new WorkspaceStore(':memory:', { seed: true }); stores.push(s); return s; }
afterEach(() => { for (const s of stores.splice(0)) s.close(); });

describe('controlled Markdown exchange', () => {
  it('roundtrips exact Markdown, Unicode, IDs, records and literal markup safely', () => {
    const s = workspace(); const note = s.snapshot().notes[0]!;
    const markdown = '# 中文 😀\r\n\r\n@end = "test"\n\n<!-- grasp-note {"fake":true} -->\n<!-- grasp-end fake -->\n\ntext without final newline';
    const snapshot = s.updateNote(note.id, 'danger --> <title>', markdown, note.revision);
    const exported = exportMarkdown(snapshot);
    expect(exported).not.toContain('"title":"danger --> <title>"');
    const payload = parseExchange(exported, snapshot);
    expect(payload.notes[0]).toEqual({ id: note.id, title: 'danger --> <title>', markdown, folderId: null });
    expect(payload.records).toEqual(snapshot.records);
    for (const ending of ['', '\n', '\r\n', '\r']) {
      const sample = { ...snapshot, notes: [{ ...snapshot.notes[0]!, markdown: 'trailing characters' + ending }] };
      expect(parseExchange(exportMarkdown(sample), sample).notes[0]!.markdown).toBe(sample.notes[0]!.markdown);
    }
  });

  it('shows changed source, applies only explicit server-held plans and rejects stale/replayed plans', () => {
    const s = workspace(); const snapshot = s.snapshot(); const exchange = new ExchangeService();
    const edited = exportMarkdown(snapshot).replace('@first_name = "Sean"', '@first_name = "Alex"');
    const plan = exchange.plan(edited, snapshot);
    expect(plan.canApply).toBe(true); expect(plan.changes.filter(c => c.kind === 'update')).toHaveLength(1);
    expect(plan.changes[0]!.before).toContain('"Sean"'); expect(plan.changes[0]!.after).toContain('"Alex"');
    expect(s.snapshot()).toEqual(snapshot);
    const payload = exchange.take(plan.token, plan.workspaceRevision, snapshot);
    const applied = s.applyImport(payload, plan.workspaceRevision);
    expect(applied.notes[0]!.markdown).toContain('"Alex"'); expect(s.history()).toHaveLength(1);
    expect(() => exchange.take(plan.token, applied.revision, applied)).toThrow(/失效/);
    const next = exchange.plan(exportMarkdown(applied), applied);
    const changed = s.createNote('new', 'new');
    expect(() => exchange.take(next.token, next.workspaceRevision, changed)).toThrow(/已變更/);
    expect(() => s.applyImport(payload, next.workspaceRevision)).toThrow(/已變更/);
  });

  it('rejects broken metadata, missing boundaries, foreign workspaces, and syntax before commit', () => {
    const s = workspace(); const snapshot = s.snapshot(); const exchange = new ExchangeService(); const exported = exportMarkdown(snapshot);
    for (const bad of [exported.replace('"version":2', '"version":999'), exported.slice(0, exported.lastIndexOf('<!-- grasp-end')), exported.replace(snapshot.id, 'foreign'), exported.replace('"notes":[', '"notes":[' + '"missing",'), exported.replace('@first_name = "Sean"', '@first_name = "bad unclosed')]) {
      const plan = exchange.plan(bad, snapshot); expect(plan.canApply).toBe(false); expect(plan.diagnostics.length).toBeGreaterThan(0);
      expect(s.snapshot()).toEqual(snapshot);
    }
  });

  it('creates a separate note from ordinary Markdown without replacing other records or notes', () => {
    const s = workspace(); const snapshot = s.snapshot(); const exchange = new ExchangeService();
    const plan = exchange.plan('# 外部想法\n\n自然文字。', snapshot);
    expect(plan.canApply).toBe(true); expect(plan.changes[0]?.kind).toBe('create');
    const applied = s.applyImport(exchange.take(plan.token, plan.workspaceRevision, snapshot), plan.workspaceRevision);
    expect(applied.notes).toHaveLength(snapshot.notes.length + 1); expect(applied.records).toEqual(snapshot.records);
    expect(applied.notes.at(-1)?.title).toBe('外部想法');
  });

  it('shows missing and cyclic value warnings in the reviewed proposal without blocking safe source import', () => {
    const s = workspace(); const snapshot = s.snapshot(); const exchange = new ExchangeService();
    const plan = exchange.plan('# Invalid outputs\n\n@cycle_a = "{cycle_b}"\n@cycle_b = "{cycle_a}"\n\n{{absent}}', snapshot);
    expect(plan.canApply).toBe(true);
    expect(plan.diagnostics.some(d => d.kind === 'cycle')).toBe(true);
    expect(plan.diagnostics.some(d => d.kind === 'missing' && d.name === 'absent')).toBe(true);
    expect(s.snapshot()).toEqual(snapshot);
  });

  it('never silently discards prose or unrecognized metadata outside note bodies', () => {
    const s = workspace(); const snapshot = s.snapshot(); const exchange = new ExchangeService(); const exported = exportMarkdown(snapshot);
    for (const malformed of [
      exported + '\nAI appended this important new paragraph.\n',
      exported.replace('\n\n<!-- grasp-note', '\n\nNew text outside a note.\n\n<!-- grasp-note'),
      exported.replace('# GraspPortable · Markdown Exchange', '# GraspPortable · Markdown Exchange\n\nUnexpected knowledge here.'),
      exported.replace('"version":2', '"version":2,"ignoredKnowledge":"do not lose me"'),
      exported.replace('<!-- grasp-note {', '<!-- grasp-note {"markdown":"extra source",'),
      exported.replace('"fields":{', '"extraData":"not a field","fields":{'),
    ]) {
      const plan = exchange.plan(malformed, snapshot);
      expect(plan.canApply).toBe(false); expect(plan.diagnostics[0]?.message).toMatch(/邊界外|未知欄位/);
      expect(s.snapshot()).toEqual(snapshot);
    }
    // Formatting CRLF around structural metadata is accepted without losing actual note source.
    expect(parseExchange(exported.replaceAll('\n', '\r\n'), snapshot).notes).toHaveLength(snapshot.notes.length);
  });
});
