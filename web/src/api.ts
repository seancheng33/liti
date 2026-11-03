/**
 * 部署前缀，由 Vite 的 base 推导（构建时确定）。
 *
 * 根路径部署时是空串，挂子目录时是 '/liti' 这样的值。
 * 所有以 '/' 开头的前端资源地址都必须过一遍 withBase —— 少了这一步，
 * 子路径部署下请求会打到站根，被别的服务接走，页面就白了。
 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * 给站内绝对路径加上部署前缀。
 * 外部链接（http://、//、data:）和已经带前缀的路径原样返回，重复调用也安全。
 */
export function withBase(path: string): string {
  if (!BASE_PATH) return path;
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  return `${BASE_PATH}${path.startsWith('/') ? '' : '/'}${path}`;
}

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
  const res = await fetch(withBase(path), {
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
  const res = await fetch(withBase(path), {
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
