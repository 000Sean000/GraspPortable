import { describe, expect, it } from 'vitest';
import { buildKnowledge, parseNote } from '../src/domain/knowledge';
import { parseTemplate } from '../src/domain/template';
import type { Note, StructuredRecord } from '../src/domain/model';

const note = (markdown: string, id = 'n1'): Note => ({ id, title: id, markdown, revision: 1, updatedAt: '' });

describe('knowledge language and source locations', () => {
  it('parses string declarations, escaped braces, nested dependencies and inline references', () => {
    const source = '@first = "Sean"\n@last = "Wu"\n@full = "{first} {last}"\n@label = "Hello {full}; {{literal}}"\n你好 {{label}}';
    const parsed = parseNote(note(source));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.definitions.map(d => [d.name, d.dependencies])).toEqual([['first', []], ['last', []], ['full', ['first', 'last']], ['label', ['full']]]);
    expect(parsed.references.map(r => [r.name, r.kind, source.slice(r.location.from, r.location.to), r.location.line])).toEqual([
      ['first', 'dependency', '{first}', 3], ['last', 'dependency', '{last}', 3], ['full', 'dependency', '{full}', 4], ['label', 'reference', '{{label}}', 5],
    ]);
    expect(parseTemplate('{{literal}} {{x}}')).toEqual([{ kind: 'text', text: '{literal} {x}' }]);
  });

  it('ignores fenced, indented, escaped, and inline code including multiline code spans', () => {
    const source = [
      '`{{inline}}`', '``has ` and {{longCode}}``', '`multiline', '@hidden = "no"', '{{hidden}}`',
      '```markdown', '@fenced = "no"', '{{fenced}}', '```', '~~~', '{{tilde}}', '~~~',
      '    @indented = "no"', '    {{indented}}', '\\{{escaped}}', 'Literal ` unmatched {{visible}}',
      '@real = "yes"', '{{real}}',
    ].join('\n');
    const parsed = parseNote(note(source));
    expect(parsed.definitions.map(d => d.name)).toEqual(['real']);
    expect(parsed.references.map(r => r.name)).toEqual(['visible', 'real']);
  });

  it('maps dependencies after JSON escapes and CRLF to exact UTF-16 source positions', () => {
    const source = '@a = "\\u4f60\\n\\\"{first}\\\" 😀 {last}"\r\n中文 {{a}}\r\n';
    const result = parseNote(note(source));
    expect(result.diagnostics).toEqual([]);
    expect(result.references.map(r => source.slice(r.location.from, r.location.to))).toEqual(['{first}', '{last}', '{{a}}']);
    expect(result.references.map(r => r.location.line)).toEqual([1, 1, 2]);
  });

  it('ignores Markdown code fences nested in blockquotes and lists', () => {
    const source = '> ```\n> {{quoted}}\n> ```\n\n- item\n\n  ```\n  {{listed}}\n  ```\n\n{{visible}}';
    expect(parseNote(note(source)).references.map(r => r.name)).toEqual(['visible']);
  });

  it('reports invalid JSON, non-string values and invalid identifiers without losing subsequent declarations', () => {
    const result = parseNote(note('@broken = "unterminated\n@number = 123\n@bad name = "x"\n@valid = "OK"'));
    expect(result.diagnostics.map(d => d.kind)).toEqual(['syntax', 'syntax', 'syntax']);
    expect(result.diagnostics.map(d => d.location?.line)).toEqual([1, 2, 3]);
    expect(result.definitions.map(d => d.name)).toEqual(['valid']);
  });

  it('records repeated references and diagnoses duplicate definitions across notes and records', () => {
    const record: StructuredRecord = { id: 'r1', collection: 'aura', name: 'fire', fields: { label: '{x} flame' }, revision: 1 };
    const result = buildKnowledge([note('@x = "one"\n{{x}} {{x}}'), note('@x = "two"\n@aura.fire.label = "collision"', 'n2')], [record]);
    expect(result.diagnostics.filter(d => d.kind === 'duplicate').map(d => d.name)).toEqual(['x', 'aura.fire.label']);
    expect(result.references.filter(r => r.name === 'x')).toHaveLength(3);
    expect(result.definitions.find(d => d.location.noteId === 'record:r1')?.dependencies).toEqual(['x']);
  });

  it('treats malformed brace text literally without quadratic rescanning', () => {
    const text = '{ invalid '.repeat(50_000) + '}';
    expect(parseTemplate(text)).toEqual([{ kind: 'text', text }]);
  });

  it('indexes 150,000 references without a JavaScript argument-count overflow', () => {
    const parsed = buildKnowledge([note('@x = "value"\n\n' + '{{x}} '.repeat(150_000))]);
    expect(parsed.references.length).toBe(150_000);
    expect(parsed.definitions.length).toBe(1);
  });
});
