import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本文件编译后位于 server/src/ 或 server/dist/，工作区根目录为上两级
const here = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = resolve(here, '..', '..');
export const webDistPath = join(workspaceRoot, 'web', 'dist');
export const defaultSqlitePath = join(workspaceRoot, 'data', 'app.db');
