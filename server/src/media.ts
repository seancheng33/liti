import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { workspaceRoot } from './paths.js';

/** 解析上传目录（相对路径按工作区根解析），并确保目录存在 */
export function resolveUploadDir(dir: string): string {
  const abs = isAbsolute(dir) ? dir : resolve(workspaceRoot, dir);
  mkdirSync(abs, { recursive: true });
  return abs;
}

/**
 * 只接受本站上传接口产出的相对地址，避免把 javascript:/data: 之类塞进 img src。
 * 形如 /uploads/questions/202610-xxxx.png
 */
const IMAGE_URL_RE = /^\/uploads\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i;

export function isSafeImageUrl(url: unknown): url is string {
  return typeof url === 'string' && IMAGE_URL_RE.test(url);
}

/** 从库里读出的 JSON 数组字符串 → 干净的图片地址数组 */
export function parseImageList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(isSafeImageUrl);
  } catch {
    return [];
  }
}

/** 入参 → 去重、限长、过滤非法地址后的数组 */
export function sanitizeImageList(list: unknown, max: number): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (isSafeImageUrl(item) && !out.includes(item)) out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/** 数组 → 存库用的 JSON 字符串；空数组存 null */
export function serializeImageList(list: string[]): string | null {
  return list.length ? JSON.stringify(list) : null;
}
