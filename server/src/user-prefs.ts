/**
 * 用户个人偏好（目前只有界面主题），以 JSON 字符串存在 user.prefs。
 * 解析失败一律退回空对象，避免脏数据把登录流程搞挂。
 */
export interface UserPrefs {
  theme?: string;
}

export function parsePrefs(raw: string | null | undefined): UserPrefs {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as UserPrefs;
  } catch {
    /* 脏数据忽略 */
  }
  return {};
}

export function serializePrefs(prefs: UserPrefs): string {
  return JSON.stringify(prefs);
}
