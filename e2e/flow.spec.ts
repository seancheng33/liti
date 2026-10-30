import { expect, test } from '@playwright/test';

// 前置：需已运行 `pnpm seed` 并启动服务（默认 http://127.0.0.1:8080）
test('登录后完整刷题流程', async ({ page }) => {
  // 登录（antd 会在两个汉字的按钮名中间插入空格，故用 submit 按钮定位）
  await page.goto('/login');
  await page.getByLabel('用户名').fill('admin');
  await page.getByLabel('密码').fill('admin123');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/papers/);
  await expect(page.getByText('管理员')).toBeVisible();

  // 通过 API 创建题目与固定试卷（复用页面会话，选项不乱序便于断言）
  const qRes = await page.request.post('/api/questions', {
    data: {
      type: 'single',
      stem: 'E2E：1+1 等于几？',
      explanation: '1+1=2',
      difficulty: 1,
      options: [
        { content: '1', isCorrect: false },
        { content: '2', isCorrect: true },
        { content: '3', isCorrect: false },
      ],
    },
  });
  expect(qRes.ok()).toBeTruthy();
  const qId = (await qRes.json()).id;

  const pRes = await page.request.post('/api/papers', {
    data: {
      title: 'E2E 试卷',
      mode: 'fixed',
      durationSec: 600,
      shuffleOptions: false,
      questionIds: [qId],
    },
  });
  expect(pRes.ok()).toBeTruthy();
  const pId = (await pRes.json()).id;
  await page.request.post(`/api/papers/${pId}/publish`);

  // 开始答题
  await page.goto('/papers');
  await page.getByText('E2E 试卷').first().waitFor();
  await page.getByText('开始答题').first().click();
  await expect(page).toHaveURL(/\/exam\/\d+/);
  await expect(page.getByText('E2E：1+1 等于几？')).toBeVisible();

  // 作答：选 B（正确答案为 "2"，乱序已关闭）
  await page.getByText('B. 2').click();

  // 交卷
  await page.getByRole('button', { name: /交\s*卷/ }).click();
  await expect(page).toHaveURL(/\/review\/\d+/);

  // 结果与解析
  await expect(page.getByText(/成绩 1 \/ 1/)).toBeVisible();
  await expect(page.getByText('解析：1+1=2')).toBeVisible();
});
