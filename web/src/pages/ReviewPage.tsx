import { useEffect, useState } from 'react';
import { Card, Space, Tag, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { AttemptReview } from '../types';

export default function ReviewPage() {
  const { attemptId } = useParams();
  const [review, setReview] = useState<AttemptReview | null>(null);

  useEffect(() => {
    api
      .get<AttemptReview>(`/api/attempts/${attemptId}`)
      .then(setReview)
      .catch(() => {});
  }, [attemptId]);

  if (!review) {
    return <div style={{ padding: 40 }}>加载中…</div>;
  }

  return (
    <div>
      <Card>
        <Space direction="vertical">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {review.paperTitle}
          </Typography.Title>
          <Typography.Text>
            成绩 {review.score} / {review.totalScore}，答对 {review.correctCount} 题，状态{' '}
            {review.status === 'submitted' ? '已交卷' : review.status === 'expired' ? '已超时' : '进行中'}
          </Typography.Text>
          {review.submitReason && (
            <Typography.Text type="secondary">交卷原因：{review.submitReason}</Typography.Text>
          )}
        </Space>
      </Card>

      {review.items.map((item, idx) => (
        <Card
          key={item.questionId}
          title={`第 ${idx + 1} 题`}
          style={{ marginTop: 12 }}
          extra={
            item.isCorrect === null ? null : (
              <Tag color={item.isCorrect ? 'green' : 'red'}>{item.isCorrect ? '正确' : '错误'}</Tag>
            )
          }
        >
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{item.stem}</Typography.Paragraph>
          <Space direction="vertical">
            {item.options.map((o, i) => {
              const isUser = item.selectedOptionIds.includes(o.id);
              const isCorrect = o.isCorrect;
              return (
                <Typography.Text
                  key={o.id}
                  type={isCorrect ? 'success' : isUser && !isCorrect ? 'danger' : undefined}
                >
                  {String.fromCharCode(65 + i)}. {o.content}
                  {isUser ? '（你的选择）' : ''}
                  {isCorrect ? ' ✓' : ''}
                </Typography.Text>
              );
            })}
          </Space>
          {item.explanation && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
              解析：{item.explanation}
            </Typography.Paragraph>
          )}
        </Card>
      ))}
    </div>
  );
}
