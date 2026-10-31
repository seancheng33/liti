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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

/** 上传一张题目配图，返回可直接放进 <img src> 的相对地址 */
export async function uploadImage(file: File): Promise<string> {
  if (file.size > 4 * 1024 * 1024) throw new Error('图片不能超过 4MB');
  const data = await fileToDataUrl(file);
  const res = await request<{ url: string }>('/api/uploads', { method: 'POST', body: { data } });
  return res.url;
}
