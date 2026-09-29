/** Pure, privacy-allowlisted aggregation of browser evidence. Does not open files or run the app. */
type Data = Record<string, unknown>;
const object = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonnegative = (value: unknown): number | null => finite(value) !== null && (value as number) >= 0 ? value as number : null;
const cells = ['cold', 'idle', 'warm', 'noop', 'validation', 'graph', 'stress'] as const;
const spanNames = ['runtime.update', 'runtime.job', 'runtime.post', 'worker.parse', 'worker.graph',
  'app.queue.wait', 'app.action', 'app.flush', 'app.snapshot.apply', 'app.runtime.apply', 'app.note.render', 'app.mode.render',
  'api.request', 'api.request_json', 'api.fetch', 'api.response_json'] as const;
const derivedNames = ['runtime.post_to_worker_receive', 'runtime.worker_complete_to_receive', 'runtime.post_to_receive',
  'worker.graph.index', 'worker.graph.dirty', 'worker.graph.calculation'] as const;
const metricNames = ['browser.longtask', 'browser.frame_gap', 'browser.event.duration', 'browser.event.processing_delay',
  'browser.event.processing', ...spanNames, ...derivedNames] as const;
type MetricName = typeof metricNames[number];
const eventTypes = ['other', 'click', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'input', 'beforeinput'] as const;
const outcomes = ['ok', 'error', 'http_error', 'cancelled', 'timeout', 'superseded', 'destroyed', 'stale', 'unknown', 'observed', 'censored', 'missing'] as const;
type Outcome = typeof outcomes[number];
const fixedOutcome = (value: unknown): Outcome => outcomes.includes(value as Outcome) ? value as Outcome : 'unknown';
const id = (value: unknown): value is string => typeof value === 'string' && value.length <= 80 && /^(?:s\d+:)?(?:b[1-9]\d*|w[1-9]\d*-[1-9]\d*)$/.test(value);
const jobId = (value: unknown): value is string => typeof value === 'string' && value.length <= 80 && /^(?:s\d+:)?v[1-9]\d*$/.test(value);
interface Event { name: string; phase: string; id: string; lane: string; at: number; duration: number | null; outcome: Outcome; metrics: Data; job?: string }
interface Observation { name: MetricName; start: number; end: number; duration: number | null; outcome: Outcome; lowerBound?: number | null; eventType?: typeof eventTypes[number]; positionKnown?: boolean }
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: sorted.length ? sorted[Math.ceil(sorted.length * .5) - 1] : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1] : null, maxMs: sorted.at(-1) ?? null };
}
function clockEnvelope(report: Data) {
  const selected = Object.values(object(report.clocks)).flatMap(group => {
    const samples = list(object(group).browser).map(object).flatMap(sample => {
      const offset = finite(sample.offsetMs), uncertainty = nonnegative(sample.uncertaintyMs);
      return offset !== null && uncertainty !== null ? [{ offset, uncertainty }] : [];
    }).sort((a, b) => a.uncertainty - b.uncertainty);
    return samples.length ? [samples[0]] : [];
  });
  if (!selected.length) return { availability: 'unavailable' as const, calibrationGroups: 0, browserToRunnerOffsetMs: null, uncertaintyMs: null };
  const low = Math.min(...selected.map(sample => sample.offset - sample.uncertainty)), high = Math.max(...selected.map(sample => sample.offset + sample.uncertainty));
  return { availability: 'observed' as const, calibrationGroups: selected.length, browserToRunnerOffsetMs: (low + high) / 2, uncertaintyMs: (high - low) / 2 };
}
type Support = 'supported' | 'unsupported' | 'mixed' | 'unknown';
function support(events: Event[], key: string): Support {
  const values = events.filter(event => event.name === 'browser.observers').map(event => event.metrics[key]).filter(value => typeof value === 'boolean');
  return values.length === 0 ? 'unknown' : values.every(Boolean) ? 'supported' : values.every(value => !value) ? 'unsupported' : 'mixed';
}

export function aggregateBrowserPerformance(rawReport: unknown, rawBrowser: unknown) {
  const report = object(rawReport), browser = object(rawBrowser), present = Array.isArray(browser.events);
  const rawEvents = list(browser.events), events: Event[] = [], observations: Observation[] = [];
  let malformedEvents = 0, ignoredEvents = 0, duplicateSpans = 0, unmatchedTerminals = 0, missingTerminals = 0, invalidIntervals = 0;
  const acceptedNames = new Set<string>([...spanNames, 'browser.longtask', 'browser.frame_gap', 'browser.event', 'browser.observers', 'worker.receive', 'runtime.receive']);
  for (const raw of rawEvents) {
    const value = object(raw);
    if (typeof value.name !== 'string' || !acceptedNames.has(value.name)) { ignoredEvents++; continue; }
    const at = nonnegative(value.at);
    const expectedLane = value.name.startsWith('worker.') ? 'browser-worker' : 'browser-main';
    if (value.version !== 1 || at === null || value.lane !== expectedLane || !id(value.id) || !['start', 'end', 'instant', 'sample'].includes(String(value.phase))
      || (['browser.observers', 'worker.receive', 'runtime.receive'].includes(value.name) && value.phase !== 'instant')) { malformedEvents++; continue; }
    events.push({ name: value.name, phase: String(value.phase), id: value.id, lane: expectedLane, at, duration: nonnegative(value.durationMs),
      outcome: fixedOutcome(value.outcome), metrics: object(value.metrics), ...(jobId(value.jobId) ? { job: value.jobId } : {}) });
  }
  const capabilities = { longtask: support(events, 'longtaskSupported'), eventTiming: support(events, 'eventTimingSupported'),
    observerInstallSuccess: 'not-recorded', eventTimingThresholdMs: 16, frameGapThresholdMs: 50 };
  const clock = clockEnvelope(report);
  const cellIntervals = list(report.cells).map(object).flatMap(cell => {
    const start = nonnegative(cell.start), end = nonnegative(cell.end);
    return cells.includes(cell.name as typeof cells[number]) && start !== null && end !== null && end >= start ? [{ name: cell.name as string, start, end }] : [];
  });
  const lowerBounds = new Map<string, number>();
  for (const transition of list(browser.transitions ?? report.browserSessionTransitions).map(object)) for (const pending of list(transition.unclosedSpans).map(object)) {
    const bound = nonnegative(pending.observedLowerBoundMs); if (id(pending.id) && bound !== null) lowerBounds.set(pending.id, bound);
  }
  const push = (name: MetricName, start: number, end: number, duration: number | null, outcome: Outcome, extra: Partial<Observation> = {}) => {
    if (end < start) { invalidIntervals++; duration = null; end = start; }
    observations.push({ name, start, end, duration, outcome, ...extra });
  };
  const spans = new Map<string, { starts: Event[]; ends: Event[] }>();
  for (const event of events) {
    if ((spanNames as readonly string[]).includes(event.name)) {
      if (event.phase !== 'start' && event.phase !== 'end') { malformedEvents++; continue; }
      const key = `${event.lane}:${event.id}:${event.name}`, pair = spans.get(key) ?? { starts: [], ends: [] };
      pair[event.phase === 'start' ? 'starts' : 'ends'].push(event); spans.set(key, pair);
    } else if (['browser.longtask', 'browser.frame_gap', 'browser.event'].includes(event.name)) {
      if (event.phase !== 'sample') { malformedEvents++; continue; }
      // PerformanceObserver entries carry their START; frame gaps carry their END.
      const start = event.name === 'browser.frame_gap' ? event.at - (event.duration ?? 0) : event.at;
      const end = event.name === 'browser.frame_gap' ? event.at : event.at + (event.duration ?? 0);
      if (event.name === 'browser.event') {
        const code = nonnegative(event.metrics.typeCode), eventType = code !== null && Number.isInteger(code) ? eventTypes[code] ?? 'other' : 'other';
        const delay = nonnegative(event.metrics.processingDelayMs), processing = nonnegative(event.metrics.processingMs);
        push('browser.event.duration', start, end, event.duration, 'observed', { eventType, positionKnown: event.duration !== null });
        push('browser.event.processing_delay', start, start + (delay ?? 0), delay, 'observed', { eventType, positionKnown: delay !== null });
        push('browser.event.processing', start + (delay ?? 0), start + (delay ?? 0) + (processing ?? 0), processing, 'observed', { eventType, positionKnown: delay !== null && processing !== null });
      } else push(event.name as MetricName, start, end, event.duration, 'observed', { positionKnown: event.duration !== null });
    }
  }
  for (const pair of spans.values()) {
    if (pair.starts.length > 1 || pair.ends.length > 1) { duplicateSpans++; continue; }
    const start = pair.starts[0], end = pair.ends[0], name = (start ?? end).name as MetricName;
    if (!end) {
      missingTerminals++; const lowerBound = lowerBounds.get(start.id) ?? null;
      push(name, start.at, start.at + (lowerBound ?? 0), null, 'censored', { lowerBound }); continue;
    }
    if (!start) unmatchedTerminals++;
    const duration = end.duration ?? (start && end.at >= start.at ? end.at - start.at : null);
    push(name, start?.at ?? end.at - (duration ?? 0), end.at, duration, end.outcome);
    if (name === 'worker.graph') for (const [key, metric] of [['indexMs', 'worker.graph.index'], ['dirtyMs', 'worker.graph.dirty'], ['calculationMs', 'worker.graph.calculation']] as const)
      push(metric, start?.at ?? end.at - (duration ?? 0), end.at, nonnegative(end.metrics[key]), end.outcome);
  }
  // IDs are used only for joins and never returned. Superseded workers may never deliver their telemetry.
  const jobs = new Map<string, Event[]>();
  for (const event of events) if (event.job && ['runtime.post', 'runtime.receive', 'runtime.job', 'worker.receive', 'worker.parse', 'worker.graph'].includes(event.name)) {
    const job = jobs.get(event.job) ?? []; job.push(event); jobs.set(event.job, job);
  }
  let ambiguousJobLinks = 0;
  for (const job of jobs.values()) {
    let ambiguous = false;
    const unique = (name: string, phase: string) => { const matches = job.filter(event => event.name === name && event.phase === phase); if (matches.length > 1) { ambiguousJobLinks++; ambiguous = true; } return matches.length === 1 ? matches[0] : undefined; };
    const post = unique('runtime.post', 'start'), received = unique('runtime.receive', 'instant'), workerReceived = unique('worker.receive', 'instant');
    const workerDone = unique('worker.graph', 'end') ?? unique('worker.parse', 'end'), jobEnd = unique('runtime.job', 'end');
    if (!post) continue;
    for (const [name, start, end] of [
      ['runtime.post_to_worker_receive', post, workerReceived], ['runtime.worker_complete_to_receive', workerDone, received], ['runtime.post_to_receive', post, received],
    ] as const) {
      if (start && end && !ambiguous) push(name, start.at, end.at, end.at >= start.at ? end.at - start.at : null, 'observed');
      else push(name, post.at, jobEnd?.at ?? post.at, null, jobEnd && jobEnd.outcome !== 'ok' ? jobEnd.outcome : 'missing');
    }
  }
  let boundaryUncertain = 0, outsideCells = 0, noClock = 0, unknownInterval = 0;
  const attributed = observations.map(observation => {
    if (observation.positionKnown === false) { unknownInterval++; return { ...observation, cell: 'unattributed' }; }
    if (clock.browserToRunnerOffsetMs === null || clock.uncertaintyMs === null) { noClock++; return { ...observation, cell: 'unattributed' }; }
    const start = observation.start + clock.browserToRunnerOffsetMs, end = observation.end + clock.browserToRunnerOffsetMs, uncertainty = clock.uncertaintyMs;
    const matches = cellIntervals.filter(cell => start - uncertainty >= cell.start && end + uncertainty <= cell.end);
    if (matches.length === 1) return { ...observation, cell: matches[0].name };
    if (cellIntervals.some(cell => end + uncertainty >= cell.start && start - uncertainty <= cell.end)) boundaryUncertain++; else outsideCells++;
    return { ...observation, cell: 'unattributed' };
  });
  function summary(selected: Observation[], name: MetricName) {
    const capability = name === 'browser.longtask' ? capabilities.longtask : name.startsWith('browser.event.') ? capabilities.eventTiming : 'unknown';
    const values = selected.flatMap(item => item.duration === null ? [] : [item.duration]);
    const outcomeCounts = Object.fromEntries(outcomes.map(outcome => [outcome, selected.filter(item => item.outcome === outcome).length]));
    const censored = selected.filter(item => ['censored', 'timeout', 'cancelled', 'superseded', 'destroyed', 'stale'].includes(item.outcome));
    return { availability: !present ? 'unavailable' : selected.length ? 'observed' : capability === 'unsupported' ? 'unsupported'
      : capability === 'supported' ? 'supported-no-samples' : 'missing', observations: selected.length, outcomes: outcomeCounts,
      missingDuration: selected.filter(item => item.duration === null).length, censored: censored.length,
      allObserved: distribution(values), successfulOnly: distribution(selected.flatMap(item => item.outcome === 'ok' && item.duration !== null ? [item.duration] : [])),
      observedSamples: distribution(selected.flatMap(item => item.outcome === 'observed' && item.duration !== null ? [item.duration] : [])),
      censoredLowerBounds: distribution(censored.flatMap(item => item.lowerBound !== null && item.lowerBound !== undefined ? [item.lowerBound] : item.duration !== null ? [item.duration] : [])) };
  }
  function scope(selected: Observation[]) {
    const longtasks = selected.filter(item => item.name === 'browser.longtask' && item.duration !== null);
    return { metrics: Object.fromEntries(metricNames.map(name => [name, summary(selected.filter(item => item.name === name), name)])),
      longTasksAtLeast200Ms: longtasks.length ? longtasks.filter(item => item.duration !== null && item.duration >= 200).length : null,
      eventTimingByType: Object.fromEntries(eventTypes.map(type => [type, Object.fromEntries((['browser.event.duration', 'browser.event.processing_delay', 'browser.event.processing'] as const)
        .map(name => [name, summary(selected.filter(item => item.name === name && item.eventType === type), name)]))])) };
  }
  return { version: 1, availability: present ? 'observed' as const : 'unavailable' as const, rawEventCount: present ? rawEvents.length : null,
    acceptedEventCount: events.length, malformedEvents, ignoredEvents, capabilities, clock,
    integrity: { duplicateSpans, unmatchedTerminals, missingTerminals, invalidIntervals, ambiguousJobLinks,
      droppedEvents: nonnegative(browser.dropped), droppedIntents: nonnegative(browser.droppedIntents), activeIntents: nonnegative(browser.activeIntents) },
    attribution: { method: 'whole-interval-inside-cell-with-clock-envelope', boundaryUncertain, outsideCells, noClock, unknownInterval,
      publicationOverlap: 'not-computed; temporal coincidence would not establish causation' },
    global: scope(attributed), byCell: Object.fromEntries([...cells, 'unattributed'].map(cell => [cell, scope(attributed.filter(item => item.cell === cell))])),
    interpretation: [
      'Browser PerformanceObserver longtask/event timestamps are starts; frame-gap timestamps and span terminals are ends.',
      'Cell attribution requires the complete observed interval plus calibration uncertainty inside one cell. Boundary-crossing and uncalibrated observations remain unattributed.',
      'Longtasks and EventTiming are sampled browser observations, not successful application operations. Supported entry types do not prove observer installation or exhaustive delivery.',
      'EventTiming duration is browser reported and thresholded at 16 ms; processing delay and processing execution are separate. It is not the native-input-to-painted-pixel measurement.',
      'Only visible frame gaps above 50 ms are recorded. Missing samples are not zero latency or proof of absence.',
      'Post-to-worker-receive combines synchronous postMessage cloning, transfer, queueing and dispatch; worker-complete-to-main-receive includes unobserved result preparation, transfer and dispatch. These are not pure queue times.',
      'API response_json includes response-body delivery and decoding, not isolated JSON CPU. Nested stage durations and worker graph breakdowns are not additive.',
      'Cancelled, superseded, destroyed and timed-out work retains observed elapsed/lower bounds; workers terminated before reply can have missing worker telemetry.',
    ] };
}

export function renderBrowserPerformanceMarkdown(value: ReturnType<typeof aggregateBrowserPerformance>): string[] {
  const fmt = (number: number | null) => number === null ? 'unavailable' : number.toFixed(2);
  const lines = ['Browser evidence', '', `Raw evidence: ${value.availability}; events: ${value.rawEventCount ?? 'unavailable'}. Longtask capability: ${value.capabilities.longtask}; EventTiming capability: ${value.capabilities.eventTiming}.`, '',
    '| Scope | Metric | Samples | Successful / non-successful / raw observed | All observed p50 / p95 / max ms | Successful p95 ms | Censored / missing duration | Longtasks ≥200 ms |',
    '| --- | --- | ---: | --- | --- | ---: | --- | ---: |'];
  for (const [cell, group] of [['global', value.global], ...Object.entries(value.byCell)] as const) for (const name of metricNames) {
    const metric = group.metrics[name]; if (!metric.observations && cell !== 'global') continue;
    lines.push(`| ${cell} | ${name} | ${metric.observations || metric.availability} | ${metric.outcomes.ok} / ${metric.observations - metric.outcomes.ok - metric.outcomes.observed} / ${metric.outcomes.observed} | ${[metric.allObserved.p50Ms, metric.allObserved.p95Ms, metric.allObserved.maxMs].map(fmt).join(' / ')} | ${fmt(metric.successfulOnly.p95Ms)} | ${metric.censored} / ${metric.missingDuration} | ${name === 'browser.longtask' ? group.longTasksAtLeast200Ms ?? 'unavailable' : '—'} |`);
  }
  lines.push('', `Observed longtasks ≥200 ms: ${value.global.longTasksAtLeast200Ms ?? 'unavailable'}.`, '', ...value.interpretation.map(text => `- ${text}`), '');
  return lines;
}
