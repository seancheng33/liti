import { useState } from 'react';
import { Button, Card, Form, Input, Select, Space, Typography, message, theme as antdTheme } from 'antd';
import { BgColorsOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useTheme } from '../theme';

export default function LoginPage() {
  const { login } = useAuth();
  const { themeKey, presets, setThemeKey } = useTheme();
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      await login(values.username, values.password);
      message.success('登录成功');
      navigate('/', { replace: true });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: token.colorBgLayout,
      }}
    >
      <div style={{ width: 380 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Space size={6}>
            <BgColorsOutlined style={{ color: token.colorTextSecondary }} />
            <Select
              size="small"
              variant="borderless"
              value={themeKey}
              style={{ width: 130 }}
              onChange={(v) => setThemeKey(v)}
              options={presets.map((p) => ({ value: p.key, label: p.name }))}
            />
          </Space>
        </div>
        <Card>
          <Typography.Title level={3} style={{ textAlign: 'center', marginTop: 0 }}>
            砺题 Liti
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginTop: -8 }}>
            千题磨一剑
          </Typography.Paragraph>
          <Form onFinish={onFinish} layout="vertical">
            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input autoFocus autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}
