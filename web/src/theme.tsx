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

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';

export function isKnownTheme(key: string | null | undefined): key is string {
  return !!key && THEME_PRESETS.some((t) => t.key === key);
}

export function buildThemeConfig(key: string): ThemeConfig {
  const preset = THEME_PRESETS.find((t) => t.key === key) ?? THEME_PRESETS[0];
  return {
    algorithm: preset.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: preset.colorPrimary,
      colorInfo: preset.colorPrimary,
      colorLink: preset.colorPrimary,
      colorLinkHover: preset.colorPrimary,
      borderRadius: 8,
      borderRadiusLG: 14,
      fontSize: 14,
      fontFamily: FONT_FAMILY,
      controlHeight: 34,
      wireframe: false,
    },
    components: {
      Layout: {
        headerHeight: 64,
        headerPadding: '0 24px',
        headerBg: 'transparent',
        bodyBg: 'transparent',
        siderBg: 'transparent',
      },
      Menu: {
        itemBorderRadius: 10,
        itemMarginInline: 8,
        itemMarginBlock: 4,
        itemHeight: 42,
        iconSize: 16,
        collapsedIconSize: 18,
        itemBg: 'transparent',
        subMenuItemBg: 'transparent',
      },
      Card: {
        borderRadiusLG: 16,
        paddingLG: 22,
        headerFontSize: 16,
        headerHeight: 52,
      },
      Table: {
        headerSplitColor: 'transparent',
        cellPaddingBlock: 12,
        headerBorderRadius: 10,
      },
      Button: { fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none' },
      Modal: { borderRadiusLG: 18, paddingContentHorizontalLG: 24 },
      Tabs: { titleFontSize: 15, horizontalItemPadding: '10px 0' },
      Statistic: { contentFontSize: 26 },
      Tag: { borderRadiusSM: 6 },
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

  // 把设计 token 暴露成 CSS 变量，全局样式表据此跟随主题（深色下不会露白）
  useEffect(() => {
    const token = antdTheme.getDesignToken(config);
    const root = document.documentElement;
    const vars: Record<string, string> = {
      '--liti-primary': token.colorPrimary,
      '--liti-primary-soft': token.colorPrimaryBg,
      '--liti-primary-border': token.colorPrimaryBorder,
      '--liti-bg': token.colorBgLayout,
      '--liti-surface': token.colorBgContainer,
      '--liti-surface-2': token.colorFillQuaternary,
      '--liti-border': token.colorBorderSecondary,
      '--liti-border-strong': token.colorBorder,
      '--liti-text': token.colorText,
      '--liti-text-2': token.colorTextSecondary,
      '--liti-text-3': token.colorTextTertiary,
      '--liti-radius': `${token.borderRadiusLG}px`,
      '--liti-shadow': token.boxShadowTertiary,
    };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

    document.body.style.background = token.colorBgLayout;
    document.body.style.color = token.colorText;
    root.style.colorScheme = THEME_PRESETS.find((t) => t.key === themeKey)?.dark ? 'dark' : 'light';

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
