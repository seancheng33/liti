import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Select, Space, Typography, message, theme as antdTheme } from 'antd';
import { BgColorsOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useTheme } from '../theme';
import { api } from '../api';

export default function LoginPage() {
  const { login } = useAuth();
  const { themeKey, presets, setThemeKey } = useTheme();
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [site, setSite] = useState<{ siteName: string; siteAnnouncement: string }>({
    siteName: '砺题 Liti',
    siteAnnouncement: '',
  });

  useEffect(() => {
    api
      .get<{ siteName: string; siteAnnouncement: string }>('/api/settings/public')
      .then(setSite)
      .catch(() => {});
  }, []);

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
    <div className="liti-login">
      <div className="liti-login-aside">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Space size={10} align="center">
            <div
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 42,
                height: 42,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.28)',
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              砺
            </div>
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{site.siteName}</span>
          </Space>
        </div>

        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>
            千题磨一剑
            <br />
            把练习做成习惯
          </h1>
          <p>
            题库、组卷、答题、判分一站式完成。支持分类随机抽题、手选组卷、选项乱序与切屏检测，
            交卷后即时看到每题解析。
          </p>
          <div className="liti-login-badges">
            <span className="liti-login-badge">分类随机抽题</span>
            <span className="liti-login-badge">题目配图</span>
            <span className="liti-login-badge">自动判分</span>
            <span className="liti-login-badge">多主题</span>
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
          面向局域网的学习刷题系统
        </div>
      </div>

      <div className="liti-login-form">
        <div className="liti-login-card">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <Space size={6}>
              <BgColorsOutlined style={{ color: token.colorTextTertiary }} />
              <Select
                size="small"
                variant="borderless"
                value={themeKey}
                style={{ width: 132 }}
                onChange={(v) => setThemeKey(v)}
                options={presets.map((p) => ({ value: p.key, label: p.name }))}
              />
            </Space>
          </div>

          <Card style={{ paddingTop: 8 }}>
            <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
              登录
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
              使用管理员分配的账号进入系统
            </Typography.Paragraph>

            {site.siteAnnouncement && (
              <Card
                size="small"
                style={{ marginBottom: 18, background: token.colorPrimaryBg, borderColor: token.colorPrimaryBorder }}
              >
                <Typography.Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{site.siteAnnouncement}</Typography.Text>
              </Card>
            )}

            <Form onFinish={onFinish} layout="vertical" requiredMark={false} size="large">
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input prefix={<UserOutlined />} autoFocus autoComplete="username" placeholder="请输入用户名" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="请输入密码" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading} style={{ marginTop: 4 }}>
                进入砺题
              </Button>
            </Form>
          </Card>

          <Typography.Paragraph type="secondary" style={{ textAlign: 'center', fontSize: 12, marginTop: 16 }}>
            {site.siteName} · 千题磨一剑
          </Typography.Paragraph>
        </div>
      </div>
    </div>
  );
}
