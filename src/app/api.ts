import { apiMetrics, browserPerformance, safeRequestId, type PerfOutcome, type PerfSpan } from '../diagnostics/performance';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export const DEFAULT_GET_TIMEOUT_MS = 30_000;
export const FILES_INSPECTION_TIMEOUT_MS = 300_000;
export const FILE_LOCATION_TIMEOUT_MS = 300_000;
export const FILE_LOCATION_TIMEOUT_MESSAGE = '定位等待逾時；檔案檢查或 checkpoint 可能仍在執行。請先查看 Markdown 狀態再重試。';

export interface RequestOptions {
  signal?: AbortSignal;
  /** Set to 0 to disable the default GET timeout for this request. */
  timeoutMs?: number;
  /** Optional localized message used when timeoutMs expires. */
  timeoutMessage?: string;
}

export class RequestCancelledError extends Error {
  constructor(public readonly reason: 'caller' | 'timeout', message?: string) {
    super(message ?? (reason === 'timeout' ? '讀取逾時，請重試。' : '已取消讀取。'));
    this.name = 'AbortError';
  }
}

export function isRequestCancellation(error: unknown): boolean {
  return error instanceof RequestCancelledError || (error instanceof Error && error.name === 'AbortError');
}

let workspaceId = '';
export function setWorkspaceId(id: string) { workspaceId = id; }
export function workspaceHeaders(): Record<string, string> { return workspaceId ? { 'X-Grasp-Workspace': workspaceId } : {}; }
function observedJson(body: unknown, parentId?: string): string | undefined {
  const encoding = browserPerformance.start('api.request_json', {}, { parentId }); let succeeded = false;
  try { const result = JSON.stringify(body); succeeded = true; return result; }
  finally { encoding?.end(succeeded ? 'ok' : 'error'); }
}
export async function request<T>(path: string, method = 'GET', body?: unknown, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? (method.toUpperCase() === 'GET' ? DEFAULT_GET_TIMEOUT_MS : 0);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError('timeoutMs must be a finite, non-negative number.');
  const metrics = browserPerformance.enabled ? apiMetrics(path, method) : undefined;
  const observation = browserPerformance.start('api.request', metrics);
  let fetching: PerfSpan | undefined, decoding: PerfSpan | undefined, requestId: string | undefined;
  let outcome: PerfOutcome = 'error';

  let cancellation: RequestCancelledError | undefined;
  let resolveCancellation!: (error: RequestCancelledError) => void;
  const cancelled = new Promise<RequestCancelledError>(resolve => { resolveCancellation = resolve; });
  const cancel = (reason: 'caller' | 'timeout') => {
    if (cancellation) return;
    browserPerformance.emit('api.cancel', 'instant', metrics, { parentId: observation?.id, outcome: reason === 'timeout' ? 'timeout' : 'cancelled' });
    cancellation = new RequestCancelledError(reason, reason === 'timeout' ? options.timeoutMessage : undefined);
    resolveCancellation(cancellation);
    controller.abort(cancellation);
  };
  const onCallerAbort = () => cancel('caller');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const raceCancellation = async <TResult>(pending: Promise<TResult>): Promise<TResult> => {
    const outcome = await Promise.race([
      pending.then(value => ({ value } as const)),
      cancelled.then(error => ({ error } as const)),
    ]);
    if ('error' in outcome) throw outcome.error;
    return outcome.value;
  };

  if (options.signal?.aborted) cancel('caller');
  else options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  if (!cancellation && timeoutMs > 0) timer = setTimeout(() => cancel('timeout'), timeoutMs);

  try {
    const init: RequestInit = {
      method,
      headers: { ...workspaceHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : browserPerformance.enabled ? observedJson(body, observation?.id) : JSON.stringify(body),
      signal: controller.signal,
    };
    fetching = browserPerformance.start('api.fetch', metrics, { parentId: observation?.id });
    const response = await raceCancellation(fetch('/api' + path, init));
    const responseMetrics: Record<string, number> = { status: response.status };
    if (browserPerformance.enabled) requestId = safeRequestId(response.headers?.get('x-grasp-perf-request'));
    if (browserPerformance.enabled) {
      const length = response.headers?.get('content-length');
      if (length && /^(?:0|[1-9]\d*)$/.test(length) && Number.isSafeInteger(Number(length))) responseMetrics.responseContentLength = Number(length);
    }
    fetching?.end('ok', responseMetrics, { requestId });
    decoding = browserPerformance.start('api.response_json', metrics, { parentId: observation?.id, requestId });
    const data = await raceCancellation(Promise.resolve().then(() => response.json()));
    decoding?.end('ok', responseMetrics);
    if (!response.ok) throw new ApiError(data.error || data.message || '操作失敗', response.status);
    outcome = 'ok';
    return data as T;
  } catch (error) {
    outcome = cancellation ? cancellation.reason === 'timeout' ? 'timeout' : 'cancelled' : error instanceof ApiError ? 'http_error' : 'error';
    if (cancellation) throw cancellation;
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
    fetching?.end(outcome, {}, { requestId }); decoding?.end(outcome); observation?.end(outcome, {}, { requestId });
  }
}

/** Read-only file lookup can trigger a full integrity check; timeout stops waiting, not host work. */
export function requestFileLocation<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, 'POST', body, { timeoutMs: FILE_LOCATION_TIMEOUT_MS, timeoutMessage: FILE_LOCATION_TIMEOUT_MESSAGE });
}
