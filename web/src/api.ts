export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** 后端返回的结构化附加信息（如查重命中的题目） */
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let msg = `请求失败(${res.status})`;
    let details: unknown;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
      details = data?.details;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg, details);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export async function uploadXlsx(path: string, buffer: ArrayBuffer): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    body: buffer,
  });
  if (!res.ok) {
    let msg = `请求失败(${res.status})`;
    let details: unknown;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
      details = data?.details;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg, details);
  }
  return res.json();
}
