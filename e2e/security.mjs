// 砺题 Liti —— 安全测试（黑盒，只打接口，不碰数据库）
// 运行：docker exec -e LITI_BASE=http://127.0.0.1:8080 -w /app/server liti node liti-sec.mjs
const BASE = process.env.LITI_BASE || 'http://127.0.0.1:8080';
const PWD = 'TempPass123';

let pass = 0;
let fail = 0;
const findings = [];

function check(cond, name, detail = '') {
  if (cond) {
    pass++;
    console.log(`  [PASS] ${name}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? '  << ' + detail : ''}`);
    findings.push(`${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function api(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.cookie = `liti_session=${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, text, headers: res.headers };
}

async function login(username, password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const sc = setCookies.join(' | ');
  const m = /liti_session=([^;]+)/.exec(sc);
  return { status: res.status, token: m ? m[1] : null, setCookie: sc, body: await res.text() };
}

async function ensureUser(admin, username, role) {
  const created = await api('POST', '/api/users', {
    token: admin,
    body: { username, displayName: username, password: PWD, role },
  });
  if (created.status === 201 || created.status === 200) return created.data.id;
  const list = await api('GET', '/api/users', { token: admin });
  const hit = (list.data || []).find((u) => u.username === username);
  if (!hit) throw new Error(`无法准备账号 ${username}: ${created.status} ${created.text}`);
  // 确保密码是我们知道的（可能被别的脚本改过）
  await api('POST', `/api/users/${hit.id}/reset-password`, { token: admin, body: { password: PWD } });
  return hit.id;
}

function section(t) {
  console.log(`\n===== ${t} =====`);
}

async function main() {
  const tag = Date.now().toString(36).slice(-5);
  const studentA = `secA_${tag}`;
  const studentB = `secB_${tag}`;

  // ---------- 准备 ----------
  const adminLogin = await login('admin', 'admin123');
  if (!adminLogin.token) throw new Error('admin 登录失败：' + adminLogin.status);
  const admin = adminLogin.token;

  await ensureUser(admin, 'teacher', 'teacher');
  const tLogin = await login('teacher', 'teacher123');
  let teacher = tLogin.token;
  if (!teacher) {
    const tl = await api('GET', '/api/users', { token: admin });
    const t = (tl.data || []).find((u) => u.username === 'teacher');
    await api('POST', `/api/users/${t.id}/reset-password`, { token: admin, body: { password: 'teacher123' } });
    teacher = (await login('teacher', 'teacher123')).token;
  }

  const idA = await ensureUser(admin, studentA, 'student');
  const idB = await ensureUser(admin, studentB, 'student');
  const a = (await login(studentA, PWD)).token;
  const b = (await login(studentB, PWD)).token;
  if (!a || !b) throw new Error('学生登录失败');

  // 老师造题 + 两种卷
  const cat = await api('POST', '/api/categories', { token: teacher, body: { name: `sec_cat_${tag}` } });
  const catId = cat.data?.id ?? null;

  async function makeQuestion(n) {
    const r = await api('POST', '/api/questions', {
      token: teacher,
      body: {
        type: 'single',
        stem: `sec_${tag}_q${n}_<script>alert(1)</script>`,
        categoryId: catId,
        explanation: `sec_explain_${n}`,
        options: [
          { content: 'A', isCorrect: true },
          { content: 'B', isCorrect: false },
        ],
      },
    });
    return r.data?.id;
  }
  const q1 = await makeQuestion(1);
  const q2 = await makeQuestion(2);

  // 草稿卷（未发布）
  const draft = await api('POST', '/api/papers', {
    token: teacher,
    body: {
      title: `sec_draft_${tag}`,
      mode: 'fixed',
      questionIds: [q1, q2],
      durationSec: 600,
      reviewMode: 'after_submit',
    },
  });
  const draftId = draft.data?.id;

  // 已发布但只给 studentB 的卷（考试模式，交卷后才给答案）
  const sel = await api('POST', '/api/papers', {
    token: teacher,
    body: {
      title: `sec_sel_${tag}`,
      mode: 'fixed',
      questionIds: [q1, q2],
      durationSec: 600,
      reviewMode: 'after_submit',
      audienceMode: 'selected',
      audienceUserIds: [idB],
    },
  });
  const selId = sel.data?.id;
  await api('POST', `/api/papers/${selId}/publish`, { token: teacher, body: {} });

  // ---------- A. 认证与会话 ----------
  section('A. 认证与会话');
  check((await api('GET', '/api/attempts')).status === 401, '未登录访问 /api/attempts 返回 401');
  check((await api('GET', '/api/users')).status === 401, '未登录访问 /api/users 返回 401');

  const bad = await login('admin', 'wrong-password-xxx');
  const noUser = await login('no_such_user_' + tag, 'whatever123');
  check(bad.status === 401, '错误密码登录返回 401');
  check(
    bad.data === noUser.data || JSON.stringify(bad.body) === JSON.stringify(noUser.body),
    '错误密码与不存在用户返回同一提示（不泄露账号是否存在）',
    `bad=${bad.body} noUser=${noUser.body}`,
  );

  const sc = adminLogin.setCookie;
  check(/HttpOnly/i.test(sc), '会话 Cookie 带 HttpOnly');
  check(/SameSite=(Lax|Strict)/i.test(sc), '会话 Cookie 带 SameSite', sc);

  // 会话固定：登录前给个假 token，登录后应换新
  const fixed = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'liti_session=attacker-fixed-token' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const newToken = /liti_session=([^;]+)/.exec((fixed.headers.getSetCookie() || []).join(' '));
  check(!!newToken && newToken[1] !== 'attacker-fixed-token', '登录后重新签发会话 ID（无会话固定）');

  // 登出后 token 失效
  const tmp = await login('admin', 'admin123');
  await api('POST', '/api/auth/logout', { token: tmp.token });
  check((await api('GET', '/api/auth/me', { token: tmp.token })).status === 401, '登出后旧 token 立即失效');

  // 暴力破解：用不存在的用户名测，避免把 admin 自己锁在门外
  let throttled = false;
  const bruteUser = `brute_${tag}`;
  for (let i = 0; i < 15; i++) {
    const r = await login(bruteUser, 'wrong-' + i);
    if (r.status === 429) {
      throttled = true;
      break;
    }
  }
  check(throttled, '重复登录失败会被限流（429）', '连续 15 次错误密码都没有被限流');

  // ---------- B. 越权 ----------
  section('B. 越权访问');
  check((await api('GET', '/api/users', { token: a })).status === 403, '学生访问用户列表 403');
  check((await api('POST', '/api/users', { token: a, body: { username: 'x' + tag, displayName: 'x', password: PWD, role: 'admin' } })).status === 403, '学生创建账号 403');
  check((await api('DELETE', `/api/users/${idB}`, { token: a })).status === 403, '学生删除用户 403');
  check((await api('GET', '/api/groups', { token: a })).status === 403, '学生访问分组 403');
  check((await api('POST', '/api/papers', { token: a, body: { title: 'x', mode: 'fixed', questionIds: [q1], durationSec: 60 } })).status === 403, '学生创建试卷 403');
  check((await api('POST', `/api/papers/${selId}/publish`, { token: a, body: {} })).status === 403, '学生发布试卷 403');
  check((await api('DELETE', `/api/papers/${selId}`, { token: a })).status === 403, '学生删除试卷 403');
  check((await api('POST', '/api/questions', { token: a, body: { type: 'single', stem: 'x', options: [] } })).status === 403, '学生创建题目 403');
  check((await api('DELETE', `/api/questions/${q1}`, { token: a })).status === 403, '学生删除题目 403');
  check((await api('GET', '/api/questions/export', { token: a })).status === 403, '学生导出题库 403');
  check((await api('GET', '/api/attempts/export', { token: a })).status === 403, '学生导出成绩 403');
  check((await api('PUT', '/api/settings', { token: a, body: { site_name: 'hacked' } })).status === 403, '学生改站点设置 403');
  check((await api('POST', '/api/uploads', { token: a, body: { data: 'data:image/png;base64,AAAA' } })).status === 403, '学生上传图片 403');

  // 老师不能建教师 / 不能碰管理员
  const t2 = await api('POST', '/api/users', { token: teacher, body: { username: 'secT' + tag, displayName: 'x', password: PWD, role: 'teacher' } });
  check(t2.status === 403, '教师创建教师账号 403', `status=${t2.status}`);
  const t3 = await api('PUT', '/api/users/1', { token: teacher, body: { role: 'admin' } });
  check(t3.status === 403, '教师改管理员账号 403', `status=${t3.status}`);

  // 试卷可见性：studentA 不在 selId 名单里
  const seeSel = await api('GET', `/api/papers/${selId}`, { token: a });
  check(seeSel.status === 404, '名单外的学生读限定卷 应 404', `实际 ${seeSel.status}`);
  const seeDraft = await api('GET', `/api/papers/${draftId}`, { token: a });
  check(seeDraft.status === 404, '学生读草稿卷 应 404', `实际 ${seeDraft.status}`);
  const seeB = await api('GET', `/api/papers/${selId}`, { token: b });
  check(seeB.status === 200, '名单内的学生能读限定卷 200', `实际 ${seeB.status}`);

  // 学生看试卷列表不能出现草稿/他人限定卷
  const listA = await api('GET', '/api/papers?pageSize=100', { token: a });
  const ids = (listA.data?.items || []).map((p) => p.id);
  check(!ids.includes(draftId), '学生试卷列表不含草稿卷');
  check(!ids.includes(selId), '学生试卷列表不含他人的限定卷');

  // 题库浏览
  const qList = await api('GET', '/api/questions?pageSize=5', { token: a });
  check(qList.status === 403, '学生浏览题库 应 403', `实际 ${qList.status}`);
  if (qList.status === 200) {
    const leaked = JSON.stringify(qList.data).includes('isCorrect') || JSON.stringify(qList.data).includes('is_correct');
    check(!leaked, '题库列表不返回 isCorrect（若可读）');
  }

  // 答卷越权
  const startA = await api('POST', '/api/attempts', { token: a, body: { paperId: selId } });
  check(startA.status === 404, '名单外学生开考限定卷 应 404', `实际 ${startA.status}`);

  const startB = await api('POST', '/api/attempts', { token: b, body: { paperId: selId } });
  const attemptB = startB.data?.id;
  check(startB.status === 200 && !!attemptB, '名单内学生能开考');
  if (attemptB) {
    check((await api('GET', `/api/attempts/${attemptB}`, { token: a })).status === 403, '学生读他人答卷 403');
    check((await api('PATCH', `/api/attempts/${attemptB}/answers`, { token: a, body: { questionId: q1, selectedOptionIds: [] } })).status === 403, '学生改他人答卷 403');
    check((await api('POST', `/api/attempts/${attemptB}/submit`, { token: a })).status === 403, '学生交他人答卷 403');
  }

  // 考试模式：答题中不能看到答案
  const revB = await api('GET', `/api/attempts/${attemptB}`, { token: b });
  const leakedAnswer = JSON.stringify(revB.data).includes('"isCorrect":true') || JSON.stringify(revB.data).includes('"isCorrect":false');
  check(!leakedAnswer, '考试模式答题中不下发 isCorrect', revB.text.slice(0, 200));
  check(!JSON.stringify(revB.data).includes('sec_explain'), '考试模式答题中不下发解析');

  // 公开接口不泄露答案
  const pub = await api('GET', `/api/public/papers/${selId}`);
  check(pub.status === 404, '公开接口读限定学生卷 404');
  const pubDraft = await api('GET', `/api/public/papers/${draftId}`);
  check(pubDraft.status === 404, '公开接口读草稿卷 404');

  // ---------- C. 注入与输入 ----------
  section('C. 注入与输入');
  const inj = await api('GET', `/api/questions?keyword=${encodeURIComponent("' OR 1=1 --")}&pageSize=5`, { token: teacher });
  check(inj.status === 200, 'SQL 注入载荷不导致 500（参数化生效）', `status=${inj.status}`);
  check(inj.status === 200 && (inj.data?.total ?? 0) !== 999, 'SQL 注入载荷未绕过查询条件', `total=${inj.data?.total}`);

  const trav = await api('GET', '/uploads/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd');
  check(trav.status === 404 || trav.status === 403, '上传目录路径穿越被拦', `status=${trav.status}`);
  check(!String(trav.text).includes('root:'), '路径穿越未读到系统文件');

  // 存储型 XSS：题干里的 <script> 应原样存、由前端转义（API 不返回 HTML 上下文）
  const qDetail = await api('GET', `/api/questions/${q1}`, { token: teacher });
  check(qDetail.status === 200 && String(qDetail.data?.stem || '').includes('<script>'), '题干原样存储（前端负责转义）');

  // 超长输入
  const longStem = 'x'.repeat(200000);
  const longRes = await api('POST', '/api/questions', {
    token: teacher,
    body: { type: 'single', stem: longStem, options: [{ content: 'a', isCorrect: true }, { content: 'b', isCorrect: false }] },
  });
  check(longRes.status === 400 || longRes.status === 413, '超长题干被拒', `status=${longRes.status}`);

  // ---------- D. 信息泄露 ----------
  section('D. 信息泄露与响应头');
  const h1 = await api('GET', '/api/health');
  const hdr = h1.headers;
  check(!!hdr.get('x-content-type-options'), '带 X-Content-Type-Options', '缺失');
  check(!!hdr.get('x-frame-options') || !!hdr.get('content-security-policy'), '带 X-Frame-Options 或 CSP', '缺失');

  const err = await api('GET', '/api/papers/abc', { token: admin });
  check(!String(err.text).includes('at Object') && !String(err.text).includes('/app/server'), '错误响应不含堆栈/路径', err.text.slice(0, 150));

  const h404 = await api('GET', '/api/nope');
  check(!String(h404.text).includes('/app/'), '404 响应不泄露服务端路径');

  // ---------- E. 业务逻辑 ----------
  section('E. 业务逻辑');
  // 暂停后题面不下发
  if (attemptB) {
    await api('POST', `/api/attempts/${attemptB}/pause`, { token: b });
    const paused = await api('GET', `/api/attempts/${attemptB}`, { token: b });
    const pausedItems = paused.data?.items || [];
    check(pausedItems.length > 0 && pausedItems.every((i) => !i.stem), '暂停后不下发题面', JSON.stringify(pausedItems[0] || {}).slice(0, 120));
    check(pausedItems.every((i) => !i.options || i.options.length === 0), '暂停后不下发选项');
    await api('POST', `/api/attempts/${attemptB}/resume`, { token: b });
  }

  // 练习卷：自己创建的能开；别人的不能
  const practice = await api('POST', '/api/attempts/practice', {
    token: a,
    body: { source: 'random', rules: [{ categoryId: catId, count: 2 }] },
  });
  check(practice.status === 200 && practice.data?.id, '学生能开随机练习');
  if (practice.data?.id) {
    const pRev = await api('GET', `/api/attempts/${practice.data.id}`, { token: a });
    check(pRev.status === 200, '练习卷可读');
    // 练习卷是自己的，别人不该能读
    const pRevB = await api('GET', `/api/attempts/${practice.data.id}`, { token: b });
    check(pRevB.status === 403, '他学生读我的练习答卷 403', `实际 ${pRevB.status}`);

    // 练习卷的 paper 详情：他人能否读到
    const pPaperId = pRev.data?.paperId;
    if (pPaperId) {
      const otherPaper = await api('GET', `/api/papers/${pPaperId}`, { token: b });
      check(otherPaper.status === 404, '他学生读我的练习卷详情 应 404', `实际 ${otherPaper.status}`);
      const otherStart = await api('POST', '/api/attempts', { token: b, body: { paperId: pPaperId } });
      check(otherStart.status === 404, '他学生开我的练习卷 应 404', `实际 ${otherStart.status}`);
    }
  }

  // ---------- F. 会话生命周期 ----------
  section('F. 会话生命周期');
  const victim = await ensureUser(admin, `secC_${tag}`, 'student');
  const vLogin = await login(`secC_${tag}`, PWD);
  const vToken = vLogin.token;
  check((await api('GET', '/api/attempts', { token: vToken })).status === 200, '停用前旧会话可用（基线）');
  await api('PUT', `/api/users/${victim}`, { token: admin, body: { status: 'disabled' } });
  const afterDisable = [
    (await api('GET', '/api/attempts', { token: vToken })).status,
    (await api('GET', '/api/wrong-questions', { token: vToken })).status,
    (await api('GET', '/api/papers', { token: vToken })).status,
  ];
  check(afterDisable.every((s) => s === 401 || s === 403), '停用账号后旧会话立即失效', `实际 ${afterDisable.join('/')}`);
  await api('PUT', `/api/users/${victim}`, { token: admin, body: { status: 'active' } });

  // 重置密码踢会话
  const pLogin = await login(`secC_${tag}`, PWD);
  await api('POST', `/api/users/${victim}/reset-password`, { token: admin, body: { password: PWD } });
  check((await api('GET', '/api/attempts', { token: pLogin.token })).status === 401, '管理员重置密码后旧会话失效');
  // 本人改密码踢会话（当前设备应拿到新 cookie）
  const cLogin = await login(`secC_${tag}`, PWD);
  const chg = await fetch(BASE + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `liti_session=${cLogin.token}` },
    body: JSON.stringify({ currentPassword: PWD, newPassword: PWD + 'z' }),
  });
  check(chg.status === 200, '本人改密码成功');
  check((await api('GET', '/api/attempts', { token: cLogin.token })).status === 401, '改密码后旧 token 失效');
  const newCookie = /liti_session=([^;]+)/.exec((chg.headers.getSetCookie() || []).join(' '));
  check(!!newCookie && newCookie[1] !== cLogin.token, '改密码后当前设备拿到新会话（不掉线）');
  if (newCookie) {
    check((await api('GET', '/api/attempts', { token: newCookie[1] })).status === 200, '改密码后新会话可用');
  }

  // ---------- 汇总 ----------
  console.log(`\n===== 安全测试：${pass} 通过，${fail} 失败 =====`);
  if (findings.length) {
    console.log('\n--- 失败项（即待修问题）---');
    findings.forEach((f, i) => console.log(`${i + 1}. ${f}`));
  }
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(2);
});
