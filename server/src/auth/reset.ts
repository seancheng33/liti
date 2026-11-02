import { createHash, randomBytes } from 'node:crypto';

/**
 * 找回密码的一次性重置码工具（v0.14）。
 *
 * 自托管环境没有 SMTP，发不了邮件验证码，所以走「教师签发码、学生登录取码设新密码」。
 * 这套逻辑签发端（users 路由）和兑换端（auth 路由）都要用，抽到共享模块避免重复。
 */

/** 重置码有效期：30 分钟。过期即作废 */
export const RESET_CODE_TTL_MS = 30 * 60 * 1000;

/**
 * 32 个字符的字母表，刻意去掉了容易看混的 0 O 1 I L。
 * base32 的整数倍，一次 randomBytes 正好映射成等长串。
 */
const RESET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 生成一串不含歧义字符的重置码（默认 8 位，约 32^8 ≈ 1.1e12 种） */
export function generateResetCode(len = 8): string {
  const buf = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += RESET_ALPHABET[buf[i] % RESET_ALPHABET.length];
  return s;
}

/** 重置码只存哈希，明文只在签发响应里走一次 */
export function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
