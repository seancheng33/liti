import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Checkbox, Modal, Progress, Radio, Result, Space, Tag, Typography, message, theme as antdTheme } from 'antd';
import { ClockCircleOutlined, FieldTimeOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ImageGallery } from '../components/ImageUpload';
import type { AttemptReview } from '../types';

/** 选项配图：阻止点击冒泡，避免误触发选择 */
function OptionImages({ images }: { images?: string[] }) {
  if (!images?.length) return null;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <ImageGallery images={images} size="sm" />
    </div>
  );
}

export default function ExamPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { token } = antdTheme.useToken();
  const [review, setReview] = useState<AttemptReview | null>(null);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [current, setCurrent] = useState(0);
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

  function confirmSubmit() {
    const unanswered = review ? review.items.length - Object.values(answers).filter((v) => v.length > 0).length : 0;
    Modal.confirm({
      title: '确认交卷？',
      content: unanswered > 0 ? `还有 ${unanswered} 题没有作答，交卷后不能修改。` : '所有题目都已作答，交卷后不能修改。',
      okText: '确认交卷',
      cancelText: '再检查一下',
      okButtonProps: { danger: true },
      onOk: handleSubmit,
    });
  }

  if (!review) {
    return <div className="liti-loading">加载中…</div>;
  }
  if (review.status !== 'in_progress') {
    return <Result status="info" title="答卷已结束" extra={<Button onClick={() => navigate(`/review/${attemptId}`)}>查看结果</Button>} />;
  }

  const mins = Math.floor((remaining ?? 0) / 60);
  const secs = String((remaining ?? 0) % 60).padStart(2, '0');
  const urgent = (remaining ?? 0) <= 300;
  const items = review.items;
  const item = items[current];
  const answeredCount = items.filter((it) => (answers[it.questionId] ?? []).length > 0).length;
  const percent = items.length ? Math.round((answeredCount / items.length) * 100) : 0;

  return (
    <div className="liti-page">
      {/* 顶部信息卡 */}
      <Card>
        <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }} size={16}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {review.paperTitle}
            </Typography.Title>
            <Space size={16} style={{ marginTop: 6 }} wrap>
              <Typography.Text type={urgent ? 'danger' : 'secondary'}>
                <ClockCircleOutlined /> 剩余时间 {mins}:{secs}
              </Typography.Text>
              <Typography.Text type="secondary">
                已答 {answeredCount}/{items.length} 题
              </Typography.Text>
              <Typography.Text type={violations > 0 ? 'danger' : 'secondary'}>
                <FieldTimeOutlined /> 违规 {violations}/3
              </Typography.Text>
            </Space>
          </div>
          <Space size={16}>
            <Progress type="circle" size={54} percent={percent} strokeColor={token.colorPrimary} />
            <Button type="primary" danger size="large" loading={submitting} onClick={confirmSubmit}>
              交卷
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 当前题目卡片 */}
      <Card
        key={item.questionId}
        className="liti-question-card"
        style={{ marginTop: 16 }}
        title={
          <Space>
            <Tag color="blue">第 {current + 1} 题</Tag>
            <span>{item.type === 'single' ? '单选题' : '多选题'}</span>
            <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
              （{(answers[item.questionId] ?? []).length ? '已作答' : '未作答'}）
            </Typography.Text>
          </Space>
        }
      >
        {item.stem ? <div className="liti-stem">{item.stem}</div> : null}
        <ImageGallery images={item.images} />

        <div style={{ marginTop: 16 }}>
          {item.type === 'single' ? (
            <Radio.Group
              value={answers[item.questionId]?.[0]}
              onChange={(e) => saveAnswer(item.questionId, [e.target.value])}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {item.options.map((o, i) => (
                  <Radio key={o.id} value={o.id} className="liti-option" style={{ marginInlineStart: 0 }}>
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <span>
                        <span className="liti-option-label">{String.fromCharCode(65 + i)}.</span> {o.content}
                      </span>
                      <OptionImages images={o.images} />
                    </Space>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              {item.options.map((o, i) => (
                <Checkbox
                  key={o.id}
                  className="liti-option"
                  checked={(answers[item.questionId] ?? []).includes(o.id)}
                  onChange={(e) => {
                    const cur = answers[item.questionId] ?? [];
                    const next = e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id);
                    saveAnswer(item.questionId, next);
                  }}
                >
                  <Space direction="vertical" size={0} style={{ width: '100%' }}>
                    <span>
                      <span className="liti-option-label">{String.fromCharCode(65 + i)}.</span> {o.content}
                    </span>
                    <OptionImages images={o.images} />
                  </Space>
                </Checkbox>
              ))}
            </Space>
          )}
        </div>
      </Card>

      {/* 底部：翻页 + 答题卡 */}
      <Card style={{ marginTop: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Button disabled={current === 0} onClick={() => setCurrent(current - 1)}>
              上一题
            </Button>
            <Button disabled={current === items.length - 1} onClick={() => setCurrent(current + 1)}>
              下一题
            </Button>
            <Typography.Text type="secondary">
              {current + 1} / {items.length}
            </Typography.Text>
          </Space>

          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10 }}>
              答题卡（点击题号跳转）
            </Typography.Text>
            <div className="liti-answer-sheet">
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
                      width: 34,
                      height: 34,
                      background: answered ? token.colorSuccess : token.colorFillSecondary,
                      color: answered ? '#fff' : token.colorText,
                      borderColor: isCurrent ? token.colorPrimary : answered ? token.colorSuccess : token.colorBorder,
                      borderWidth: isCurrent ? 2 : 1,
                      fontWeight: isCurrent ? 700 : 400,
                    }}
                  >
                    {idx + 1}
                  </Button>
                );
              })}
            </div>
            <div style={{ marginTop: 12 }}>
              <Space size="large">
                <span>
                  <span className="liti-sheet-dot" style={{ background: token.colorSuccess }} />
                  已答
                </span>
                <span>
                  <span className="liti-sheet-dot" style={{ background: token.colorFillSecondary, border: `1px solid ${token.colorBorder}` }} />
                  未答
                </span>
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
