import type { Definition, Diagnostic, ParseResult, Reference, RuntimeResult, ValueResult } from './model';
import { parseTemplate, type TemplatePart } from './template';

export interface GraphLimits { maxValueLength?: number; maxTotalValueLength?: number }
export interface GraphUpdateOptions { isCancelled?: () => boolean }
export class CalculationCancelledError extends Error { constructor() { super('Calculation superseded or cancelled.'); this.name = 'CalculationCancelledError'; } }
interface Node { definition: Definition; parts: TemplatePart[]; signature: string; duplicate: boolean }
const missing = (name: string): ValueResult => ({ value: '', status: 'missing', message: `Identifier “${name}” is not defined.`.slice(0, 512) });

/** Pure, replaceable calculation engine. No eval, recursion, database or UI objects. */
export class ValueGraph {
  private nodes = new Map<string, Node>();
  private reverse = new Map<string, Set<string>>();
  private cache = new Map<string, ValueResult>();
  private references = new Map<string, Reference[]>();
  private budgetLimited = new Set<string>();
  private latest?: RuntimeResult;
  private readonly maxValueLength: number;
  private readonly maxTotalValueLength: number;

  constructor(limits: GraphLimits = {}) {
    this.maxValueLength = limits.maxValueLength ?? 65_536;
    this.maxTotalValueLength = limits.maxTotalValueLength ?? 16_777_216;
  }

  getDefinition(name: string): Definition | undefined { return this.nodes.get(name)?.definition; }
  findReferences(name: string): readonly Reference[] { return this.references.get(name) ?? []; }
  getValue(name: string): ValueResult { return this.cache.get(name) ?? missing(name); }

  /** A transaction candidate may be calculated and discarded without changing committed state. */
  fork(): ValueGraph {
    const candidate = new ValueGraph({ maxValueLength: this.maxValueLength, maxTotalValueLength: this.maxTotalValueLength });
    candidate.nodes = new Map(this.nodes); candidate.reverse = new Map(this.reverse);
    candidate.cache = new Map(this.cache); candidate.references = new Map(this.references);
    candidate.budgetLimited = new Set(this.budgetLimited); candidate.latest = this.latest;
    return candidate;
  }

  /** Refresh exact source locations after cache serialization, without recalculating values. */
  reindex(parsed: ParseResult): RuntimeResult | undefined {
    if (!this.latest) return;
    const references = new Map<string, Reference[]>();
    for (const reference of parsed.references) {
      const entries = references.get(reference.name) ?? []; entries.push(reference); references.set(reference.name, entries);
    }
    for (const definition of parsed.definitions) {
      const previous = this.nodes.get(definition.name);
      if (previous) this.nodes.set(definition.name, { ...previous, definition });
    }
    this.references = references;
    const diagnostics = [...parsed.diagnostics];
    for (const reference of parsed.references) if (!this.nodes.has(reference.name)) diagnostics.push({ kind: 'missing', name: reference.name,
      location: reference.location, message: `Identifier “${reference.name}” is not defined.` });
    for (const diagnostic of this.latest.diagnostics) if (diagnostic.kind === 'cycle' || diagnostic.kind === 'limit') {
      diagnostics.push({ ...diagnostic, location: diagnostic.name ? this.nodes.get(diagnostic.name)?.definition.location : diagnostic.location });
    }
    this.latest = { ...this.latest, definitions: parsed.definitions, references: parsed.references, diagnostics };
    return this.latest;
  }

  update(parsed: ParseResult, revision: number, options: GraphUpdateOptions = {}): RuntimeResult {
    // A late worker result or retried snapshot may never replace newer state.
    if (this.latest && revision <= this.latest.revision) return this.latest;
    const started = performance.now();
    const checkCancelled = () => { if (options.isCancelled?.()) throw new CalculationCancelledError(); };
    checkCancelled();
    const next = new Map<string, Node>();
    const reverse = new Map<string, Set<string>>();
    for (const definition of parsed.definitions) {
      const existing = next.get(definition.name);
      if (existing) { existing.duplicate = true; continue; }
      const signature = JSON.stringify([definition.parts?.map(part => part.kind === 'literal' ? ['literal', part.value] : ['identifier', part.name]) ?? definition.template, definition.dependencies]);
      const previous = this.nodes.get(definition.name);
      const parts: TemplatePart[] = previous?.signature === signature ? previous.parts : definition.parts
        ? definition.parts.map(part => part.kind === 'literal' ? { kind: 'text', text: part.value }
          : { kind: 'reference', name: part.name, from: part.location?.from ?? 0, to: part.location?.to ?? 0 })
        : parseTemplate(definition.template);
      next.set(definition.name, { definition, signature, parts, duplicate: false });
      for (const dependency of definition.dependencies) {
        let dependents = reverse.get(dependency);
        if (!dependents) reverse.set(dependency, dependents = new Set());
        dependents.add(definition.name);
      }
    }
    const dirtyStarted = performance.now();
    const changed = new Set<string>();
    for (const [name, node] of next) {
      const previous = this.nodes.get(name);
      if (!previous || previous.signature !== node.signature || previous.duplicate !== node.duplicate) changed.add(name);
    }
    for (const name of this.nodes.keys()) if (!next.has(name)) changed.add(name);
    // Previously refused values can become valid when another value shrinks or
    // is deleted. Include their dependents in the normal invalidation closure.
    if (changed.size) for (const name of this.budgetLimited) changed.add(name);
    const affected = new Set(changed);
    const queue = [...changed];
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i];
      for (const index of [this.reverse, reverse]) for (const dependent of index.get(name) ?? []) {
        if (!affected.has(dependent)) { affected.add(dependent); queue.push(dependent); }
      }
    }
    const dirtyMs = performance.now() - dirtyStarted;
    const calculationStarted = performance.now();
    // Work against detached state; cancellation cannot leave a half-updated cache.
    const cache = new Map(this.cache);
    for (const name of affected) cache.delete(name);
    let cachedCharacters = 0;
    for (const value of cache.values()) cachedCharacters += value.value.length;
    let recalculated = 0;
    const done = new Set<string>();
    const budgetLimited = new Set([...this.budgetLimited].filter(name => !affected.has(name)));
    const setValue = (name: string, value: ValueResult) => {
      if (done.has(name)) return;
      if (value.status === 'ok' && cachedCharacters + value.value.length > this.maxTotalValueLength) {
        value = { value: '', status: 'error', message: `Workspace calculated text exceeds ${this.maxTotalValueLength.toLocaleString()} characters.` };
        budgetLimited.add(name);
      }
      cache.set(name, value); cachedCharacters += value.value.length; done.add(name); recalculated++;
    };
    // Explicit DFS frames allow 10k+ chains without exhausting the JS call stack.
    for (const root of affected) {
      if (!next.has(root) || done.has(root)) continue;
      const frames: { name: string; cursor: number }[] = [{ name: root, cursor: 0 }];
      const active = new Map<string, number>([[root, 0]]);
      while (frames.length) {
        if ((recalculated & 255) === 0) checkCancelled();
        const frame = frames[frames.length - 1];
        const node = next.get(frame.name)!;
        if (done.has(frame.name)) { active.delete(frame.name); frames.pop(); continue; }
        if (node.duplicate) { setValue(frame.name, { value: '', status: 'error', message: `Identifier “${frame.name}” has duplicate definitions.`.slice(0, 512) }); continue; }
        const dependencies = node.definition.dependencies;
        if (frame.cursor < dependencies.length) {
          const dependency = dependencies[frame.cursor++];
          if (!next.has(dependency) || cache.has(dependency)) continue;
          const cycleStart = active.get(dependency);
          if (cycleStart !== undefined) {
            const cycleNames = frames.slice(cycleStart).map(f => f.name);
            const description = (cycleNames.slice(0, 8).join(' → ') + (cycleNames.length > 8 ? ' → …' : ` → ${dependency}`)).slice(0, 480);
            for (const name of cycleNames) setValue(name, { value: '', status: 'cycle', message: `Dependency cycle: ${description}` });
            continue;
          }
          active.set(dependency, frames.length); frames.push({ name: dependency, cursor: 0 }); continue;
        }
        let value = '';
        let failure: ValueResult | undefined;
        const chunks: string[] = [];
        let length = 0;
        for (const part of node.parts) {
          let chunk: string;
          if (part.kind === 'text') chunk = part.text;
          else {
            const resolved = cache.get(part.name) ?? missing(part.name);
            if (resolved.status !== 'ok') { failure = { ...resolved, message: `“${frame.name}” depends on “${part.name}”: ${resolved.message ?? resolved.status}`.slice(0, 512) }; break; }
            chunk = resolved.value;
          }
          length += chunk.length;
          if (length > this.maxValueLength) { failure = { value: '', status: 'error', message: `Calculated value exceeds ${this.maxValueLength.toLocaleString()} characters.` }; break; }
          chunks.push(chunk);
        }
        if (!failure) value = chunks.join('');
        setValue(frame.name, failure ?? { value, status: 'ok' });
      }
    }
    checkCancelled();
    const calculationMs = performance.now() - calculationStarted;
    const indexStarted = performance.now();
    const referenceIndex = new Map<string, Reference[]>();
    const diagnostics = [...parsed.diagnostics];
    for (const reference of parsed.references) {
      let entries = referenceIndex.get(reference.name);
      if (!entries) referenceIndex.set(reference.name, entries = []);
      entries.push(reference);
      if (!next.has(reference.name)) diagnostics.push({ kind: 'missing', name: reference.name, location: reference.location, message: `Identifier “${reference.name}” is not defined.` });
    }
    const indexMs = performance.now() - indexStarted;
    for (const [name, result] of cache) {
      // Direct duplicate declarations already have parser diagnostics. An
      // inherited error is visible in the value without inventing a limit error.
      if (result.status === 'cycle' || result.status === 'error' && /^(Calculated value|Workspace calculated text)/.test(result.message ?? '')) diagnostics.push({ kind: result.status === 'cycle' ? 'cycle' : 'limit', name, location: next.get(name)?.definition.location, message: result.message! });
    }
    const values: Record<string, ValueResult> = Object.create(null);
    for (const [name, value] of cache) values[name] = value;
    const result: RuntimeResult = { revision, values, definitions: parsed.definitions, references: parsed.references, diagnostics, metrics: { elapsedMs: performance.now() - started, recalculated, total: next.size, affected: [...affected].filter(name => next.has(name)).length, indexMs, dirtyMs, calculationMs } };
    this.nodes = next; this.reverse = reverse; this.cache = cache; this.references = referenceIndex; this.budgetLimited = budgetLimited; this.latest = result;
    return result;
  }
}
