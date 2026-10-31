import { Button, Layout, Menu, Space, Typography } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

const ROLE_LABEL: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
          砺题 Liti
        </Typography.Title>
        <Space>
          <span style={{ color: '#fff' }}>
            {user?.displayName}（{ROLE_LABEL[user?.role ?? ''] ?? user?.role}）
          </span>
          <Button
            size="small"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            退出
          </Button>
        </Space>
      </Layout.Header>
      <Layout>
        <Layout.Sider width={180} theme="light">
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={items}
            onClick={({ key }) => navigate(key)}
            style={{ height: '100%' }}
          />
        </Layout.Sider>
        <Layout.Content style={{ padding: 24, background: '#fff' }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
