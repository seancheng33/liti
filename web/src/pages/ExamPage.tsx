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
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudSyncOutlined,
  ExclamationCircleOutlined,
  FlagFilled,
  FlagOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { AnswerQueue, INITIAL_SAVE_STATE, type SaveState } from '../answerQueue';
import { ImageGallery } from '../components/ImageUpload';
import type { AttemptItem, AttemptReview } from '../types';

/** 违规上报去抖窗口：一次切窗通常会连着触发 visibilitychange + blur，别记成两次 */
const VIOLATION_DEBOUNCE_MS = 2000;

/** 保存状态指示：学生需要知道「我这题到底存上没有」，尤其是网差的时候 */
function SaveIndicator({ state }: { state: SaveState }) {
  if (state.phase === 'idle') return null;

  if (state.phase === 'stuck') {
    return (
      <Tooltip title="这几题的答案还在这台电脑上，交卷时会随交卷一起提交，不会丢。网络恢复后也会自动补存。">
        <Typography.Text type="warning" style={{ cursor: 'help' }}>
          <CloudSyncOutlined /> {state.pending} 题未同步
        </Typography.Text>
      </Tooltip>
    );
  }
  if (state.phase === 'retrying') {
    return (
      <Tooltip title="网络不稳定，正在自动重试；答案还在本地，不用重复作答">
        <Typography.Text type="warning" style={{ cursor: 'help' }}>
          <CloudSyncOutlined /> 网络不稳，{state.pending} 题重试中
        </Typography.Text>
      </Tooltip>
    );
  }
  if (state.phase === 'saving') {
    return (
      <Typography.Text type="secondary">
        <LoadingOutlined /> 保存中…
      </Typography.Text>
    );
  }
  return (
    <Typography.Text type="secondary">
      <CheckCircleOutlined style={{ color: '#52c41a' }} /> 答案已保存
    </Typography.Text>
  );
}

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
  /** 答案落盘状态：已保存 / 保存中 / 网络不稳重试中 / 未同步 */
  const [saveState, setSaveState] = useState<SaveState>(INITIAL_SAVE_STATE);
  const queueRef = useRef<AnswerQueue | null>(null);
  const submittedRef = useRef(false);
  const lastViolationRef = useRef(0);
  /** 服务端时间与本机时间的差（毫秒）：考生电脑时钟不准时，倒计时也得是对的 */
  const clockOffsetRef = useRef(0);

  const paused = !!review?.paused;
  /** 交卷时要知道当前是否暂停（暂停中 PATCH 一律 400，没必要去试） */
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

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

  /**
   * 答案保存队列：按题合并、同题串行、断网指数退避重试。
   * 交卷时没落盘的答案会作为快照随 submit 一起提交，见 handleSubmit。
   */
  useEffect(() => {
    const queue = new AnswerQueue({
      save: async (questionId, selectedOptionIds) => {
        await api.patch(`/api/attempts/${attemptId}/answers`, { questionId, selectedOptionIds });
      },
      onChange: setSaveState,
      onFatal: (_questionId, e) => message.error((e as Error).message),
      // 关页面时普通 fetch 会被浏览器取消，只有 keepalive 发得出去
      beacon: (questionId, selectedOptionIds) => {
        void fetch(`/api/attempts/${attemptId}/answers`, {
          method: 'PATCH',
          credentials: 'include',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId, selectedOptionIds }),
        }).catch(() => {});
      },
    });
    queueRef.current = queue;

    const onPageHide = () => queue.beacon();
    // 网络一恢复就立刻补存，不用等队列自己的兜底定时器
    const onOnline = () => queue.retryStuck();
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      queue.destroy();
      queueRef.current = null;
    };
  }, [attemptId]);

  const handleSubmit = useCallback(async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    const queue = queueRef.current;
    try {
      // 先把没落盘的尽量补回去；网络彻底断了就靠下面的快照，不等太久。
      // 暂停中不补 —— 后端对暂停中的保存一律 400，交卷接口本身会先自动恢复再落快照。
      if (queue && !pausedRef.current) await queue.flushNow({ retryStuck: true, timeoutMs: 4000 });
      // 快照里只有「还没落盘」的题，服务端在判分前先写一遍
      await api.post(`/api/attempts/${attemptId}/submit`, { answers: queue ? queue.snapshot() : [] });
    } catch {
      /* 超时或已提交 */
    } finally {
      queue?.destroy();
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

  /**
   * 作答：本地立刻生效，落盘交给队列。
   * 不再 await 请求，也不在失败时弹红字 —— 考试中弹窗只会让学生慌，
   * 队列自己会重试，顶部状态条会如实显示「还没存上」。
   */
  function saveAnswer(questionId: number, ids: number[]) {
    setAnswers((a) => ({ ...a, [questionId]: ids }));
    queueRef.current?.set(questionId, ids);
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
              <SaveIndicator state={saveState} />
              {flaggedCount > 0 && (
                <Typography.Text style={{ color: token.colorWarning }}>
                  <FlagFilled /> 标记 {flaggedCount} 题
                </Typography.Text>
              )}
              <Typography.Text type={violations > 0 ? 'danger' : 'secondary'}>
                <ExclamationCircleOutlined /> 违规 {violations}/3
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
                {review?.allowPause !== false && (
                  <Tooltip title="暂停后计时停止，试卷内容会被隐藏">
                    <Button size="large" icon={<PauseCircleOutlined />} loading={pausing} onClick={confirmPause}>
                      暂停
                    </Button>
                  </Tooltip>
                )}
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
              message="答案会自动保存，网络断了会自动重试"
              description={
                (review?.allowPause === false
                  ? '本场考试不允许自行暂停，倒计时会一直走。切到别的窗口或标签页会被记为违规，累计 3 次自动强制交卷。倒计时结束会自动交卷，已答的题照常判分。'
                  : '切到别的窗口或标签页会被记为违规，累计 3 次自动强制交卷；需要离开一下可以点「暂停」，计时会停住。倒计时结束也会自动交卷，已答的题照常判分。') +
                '顶部会显示保存状态；万一网络一直不通，交卷时也会把已答的答案一并带上。'
              }
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
          subTitle={
            review?.allowPause === false
              ? `本次已记为违规（第 ${violations} 次，共 3 次机会）。本场考试不允许暂停，计时不会停，累计 3 次会自动强制交卷。`
              : `本次已记为违规（第 ${violations} 次，共 3 次机会）。计时没有暂停，累计 3 次会自动强制交卷；需要离开一会儿请用「暂停」。`
          }
        />
      </Modal>
    </div>
  );
}
