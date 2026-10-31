import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Modal,
  Progress,
  Radio,
  Result,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
  theme as antdTheme,
} from 'antd';
import {
  ClockCircleOutlined,
  FieldTimeOutlined,
  FlagFilled,
  FlagOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ImageGallery } from '../components/ImageUpload';
import type { AttemptItem, AttemptReview } from '../types';

/** 违规上报去抖窗口：一次切窗通常会连着触发 visibilitychange + blur，别记成两次 */
const VIOLATION_DEBOUNCE_MS = 2000;

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
  /** 违规后盖住页面的遮罩（和服务端「暂停」是两件事） */
  const [blocked, setBlocked] = useState(false);
  const [violations, setViolations] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [showTip, setShowTip] = useState(true);
  const submittedRef = useRef(false);
  const lastViolationRef = useRef(0);
  /** 服务端时间与本机时间的差（毫秒）：考生电脑时钟不准时，倒计时也得是对的 */
  const clockOffsetRef = useRef(0);

  const paused = !!review?.paused;

  /** 按服务端时钟算「还剩几秒」；pausedAt 本身就是服务端时间，不用再加偏移 */
  const remainFrom = useCallback((deadlineAt: number, pausedAt?: number | null) => {
    const serverNow = pausedAt ?? Date.now() + clockOffsetRef.current;
    return Math.max(0, Math.floor((deadlineAt - serverNow) / 1000));
  }, []);

  const applyReview = useCallback(
    (r: AttemptReview) => {
      if (typeof r.serverNow === 'number') clockOffsetRef.current = r.serverNow - Date.now();
      setReview(r);
      const sel: Record<number, number[]> = {};
      for (const item of r.items) if (item.selectedOptionIds.length) sel[item.questionId] = item.selectedOptionIds;
      setAnswers(sel);
      // 暂停中剩余时间要定格在暂停那一刻，不能按当前时间算
      if (r.deadlineAt) setRemaining(remainFrom(r.deadlineAt, r.paused ? (r.pausedAt ?? null) : null));
    },
    [remainFrom],
  );

  useEffect(() => {
    api
      .get<AttemptReview>(`/api/attempts/${attemptId}`)
      .then(applyReview)
      .catch((e) => {
        message.error((e as Error).message);
        navigate('/papers');
      });
  }, [attemptId, navigate, applyReview]);

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

  // 倒计时：暂停时不走表，也不自动交卷
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      if (!review || review.status !== 'in_progress') return;
      const left = remainFrom(review.deadlineAt);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        handleSubmit();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [review, paused, handleSubmit, remainFrom]);

  /**
   * 防切屏：三条路都要埋点，任何一条断了都会漏记。
   * - visibilitychange(hidden)：切标签页、最小化、切到别的应用（最可靠的一条）
   * - window blur：点别的窗口，但页面还"可见"的情况
   * - pagehide：直接关页面/前进后退
   * 之前只挂了 document 上的 blur（事件目标其实是 window，且 blur 不冒泡），
   * 切标签页完全收不到，所以违规一次都没记上。
   */
  useEffect(() => {
    if (!review || review.status !== 'in_progress' || paused || submittedRef.current) return;

    const reportViolation = async (kind: string) => {
      if (submittedRef.current) return;
      const now = Date.now();
      if (now - lastViolationRef.current < VIOLATION_DEBOUNCE_MS) return;
      lastViolationRef.current = now;

      setBlocked(true);
      try {
        const r = await api.post<{ count: number; autoSubmitted: boolean; ignored?: boolean }>(
          `/api/attempts/${attemptId}/violations`,
          { type: kind },
        );
        if (r.ignored) return;
        setViolations(r.count);
        if (r.autoSubmitted) {
          submittedRef.current = true;
          message.warning('违规次数已达上限，自动交卷');
          navigate(`/review/${attemptId}`, { replace: true });
        }
      } catch {
        /* 网络抖动不该影响答题 */
      }
    };

    // Electron 壳：主进程做物理级检测
    const guard = window.liti?.examGuard;
    if (guard) {
      guard.start().catch(() => {});
      guard.onViolation(() => reportViolation('switch'));
      return () => {
        guard.stop().catch(() => {});
      };
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void reportViolation('tab');
      } else {
        // 回来时跟服务端对一次时间，避免暂停/超时状态不同步。
        // 故意不清掉遮罩：让学生看到这次切走被记了一次违规，点「继续答题」再走。
        api
          .get<AttemptReview>(`/api/attempts/${attemptId}`)
          .then((r) => {
            if (typeof r.serverNow === 'number') clockOffsetRef.current = r.serverNow - Date.now();
            if (r.status !== 'in_progress') {
              submittedRef.current = true;
              navigate(`/review/${attemptId}`, { replace: true });
              return;
            }
            setReview(r);
            if (r.deadlineAt) setRemaining(Math.max(0, Math.floor((r.deadlineAt - (Date.now() + clockOffsetRef.current)) / 1000)));
          })
          .catch(() => {});
      }
    };
    const onBlur = () => void reportViolation('blur');
    const onPageHide = () => void reportViolation('pagehide');

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [review?.status, paused, attemptId, navigate]);

  async function saveAnswer(questionId: number, ids: number[]) {
    setAnswers((a) => ({ ...a, [questionId]: ids }));
    try {
      await api.patch(`/api/attempts/${attemptId}/answers`, { questionId, selectedOptionIds: ids });
    } catch (e) {
      message.error((e as Error).message);
    }
  }

  /** 标记 / 取消标记：状态存在服务端，刷新、换设备都还在 */
  async function toggleFlag(item: AttemptItem) {
    const next = !item.flagged;
    setReview((r) =>
      r ? { ...r, items: r.items.map((it) => (it.questionId === item.questionId ? { ...it, flagged: next } : it)) } : r,
    );
    try {
      await api.patch(`/api/attempts/${attemptId}/flag`, { questionId: item.questionId, flagged: next });
    } catch (e) {
      message.error((e as Error).message);
      setReview((r) =>
        r ? { ...r, items: r.items.map((it) => (it.questionId === item.questionId ? { ...it, flagged: !next } : it)) } : r,
      );
    }
  }

  async function doPause() {
    setPausing(true);
    try {
      const r = await api.post<{ pausedAt: number; deadlineAt: number; pausedTotalMs: number; remainingSec: number; serverNow: number }>(
        `/api/attempts/${attemptId}/pause`,
      );
      if (typeof r.serverNow === 'number') clockOffsetRef.current = r.serverNow - Date.now();
      setReview((prev) => (prev ? { ...prev, paused: true, pausedAt: r.pausedAt, pausedTotalMs: r.pausedTotalMs } : prev));
      setRemaining(r.remainingSec);
      message.success('已暂停，计时停止');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPausing(false);
    }
  }

  async function doResume() {
    setPausing(true);
    try {
      const r = await api.post<{
        pausedAt: null;
        deadlineAt: number;
        pausedTotalMs: number;
        remainingSec: number;
        serverNow: number;
      }>(`/api/attempts/${attemptId}/resume`);
      if (typeof r.serverNow === 'number') clockOffsetRef.current = r.serverNow - Date.now();
      setReview((prev) => (prev ? { ...prev, paused: false, pausedAt: null, pausedTotalMs: r.pausedTotalMs, deadlineAt: r.deadlineAt } : prev));
      setRemaining(r.remainingSec);
      // 恢复后重新拉一次题面（暂停期间服务端把内容屏蔽了）
      const fresh = await api.get<AttemptReview>(`/api/attempts/${attemptId}`);
      applyReview(fresh);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPausing(false);
    }
  }

  function confirmPause() {
    Modal.confirm({
      title: '暂停考试？',
      content: '暂停后计时停止，试卷内容会隐藏起来。想继续时点「继续考试」，剩余时间会接着走。',
      okText: '暂停',
      cancelText: '继续答题',
      onOk: doPause,
    });
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
  const urgent = !paused && (remaining ?? 0) <= 300;
  const items = review.items;
  const item = items[current];
  const answeredCount = items.filter((it) => (answers[it.questionId] ?? []).length > 0).length;
  const flaggedCount = items.filter((it) => it.flagged).length;
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
              <Typography.Text type={paused ? 'warning' : urgent ? 'danger' : 'secondary'}>
                <ClockCircleOutlined /> {paused ? '已暂停 · 剩余 ' : '剩余时间 '}
                {mins}:{secs}
              </Typography.Text>
              <Typography.Text type="secondary">
                已答 {answeredCount}/{items.length} 题
              </Typography.Text>
              {flaggedCount > 0 && (
                <Typography.Text style={{ color: token.colorWarning }}>
                  <FlagFilled /> 标记 {flaggedCount} 题
                </Typography.Text>
              )}
              <Typography.Text type={violations > 0 ? 'danger' : 'secondary'}>
                <FieldTimeOutlined /> 违规 {violations}/3
              </Typography.Text>
            </Space>
          </div>
          <Space size={12} wrap>
            <Progress type="circle" size={54} percent={percent} strokeColor={token.colorPrimary} />
            {paused ? (
              <Button type="primary" size="large" icon={<PlayCircleOutlined />} loading={pausing} onClick={doResume}>
                继续考试
              </Button>
            ) : (
              <>
                <Tooltip title="暂停后计时停止，试卷内容会被隐藏">
                  <Button size="large" icon={<PauseCircleOutlined />} loading={pausing} onClick={confirmPause}>
                    暂停
                  </Button>
                </Tooltip>
                <Button type="primary" danger size="large" loading={submitting} onClick={confirmSubmit}>
                  交卷
                </Button>
              </>
            )}
          </Space>
        </Space>
      </Card>

      {paused ? (
        <Card style={{ marginTop: 16 }} className="liti-paused-card">
          <Result
            icon={<PauseCircleOutlined style={{ color: token.colorWarning }} />}
            title="考试已暂停"
            subTitle={
              <Space direction="vertical" size={4}>
                <span>
                  计时已停止，剩余 {mins}:{secs}；试卷内容已隐藏，恢复后接着答。
                </span>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  暂停时长会累计到这张答卷里，可在结果页查看。
                </Typography.Text>
              </Space>
            }
            extra={
              <Button type="primary" size="large" icon={<PlayCircleOutlined />} loading={pausing} onClick={doResume}>
                继续考试
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {showTip && (
            <Alert
              type="info"
              showIcon
              closable
              onClose={() => setShowTip(false)}
              style={{ marginTop: 16 }}
              message="答案会自动保存，不用手动提交每一步"
              description="切到别的窗口或标签页会被记为违规，累计 3 次自动强制交卷；需要离开一下可以点「暂停」，计时会停住。倒计时结束也会自动交卷，已答的题照常判分。"
            />
          )}

          {/* 当前题目卡片 */}
          {item && (
            <Card
              key={item.questionId}
              className="liti-question-card"
              style={{ marginTop: 16 }}
              title={
                <Space wrap>
                  <Tag color="blue">第 {current + 1} 题</Tag>
                  <span>{item.type === 'single' ? '单选题' : '多选题'}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
                    （{(answers[item.questionId] ?? []).length ? '已作答' : '未作答'}）
                  </Typography.Text>
                  {item.flagged && <Tag color="orange">已标记</Tag>}
                </Space>
              }
              extra={
                <Tooltip title={item.flagged ? '取消标记' : '先标记，稍后回来再看'}>
                  <Button
                    type="text"
                    size="small"
                    icon={item.flagged ? <FlagFilled style={{ color: token.colorWarning }} /> : <FlagOutlined />}
                    onClick={() => toggleFlag(item)}
                  >
                    {item.flagged ? '已标记' : '标记'}
                  </Button>
                </Tooltip>
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
          )}

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
                  答题卡（点击题号跳转，右上角小旗是标记过的题）
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
                          position: 'relative',
                          width: 34,
                          height: 34,
                          background: answered ? token.colorSuccess : token.colorFillSecondary,
                          color: answered ? '#fff' : token.colorText,
                          borderColor: isCurrent
                            ? token.colorPrimary
                            : it.flagged
                              ? token.colorWarning
                              : answered
                                ? token.colorSuccess
                                : token.colorBorder,
                          borderWidth: isCurrent || it.flagged ? 2 : 1,
                          fontWeight: isCurrent ? 700 : 400,
                        }}
                      >
                        {idx + 1}
                        {it.flagged && <span className="liti-sheet-flag" />}
                      </Button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Space size="large" wrap>
                    <span>
                      <span className="liti-sheet-dot" style={{ background: token.colorSuccess }} />
                      已答
                    </span>
                    <span>
                      <span
                        className="liti-sheet-dot"
                        style={{ background: token.colorFillSecondary, border: `1px solid ${token.colorBorder}` }}
                      />
                      未答
                    </span>
                    <span>
                      <span className="liti-sheet-dot" style={{ background: token.colorWarning }}>
                        <FlagFilled style={{ fontSize: 8, color: '#fff' }} />
                      </span>
                      已标记
                    </span>                  </Space>
                </div>
              </div>
            </Space>
          </Card>
        </>
      )}

      <Modal
        open={blocked}
        closable={false}
        maskClosable={false}
        footer={
          <Button type="primary" onClick={() => setBlocked(false)}>
            我知道了，继续答题
          </Button>
        }
      >
        <Result
          status="warning"
          title="检测到你离开了答题页"
          subTitle={`本次已记为违规（第 ${violations} 次，共 3 次机会）。计时没有暂停，累计 3 次会自动强制交卷；需要离开一会儿请用「暂停」。`}
        />
      </Modal>
    </div>
  );
}
