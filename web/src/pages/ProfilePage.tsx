import { useEffect, useState } from 'react';
import { Button, Card, Col, Descriptions, Form, Input, Row, Space, Tag, Typography, message } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { api } from '../api';
import { useAuth } from '../auth';
import { useTheme } from '../theme';

const ROLE_LABEL: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' };
const ROLE_COLOR: Record<string, string> = { admin: 'red', teacher: 'blue', student: 'green' };

export default function ProfilePage() {
  const { user, refresh, applyTheme } = useAuth();
  const { themeKey, presets, isDark } = useTheme();
  const [profileForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    profileForm.setFieldsValue({ displayName: user?.displayName ?? '' });
  }, [user?.displayName, profileForm]);

  async function onSaveProfile() {
    const values = await profileForm.validateFields();
    setSavingProfile(true);
    try {
      await api.put('/api/auth/profile', { displayName: values.displayName });
      await refresh();
      message.success('个人信息已更新');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function onChangePassword() {
    const values = await pwdForm.validateFields();
    setSavingPwd(true);
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      message.success('密码已修改，下次登录请使用新密码');
      pwdForm.resetFields();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSavingPwd(false);
    }
  }

  return (
    <div style={{ maxWidth: 880 }}>
      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="用户名">{user?.username}</Descriptions.Item>
          <Descriptions.Item label="角色">
            <Tag color={ROLE_COLOR[user?.role ?? '']}>{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</Tag>
          </Descriptions.Item>
        </Descriptions>
        <Form form={profileForm} layout="vertical" style={{ maxWidth: 360 }}>
          <Form.Item
            name="displayName"
            label="显示名"
            rules={[{ required: true, message: '请输入显示名' }, { max: 64, message: '最多 64 个字符' }]}
          >
            <Input placeholder="会显示在页面右上角" />
          </Form.Item>
          <Button type="primary" loading={savingProfile} onClick={onSaveProfile}>
            保存
          </Button>
        </Form>
      </Card>

      <Card title="界面主题" style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          主题会保存到你的账号，换设备登录也保持一致。
        </Typography.Paragraph>
        <Row gutter={[12, 12]}>
          {presets.map((p) => {
            const active = p.key === themeKey;
            return (
              <Col key={p.key} xs={12} sm={8} md={6}>
                <Card
                  size="small"
                  hoverable
                  onClick={() => applyTheme(p.key)}
                  style={{
                    borderColor: active ? p.colorPrimary : undefined,
                    borderWidth: active ? 2 : 1,
                    cursor: 'pointer',
                    background: p.dark ? '#1f1f1f' : undefined,
                  }}
                  styles={{ body: { padding: 12 } }}
                >
                  <Space>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 22,
                        height: 22,
                        borderRadius: 4,
                        background: p.swatch,
                        border: isDark ? '1px solid #555' : '1px solid #e5e5e5',
                      }}
                    />
                    <span style={{ color: p.dark ? '#f0f0f0' : undefined }}>{p.name}</span>
                    {active && <CheckOutlined style={{ color: p.colorPrimary }} />}
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      </Card>

      <Card title="修改密码">
        <Form form={pwdForm} layout="vertical" style={{ maxWidth: 360 }}>
          <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" loading={savingPwd} onClick={onChangePassword}>
            修改密码
          </Button>
        </Form>
      </Card>
    </div>
  );
}
