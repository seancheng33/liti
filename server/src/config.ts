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

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`配置错误: ${parsed.error.message}`);
  }
  return parsed.data;
}
