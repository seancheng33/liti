import { describe, it, expect } from 'vitest';
import { effectivePassScore, paperTotalScore } from '../../src/paper/service.js';

describe('有效及格分', () => {
  it('pass_score > 0 时按手动设置值原样返回', () => {
    expect(effectivePassScore(60, 100)).toBe(60);
    expect(effectivePassScore(3, 10)).toBe(3);
  });

  it('pass_score = 0（自动）按总分 60% 四舍五入', () => {
    expect(effectivePassScore(0, 100)).toBe(60);
    expect(effectivePassScore(0, 10)).toBe(6);
    expect(effectivePassScore(0, 5)).toBe(3);
    expect(effectivePassScore(0, 7)).toBe(4); // 4.2 → 4
  });

  it('总分为 0 或缺失时自动及格线为 0', () => {
    expect(effectivePassScore(0, 0)).toBe(0);
  });

  it('paperTotalScore = 题量 × 每题分值（缺省按 1 分）', () => {
    expect(paperTotalScore({ question_count: 10, per_question_score: 2 })).toBe(20);
    expect(paperTotalScore({ question_count: 10, per_question_score: null })).toBe(10);
  });
});
