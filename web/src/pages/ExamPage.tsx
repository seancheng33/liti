import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Checkbox, Modal, Radio, Result, Space, Typography, message, theme as antdTheme } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import type { AttemptReview } from '../types';

export default function ExamPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { token } = antdTheme.useToken();
  const [review, setReview] = useState<AttemptReview | null>(null);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [current, setCurrent] = useState(0); // 当前题索引（0-based）
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

  // 防切屏（Electron 主进程检测失焦并强制拉回；浏览器用 visibilitychange/blur 兜底）
  useEffect(() => {
    if (!review || review.status !== 'in_progress' || submittedRef.current) return;

    async function reportViolation() {
      if (submittedRef.current) return;
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

    const guard = window.liti?.examGuard;
    if (guard) {
      guard.start().catch(() => {});
      guard.onViolation(reportViolation);
      return () => {
        guard.stop().catch(() => {});
      };
    }

    function onVisible() {
      if (document.visibilityState === 'visible') setPaused(false);
    }
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('blur', reportViolation);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('blur', reportViolation);
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
  const items = review.items;
  const item = items[current];
  const answeredCount = items.filter((it) => (answers[it.questionId] ?? []).length > 0).length;

  return (
    <div>
      {/* 顶部信息卡片 */}
      <Card>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {review.paperTitle}
          </Typography.Title>
          <Space size="large" wrap>
            <Typography.Text strong>
              剩余时间：{mins}:{secs}
            </Typography.Text>
            <Typography.Text>已答：{answeredCount}/{items.length}</Typography.Text>
            <Typography.Text type={violations > 0 ? 'danger' : 'secondary'}>违规次数：{violations}/3</Typography.Text>
          </Space>
        </Space>
      </Card>

      {/* 当前题目卡片 */}
      <Card
        key={item.questionId}
        title={`第 ${current + 1} 题（${item.type === 'single' ? '单选' : '多选'}）`}
        style={{ marginTop: 12 }}
      >
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 16 }}>{item.stem}</Typography.Paragraph>
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

      {/* 底部：翻页 + 题号导航 */}
      <Card style={{ marginTop: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space>
            <Button disabled={current === 0} onClick={() => setCurrent(current - 1)}>
              上一题
            </Button>
            <Button type="primary" disabled={current === items.length - 1} onClick={() => setCurrent(current + 1)}>
              下一题
            </Button>
            <Button type="primary" danger size="large" loading={submitting} onClick={() => handleSubmit()}>
              交卷
            </Button>
          </Space>

          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              答题卡（点击题号跳转）
            </Typography.Text>
            <Space wrap size={[8, 8]}>
              {items.map((it, idx) => {
                const answered = (answers[it.questionId] ?? []).length > 0;
                const isCurrent = idx === current;
                return (
                  <Button
                    key={it.questionId}
                    shape="circle"
                    size="small"
                    onClick={() => setCurrent(idx)}
                    style={{
                      background: answered ? token.colorSuccess : token.colorFillSecondary,
                      color: answered ? '#fff' : token.colorText,
                      borderColor: isCurrent
                        ? token.colorPrimary
                        : answered
                          ? token.colorSuccess
                          : token.colorBorder,
                      borderWidth: isCurrent ? 2 : 1,
                      fontWeight: isCurrent ? 700 : 400,
                    }}
                  >
                    {idx + 1}
                  </Button>
                );
              })}
            </Space>
            <div style={{ marginTop: 8 }}>
              <Space size="large">
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: token.colorSuccess, borderRadius: '50%', marginRight: 4 }} />已答</span>
                <span><span style={{ display: 'inline-block', width: 12, height: 12, background: token.colorFillSecondary, border: `1px solid ${token.colorBorder}`, borderRadius: '50%', marginRight: 4 }} />未答</span>
              </Space>
            </div>
          </div>
        </Space>
      </Card>

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
