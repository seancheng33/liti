import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Row, Space, Statistic, Tag, Typography, theme as antdTheme } from 'antd';
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

  const finished = review.status !== 'in_progress';
  // 分数要老师公布后才给看；解析由 analysisPublished 控制（后端已经算好，这里只是照着显示）
  const showScore = finished && review.resultsPublished && review.score != null;
  const percent = showScore && review.totalScore ? Math.round(((review.score ?? 0) / review.totalScore) * 100) : null;
  // 及格按试卷配置的绝对分算，不再写死 60%
  const passed = showScore ? (review.score ?? 0) >= review.passScore : false;
  const reason = submitReasonText(review.submitReason);
  const abnormal = review.submitReason === 'timeout' || review.submitReason === 'violation' || review.submitReason === 'forced';

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
        {showScore ? (
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}>
              <Statistic title="得分" value={review.score ?? 0} suffix={`/ ${review.totalScore ?? 0}`} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="答对题数" value={review.correctCount ?? 0} suffix={`/ ${review.items.length}`} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="得分率" value={percent ?? 0} suffix="%" />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic
                title={`结果（及格线 ${review.passScore} 分）`}
                value={passed ? '及格' : '不及格'}
                valueStyle={{ color: passed ? token.colorSuccess : token.colorError }}
              />
            </Col>
          </Row>
        ) : (
          <Alert
            type="info"
            showIcon
            message="成绩尚未公布"
            description="这份试卷的成绩由老师统一公布。公布后刷新本页就能看到分数；解析是否可见由老师另设。"
          />
        )}
      </Card>

      {!review.analysisPublished && finished && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="答案与解析暂不公布"
          description="你只能看到自己选了什么，看不到正确答案。等老师公布后再来看。"
        />
      )}

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
                {item.score == null ? '得分未公布' : `得分 ${item.score}`}
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
              // null = 解析还没公布。此时只能用中性色标出「你选了哪个」：
              // 红会像答错，主题色是绿又像答对，两头都会误导
              const revealed = o.isCorrect !== null;
              const isRight = o.isCorrect === true;
              const wrongPick = revealed && isUser && !isRight;
              return (
                <div
                  key={o.id}
                  className="liti-option"
                  style={{
                    borderColor: isRight
                      ? token.colorSuccessBorder
                      : wrongPick
                        ? token.colorErrorBorder
                        : isUser
                          ? token.colorBorder
                          : token.colorBorderSecondary,
                    background: isRight
                      ? token.colorSuccessBg
                      : wrongPick
                        ? token.colorErrorBg
                        : isUser
                          ? token.colorFillTertiary
                          : undefined,
                  }}
                >
                  <span className="liti-option-label">{String.fromCharCode(65 + i)}.</span>
                  <div style={{ flex: 1 }}>
                    <span>{o.content}</span>
                    <ImageGallery images={o.images} size="sm" />
                    <Space size={6} style={{ marginTop: 4 }} wrap>
                      {/* 橙=「这是我选的」纯标记，别用绿/红去暗示对错（主题色本身就是绿） */}
                      {isUser && <Tag color="warning">你的选择</Tag>}
                      {isRight && <Tag color="success">正确答案</Tag>}
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
