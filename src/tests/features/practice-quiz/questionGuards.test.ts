import { describe, expect, it } from 'vitest';
import { QUESTION_BANK } from '../../../features/practice-quiz/data/questionBank';
import { DEFAULT_QUIZ_CONFIG } from '../../../features/practice-quiz/domain/engine';
import {
  MAX_BANK_SIZE,
  MAX_TEXT_LENGTH,
  parseQuestionBank,
  parseQuizQuestion,
} from '../../../features/practice-quiz/domain/questionGuards';
import { QUIZ_CATEGORIES } from '../../../features/practice-quiz/domain/types';
import { networkOf, sameSubnet } from '../../../utils/ipv4';

const valid = {
  id: 'q1',
  prompt: 'Prompt',
  category: 'routing',
  level: 3,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correctOptionIds: ['a'],
  explanation: 'Because.',
  tags: ['ospf'],
};

describe('question guard', () => {
  it('accepts a well-formed question and returns a rebuilt copy', () => {
    const parsed = parseQuizQuestion(valid);
    expect(parsed).toEqual(valid);
    expect(parsed).not.toBe(valid);
  });

  it('rejects malformed questions', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `o${i}`, text: 'x' }));
    const invalid: unknown[] = [
      null,
      'question',
      [valid],
      { ...valid, id: '' },
      { ...valid, id: 'Has Spaces' },
      { ...valid, prompt: 42 },
      { ...valid, prompt: '   ' },
      { ...valid, prompt: 'x'.repeat(MAX_TEXT_LENGTH + 1) },
      { ...valid, category: 'cooking' },
      { ...valid, level: 6 },
      { ...valid, level: 2.5 },
      { ...valid, options: [{ id: 'a', text: 'A' }] },
      { ...valid, options: many },
      { ...valid, options: [{ id: 'a', text: 'A' }, { id: 'a', text: 'B' }] },
      { ...valid, options: [{ id: 'a', text: 'A' }, { id: 'b' }] },
      { ...valid, correctOptionIds: [] },
      { ...valid, correctOptionIds: ['z'] },
      { ...valid, correctOptionIds: ['a', 'a'] },
      { ...valid, tags: 'ospf' },
      { ...valid, tags: ['Not A Tag'] },
      { ...valid, explanation: undefined },
    ];
    for (const candidate of invalid) expect(parseQuizQuestion(candidate)).toBeNull();
  });

  it('drops unknown fields and prototype-related names from parsed text', () => {
    const text = JSON.stringify(valid).replace('{', '{"__proto__":{"polluted":true},"extra":{"x":1},');
    const raw: unknown = JSON.parse(text);
    const parsed = parseQuizQuestion(raw);
    expect(parsed).toEqual(valid);
    expect(Object.keys(parsed ?? {})).toHaveLength(8);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('filters a bank, removes duplicate ids and reports rejections', () => {
    const result = parseQuestionBank([valid, { ...valid }, { ...valid, id: 'q2' }, { broken: true }]);
    expect(result.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(result.rejected).toBe(2);
    expect(parseQuestionBank({ not: 'an array' })).toEqual({ questions: [], rejected: 0 });
  });

  it('caps the number of entries it will inspect', () => {
    const oversized = Array.from({ length: MAX_BANK_SIZE + 5 }, (_, i) => ({ ...valid, id: `q${i}` }));
    const result = parseQuestionBank(oversized);
    expect(result.questions).toHaveLength(MAX_BANK_SIZE);
    expect(result.rejected).toBe(5);
  });
});

describe('built-in question bank', () => {
  it('passes the guard unchanged', () => {
    const result = parseQuestionBank(QUESTION_BANK);
    expect(result.rejected).toBe(0);
    expect(result.questions).toEqual(QUESTION_BANK);
  });

  it('covers every category, fills a default quiz and includes a multi-select question', () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(DEFAULT_QUIZ_CONFIG.length);
    for (const category of QUIZ_CATEGORIES) {
      expect(QUESTION_BANK.some((q) => q.category === category)).toBe(true);
    }
    expect(QUESTION_BANK.some((q) => q.correctOptionIds.length > 1)).toBe(true);
  });

  it('agrees with the IPv4 helpers on the addressing answers', () => {
    const network = QUESTION_BANK.find((q) => q.id === 'addr-network-77');
    const correct = network?.options.find((option) => network.correctOptionIds.includes(option.id));
    expect(correct?.text).toBe(`${networkOf('192.0.2.77', 27)}/27`);

    const subnet = QUESTION_BANK.find((q) => q.id === 'addr-same-subnet');
    expect(subnet).toBeDefined();
    for (const option of subnet?.options ?? []) {
      const inSubnet = sameSubnet('198.51.100.70', option.text, '255.255.255.192');
      expect(inSubnet).toBe(subnet?.correctOptionIds.includes(option.id));
    }
  });
});
