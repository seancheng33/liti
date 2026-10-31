import { Alert, Button, Empty, Modal, Space, Spin, Tag, Typography } from 'antd';
import { ClockCircleOutlined, FileTextOutlined, FlagOutlined, OrderedListOutlined } from '@ant-design/icons';
import type { PaperPreview } from '../types';
import { ImageGallery } from './ImageUpload';

interface PaperPreviewModalProps {
  open: boolean;
  preview: PaperPreview | null;
  loading?: boolean;
  onClose: () => void;
  /** 底部左侧额外按钮：首页放「开始答题」，教师端放「直接创建」 */
  extra?: React.ReactNode;
}

/**
 * 试卷预览（考生视角）：显示卷面题面与选项，但**不显示答案和解析**。
 * 首页看已发布试卷、教师端新建试卷时看草稿，都用这一个弹窗。
 */
export default function PaperPreviewModal({ open, preview, loading, onClose, extra }: PaperPreviewModalProps) {
  const reviewModeText = preview?.reviewMode === 'immediate' ? '答完每题即时看解析' : '交卷后统一看解析';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={860}
      title={
        <Space size={8}>
          <FileTextOutlined />
          <span>试卷预览</span>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            考生视角
          </Typography.Text>
        </Space>
      }
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>{extra}</div>
          <Button onClick={onClose}>关闭</Button>
        </div>
      }
      styles={{ body: { maxHeight: '66vh', overflowY: 'auto', paddingTop: 8 } }}
    >
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : !preview ? (
        <Empty description="没有可预览的内容" />
      ) : (
        <>
          <Typography.Title level={4} style={{ marginBottom: 10 }}>
            {preview.title}
          </Typography.Title>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 14 }}
            message="这里只展示题面，正确答案和解析不会出现在预览里"
            description="实际答题时选项顺序会重新打乱，交卷后才按解析时机展示答案。"
          />

          <Space size={[8, 8]} wrap style={{ marginBottom: 16 }}>
            <Tag icon={<OrderedListOutlined />} color="blue">
              共 {preview.questionCount} 题
            </Tag>
            <Tag icon={<ClockCircleOutlined />} color="geekblue">
              {Math.round(preview.durationSec / 60)} 分钟
            </Tag>
            <Tag icon={<FlagOutlined />} color="green">
              及格 {preview.passScore} 分
            </Tag>
            <Tag color="purple">{reviewModeText}</Tag>
            {preview.shuffleOptions && <Tag color="cyan">选项乱序</Tag>}
            {preview.categories?.map((c) => (
              <Tag key={c}>{c}</Tag>
            ))}
          </Space>

          {preview.items.length === 0 ? (
            <Empty description="这份试卷还没有题目" />
          ) : (
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              {preview.items.map((item) => (
                <div className="liti-preview-item" key={`${item.orderNo}-${item.questionId}`}>
                  <div className="liti-preview-head">
                    <span className="liti-preview-no">第 {item.orderNo} 题</span>
                    <Tag color={item.type === 'multiple' ? 'purple' : 'blue'} style={{ marginInlineEnd: 0 }}>
                      {item.typeLabel}
                    </Tag>
                  </div>

                  {item.stem ? (
                    <div className="liti-stem">{item.stem}</div>
                  ) : (
                    <div className="liti-stem liti-muted">（本题只看配图作答）</div>
                  )}

                  <ImageGallery images={item.images} />

                  <div className="liti-preview-options">
                    {item.options.map((opt) => (
                      <div className="liti-option" key={opt.label}>
                        <span className="liti-option-label">{opt.label}</span>
                        <div style={{ flex: 1 }}>
                          {opt.content ? <span>{opt.content}</span> : <span className="liti-muted">（图片选项）</span>}
                          <ImageGallery images={opt.images} size="sm" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Space>
          )}
        </>
      )}
    </Modal>
  );
}
