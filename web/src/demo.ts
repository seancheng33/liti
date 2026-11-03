import { useEffect, useState } from 'react';
import { api, withBase } from './api';

/**
 * 演示模式的公共逻辑。
 *
 * `/api/demo/info` 在正式部署里是不存在的（路由压根没注册），请求会 404，
 * 于是 loadDemoInfo() 返回 null，所有演示 UI 自动不渲染 ——
 * 这样同一份前端代码既能上生产也能上演示站，不用编两个版本。
 */
export interface DemoAccount {
  role: 'admin' | 'teacher' | 'student';
  username: string;
  label: string;
  hint: string;
}

export interface DemoInfo {
  siteName: string;
  resetHint: string;
  accounts: DemoAccount[];
}

/** 缓存请求：登录页和主布局都会问一次，没必要发两遍 */
let cache: Promise<DemoInfo | null> | null = null;

export function loadDemoInfo(): Promise<DemoInfo | null> {
  if (!cache) {
    cache = api
      .get<DemoInfo>('/api/demo/info')
      .then((d) => (d && (d as unknown as { demo?: boolean }).demo ? d : null))
      .catch(() => null);
  }
  return cache;
}

export function useDemoInfo(): DemoInfo | null {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  useEffect(() => {
    let alive = true;
    loadDemoInfo().then((d) => {
      if (alive) setInfo(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

/** 一键进入某个角色。成功后整页刷新 —— 会话变了，内存里的路由状态和缓存都不该留 */
export async function demoLogin(role: string): Promise<void> {
  await api.post('/api/demo/login', { role });
  // 换身份要整页刷新；子路径部署时这里必须带上前缀，否则跳到站点根跑到别人家去了
  window.location.href = withBase('/');
}
