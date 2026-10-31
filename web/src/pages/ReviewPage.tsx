import { useEffect, useState } from 'react';
import { Button, Card, Col, Row, Space, Statistic, Tag, Typography, theme as antdTheme } from 'antd';
import { ArrowLeftOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ImageGallery } from '../components/ImageUpload';
import PageHeader from '../components/PageHeader';
import type { AttemptReview } from '../types';
import { STATUS_LABEL, submitReasonText } from '../types';

export default function ReviewPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { token } = antdTheme.useToken();
  const [review, setReview] = useState<AttemptReview | null>(null);

  useEffect(() => {
    api
      .get<AttemptReview>(`/api/attempts/${attemptId}`)
      .then(setReview)
      .catch(() => {});
  }, [attemptId]);

  if (!review) {
    return <div className="liti-loading">加载中…</div>;
  }

  const percent = review.totalScore ? Math.round((review.score / review.totalScore) * 100) : 0;
  const passed = percent >= 60;
  const reason = submitReasonText(review.submitReason);
  const abnormal = review.submitReason === 'timeout' || review.submitReason === 'violation';

  return (
    <div className="liti-page">
      <PageHeader
        title={review.paperTitle ?? '答卷解析'}
        description={
          <Space size={8} wrap>
            <Tag>{STATUS_LABEL[review.status] ?? review.status}</Tag>
            <Tag color={abnormal ? 'orange' : 'green'}>交卷原因：{reason}</Tag>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/papers')}>
              返回试卷
            </Button>
            <Button onClick={() => navigate('/attempts')}>我的答卷</Button>
          </Space>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6}>
            <Statistic title="得分" value={review.score} suffix={`/ ${review.totalScore}`} />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="答对题数" value={review.correctCount} suffix={`/ ${review.items.length}`} />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="得分率" value={percent} suffix="%" />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="结果"
              value={passed ? '及格' : '不及格'}
              valueStyle={{ color: passed ? token.colorSuccess : token.colorError }}
            />
          </Col>
        </Row>
      </Card>

      {review.items.map((item, idx) => (
        <Card
          key={item.questionId}
          className="liti-question-card"
          style={{ marginTop: 12 }}
          title={
            <Space>
              <Tag color="blue">第 {idx + 1} 题</Tag>
              <span>{item.type === 'single' ? '单选题' : '多选题'}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                得分 {item.score ?? 0}
              </Typography.Text>
            </Space>
          }
          extra={
            item.isCorrect === null ? null : (
              <Tag
                color={item.isCorrect ? 'success' : 'error'}
                icon={item.isCorrect ? <CheckCircleFilled /> : <CloseCircleFilled />}
              >
                {item.isCorrect ? '正确' : '错误'}
              </Tag>
            )
          }
        >
          {item.stem ? <div className="liti-stem">{item.stem}</div> : null}
          <ImageGallery images={item.images} />

          <Space direction="vertical" style={{ width: '100%', marginTop: 14 }} size={8}>
            {item.options.map((o, i) => {
              const isUser = item.selectedOptionIds.includes(o.id);
              const isCorrect = o.isCorrect;
              return (
                <div
                  key={o.id}
                  className="liti-option"
                  style={{
                    borderColor: isCorrect ? token.colorSuccessBorder : isUser ? token.colorErrorBorder : token.colorBorderSecondary,
                    background: isCorrect ? token.colorSuccessBg : isUser ? token.colorErrorBg : undefined,
                  }}
                >
                  <span className="liti-option-label">{String.fromCharCode(65 + i)}.</span>
                  <div style={{ flex: 1 }}>
                    <span>{o.content}</span>
                    <ImageGallery images={o.images} size="sm" />
                    <Space size={6} style={{ marginTop: 4 }} wrap>
                      {isUser && <Tag color="processing">你的选择</Tag>}
                      {isCorrect && <Tag color="success">正确答案</Tag>}
                    </Space>
                  </div>
                </div>
              );
            })}
          </Space>

          {item.explanation && (
            <Card size="small" style={{ marginTop: 12, background: token.colorFillQuaternary, borderStyle: 'dashed' }}>
              <Typography.Text strong>解析</Typography.Text>
              <Typography.Paragraph style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>
                {item.explanation}
              </Typography.Paragraph>
            </Card>
          )}
        </Card>
      ))}
    </div>
  );
}
