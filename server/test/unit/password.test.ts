import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';

describe('password 密码哈希', () => {
  it('哈希结果不包含明文', async () => {
    const hash = await hashPassword('secret123');
    expect(hash).not.toBe('secret123');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('正确密码校验通过', async () => {
    const hash = await hashPassword('secret123');
    await expect(verifyPassword(hash, 'secret123')).resolves.toBe(true);
  });

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('secret123');
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('相同明文每次生成的哈希不同（加盐）', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
  });
});
