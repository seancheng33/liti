import { useEffect, useState } from 'react';
import { Avatar, Button, Dropdown, Layout, Menu, Space, Tag, Typography, theme as antdTheme } from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  CheckOutlined,
  FileTextOutlined,
  HomeOutlined,
  LogoutOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import { useTheme } from '../theme';

const ROLE_LABEL: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };
const ROLE_COLOR: Record<string, string> = { admin: 'red', teacher: 'blue', student: 'green' };

export default function AppLayout({ children }: { children?: React.ReactNode }) {
  const { user, logout, applyTheme } = useAuth();
  const { themeKey, presets, isDark } = useTheme();
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const [siteName, setSiteName] = useState('砺题 Liti');

  useEffect(() => {
    api
      .get<{ siteName: string }>('/api/settings/public')
      .then((s) => {
        const name = s.siteName || '砺题 Liti';
        setSiteName(name);
        document.title = name;
      })
      .catch(() => {});
  }, []);

  const isManager = !!user && user.role !== 'student';
  const isAdmin = user?.role === 'admin';

  const items = [
    { key: '/', icon: <HomeOutlined />, label: '首页' },
    { key: '/papers', icon: <FileTextOutlined />, label: '试卷' },
    { key: '/practice', icon: <ThunderboltOutlined />, label: '练习中心' },
    { key: '/attempts', icon: <ProfileOutlined />, label: '我的答卷' },
    { key: '/wrong', icon: <WarningOutlined />, label: '错题本' },
    ...(isManager
      ? [
          { key: '/questions', icon: <ReadOutlined />, label: '题库' },
          { key: '/categories', icon: <AppstoreOutlined />, label: '分类管理' },
          { key: '/groups', icon: <ApartmentOutlined />, label: '学生分组' },
          { key: '/stats', icon: <BarChartOutlined />, label: '统计' },
        ]
      : []),
    ...(isManager
      ? [{ key: '/users', icon: <TeamOutlined />, label: isAdmin ? '用户管理' : '学生管理' }]
      : []),
    ...(isAdmin ? [{ key: '/settings', icon: <SettingOutlined />, label: '网站管理' }] : []),
    { type: 'divider' as const },
    { key: '/help', icon: <QuestionCircleOutlined />, label: '帮助' },
  ];

  const selectedKey = location.pathname.startsWith('/exam')
    ? '/papers'
    : location.pathname.startsWith('/review')
      ? '/attempts'
      : location.pathname;

  const themeMenu = {
    items: presets.map((p) => ({
      key: p.key,
      label: (
        <Space>
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: 4,
              background: p.swatch,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          />
          <span>{p.name}</span>
          {p.key === themeKey && <CheckOutlined style={{ fontSize: 12, color: token.colorPrimary }} />}
        </Space>
      ),
    })),
    onClick: ({ key }: { key: string }) => applyTheme(key),
    selectedKeys: [themeKey],
  };

  const userMenu = {
    items: [
      {
        key: 'profile',
        label: (
          <Space>
            <UserOutlined />
            个人设置
          </Space>
        ),
      },
      { type: 'divider' as const },
      {
        key: 'logout',
        label: (
          <Space>
            <LogoutOutlined />
            退出登录
          </Space>
        ),
      },
    ],
    onClick: async ({ key }: { key: string }) => {
      if (key === 'profile') navigate('/profile');
      if (key === 'logout') {
        await logout();
        navigate('/login');
      }
    },
  };

  return (
    <div className="liti-shell">
      <header className="liti-header">
        <div className="liti-brand">
          <div className="liti-logo">砺</div>
          <div className="liti-brand-text">
            <span className="liti-brand-name">{siteName}</span>
            <span className="liti-brand-sub">千题磨一剑</span>
          </div>
        </div>

        <Space size={12}>
          <Dropdown menu={themeMenu} trigger={['click']} placement="bottomRight">
            <Button icon={<BgColorsOutlined />} shape="round">
              {presets.find((p) => p.key === themeKey)?.name ?? '主题'}
            </Button>
          </Dropdown>
          <Dropdown menu={userMenu} trigger={['click']} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }} size={8}>
              <Avatar size={32} style={{ background: token.colorPrimary }} icon={<UserOutlined />} />
              <Space size={6}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{user?.displayName}</span>
                <Tag color={ROLE_COLOR[user?.role ?? '']} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}>
                  {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
                </Tag>
              </Space>
            </Space>
          </Dropdown>
        </Space>
      </header>

      <div className="liti-body">
        <aside className="liti-sider">
          <div className="liti-sider-label">导航</div>
          <Menu
            mode="inline"
            theme={isDark ? 'dark' : 'light'}
            selectedKeys={[selectedKey]}
            items={items}
            onClick={({ key }) => navigate(key)}
          />
        </aside>

        <Layout.Content className="liti-main">
          {/* 窄屏时的横向导航 */}
          <div className="liti-mobile-menu">
            <Menu
              mode="horizontal"
              selectedKeys={[selectedKey]}
              items={items}
              onClick={({ key }) => navigate(key)}
              style={{ borderBottom: 'none', marginBottom: 12 }}
            />
          </div>

          <div className="liti-main-inner" key={location.pathname}>
            {children ?? <Outlet />}
          </div>
        </Layout.Content>
      </div>
    </div>
  );
}
