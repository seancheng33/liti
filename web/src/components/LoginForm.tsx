import { useState } from 'react';
import { Button, Form, Input, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '../auth';

interface LoginFormProps {
  /** 登录成功后的回调（首页原地刷新 / 登录页跳转） */
  onSuccess?: () => void;
  /** 紧凑模式：首页右侧登录卡用，不显示大号输入框 */
  size?: 'middle' | 'large';
  autoFocus?: boolean;
}

/** 登录表单：首页与登录页共用同一份逻辑，避免两处行为不一致 */
export default function LoginForm({ onSuccess, size = 'large', autoFocus = false }: LoginFormProps) {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      await login(values.username, values.password);
      message.success('登录成功');
      onSuccess?.();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form onFinish={onFinish} layout="vertical" requiredMark={false} size={size}>
      <Form.Item
        name="username"
        label="用户名"
        rules={[{ required: true, message: '请输入用户名' }]}
        tooltip="由管理员或教师分配，忘记用户名请联系管理员"
      >
        <Input id="login-username" prefix={<UserOutlined />} autoFocus={autoFocus} autoComplete="username" placeholder="请输入用户名" />
      </Form.Item>
      <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="请输入密码" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={loading} style={{ marginTop: 4 }}>
        进入砺题
      </Button>
    </Form>
  );
}
