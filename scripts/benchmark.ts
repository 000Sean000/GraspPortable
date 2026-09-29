import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { buildKnowledge } from '../src/domain/knowledge';
import { ValueGraph } from '../src/domain/graph';
import type { Note, RuntimeResult, StructuredRecord } from '../src/domain/model';
import { executeQuery, parseQuery } from '../src/editor/query';
import { WorkspaceStore } from '../server/store';
import { evidenceDirectory } from './evidence-path';

const round = (value: number) => Math.round(value * 100) / 100;
const note = (markdown: string, id = 'benchmark'): Note => ({ id, title: 'Synthetic benchmark', folderId: null, markdown, revision: 1, updatedAt: '' });
const duration = <T>(run: () => T): { value: T; ms: number } => { const start = performance.now(); const value = run(); return { value, ms: round(performance.now() - start) }; };
const stats = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: samples.length, minMs: round(sorted[0]), medianMs: round(sorted[Math.floor(sorted.length / 2)]), p95Ms: round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]), maxMs: round(sorted.at(-1)!) };
};
const chainSource = (count: number, suffix = '') => Array.from({ length: count }, (_, i) => `@v${i} = "${i ? `{v${i - 1}}${suffix}` : 'seed'}"`).join('\n');
const graphMetrics = (result: RuntimeResult) => Object.fromEntries(Object.entries(result.metrics).map(([key, value]) => [key, round(value!)]));

function graphCase(source: string, last: string, expected: string) {
  const graph = new ValueGraph();
  const parse = duration(() => buildKnowledge([note(source)]));
  const result = graph.update(parse.value, 1);
  assert.equal(result.values[last].value, expected);
  assert.equal(result.values[last].status, 'ok');
  const editParse = duration(() => buildKnowledge([note(source.replace('"seed"', '"changed"'))]));
  const changed = graph.update(editParse.value, 2);
  assert.equal(changed.values[last].value, expected.replaceAll('seed', 'changed'));
  const lookups = duration(() => { let count = 0; for (let i = 0; i < 100_000; i++) { const key = `v${i % 20_000}`; count += graph.findReferences(key).length; if (graph.getDefinition(key)) count++; } return count; });
  return { definitions: result.metrics.total, references: parse.value.references.length, parseMs: parse.ms, initial: graphMetrics(result), rootEditParseMs: editParse.ms, rootEdit: graphMetrics(changed), definitionAndReferenceLookup100kMs: lookups.ms, lookupChecksum: lookups.value };
}

function repeatedEdits() {
  const stable = Array.from({ length: 10_000 }, (_, i) => `@stable${i} = "${i}"`).join('\n');
  const source = `${stable}\n@edit = "initial"\n@a = "{edit}"\n@b = "{edit}"\n@joined = "{a}:{b}"`;
  const graph = new ValueGraph();
  graph.update(buildKnowledge([note(source)]), 1);
  const whole: number[] = [], parsing: number[] = [], calculations: number[] = [], dirty: number[] = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    const parsed = duration(() => buildKnowledge([note(source.replace('"initial"', `"value-${i}"`))]));
    const result = graph.update(parsed.value, i + 2);
    whole.push(performance.now() - start); parsing.push(parsed.ms); calculations.push(result.metrics.elapsedMs); dirty.push(result.metrics.dirtyMs!);
    assert.equal(result.metrics.recalculated, 4);
    assert.equal(result.metrics.affected, 4);
    assert.equal(result.values.joined.value, `value-${i}:value-${i}`);
  }
  return { totalDefinitions: 10_004, affectedPerEdit: 4, recalculatedPerEdit: 4, parseAndGraph: stats(whole), parse: stats(parsing), graph: stats(calculations), dirtyPropagation: stats(dirty) };
}

function structuredQuery() {
  const records: StructuredRecord[] = Array.from({ length: 10_000 }, (_, i) => ({ id: `r${i}`, collection: 'aura', name: `a${i}`, revision: 1, fields: { label: `Aura ${i}`, element: i % 3 === 0 ? 'fire' : 'water', description: `{seed}: ${i}` } }));
  const parsed = duration(() => buildKnowledge([note('@seed = "Collection"')], records));
  const runtime = new ValueGraph().update(parsed.value, 1);
  const query = parseQuery('{"collection":"aura","where":{"field":"element","equals":"fire"}}');
  const times: number[] = [];
  for (let i = 0; i < 100; i++) {
    const result = duration(() => executeQuery(query, records, runtime));
    assert.equal(result.value.total, 3334); assert.equal(result.value.rows.length, 200); assert.equal(result.value.truncated, true); times.push(result.ms);
  }
  return { records, report: { records: records.length, fields: 30_000, parseMs: parsed.ms, graph: graphMetrics(runtime), query: stats(times), matchingRows: 3334, renderedRowCap: 200 } };
}

function workspaceLoading(records: StructuredRecord[]) {
  const cacheRoot = resolve('.cache'); mkdirSync(cacheRoot, { recursive: true });
  const directory = mkdtempSync(join(cacheRoot, 'benchmark-'));
  assert.ok(resolve(directory).startsWith(cacheRoot + sep));
  const path = join(directory, 'synthetic.grasp.db');
  try {
    let store = new WorkspaceStore(path, { create: true });
    try { store.applyImport({ notes: [note('@seed = "Collection"\n' + chainSource(20_000))], records }, store.snapshot().revision); } finally { store.close(); }
    const bytes = statSync(path).size;
    const runs = [];
    for (let i = 0; i < 2; i++) {
      const start = performance.now();
      const opened = duration(() => { store = new WorkspaceStore(path); return store.snapshot(); });
      try {
        const parsed = duration(() => buildKnowledge(opened.value.notes, opened.value.records));
        const runtime = new ValueGraph().update(parsed.value, opened.value.revision);
        assert.equal(runtime.values.v19999.value, 'seed');
        assert.equal(runtime.values['aura.a9999.description'].value, 'Collection: 9999');
        assert.equal(runtime.diagnostics.length, 0);
        runs.push({ databaseOpenAndReadMs: opened.ms, parseMs: parsed.ms, graph: graphMetrics(runtime), totalMs: round(performance.now() - start), notes: opened.value.notes.length, records: opened.value.records.length });
      } finally { store.close(); }
    }
    return { databaseBytes: bytes, coldAppLoad: runs[0], warmReopen: runs[1], note: 'Fresh graph each time; operating-system disk cache was not flushed.' };
  } finally {
    assert.ok(resolve(directory).startsWith(cacheRoot + sep));
    rmSync(directory, { recursive: true, force: true });
  }
}

function memoryGrowth() {
  const gc = (globalThis as { gc?: () => void }).gc;
  const graph = new ValueGraph();
  const source = chainSource(2000);
  const update = (revision: number) => graph.update(buildKnowledge([note(source.replace('"seed"', `"v${revision % 10}"`))]), revision);
  update(1); gc?.();
  const samples = [{ iteration: 0, heapUsedMB: round(process.memoryUsage().heapUsed / 1048576), rssMB: round(process.memoryUsage().rss / 1048576) }];
  for (let i = 1; i <= 100; i++) {
    update(i + 1);
    if (i % 10 === 0) { gc?.(); samples.push({ iteration: i, heapUsedMB: round(process.memoryUsage().heapUsed / 1048576), rssMB: round(process.memoryUsage().rss / 1048576) }); }
  }
  assert.equal(graph.getValue('v1999').status, 'ok');
  return { workload: '100 replacements of the same 2,000-node graph', explicitGc: Boolean(gc), samples, heapGrowthMB: round(samples.at(-1)!.heapUsedMB - samples[0].heapUsedMB), note: gc ? 'Explicit full GC before every recorded sample; not a leak-free proof.' : 'No explicit GC: heap includes uncollected allocation; rerun node --expose-gc --import tsx scripts/benchmark.ts.' };
}

function realVault(path: string) {
  const root = resolve(path);
  assert.ok(existsSync(root), 'Vault path does not exist');
  const files: string[] = [];
  const pending = [root];
  while (pending.length) for (const entry of readdirSync(pending.pop()!, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const full = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) pending.push(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(full);
  }
  files.sort();
  const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(files.length <= 10_000 && totalBytes <= 50 * 1024 * 1024, 'Vault exceeds bounded benchmark (10k Markdown files / 50 MiB).');
  const manifest = createHash('sha256');
  const read = duration(() => files.map((file, i) => { const content = readFileSync(file); manifest.update(relative(root, file)); manifest.update('\0'); manifest.update(content); return note(content.toString('utf8'), `private-${i}`); }));
  const before = manifest.digest('hex');
  const parsed = duration(() => buildKnowledge(read.value));
  const graph = new ValueGraph().update(parsed.value, 1);
  const afterHash = createHash('sha256');
  for (const file of files) { afterHash.update(relative(root, file)); afterHash.update('\0'); afterHash.update(readFileSync(file)); }
  const after = afterHash.digest('hex');
  assert.equal(after, before, 'Source corpus changed during benchmark');
  return { corpus: 'User-provided local MainVault (read-only, anonymous aggregate only)', markdownFiles: files.length, bytes: totalBytes, readMs: read.ms, parseAndReferenceDiscoveryMs: parsed.ms, graph: graphMetrics(graph), references: parsed.value.references.length, definitions: parsed.value.definitions.length, diagnosticCount: graph.diagnostics.length, sourceUnchanged: before === after, sourceManifestSha256: before, note: 'Existing legacy syntax is not migrated. This measures Markdown scanning and current Grasp grammar only, not full legacy reference semantics.' };
}

const structured = structuredQuery();
const deep = graphCase(chainSource(20_000), 'v19999', 'seed');
const wide = graphCase('@seed = "seed"\n' + Array.from({ length: 20_000 }, (_, i) => `@v${i} = "{seed}:${i}"`).join('\n'), 'v19999', 'seed:19999');
const mixed = graphCase('@seed = "seed"\n' + Array.from({ length: 5000 }, (_, i) => `@v${i * 3} = "{seed}"\n@v${i * 3 + 1} = "{v${i * 3}}:{seed}"\n@v${i * 3 + 2} = "{v${i * 3}}-{v${i * 3 + 1}}"`).join('\n'), 'v14999', 'seed-seed:seed');
const cascade = graphCase(chainSource(5000, '.'), 'v4999', 'seed' + '.'.repeat(4999));
const vaultFlag = process.argv.indexOf('--vault');
const report = {
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  scope: 'Actual production knowledge parser, calculation engine, SQLite adapter, and record query; synthetic fixtures contain no personal content.',
  deepChain20k: deep, wideFanout20k: wide, mixedGraph15k: mixed, formattedCascade5k: cascade,
  frequentSmallEdits: repeatedEdits(), recordQuery10k: structured.report, persistence: workspaceLoading(structured.records), memory: memoryGrowth(),
  mainVault: vaultFlag >= 0 ? realVault(process.argv[vaultFlag + 1]) : { skipped: true, reason: 'Optional: pass --vault <directory>; only aggregate statistics are saved.' },
  browserResponsiveness: 'Measured separately by browser end-to-end test; this script does not claim editor latency.',
};
const output = evidenceDirectory('legacy-domain-benchmark');
writeFileSync(join(output, 'latest.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(output, `${report.generatedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 2) + '\n');
const row = (label: string, value: typeof deep) => `| ${label} | ${value.definitions.toLocaleString()} | ${value.parseMs} | ${value.initial.elapsedMs} | ${value.initial.indexMs} | ${value.rootEdit.elapsedMs} |`;
const vaultReport = 'markdownFiles' in report.mainVault ? `已讀取 MainVault **${report.mainVault.markdownFiles} 份 Markdown / ${report.mainVault.bytes} bytes**，檔案讀取 ${report.mainVault.readMs} ms、Markdown parsing/reference discovery ${report.mainVault.parseAndReferenceDiscoveryMs} ms。前後完整檔案 manifest SHA-256 相同。只保存匿名統計；沒有複製內容。現有舊語法不自動轉換，這不是 legacy value sync 相容性宣稱。` : '本次未指定 MainVault；可用 --vault 指向 read-only corpus 重跑。';
writeFileSync(resolve(output, 'PERFORMANCE.md'), `# Performance evidence\n\n執行時間：${report.generatedAt}。環境：${report.environment.node} / ${report.environment.platform} ${report.environment.arch} / ${report.environment.cpu}。\n\n重跑：\n\n\`\`\`sh\nnpm run benchmark\nnode --expose-gc --import tsx scripts/benchmark.ts --vault "<MainVault directory>"\n\`\`\`\n\n完整數值與可機讀樣本：[benchmarks/latest.json](latest.json)。這是本機單輪量測，不是跨機保證；benchmark 內有 correctness assertions。Parse 與每次 update 都使用成品模組。\n\n| Workload | Identifiers | Parse ms | Graph build ms | Reference index ms | Root edit graph ms |\n|---|---:|---:|---:|---:|---:|\n${row('Deep chain', deep)}\n${row('Wide fan-out', wide)}\n${row('Shared mixed graph', mixed)}\n${row('Formatted cascade', cascade)}\n\n- **小幅反覆更新**：10,004 個 identifiers，100 次修改每次只重算 4 個。Parse + graph median ${report.frequentSmallEdits.parseAndGraph.medianMs} ms / p95 ${report.frequentSmallEdits.parseAndGraph.p95Ms} ms；graph median ${report.frequentSmallEdits.graph.medianMs} ms。仍會掃描文件與重建索引，並非已實作全文件 incremental parsing。\n- **查找**：deep-chain graph 100,000 次 definition + references indexed lookup 共 ${deep.definitionAndReferenceLookup100kMs} ms（每次各一次，結果有 checksum）。\n- **Structured query**：10,000 records / 30,000 fields，100 次篩選 median ${report.recordQuery10k.query.medianMs} ms / p95 ${report.recordQuery10k.query.p95Ms} ms；符合 3,334 筆，view 上限 200 筆。\n- **Database reopen**：${report.persistence.databaseBytes} bytes；fresh app load + parse + graph ${report.persistence.coldAppLoad.totalMs} ms，warm reopen ${report.persistence.warmReopen.totalMs} ms。兩者皆用新的 engine；沒有清除 OS disk cache，所以不宣稱硬碟冷快取量測。\n- **Memory**：固定 2,000-node graph 反覆替換 100 次，${report.memory.explicitGc ? '每 10 次強制 GC 後取樣' : '未強制 GC'}，heap delta ${report.memory.heapGrowthMB} MiB。RSS/heap 全樣本在 JSON；有限測試不等於沒有 memory leak。\n- **Editor responsiveness**：另由瀏覽器 E2E 量測；這份 Node benchmark 不把 worker 計算時間當成輸入延遲。\n\n${vaultReport}\n\n安全限制：每個 rendered value 最多 65,536 characters，graph cache 最多 16,777,216 characters；超出會顯示 limit error 並讓 App 保持可操作。Cycle/missing/duplicate 不執行任意程式碼；stale revision 被拒絕。\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
