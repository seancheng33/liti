#!/usr/bin/env node
// 砺题 Liti 性能基准（M15-2 压测）
// 用法：LITI_BASE=http://192.168.1.61:8080 node liti-bench.mjs
//       LITI_BASE=http://192.168.1.61:8081 BENCH_TAG=benchmysql node liti-bench.mjs
// 场景：login / papers-list / public-overview / questions-list / save-answer / exam-flow
// 说明：login 用正确密码（FailBucket 只记失败，不会触发限流）；
//       exam-flow 每次迭代消耗一个作答名额，故建 10 张相同卷轮换。
import http from 'node:http';

const BASE = (process.env.LITI_BASE || 'http://127.0.0.1:8080').replace(/\/$/, '');
const TAG = process.env.BENCH_TAG || 'bench';
const CONC = parseInt(process.env.BENCH_CONC || '8', 10);
const DUR = parseInt(process.env.BENCH_DUR || '12', 10); // 每场景秒数
const NQ = 20;          // 压测卷题数
const NPAPERS = 10;     // 轮换卷数
const NUSERS = 8;

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function request(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      BASE + path,
      {
        method,
        agent,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try { data = JSON.parse(text); } catch { /* ignore */ }
          resolve({ status: res.statusCode, data, setCookie: res.headers['set-cookie'] });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function pct(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// 并发压测：worker 循环直到 deadline，lat 收集毫秒，err 计数
async function runLoad({ workers, durationSec, maxCount, action }) {
  const lat = [];
  let err = 0, ok = 0, stop = false;
  const t0 = Date.now();
  const deadline = t0 + durationSec * 1000;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (!stop) {
        if (maxCount && ok + err >= maxCount) return;
        if (!maxCount && Date.now() >= deadline) return;
        try {
          await action((ms) => lat.push(ms));
          ok++;
        } catch {
          err++;
        }
        if (maxCount && ok + err >= maxCount) stop = true;
        if (!maxCount && Date.now() >= deadline) stop = true;
      }
    }),
  );
  lat.sort((a, b) => a - b);
  const elapsed = Math.max(0.001, (Date.now() - t0) / 1000);
  return { ok, err, rps: +((ok + err) / elapsed).toFixed(1), p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1) };
}

async function login(username, password) {
  const r = await request('POST', '/api/auth/login', { body: { username, password } });
  if (r.status !== 200) throw new Error(`login ${r.status}`);
  return (r.setCookie || []).map((c) => c.split(';')[0]).join('; ');
}

const results = [];
async function scenario(name, opts) {
  const t0 = Date.now();
  const r = await runLoad(opts);
  results.push({ name, ...r });
  console.log(
    `  ${name.padEnd(16)} ok=${String(r.ok).padStart(6)} err=${String(r.err).padStart(4)}  rps=${String(r.rps).padStart(7)}  p50=${String(r.p50).padStart(7)}ms  p95=${String(r.p95).padStart(7)}ms  p99=${String(r.p99).padStart(7)}ms`,
  );
  return r;
}

async function main() {
  console.log(`=== Liti 性能基准 @ ${BASE} (TAG=${TAG}, 并发=${CONC}) ===\n`);
  const health = await request('GET', '/api/health');
  if (health.status !== 200) throw new Error('服务不可达');
  const serverNow = health.data?.time ?? Date.now();

  /* ---------- 准备数据（不计入压测） ---------- */
  console.log('准备压测数据…');
  const adminCookie = await login('admin', 'admin123');
  const teacherCookie = await login('teacher', 'teacher123');

  // 建题（题干带唯一序号，避开查重）
  const questionIds = [];
  for (let i = 0; i < NQ; i++) {
    const r = await request('POST', '/api/questions', {
      body: {
        type: 'single',
        stem: `【${TAG}】第 ${i + 1} 题：2 + ${i} = ?`,
        explanation: `和是 ${2 + i}`,
        options: [
          { content: String(2 + i), isCorrect: true },
          { content: String(3 + i), isCorrect: false },
          { content: String(4 + i), isCorrect: false },
          { content: String(5 + i), isCorrect: false },
        ],
      },
      cookie: adminCookie,
    });
    if (r.status !== 200 || !r.data?.id) throw new Error(`建题失败 #${i}: ${r.status} ${JSON.stringify(r.data)}`);
    questionIds.push(r.data.id);
  }

  // 建 10 张相同的手选卷（轮换作答名额）
  const paperIds = [];
  for (let i = 0; i < NPAPERS; i++) {
    const r = await request('POST', '/api/papers', {
      body: {
        title: `【${TAG}】压测卷 ${i + 1}`,
        mode: 'fixed',
        durationSec: 1800,
        passScore: 60,
        reviewMode: 'after_submit',
        maxAttempts: 99,
        questionIds,
      },
      cookie: adminCookie,
    });
    if (r.status !== 200 || !r.data?.id) throw new Error(`建卷失败 ${i}: ${r.status} ${JSON.stringify(r.data)}`);
    paperIds.push(r.data.id);
    await request('POST', `/api/papers/${r.data.id}/publish`, { cookie: adminCookie });
  }

  // 建 8 个压测学生并登录
  const students = [];
  for (let i = 0; i < NUSERS; i++) {
    const uname = `${TAG}user${String(i + 1).padStart(2, '0')}`;
    const cr = await request('POST', '/api/users', {
      body: { username: uname, displayName: `${TAG} 学生${i + 1}`, password: 'bench12345', role: 'student' },
      cookie: adminCookie,
    });
    if (cr.status !== 200 && cr.status !== 201 && !/exist|占用|已存在/i.test(cr.data?.error ?? '')) {
      throw new Error(`建学生失败 ${uname}: ${cr.status} ${JSON.stringify(cr.data)}`);
    }
    students.push({ username: uname, cookie: await login(uname, 'bench12345'), attemptId: null, items: [] });
  }
  console.log(`数据就绪：${NQ} 题 / ${NPAPERS} 卷 / ${NUSERS} 学生\n`);

  /* ---------- 场景 1：登录（argon2 校验是 CPU 热点） ---------- */
  console.log('场景 1  login（正确密码，共 24 次）');
  let loginIdx = 0;
  await scenario('login', {
    workers: CONC,
    durationSec: DUR,
    maxCount: 24,
    action: async (lat) => {
      const u = students[loginIdx++ % students.length];
      const t = Date.now();
      await login(u.username, 'bench12345');
      lat(Date.now() - t);
    },
  });

  /* ---------- 场景 2：学生试卷列表 ---------- */
  console.log('\n场景 2  papers-list（学生已登录）');
  {
    let idx = 0;
    await scenario('papers-list', {
      workers: CONC,
      durationSec: DUR,
      action: async (lat) => {
        const s = students[idx++ % students.length];
        const t = Date.now();
        const r = await request('GET', '/api/papers', { cookie: s.cookie });
        lat(Date.now() - t);
        if (r.status !== 200) throw new Error(String(r.status));
      },
    });
  }

  /* ---------- 场景 3：公开统计（未登录） ---------- */
  console.log('\n场景 3  public-overview（未登录）');
  await scenario('public-overview', {
    workers: CONC,
    durationSec: DUR,
    action: async (lat) => {
      const t = Date.now();
      const r = await request('GET', '/api/public/overview');
      lat(Date.now() - t);
      if (r.status !== 200) throw new Error(String(r.status));
    },
  });

  /* ---------- 场景 4：教师题库列表 ---------- */
  console.log('\n场景 4  questions-list（教师）');
  await scenario('questions-list', {
    workers: Math.max(2, CONC >> 1),
    durationSec: DUR,
    action: async (lat) => {
      const t = Date.now();
      const r = await request('GET', '/api/questions?pageSize=50', { cookie: teacherCookie });
      lat(Date.now() - t);
      if (r.status !== 200) throw new Error(String(r.status));
    },
  });

  /* ---------- 场景 5：答题自动保存（真实考试最热的路径） ---------- */
  console.log('\n场景 5  save-answer（PATCH /answers）');
  {
    // 先给每个学生开一张进行中的答卷（不计入压测时长）
    for (const s of students) {
      const r = await request('POST', '/api/attempts', { body: { paperId: paperIds[0] }, cookie: s.cookie });
      if (r.status !== 200 || !r.data?.id) throw new Error(`开考失败 ${s.username}: ${r.status} ${JSON.stringify(r.data)}`);
      s.attemptId = r.data.id;
      const d = await request('GET', `/api/attempts/${s.attemptId}`, { cookie: s.cookie });
      s.items = (d.data?.items ?? []).map((i) => ({ questionId: i.questionId, optionIds: (i.options ?? []).map((o) => o.id) }));
    }
    let idx = 0;
    await scenario('save-answer', {
      workers: CONC,
      durationSec: DUR,
      action: async (lat) => {
        const s = students[idx++ % students.length];
        const item = s.items[idx % s.items.length];
        const t = Date.now();
        const r = await request('PATCH', `/api/attempts/${s.attemptId}/answers`, {
          body: { questionId: item.questionId, selectedOptionIds: [item.optionIds[idx % item.optionIds.length]] },
          cookie: s.cookie,
        });
        lat(Date.now() - t);
        if (r.status !== 200) throw new Error(String(r.status));
      },
    });
  }

  /* ---------- 场景 6：完整考试流（开考→存 3 题→交卷→判分） ---------- */
  console.log('\n场景 6  exam-flow（开考→3 次保存→交卷，计整流时延）');
  {
    let flowIdx = 0;
    await scenario('exam-flow', {
      workers: Math.max(2, CONC >> 1),
      durationSec: DUR,
      action: async (lat) => {
        const s = students[flowIdx % students.length];
        const paperId = paperIds[flowIdx++ % paperIds.length];
        const t = Date.now();
        const st = await request('POST', '/api/attempts', { body: { paperId }, cookie: s.cookie });
        if (st.status !== 200 || !st.data?.id) throw new Error(`开考 ${st.status} ${JSON.stringify(st.data)}`);
        const attemptId = st.data.id;
        const d = await request('GET', `/api/attempts/${attemptId}`, { cookie: s.cookie });
        const items = (d.data?.items ?? []).slice(0, 3);
        for (const item of items) {
          const sv = await request('PATCH', `/api/attempts/${attemptId}/answers`, {
            body: { questionId: item.questionId, selectedOptionIds: [(item.options ?? [])[0]?.id].filter(Boolean) },
            cookie: s.cookie,
          });
          if (sv.status !== 200) throw new Error(`保存 ${sv.status}`);
        }
        const sub = await request('POST', `/api/attempts/${attemptId}/submit`, { cookie: s.cookie });
        if (sub.status !== 200) throw new Error(`交卷 ${sub.status} ${JSON.stringify(sub.data)}`);
        lat(Date.now() - t);
      },
    });
  }

  /* ---------- 汇总 ---------- */
  console.log(`\n=== 汇总（服务器时钟基准 ${new Date(serverNow).toISOString()}）===`);
  console.log('| 场景 | 请求数 | 错误 | rps | p50(ms) | p95(ms) | p99(ms) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.name} | ${r.ok} | ${r.err} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} |`);
  }

  const after = await request('GET', '/api/health');
  console.log(`\n压测后 health: ${after.status}（error=${after.data?.error ?? '—'}）`);
  console.log('清理提示：压测产生的学生/题目/答卷留在测试库；学生可经用户管理删除，题目为软删除，答卷随归档保留。');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('压测中止：', e.message);
    process.exit(1);
  });
