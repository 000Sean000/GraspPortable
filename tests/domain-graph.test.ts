import { describe, expect, it } from 'vitest';
import { buildKnowledge } from '../src/domain/knowledge';
import { CalculationCancelledError, ValueGraph } from '../src/domain/graph';
import type { Note, ParseResult } from '../src/domain/model';

function parse(markdown: string): ParseResult {
  const note: Note = { id: 'n', title: 'Test', markdown, revision: 1, updatedAt: '' };
  return buildKnowledge([note]);
}
const chain = (count: number, first: string) => Array.from({ length: count }, (_, i) => `@v${i} = "${i ? `{v${i - 1}}` : first}"`).join('\n');

describe('incremental value calculation', () => {
  it('evaluates nested values and only recalculates the changed dependency closure', () => {
    const graph = new ValueGraph();
    const original = '@first = "Sean"\n@last = "Wu"\n@full = "{first} {last}"\n@greeting = "你好，{full}！"\n@independent = "leave alone"\n{{greeting}}';
    const initial = graph.update(parse(original), 1);
    expect(initial.values.greeting).toEqual({ value: '你好，Sean Wu！', status: 'ok' });
    expect(initial.metrics.recalculated).toBe(5);
    const edited = graph.update(parse(original.replace('Sean', '小明')), 2);
    expect(edited.values.greeting.value).toBe('你好，小明 Wu！');
    expect(edited.metrics.recalculated).toBe(3);
    expect(edited.values.independent).toBe(initial.values.independent);
    const moved = graph.update(parse('\n' + original.replace('Sean', '小明')), 3);
    expect(moved.metrics.recalculated).toBe(0);
    expect(graph.getDefinition('first')?.location.line).toBe(2);
    expect(graph.findReferences('full')).toHaveLength(1);
    expect(graph.findReferences('greeting')[0].kind).toBe('reference');
  });

  it('handles deletion, missing references, and later definition creation', () => {
    const graph = new ValueGraph();
    let result = graph.update(parse('@greeting = "Hello {person}"\n{{notDefined}}'), 1);
    expect(result.values.greeting.status).toBe('missing');
    expect(result.diagnostics.filter(d => d.kind === 'missing').map(d => d.name)).toEqual(['person', 'notDefined']);
    result = graph.update(parse('@greeting = "Hello {person}"\n@person = "Sean"'), 2);
    expect(result.values.greeting.value).toBe('Hello Sean');
    result = graph.update(parse('@greeting = "Hello {person}"'), 3);
    expect(result.values.person).toBeUndefined();
    expect(result.values.greeting.status).toBe('missing');
  });

  it('detects cycles and dependents, then recovers after the cycle is broken', () => {
    const graph = new ValueGraph();
    const result = graph.update(parse('@a = "{b}"\n@b = "{c}"\n@c = "{a}"\n@dependent = "{b}!"\n@fine = "ok"'), 1);
    for (const name of ['a', 'b', 'c', 'dependent']) expect(result.values[name].status).toBe('cycle');
    expect(result.values.fine.value).toBe('ok');
    const fixed = graph.update(parse('@a = "{b}"\n@b = "{c}"\n@c = "fixed"\n@dependent = "{b}!"\n@fine = "ok"'), 2);
    expect(fixed.values.dependent.value).toBe('fixed!');
    expect(fixed.metrics.recalculated).toBe(4);
    expect(fixed.diagnostics).toEqual([]);
    expect(new ValueGraph().update(parse('@self = "{self}"'), 1).values.self.status).toBe('cycle');
  });

  it('rejects stale and duplicate revisions without corrupting current values', () => {
    const graph = new ValueGraph();
    const current = graph.update(parse('@a = "new"'), 10);
    expect(graph.update(parse('@a = "old"'), 9)).toBe(current);
    expect(graph.update(parse('@a = "same revision"'), 10)).toBe(current);
    expect(graph.getValue('a').value).toBe('new');
  });

  it('cancels atomically and can accept the next revision afterward', () => {
    const graph = new ValueGraph();
    graph.update(parse('@a = "original"'), 1);
    let polls = 0;
    expect(() => graph.update(parse(chain(2000, 'cancel')), 2, { isCancelled: () => ++polls > 2 })).toThrow(CalculationCancelledError);
    expect(graph.getValue('a').value).toBe('original');
    expect(graph.getDefinition('v0')).toBeUndefined();
    expect(graph.update(parse('@a = "committed"'), 3).values.a.value).toBe('committed');
  });

  it('treats duplicate definitions as errors and updates after resolving the ambiguity', () => {
    const graph = new ValueGraph();
    const conflict = graph.update(parse('@a = "one"\n@a = "two"\n@b = "{a}"'), 1);
    expect(conflict.values.a.status).toBe('error');
    expect(conflict.values.b.status).toBe('error');
    const fixed = graph.update(parse('@a = "one"\n@b = "{a}"'), 2);
    expect(fixed.values.b.value).toBe('one');
    expect(fixed.metrics.recalculated).toBe(2);
  });

  it('supports 12,000-node chains, repeated changes, and a deep cycle without recursion', () => {
    const graph = new ValueGraph();
    const source = chain(12_000, 'start');
    let result = graph.update(parse(source), 1);
    expect(result.values.v11999.value).toBe('start');
    result = graph.update(parse(source.replace('"start"', '"updated"')), 2);
    expect(result.values.v11999.value).toBe('updated');
    expect(result.metrics.recalculated).toBe(12_000);
    result = graph.update(parse(source.replace('"start"', '"{v11999}"')), 3);
    expect(result.values.v11999.status).toBe('cycle');
  }, 15_000);

  it('bounds exponential formatted-string expansion and propagated error messages', () => {
    const source = Array.from({ length: 2000 }, (_, i) => `@v${i} = "${i ? `{v${i - 1}}{v${i - 1}}` : 'x'}"`).join('\n');
    const graph = new ValueGraph({ maxValueLength: 1024 });
    const result = graph.update(parse(source), 1);
    expect(result.values.v10.value.length).toBe(1024);
    expect(result.values.v11.status).toBe('error');
    expect(result.values.v1999.status).toBe('error');
    expect(result.values.v1999.message!.length).toBeLessThanOrEqual(512);
  });

  it('bounds aggregate cache size and retries previously limited values after deletion frees space', () => {
    const graph = new ValueGraph({ maxTotalValueLength: 10 });
    const result = graph.update(parse('@a = "12345678"\n@b = "abcd"\n@c = "{b}"'), 1);
    expect(result.values.a.status).toBe('ok');
    expect(result.values.b.status).toBe('error');
    expect(result.values.c.status).toBe('error');
    const freed = graph.update(parse('@b = "abcd"\n@c = "{b}"'), 2);
    expect(freed.values.b.value).toBe('abcd');
    expect(freed.values.c.value).toBe('abcd');
    expect(freed.diagnostics).toEqual([]);
  });

  it('updates only one shared branch under repeated small edits', () => {
    const graph = new ValueGraph();
    const original = '@left = "L"\n@right = "R"\n@l1 = "{left}"\n@l2 = "{left}"\n@r1 = "{right}"\n@join = "{l1}:{l2}:{r1}"';
    graph.update(parse(original), 1);
    for (let revision = 2; revision <= 50; revision++) {
      const result = graph.update(parse(original.replace('"L"', `"${revision}"`)), revision);
      expect(result.values.join.value).toBe(`${revision}:${revision}:R`);
      expect(result.metrics.recalculated).toBe(4);
    }
  });

  it('resolves record fields through the same graph and protects object prototype identifiers', () => {
    const parsed = buildKnowledge([{ id: 'n', title: 'n', markdown: '@__proto__ = "safe"\n@label = "{aura.flame.label}"', revision: 1, updatedAt: '' }], [{ id: 'r', collection: 'aura', name: 'flame', fields: { label: '{__proto__} fire' }, revision: 1 }]);
    const result = new ValueGraph().update(parsed, 1);
    expect(result.values.label.value).toBe('safe fire');
    expect(result.values.__proto__.value).toBe('safe');
    expect(Object.getPrototypeOf(result.values)).toBeNull();
  });

  it('does not confuse Map method or Object prototype names with cached values or duplicates', () => {
    const graph = new ValueGraph();
    const source = '@constructor = "C"\n@toString = "T"\n@__proto__ = "P"\n@get = "{constructor}{toString}{__proto__}"\n{{get}}';
    expect(graph.update(parse(source), 1).values.get.value).toBe('CTP');
    const duplicate = graph.update(parse(source + '\n@__proto__ = "duplicate"'), 2);
    expect(duplicate.values.__proto__.status).toBe('error');
    expect(duplicate.values.get.status).toBe('error');
    expect(graph.getValue('constructor').status).toBe('ok');
    expect(graph.update(parse(source), 3).values.get.value).toBe('CTP');
  });

  it('matches fresh calculation across deterministic adversarial graph edits', () => {
    const graph = new ValueGraph();
    let seed = 11235813;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    const definitions = new Map<string, string>();
    for (let i = 0; i < 35; i++) definitions.set(`v${i}`, `${i}`);
    for (let revision = 1; revision <= 200; revision++) {
      const name = `v${Math.floor(random() * 35)}`;
      const operation = random();
      if (operation < 0.12) definitions.delete(name);
      else if (operation < 0.4) definitions.set(name, `text-${revision}`);
      else definitions.set(name, `{v${Math.floor(random() * 40)}}{v${Math.floor(random() * 40)}}`);
      const source = [...definitions].map(([id, template]) => `@${id} = ${JSON.stringify(template)}`).join('\n') + (revision % 13 === 0 ? '\n@v1 = "duplicate"' : '');
      const parsed = parse(source);
      const incremental = graph.update(parsed, revision);
      const fresh = new ValueGraph().update(parsed, revision);
      // Cache invalidation must not change either values or error categories.
      for (const id of new Set([...Object.keys(incremental.values), ...Object.keys(fresh.values)])) {
        expect(incremental.values[id]?.status, `${revision}: ${id}`).toBe(fresh.values[id]?.status);
        expect(incremental.values[id]?.value, `${revision}: ${id}`).toBe(fresh.values[id]?.value);
      }
    }
  });
});
