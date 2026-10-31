import { Button, Select, Space, Tooltip } from 'antd';
import { BgColorsOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../theme';

/**
 * 未登录时的公共外壳：页头（logo + 站名 + 帮助 + 主题）+ 内容区。
 * 首页和帮助页在没有登录态时共用它，保证导航不丢。
 */
export default function PublicShell({ children, siteName }: { children: React.ReactNode; siteName?: string }) {
  const { themeKey, presets, setThemeKey } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="liti-guest">
      <header className="liti-header liti-guest-header">
        <div className="liti-brand" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div className="liti-logo">砺</div>
          <div className="liti-brand-text">
            <span className="liti-brand-name">{siteName || '砺题 Liti'}</span>
            <span className="liti-brand-sub">千题磨一剑</span>
          </div>
        </div>
        <Space size={12}>
          <Tooltip title="使用说明与常见问题">
            <Button type="text" icon={<QuestionCircleOutlined />} onClick={() => navigate('/help')}>
              帮助
            </Button>
          </Tooltip>
          <Space size={6}>
            <BgColorsOutlined style={{ color: 'var(--liti-text-3)' }} />
            <Select
              size="small"
              variant="borderless"
              value={themeKey}
              style={{ width: 120 }}
              onChange={(v) => setThemeKey(v)}
              options={presets.map((p) => ({ value: p.key, label: p.name }))}
            />
          </Space>
        </Space>
      </header>

      <div className="liti-guest-main">{children}</div>
    </div>
  );
}
