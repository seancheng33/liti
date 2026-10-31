import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authenticate } from '../plugins/auth.js';
import { requireRole } from '../rbac.js';

// 站点配置项定义（key -> 默认值 + 校验）
const SETTING_DEFS: Record<string, { default: string; label: string; type: 'string' | 'number' | 'boolean' }> = {
  site_name: { default: '砺题 Liti', label: '站点名称', type: 'string' },
  site_announcement: { default: '', label: '站点公告', type: 'string' },
  default_duration_sec: { default: '3600', label: '默认考试时长（秒）', type: 'number' },
  default_pass_score: { default: '60', label: '默认及格分', type: 'number' },
  practice_enabled: { default: 'true', label: '学生自助练习', type: 'boolean' },
};

const settingsSchema = z.object({
  siteName: z.string().min(1).max(64).optional(),
  siteAnnouncement: z.string().max(500).optional(),
  defaultDurationSec: z.number().int().min(60).max(86400).optional(),
  defaultPassScore: z.number().int().min(0).max(100).optional(),
  practiceEnabled: z.boolean().optional(),
});

async function loadSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.selectFrom('setting').select(['key', 'value']).execute();
  const result: Record<string, string> = {};
  for (const key of Object.keys(SETTING_DEFS)) result[key] = SETTING_DEFS[key].default;
  for (const r of rows) if (r.key in SETTING_DEFS) result[r.key] = r.value;
  return result;
}

function normalize(values: Record<string, string>) {
  return {
    siteName: values.site_name,
    siteAnnouncement: values.site_announcement,
    defaultDurationSec: Number(values.default_duration_sec),
    defaultPassScore: Number(values.default_pass_score),
    practiceEnabled: values.practice_enabled === 'true',
  };
}

export async function settingRoutes(app: FastifyInstance, opts: { db: Db }): Promise<void> {
  const { db } = opts;

  // 公开信息（登录页展示站点名与公告；练习开关前端也要用，无需登录）
  app.get('/public', async () => {
    const values = await loadSettings(db);
    return {
      siteName: values.site_name,
      siteAnnouncement: values.site_announcement,
      practiceEnabled: values.practice_enabled === 'true',
    };
  });

  // 读取配置（登录即可读，前端展示站点名/公告/练习开关）
  app.get('/', async (request) => {
    authenticate(request);
    return normalize(await loadSettings(db));
  });

  // 保存配置（仅管理员）
  app.put('/', async (request) => {
    const user = authenticate(request);
    requireRole(user, 'admin');
    const body = settingsSchema.parse(request.body);
    const now = Date.now();

    const entries: { key: string; value: string }[] = [];
    if (body.siteName !== undefined) entries.push({ key: 'site_name', value: body.siteName });
    if (body.siteAnnouncement !== undefined) entries.push({ key: 'site_announcement', value: body.siteAnnouncement });
    if (body.defaultDurationSec !== undefined) entries.push({ key: 'default_duration_sec', value: String(body.defaultDurationSec) });
    if (body.defaultPassScore !== undefined) entries.push({ key: 'default_pass_score', value: String(body.defaultPassScore) });
    if (body.practiceEnabled !== undefined) entries.push({ key: 'practice_enabled', value: String(body.practiceEnabled) });

    for (const e of entries) {
      // SQLite/MySQL 双方言兼容：先查再插入或更新，避免 ON CONFLICT 方言差异
      const existing = await db.selectFrom('setting').select('key').where('key', '=', e.key).executeTakeFirst();
      if (existing) {
        await db.updateTable('setting').set({ value: e.value, updated_at: now }).where('key', '=', e.key).execute();
      } else {
        await db.insertInto('setting').values({ key: e.key, value: e.value, updated_at: now }).execute();
      }
    }

    return normalize(await loadSettings(db));
  });
}
