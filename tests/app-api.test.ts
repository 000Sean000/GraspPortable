import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, DEFAULT_GET_TIMEOUT_MS, FILES_INSPECTION_TIMEOUT_MS, FILE_LOCATION_TIMEOUT_MESSAGE, FILE_LOCATION_TIMEOUT_MS, isRequestCancellation, request, requestFileLocation, RequestCancelledError, setWorkspaceId } from '../src/app/api';

function response(data: unknown, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: vi.fn().mockResolvedValue(data) } as unknown as Response;
}

describe('application API request lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    setWorkspaceId('test-workspace');
  });

  afterEach(() => {
    setWorkspaceId('');
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('times out a hanging GET and aborts its fetch signal without retrying', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    const pending = request('/files/status');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({ 'X-Grasp-Workspace': 'test-workspace' });

    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError', reason: 'timeout', message: '讀取逾時，請重試。' });
    await vi.advanceTimersByTimeAsync(DEFAULT_GET_TIMEOUT_MS);
    await rejection;
    expect(isRequestCancellation(new RequestCancelledError('timeout'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets a large workspace inspection GET run for five minutes instead of the default 30 seconds', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const pending = request('/projection/state', 'GET', undefined, { timeoutMs: FILES_INSPECTION_TIMEOUT_MS });
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError', reason: 'timeout', message: '讀取逾時，請重試。' });

    expect(FILES_INSPECTION_TIMEOUT_MS).toBe(300_000);
    await vi.advanceTimersByTimeAsync(DEFAULT_GET_TIMEOUT_MS);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(FILES_INSPECTION_TIMEOUT_MS - DEFAULT_GET_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels when the caller aborts, settles even if fetch ignores the signal, and does not retry', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const caller = new AbortController();
    const pending = request('/projection/state', 'POST', {}, { signal: caller.signal });
    caller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', reason: 'caller', message: '已取消讀取。' });
    await vi.advanceTimersByTimeAsync(DEFAULT_GET_TIMEOUT_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the timeout active while response JSON is being read', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    } as unknown as Response);

    const pending = request('/files/status', 'GET', undefined, { timeoutMs: 25 });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError', reason: 'timeout', message: '讀取逾時，請重試。' });
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans the timer and caller abort listener after a successful response', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response({ value: 7 }));
    const caller = new AbortController();
    const addListener = vi.spyOn(caller.signal, 'addEventListener');
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    await expect(request<{ value: number }>('/workspace', 'GET', undefined, { signal: caller.signal, timeoutMs: 100 })).resolves.toEqual({ value: 7 });
    expect(addListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeListener).toHaveBeenCalledWith('abort', addListener.mock.calls[0]![1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves HTTP errors and cleans up after parsing their response', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response({ error: 'Conflict' }, false, 409));
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    await expect(request('/notes', 'PUT', { title: 'x' }, { signal: caller.signal, timeoutMs: 100 })).rejects.toEqual(expect.objectContaining(new ApiError('Conflict', 409)));
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not apply a default timeout to mutations', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(response({ saved: true }));

    await expect(request<{ saved: boolean }>('/notes', 'POST', { title: 'safe' })).resolves.toEqual({ saved: true });
    expect(fetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives file-location POSTs five minutes, reports that host work may continue, and does not retry', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const body = { kind: 'note', id: 'note-1' };
    const pending = requestFileLocation<{ path: string }>('/files/locate', body);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'AbortError', reason: 'timeout', message: FILE_LOCATION_TIMEOUT_MESSAGE,
    });

    expect(FILE_LOCATION_TIMEOUT_MS).toBe(300_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: JSON.stringify(body) });
    await vi.advanceTimersByTimeAsync(FILE_LOCATION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
