import { z } from 'zod';
import { defaultSqlitePath, defaultUploadDir } from './paths.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),
  DB_DRIVER: z.enum(['sqlite', 'mysql']).default('sqlite'),
  SQLITE_PATH: z.string().default(defaultSqlitePath),
  UPLOAD_DIR: z.string().default(defaultUploadDir),
  MYSQL_URL: z.string().optional(),
  SESSION_SECRET: z.string().min(16).default('dev-secret-change-me-please'),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60 * 1000),
  AUTH_PROVIDERS: z.string().default('local'),
});

export type Config = z.infer<typeof envSchema>;

/**
 * 把 zod 的 issue 翻成一句人话。
 * 默认的 `parsed.error.message` 是一段 JSON，贴在容器日志里基本没人看得懂 ——
 * 而配置错误恰恰是「容器起来就退」最常见的原因，所以这里单独把人能看懂的信息写出来。
 */
function describeIssue(issue: z.ZodIssue, env: Record<string, string | undefined>): string {
  const key = issue.path.join('.') || '(env)';
  const actual = env[key];

  if (key === 'SESSION_SECRET' && issue.code === 'too_small') {
    return `  ${key} 太短：当前 ${String(actual ?? '').length} 个字符，至少需要 16 个。`
      + `生成方法：openssl rand -hex 32`;
  }
  if (issue.code === 'invalid_enum_value') {
    return `  ${key} 取值不合法：当前是 "${String(actual ?? '')}"`;
  }
  if (key === 'PORT' || key === 'SESSION_TTL_MS') {
    return `  ${key} 必须是正整数：当前是 "${String(actual ?? '')}"`;
  }
  return `  ${key}：${issue.message}`;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => describeIssue(issue, env)).join('\n');
    throw new Error(`配置错误：\n${detail}`);
  }
  return parsed.data;
}
