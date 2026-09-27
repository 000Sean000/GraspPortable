import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { history, redo, undo } from '@codemirror/commands';
import { parseBindingAt, serializeBinding, type BindingInputPart } from '../src/domain/binding-language';
import { parseReferenceAt, serializeReference, type ReferenceKind } from '../src/domain/reference-language';
import { parseNoteLanguage } from '../src/domain/note-language';
import { insertedSourceEffects, rawDocument, rawSourceField, rawSourceHistory, rawSourceNormalization, rawToEditor, sourceFormat } from '../src/editor/raw-source';

describe('new syntax at the existing raw-source adapter boundary', () => {
  for (const kind of ['pure', 'wiki'] as ReferenceKind[]) it(`${kind} cache patch preserves adjacent raw source, EOLs and undo`, () => {
    const prefix = '\ufeff前言🙂\r\n' + serializeBinding('X', [{ kind: 'literal', value: '\n first\r\nsecond\r' }]) + '\r\n正文 ';
    const originalReference = serializeReference({ kind, identifier: 'X', value: 'old\r\n\r\nvalue' });
    const suffix = ' 後文\r\n尾段\r';
    const original = prefix + originalReference + suffix;
    let state = EditorState.create({ doc: original, extensions: [
      rawSourceField.init(() => sourceFormat(original)), rawSourceHistory, rawSourceNormalization, history(),
    ] });
    expect(rawDocument(state)).toBe(original);
    const parsed = parseReferenceAt(rawDocument(state), prefix.length);
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const value = '\r\n[new] | \\path\n\n```\n@Fake = <||>\n```\r';
    const replacement = serializeReference({ kind, identifier: parsed.reference.identifier, value });
    const transaction = state.update({ changes: {
      from: rawToEditor(state, parsed.reference.from), to: rawToEditor(state, parsed.reference.to), insert: replacement,
    }, userEvent: 'input', filter: false });
    state = state.update(transaction, { effects: insertedSourceEffects(transaction, replacement), sequential: true }).state;
    const expected = prefix + replacement + suffix;
    expect(rawDocument(state)).toBe(expected);
    const note = parseNoteLanguage(rawDocument(state), 2);
    expect(note.contextsComplete).toBe(true);
    expect(note.bindings.map(binding => binding.name)).toEqual(['X']);
    expect(note.references.map(reference => reference.identifier)).toEqual(['X']);
    const reread = parseReferenceAt(rawDocument(state), prefix.length);
    expect(reread.ok && reread.reference.value).toBe(value);
    const commandTarget = () => ({ state, dispatch: (change: Parameters<Parameters<typeof undo>[0]['dispatch']>[0]) => { state = change.state; } });
    expect(undo(commandTarget())).toBe(true);
    expect(rawDocument(state)).toBe(original);
    expect(redo(commandTarget())).toBe(true);
    expect(rawDocument(state)).toBe(expected);
  });

  it('reconstructs composition and both cached forms from a synthetic JSON DTO without flattening', () => {
    const parts: BindingInputPart[] = [
      { kind: 'literal', value: '\r\nAn [apple] |> \r' },
      { kind: 'identifier', name: 'Fruit' },
      { kind: 'literal', value: '\n\nnext\t' },
      { kind: 'identifier', name: 'Fruit' },
    ];
    const source = serializeBinding('Slogan', parts);
    const parsed = parseBindingAt(source);
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const bundle = JSON.parse(JSON.stringify({
      ownerId: 'synthetic-note', revision: 3, source,
      binding: parsed.node,
      references: (['pure', 'wiki'] as ReferenceKind[]).map(kind => ({ kind, identifier: 'Slogan', value: '\n完整 cached value\r\n[link](path)\r' })),
    }));
    const restored = parseBindingAt(serializeBinding(bundle.binding.name, bundle.binding.parts));
    expect(restored.ok && restored.node.dependencies).toEqual(['Fruit', 'Fruit']);
    expect(restored.ok && restored.node.parts.map(part => part.kind === 'literal'
      ? { kind: part.kind, value: part.value } : { kind: part.kind, name: part.name })).toEqual(parts);
    expect(bundle.source).toBe(source);
    for (const reference of bundle.references) {
      const result = parseReferenceAt(serializeReference(reference));
      expect(result.ok && { kind: result.reference.kind, identifier: result.reference.identifier, value: result.reference.value }).toEqual(reference);
    }
    // This checks codec DTO reconstruction only, not a portable package or fresh DB restore.
  });
});
