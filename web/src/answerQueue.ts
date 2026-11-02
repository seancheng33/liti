/**
 * 答案保存队列
 *
 * 存在的理由：考试现场的网不会一直好。原来每点一次选项就发一次 PATCH、失败只弹一条红字，
 * 有三个后果，任何一个都够让人丢分：
 *
 *   1. 快速连点会并发发出多个 PATCH，服务端可能先处理后到的那条，
 *      于是库里留下的是**旧答案**（请求完成顺序不等于发出顺序）；
 *   2. 断网那几下的答案直接没了，学生还以为存好了，交卷后无法挽回；
 *   3. 交卷不等答案落盘，最后改的几题大概率丢。
 *
 * 现在的做法：
 *   - 按题合并 + 去抖，同一题永远串行；用 seq 认版本，旧响应回来不会覆盖新值；
 *   - 网络错误 / 5xx / 429 指数退避重试，400 / 403 / 404 属终态错误不再重试（重试也没用）；
 *   - 交卷时把还没落盘的答案作为快照随 submit 一起带上，一次请求兜底；
 *   - 页面被关掉时用 fetch keepalive 尽力发一次（普通 fetch 在 pagehide 后会被取消）。
 */

export type SavePhase = 'idle' | 'ok' | 'saving' | 'retrying' | 'stuck';

export interface SaveState {
  phase: SavePhase;
  /** 还没落到服务端的题目数 */
  pending: number;
  /** 自动重试已放弃、只能靠交卷快照兜底的题目数 */
  stuck: number;
  /** 最近一次成功落盘的时间戳；0 表示还没保存过任何东西 */
  lastSavedAt: number;
}

export interface AnswerQueueOptions {
  /** 真正发请求的那一步；抛错即视为失败 */
  save: (questionId: number, selectedOptionIds: number[]) => Promise<void>;
  /** 状态变化回调（用于渲染「已保存 / 保存中 / 重试中」） */
  onChange?: (state: SaveState) => void;
  /** 终态错误（400/403/404）回调，通常是「答卷已结束」这类没法重试的情况 */
  onFatal?: (questionId: number, error: unknown) => void;
  /** 页面即将关闭时的尽力发送；不提供就跳过 */
  beacon?: (questionId: number, selectedOptionIds: number[]) => void;
  /** 合并窗口，默认 250ms */
  debounceMs?: number;
  /** 单题最多自动重试几次，默认 4 次 */
  maxAttempts?: number;
  /** 首次重试延迟，之后翻倍，默认 800ms、上限 8s */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /**
   * 自动重试放弃之后，隔多久再给一次机会（默认 15s，一直试到成功或交卷）。
   * 考试中途网络断个十几秒很常见，总不能让学生自己去刷新页面。
   */
  stuckRetryMs?: number;
}

interface Version {
  ids: number[];
  /** 每次 set 递增；响应回来时用它判断本地是否已经有更新的值 */
  seq: number;
}

const DEFAULT_STATE: SaveState = { phase: 'idle', pending: 0, stuck: 0, lastSavedAt: 0 };

function statusOf(e: unknown): number | null {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

/** 没拿到 HTTP 状态（断网、DNS、连接被掐）或服务端自身出错，才值得再试 */
function defaultRetryable(status: number | null): boolean {
  if (status === null) return true;
  return status >= 500 || status === 429 || status === 408;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class AnswerQueue {
  private pending = new Map<number, Version>();
  private attempts = new Map<number, number>();
  /** 自动重试次数用完的题：值保留着，等交卷快照兜底 */
  private stuck = new Set<number>();
  private inflight = new Set<number>();
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stuckTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** 本轮 drain 期间是否有题拿到了更新版本，需要再走一轮 */
  private again = false;
  private needRetry = false;
  private lastSavedAt = 0;
  private destroyed = false;

  private readonly debounceMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly stuckRetryMs: number;

  constructor(private opts: AnswerQueueOptions) {
    this.debounceMs = opts.debounceMs ?? 250;
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.backoffBaseMs = opts.backoffBaseMs ?? 800;
    this.backoffMaxMs = opts.backoffMaxMs ?? 8000;
    this.stuckRetryMs = opts.stuckRetryMs ?? 15000;
  }

  /** 记录一次作答（本地立即生效，落盘是队列的事） */
  set(questionId: number, ids: number[]): void {
    if (this.destroyed) return;
    this.pending.set(questionId, { ids: [...ids], seq: ++this.seq });
    // 用户又改了这道题，值得再从零试几次
    this.attempts.delete(questionId);
    this.stuck.delete(questionId);
    this.schedule(this.debounceMs);
    this.emit();
  }

  /** 本地当前的全部待落盘答案（含已放弃重试的），交卷快照用 */
  snapshot(): { questionId: number; selectedOptionIds: number[] }[] {
    return [...this.pending.entries()].map(([questionId, v]) => ({
      questionId,
      selectedOptionIds: [...v.ids],
    }));
  }

  pendingCount(): number {
    return this.pending.size;
  }

  /**
   * 把队列跑干，用于交卷前。
   * @param retryStuck 是否给已经放弃的题最后一次机会（用户手动交卷时给）
   * @param timeoutMs 最多等多久；0 表示一直等到出结果
   * @returns 是否全部落盘
   */
  async flushNow({ retryStuck = true, timeoutMs = 0 } = {}): Promise<boolean> {
    this.clearTimers();
    if (retryStuck) {
      this.stuck.clear();
      this.attempts.clear();
    }
    if (!this.pending.size) return true;

    const work = this.drain();
    if (timeoutMs > 0) {
      const finished = await Promise.race([work.then(() => true), sleep(timeoutMs).then(() => false)]);
      if (!finished) return this.unsettled() === 0;
    } else {
      await work;
    }
    return this.unsettled() === 0;
  }

  /** 网络恢复时手动叫醒：清掉放弃标记，立刻重试一轮 */
  retryStuck(): void {
    if (this.destroyed || !this.stuck.size) return;
    this.stuck.clear();
    this.attempts.clear();
    this.clearTimers();
    void this.drain();
  }

  /** 页面即将关闭：把还没落盘的每题尽力发一次，不等待结果 */
  beacon(): void {
    if (!this.opts.beacon) return;
    for (const [questionId, v] of this.pending) {
      try {
        this.opts.beacon(questionId, v.ids);
      } catch {
        /* 关页面时出什么错都没法处理 */
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stuckTimer) clearTimeout(this.stuckTimer);
    this.timer = null;
    this.stuckTimer = null;
  }

  /** 还没真正落盘的题数（stuck 的也算，因为它们确实没存上） */
  private unsettled(): number {
    return this.pending.size;
  }

  private emit(): void {
    this.opts.onChange?.(this.state());
  }

  private state(): SaveState {
    const pending = this.pending.size;
    let phase: SavePhase = 'idle';
    if (pending > 0 && this.stuck.size >= pending) phase = 'stuck';
    else if (pending > 0 && this.running) phase = 'saving';
    else if (pending > 0) phase = 'retrying';
    else if (this.lastSavedAt > 0) phase = 'ok';
    return { phase, pending, stuck: this.stuck.size, lastSavedAt: this.lastSavedAt };
  }

  private schedule(ms: number): void {
    if (this.destroyed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, ms);
  }

  private async drain(): Promise<void> {
    if (this.destroyed) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.emit();
    try {
      do {
        this.again = false;
        const batch: [number, number[]][] = [];
        for (const [qid, v] of this.pending) {
          if (this.inflight.has(qid) || this.stuck.has(qid)) continue;
          batch.push([qid, v.ids]);
        }
        if (!batch.length) break;
        // 不同题互不影响，可以并发；同一题永远只有一个在飞（batch 里每题只出现一次）
        await Promise.all(batch.map(([qid, ids]) => this.sendOne(qid, ids)));
      } while (this.again && !this.destroyed);
    } finally {
      this.running = false;
      this.emit();
    }
    this.scheduleRetryIfNeeded();
    this.armStuckRetry();
  }

  /**
   * 放弃重试的题不能就这么躺到交卷。
   * 隔一段时间自己醒过来再试一轮，成功即止（pending 空了就不再排）。
   */
  private armStuckRetry(): void {
    if (this.destroyed || this.stuckTimer || !this.stuck.size) return;
    this.stuckTimer = setTimeout(() => {
      this.stuckTimer = null;
      if (this.destroyed) return;
      this.stuck.clear();
      this.attempts.clear();
      void this.drain();
    }, this.stuckRetryMs);
  }

  private async sendOne(questionId: number, ids: number[]): Promise<void> {
    const ver = this.pending.get(questionId);
    if (!ver) return;
    const seq = ver.seq;
    this.inflight.add(questionId);
    this.emit();
    try {
      await this.opts.save(questionId, ids);
      const cur = this.pending.get(questionId);
      if (cur && cur.seq === seq) this.pending.delete(questionId);
      else this.again = true; // 发送期间用户又改了，下一轮发新值
      this.attempts.delete(questionId);
      this.lastSavedAt = Date.now();
    } catch (e) {
      if (!defaultRetryable(statusOf(e))) {
        // 终态错误：这道题再发也是同样的结果，丢掉待发值、交给调用方提示
        const cur = this.pending.get(questionId);
        if (cur && cur.seq === seq) this.pending.delete(questionId);
        this.opts.onFatal?.(questionId, e);
      } else {
        const n = (this.attempts.get(questionId) ?? 0) + 1;
        this.attempts.set(questionId, n);
        if (n >= this.maxAttempts) this.stuck.add(questionId);
        else this.needRetry = true;
      }
    } finally {
      this.inflight.delete(questionId);
      this.emit();
    }
  }

  private scheduleRetryIfNeeded(): void {
    if (this.destroyed || !this.needRetry) return;
    this.needRetry = false;
    const tries = Math.min(...[...this.attempts.values()], this.maxAttempts);
    const delay = Math.min(this.backoffBaseMs * 2 ** Math.max(0, tries - 1), this.backoffMaxMs);
    this.schedule(delay);
  }
}

export const INITIAL_SAVE_STATE = DEFAULT_STATE;
