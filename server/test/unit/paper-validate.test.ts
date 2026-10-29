import { describe, it, expect } from 'vitest';
import { validatePaperInput, fisherYates, MAX_PAPER_QUESTIONS } from '../../src/paper/validate.js';

describe('validatePaperInput 组卷校验', () => {
  it('合法随机卷通过', () => {
    expect(validatePaperInput({ title: 't', mode: 'random', durationSec: 60, randomRules: [{ count: 5 }] })).toEqual([]);
  });

  it('标题为空报错', () => {
    const e = validatePaperInput({ title: ' ', mode: 'random', durationSec: 60, randomRules: [{ count: 5 }] });
    expect(e.join()).toContain('标题');
  });

  it('时长无效报错', () => {
    const e = validatePaperInput({ title: 't', mode: 'random', durationSec: 0, randomRules: [{ count: 5 }] });
    expect(e.join()).toContain('时长');
  });

  it('随机卷题量超上限报错', () => {
    const e = validatePaperInput({ title: 't', mode: 'random', durationSec: 60, randomRules: [{ count: MAX_PAPER_QUESTIONS + 1 }] });
    expect(e.join()).toContain('题量');
  });

  it('固定卷题量超上限报错', () => {
    const ids = Array.from({ length: MAX_PAPER_QUESTIONS + 1 }, (_, i) => i + 1);
    const e = validatePaperInput({ title: 't', mode: 'fixed', durationSec: 60, questionIds: ids });
    expect(e.join()).toContain('题量');
  });

  it('规则数量为 0 报错', () => {
    const e = validatePaperInput({ title: 't', mode: 'random', durationSec: 60, randomRules: [{ count: 0 }] });
    expect(e.join()).toContain('大于 0');
  });
});

describe('fisherYates 洗牌', () => {
  it('保持元素集合不变', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = fisherYates(arr);
    expect(shuffled).toHaveLength(arr.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([...arr].sort((a, b) => a - b));
  });

  it('不修改原数组', () => {
    const arr = [1, 2, 3];
    fisherYates(arr);
    expect(arr).toEqual([1, 2, 3]);
  });
});
