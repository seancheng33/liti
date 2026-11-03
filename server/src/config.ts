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
  /**
   * 演示模式开关。开启后：
   * - 注册 /api/demo/* （一键体验登录，不需要密码）
   * - 登录页显示三个「一键体验」按钮，全站顶部显示「演示环境」横幅
   *
   * **默认关闭，且只该在演示实例上开**。这个开关等于把账号密码这道门拆了，
   * 生产环境误开一次就是把后台交出去。所以只认字符串 '1'，
   * 不用 z.coerce.boolean —— 那个会把 'false' 也当成 true。
   */
  DEMO_MODE: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  /**
   * 是否信任反向代理传来的 X-Forwarded-For。
   *
   * 默认关：直连部署时开着它，任何客户端都能伪造 IP，把登录限流绕过去
   * （换个 X-Forwarded-For 就换一个桶）。只有在确实挂在 nginx/caddy 后面、
   * 且只有反代能访问到本进程时才该打开。
   */
  TRUST_PROXY: z
    .enum(['0', '1'])
    .default('0')
    .transform((v) => v === '1'),
  /**
   * 部署子路径。
   *
   * 挂到已有站点的子目录下（https://example.com/liti/）时填 '/liti/'；
   * 独占域名或直接开端口时填 '/'。默认 '/liti/'，因为 demo 这个分支就是为了
   * 挂在别人的子目录下演示而存在的。正式版（main）不受影响。
   *
   * **必须和前端构建时的 VITE_BASE_PATH 一致**。两处对不上不会报错，
   * 只会表现为页面空白（资源请求打到站根去了），所以 Dockerfile 里
   * 让 VITE_BASE_PATH 直接取这个变量的值，compose 只传一次。
   */
  BASE_PATH: z
    .string()
    .default('/liti/')
    .transform((raw) => {
      const v = raw.trim();
      if (!v || v === '/') return '/';
      const lead = v.startsWith('/') ? v : `/${v}`;
      return lead.endsWith('/') ? lead : `${lead}/`;
    }),
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
