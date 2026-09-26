export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
let workspaceId = '';
export function setWorkspaceId(id: string) { workspaceId = id; }
export function workspaceHeaders(): Record<string, string> { return workspaceId ? { 'X-Grasp-Workspace': workspaceId } : {}; }
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, { method, headers: { ...workspaceHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || data.message || '操作失敗', response.status);
  return data as T;
}
