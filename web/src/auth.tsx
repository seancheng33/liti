import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { useTheme } from './theme';
import type { AuthUser } from './types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 切换界面主题：本地立即生效，同时写回账号偏好 */
  applyTheme: (key: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>(null as unknown as AuthContextValue);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { themeKey, setThemeKey } = useTheme();

  async function refresh() {
    try {
      const me = await api.get<AuthUser>('/api/auth/me');
      setUser(me);
      // 账号里存的主题优先（换台机器登录也能保持自己的配色）
      if (me.theme && me.theme !== themeKey) setThemeKey(me.theme);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // 只在首次挂载时拉一次会话
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(username: string, password: string) {
    await api.post('/api/auth/login', { username, password });
    await refresh();
  }

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    setUser(null);
  }

  async function applyTheme(key: string) {
    setThemeKey(key);
    if (user) await api.put('/api/auth/profile', { theme: key }).catch(() => {});
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, applyTheme }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
