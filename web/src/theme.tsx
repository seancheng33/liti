import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme as antdTheme, type ThemeConfig } from 'antd';
import zhCN from 'antd/locale/zh_CN';

export interface ThemePreset {
  key: string;
  name: string;
  colorPrimary: string;
  /** 主题色块（用于选择器预览） */
  swatch: string;
  dark?: boolean;
}

export const THEME_PRESETS: ThemePreset[] = [
  { key: 'blue', name: '青蓝', colorPrimary: '#1677ff', swatch: '#1677ff' },
  { key: 'green', name: '竹绿', colorPrimary: '#00a870', swatch: '#00a870' },
  { key: 'purple', name: '远山紫', colorPrimary: '#722ed1', swatch: '#722ed1' },
  { key: 'orange', name: '暖橙', colorPrimary: '#fa8c16', swatch: '#fa8c16' },
  { key: 'cyan', name: '深海青', colorPrimary: '#13a8a8', swatch: '#13a8a8' },
  { key: 'rose', name: '绯红', colorPrimary: '#e8386f', swatch: '#e8386f' },
  { key: 'geek', name: '墨黑（深色）', colorPrimary: '#1668dc', swatch: '#1f1f1f', dark: true },
];

export const DEFAULT_THEME_KEY = 'blue';
const STORAGE_KEY = 'liti-theme';

export function isKnownTheme(key: string | null | undefined): key is string {
  return !!key && THEME_PRESETS.some((t) => t.key === key);
}

export function buildThemeConfig(key: string): ThemeConfig {
  const preset = THEME_PRESETS.find((t) => t.key === key) ?? THEME_PRESETS[0];
  return {
    algorithm: preset.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: preset.colorPrimary,
      colorLink: preset.colorPrimary,
      borderRadius: 6,
      fontSize: 14,
    },
  };
}

function readStoredTheme(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isKnownTheme(v) ? v : DEFAULT_THEME_KEY;
  } catch {
    return DEFAULT_THEME_KEY;
  }
}

interface ThemeContextValue {
  themeKey: string;
  isDark: boolean;
  config: ThemeConfig;
  presets: ThemePreset[];
  setThemeKey: (key: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>(null as unknown as ThemeContextValue);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeKey, setKey] = useState<string>(() => readStoredTheme());

  const config = useMemo(() => buildThemeConfig(themeKey), [themeKey]);

  // 页面底色跟随主题，避免深色主题下边缘露白
  useEffect(() => {
    const token = antdTheme.getDesignToken(config);
    document.body.style.background = token.colorBgLayout;
    document.body.style.color = token.colorText;
    document.documentElement.style.colorScheme = THEME_PRESETS.find((t) => t.key === themeKey)?.dark
      ? 'dark'
      : 'light';

    // 让 message / Modal.confirm 等静态方法也走当前主题
    ConfigProvider.config({
      holderRender: (children) => (
        <ConfigProvider locale={zhCN} theme={config}>
          {children}
        </ConfigProvider>
      ),
    });
  }, [config, themeKey]);

  const setThemeKey = useCallback((key: string) => {
    const next = isKnownTheme(key) ? key : DEFAULT_THEME_KEY;
    setKey(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 隐私模式下忽略 */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeKey,
      isDark: !!THEME_PRESETS.find((t) => t.key === themeKey)?.dark,
      config,
      presets: THEME_PRESETS,
      setThemeKey,
    }),
    [themeKey, config, setThemeKey],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
