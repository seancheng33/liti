import { useEffect, useState } from 'react';
import { Avatar, Button, Dropdown, Layout, Menu, Space, Typography, theme as antdTheme } from 'antd';
import {
  BgColorsOutlined,
  CheckOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import { useTheme } from '../theme';
import type { SiteSettings } from '../types';

const ROLE_LABEL: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };

export default function AppLayout() {
  const { user, logout, applyTheme } = useAuth();
  const { themeKey, presets, isDark } = useTheme();
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const [siteName, setSiteName] = useState('砺题 Liti');

  useEffect(() => {
    api
      .get<SiteSettings>('/api/settings')
      .then((s) => {
        const name = s.siteName || '砺题 Liti';
        setSiteName(name);
        document.title = name;
      })
      .catch(() => {});
  }, []);

  const items = [
    { key: '/papers', label: '试卷' },
    { key: '/attempts', label: '我的答卷' },
    ...(user && user.role !== 'student'
      ? [
          { key: '/questions', label: '题库' },
          { key: '/stats', label: '统计' },
        ]
      : []),
    ...(user && user.role === 'admin'
      ? [
          { key: '/users', label: '用户管理' },
          { key: '/settings', label: '网站管理' },
        ]
      : []),
  ];

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
              borderRadius: 3,
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
      { key: 'profile', label: <Space><UserOutlined />个人设置</Space> },
      { type: 'divider' as const },
      { key: 'logout', label: <Space><LogoutOutlined />退出登录</Space> },
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
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: token.colorPrimary,
          paddingInline: 24,
        }}
      >
        <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
          {siteName}
        </Typography.Title>
        <Space size={12}>
          <Dropdown menu={themeMenu} trigger={['click']} placement="bottomRight">
            <Button
              size="small"
              ghost
              icon={<BgColorsOutlined />}
              style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
            >
              {presets.find((p) => p.key === themeKey)?.name ?? '主题'}
            </Button>
          </Dropdown>
          <Dropdown menu={userMenu} trigger={['click']} placement="bottomRight">
            <Space style={{ color: '#fff', cursor: 'pointer' }}>
              <Avatar size="small" style={{ background: 'rgba(255,255,255,0.25)' }} icon={<UserOutlined />} />
              <span>
                {user?.displayName}（{ROLE_LABEL[user?.role ?? ''] ?? user?.role}）
              </span>
            </Space>
          </Dropdown>
        </Space>
      </Layout.Header>
      <Layout>
        <Layout.Sider width={180} theme={isDark ? 'dark' : 'light'}>
          <Menu
            mode="inline"
            theme={isDark ? 'dark' : 'light'}
            selectedKeys={[location.pathname]}
            items={items}
            onClick={({ key }) => navigate(key)}
            style={{ height: '100%' }}
          />
        </Layout.Sider>
        <Layout.Content style={{ padding: 24, background: token.colorBgLayout }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
