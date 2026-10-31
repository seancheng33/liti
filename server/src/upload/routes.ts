import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { HttpError } from '../http-error.js';
import { resolveUploadDir } from '../media.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';

/** 单张图片上限（解码后） */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const uploadSchema = z.object({
  /** data URL：data:image/png;base64,xxxx */
  data: z.string().min(1),
});

/**
 * 题目配图上传。
 * 为了不引入 multipart 依赖，前端把图片读成 data URL 用 JSON 提交。
 */
export async function uploadRoutes(app: FastifyInstance, opts: { config: Config }): Promise<void> {
  const uploadRoot = resolveUploadDir(opts.config.UPLOAD_DIR);

  app.post('/', { bodyLimit: 12 * 1024 * 1024 }, async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin', 'teacher');

    const body = uploadSchema.parse(request.body);
    const matched = /^data:(image\/[A-Za-z+.-]+);base64,([\s\S]+)$/.exec(body.data.trim());
    if (!matched) throw new HttpError(400, '图片格式不正确（需要 data URL）');

    const mime = matched[1].toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) throw new HttpError(400, '只支持 PNG / JPEG / WEBP / GIF 图片');

    const buffer = Buffer.from(matched[2], 'base64');
    if (!buffer.length) throw new HttpError(400, '图片内容为空');
    if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(400, '图片不能超过 4MB');

    const bucket = 'questions';
    const dir = join(uploadRoot, bucket);
    mkdirSync(dir, { recursive: true });

    const stamp = new Date().toISOString().slice(0, 7).replace('-', '');
    const name = `${stamp}-${randomUUID()}.${ext}`;
    writeFileSync(join(dir, name), buffer);

    return { url: `/uploads/${bucket}/${name}`, size: buffer.length };
  });
}
