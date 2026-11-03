import { useState } from 'react';
import { Button, Space, Tag, theme as antdTheme } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useAuth } from '../auth';
import { demoLogin, useDemoInfo } from '../demo';

/**
 * 全站顶部的演示提示条。
 *
 * 三个作用：
 * 1. 来人一眼知道「这是演示，数据会还原」，不会把演示站当真库往里传东西
 * 2. 身份切换 —— 演示最有说服力的地方就是同一个系统里三种人看到的东西完全不同，
 *    让他自己点一下比站在旁边解说强
 * 3. 正式部署时它根本不渲染（拿不到 /api/demo/info）
 */
export default function DemoBanner() {
  const info = useDemoInfo();
  const { user } = useAuth();
  const { token } = antdTheme.useToken();
  const [busy, setBusy] = useState<string | null>(null);

  if (!info) return null;

  const switchTo = async (role: string) => {
    if (role === user?.role || busy) return;
    setBusy(role);
    try {
      // 成功会整页跳转，走不到下面
      await demoLogin(role);
    } catch {
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        padding: '6px 20px',
        background: token.colorInfoBg,
        borderBottom: `1px solid ${token.colorInfoBorder}`,
        fontSize: 12.5,
        color: token.colorTextSecondary,
      }}
    >
      <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '17px' }}>
        演示环境
      </Tag>
      <span>{info.resetHint}</span>
      <Space size={2} style={{ marginLeft: 'auto' }} wrap>
        <span style={{ color: token.colorTextTertiary }}>
          <SwapOutlined /> 换个身份看：
        </span>
        {info.accounts.map((a) => (
          <Button
            key={a.role}
            size="small"
            type={a.role === user?.role ? 'primary' : 'text'}
            loading={busy === a.role}
            disabled={a.role === user?.role}
            onClick={() => switchTo(a.role)}
            style={{ fontSize: 12, paddingInline: 8, height: 22 }}
          >
            {a.label}
          </Button>
        ))}
      </Space>
    </div>
  );
}
