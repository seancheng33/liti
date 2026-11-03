import { describe, it, expect } from 'vitest';
import { validateQuestionDraft, contentHash, type QuestionDraft } from '../../src/question/validate.js';

function draft(partial: Partial<QuestionDraft>): QuestionDraft {
  return {
    type: 'single',
    stem: '题干',
    options: [
      { content: 'A', isCorrect: true },
      { content: 'B', isCorrect: false },
    ],
    ...partial,
  };
}

describe('validateQuestionDraft 题目校验', () => {
  it('合法单选题通过', () => {
    expect(validateQuestionDraft(draft({}))).toEqual([]);
  });

  it('题干为空报错', () => {
    expect(validateQuestionDraft(draft({ stem: '   ' })).join()).toContain('题干不能为空');
  });

  it('单选两个答案报错', () => {
    const d = draft({ options: [{ content: 'A', isCorrect: true }, { content: 'B', isCorrect: true }] });
    expect(validateQuestionDraft(d).join()).toContain('仅有一个');
  });

  it('单选无答案报错', () => {
    const d = draft({ options: [{ content: 'A', isCorrect: false }, { content: 'B', isCorrect: false }] });
    expect(validateQuestionDraft(d).join()).toContain('仅有一个');
  });

  it('多选少于两个答案报错', () => {
    const d = draft({ type: 'multiple', options: [{ content: 'A', isCorrect: true }, { content: 'B', isCorrect: false }] });
    expect(validateQuestionDraft(d).join()).toContain('至少需要两个');
  });

  it('选项数量越界报错', () => {
    const d = draft({ options: [{ content: 'A', isCorrect: true }] });
    expect(validateQuestionDraft(d).join()).toContain('2–6');
  });

  it('空选项内容报错', () => {
    const d = draft({ options: [{ content: 'A', isCorrect: true }, { content: '  ', isCorrect: false }] });
    expect(validateQuestionDraft(d).join()).toContain('选项 B 内容不能为空');
  });
});

describe('contentHash 题干去重哈希', () => {
  it('忽略首尾空白与大小写', () => {
    expect(contentHash('  Hello World ')).toBe(contentHash('hello world'));
  });

  it('不同题干哈希不同', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});
