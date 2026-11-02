import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, Typography, message } from 'antd';
import { api } from '../api';

interface ForgotPasswordModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * 忘记密码：学生自助找回。
 * 输入用户名 + 教师给的重置码 + 新密码，兑换端（/api/auth/reset-password）校验码后改密码。
 * 不登录也能用，所以接口是公开的；失败统一回「重置码无效或已失效」，不暴露用户名是否存在。
 */
export default function ForgotPasswordModal({ open, onClose, onSuccess }: ForgotPasswordModalProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; code: string; newPassword: string }) {
    setLoading(true);
    try {
      await api.post('/api/auth/reset-password', {
        username: values.username.trim(),
        code: values.code.trim().toUpperCase(),
        newPassword: values.newPassword,
      });
      message.success('密码已重置，请用新密码登录');
      form.resetFields();
      onClose();
      onSuccess?.();
    } catch (e) {
      // 服务端只回「无效或已失效」；太频繁会回 429，提示里带分钟数
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      title="找回密码"
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      footer={null}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="重置码从哪里来？"
        description="重置码由你的老师或管理员在后台生成，请向老师索取。它是一次性的、30 分钟内有效。"
      />
      <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input autoComplete="username" placeholder="请输入用户名" />
        </Form.Item>
        <Form.Item
          name="code"
          label="重置码"
          rules={[{ required: true, message: '请输入老师给的重置码' }]}
          tooltip="不区分大小写，去掉空格即可"
        >
          <Input style={{ letterSpacing: 3, fontFamily: 'ui-monospace, Menlo, monospace' }} placeholder="8 位重置码" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '密码至少 6 位' },
          ]}
        >
          <Input.Password autoComplete="new-password" placeholder="至少 6 位" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          重置密码
        </Button>
      </Form>
      <Typography.Paragraph type="secondary" style={{ textAlign: 'center', fontSize: 12, marginTop: 12, marginBottom: 0 }}>
        想起来了？<a onClick={onClose}>返回登录</a>
      </Typography.Paragraph>
    </Modal>
  );
}
