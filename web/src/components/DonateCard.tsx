import { Card, Typography } from 'antd';
import { withBase } from '../api';

/**
 * 「支持一下」捐赠卡片：收款码从主站（wikiProject）捐赠页搬过来的，
 * 图片放在 web/public/img/ 下。
 *
 * 完整捐赠页（含 PayPal）在 https://three-corner.xyz/about ，这里放二维码加个链接就够了：
 * 主站那套 PayPal 按钮用的是沙箱测试号（client-id=sb），收不了真钱，不值得移植。
 */
export default function DonateCard() {
  return (
    <Card size="small" title="支持一下" style={{ marginTop: 16 }}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        这是作者的业余项目。如果觉得好用，扫码请作者喝杯奶茶～ 也可以到
        <a href="https://three-corner.xyz/about" target="_blank" rel="noreferrer">
          三的小角落
        </a>
        看完整的捐赠页。
      </Typography.Paragraph>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        <img
          src={withBase('/img/wechat_pay.png')}
          alt="微信支付收款码"
          loading="lazy"
          decoding="async"
          style={{ width: 116, height: 116, objectFit: 'contain', borderRadius: 6 }}
        />
        <img
          src={withBase('/img/ali_pay.png')}
          alt="支付宝收款码"
          loading="lazy"
          decoding="async"
          style={{ width: 116, height: 116, objectFit: 'contain', borderRadius: 6 }}
        />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center', marginTop: 6 }}>
        微信 / 支付宝扫码
      </Typography.Text>
    </Card>
  );
}
