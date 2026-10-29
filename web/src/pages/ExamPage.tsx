import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Checkbox, Modal, Radio, Result, Space, Typography, message } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { AttemptReview } from '../types';

export default function ExamPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [review, setReview] = useState<AttemptReview | null>(null);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [violations, setViolations] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    api
      .get<AttemptReview>(`/api/attempts/${attemptId}`)
      .then((r) => {
        setReview(r);
        const sel: Record<number, number[]> = {};
        for (const item of r.items) if (item.selectedOptionIds.length) sel[item.questionId] = item.selectedOptionIds;
        setAnswers(sel);
        if (r.deadlineAt) setRemaining(Math.max(0, Math.floor((r.deadlineAt - Date.now()) / 1000)));
      })
      .catch((e) => {
        message.error((e as Error).message);
        navigate('/papers');
      });
  }, [attemptId, navigate]);

  const handleSubmit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await api.post(`/api/attempts/${attemptId}/submit`);
    } catch {
      /* 超时或已提交 */
    } finally {
      navigate(`/review/${attemptId}`, { replace: true });
    }
  }, [attemptId, navigate]);

  // 倒计时
  useEffect(() => {
    const t = setInterval(() => {
      if (!review || review.status !== 'in_progress') return;
      const left = Math.floor((review.deadlineAt - Date.now()) / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(t);
        handleSubmit();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [review, handleSubmit]);

  // 防切屏
  useEffect(() => {
    async function onHidden() {
      if (!review || review.status !== 'in_progress' || submittedRef.current) return;
      setPaused(true);
      try {
        const r = await api.post<{ count: number; autoSubmitted: boolean }>(`/api/attempts/${attemptId}/violations`, { type: 'switch' });
        setViolations(r.count);
        if (r.autoSubmitted) {
          message.warning('违规次数已达上限，自动交卷');
          submittedRef.current = true;
          navigate(`/review/${attemptId}`, { replace: true });
        }
      } catch {
        /* ignore */
      }
    }
    function onVisible() {
      if (document.visibilityState === 'visible') setPaused(false);
    }
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('blur', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('blur', onHidden);
    };
  }, [review, attemptId, navigate]);

  async function saveAnswer(questionId: number, ids: number[]) {
    setAnswers((a) => ({ ...a, [questionId]: ids }));
    try {
      await api.patch(`/api/attempts/${attemptId}/answers`, { questionId, selectedOptionIds: ids });
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  if (!review) {
    return <div style={{ padding: 40 }}>加载中…</div>;
  }
  if (review.status !== 'in_progress') {
    return (
      <Result status="info" title="答卷已结束" extra={<Button onClick={() => navigate(`/review/${attemptId}`)}>查看结果</Button>} />
    );
  }

  const mins = Math.floor((remaining ?? 0) / 60);
  const secs = String((remaining ?? 0) % 60).padStart(2, '0');

  return (
    <div>
      <Card>
        <Space direction="vertical">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {review.paperTitle}
          </Typography.Title>
          <Space size="large">
            <Typography.Text strong>
              剩余时间：{mins}:{secs}
            </Typography.Text>
            <Typography.Text type={violations > 0 ? 'danger' : 'secondary'}>违规次数：{violations}/3</Typography.Text>
          </Space>
        </Space>
      </Card>

      {review.items.map((item, idx) => (
        <Card key={item.questionId} title={`第 ${idx + 1} 题（${item.type === 'single' ? '单选' : '多选'}）`} style={{ marginTop: 12 }}>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{item.stem}</Typography.Paragraph>
          {item.type === 'single' ? (
            <Radio.Group
              value={answers[item.questionId]?.[0]}
              onChange={(e) => saveAnswer(item.questionId, [e.target.value])}
            >
              <Space direction="vertical">
                {item.options.map((o, i) => (
                  <Radio key={o.id} value={o.id}>
                    {String.fromCharCode(65 + i)}. {o.content}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          ) : (
            <Space direction="vertical">
              {item.options.map((o, i) => (
                <Checkbox
                  key={o.id}
                  checked={(answers[item.questionId] ?? []).includes(o.id)}
                  onChange={(e) => {
                    const cur = answers[item.questionId] ?? [];
                    const next = e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id);
                    saveAnswer(item.questionId, next);
                  }}
                >
                  {String.fromCharCode(65 + i)}. {o.content}
                </Checkbox>
              ))}
            </Space>
          )}
        </Card>
      ))}

      <Button type="primary" size="large" block style={{ marginTop: 16 }} loading={submitting} onClick={() => handleSubmit()}>
        交卷
      </Button>

      <Modal open={paused} closable={false} footer={null} maskClosable={false}>
        <Result
          status="warning"
          title="请回到答题页"
          subTitle={`已检测到离开答题页（违规 ${violations}/3），计时不暂停，累计 3 次将自动交卷。`}
        />
      </Modal>
    </div>
  );
}
