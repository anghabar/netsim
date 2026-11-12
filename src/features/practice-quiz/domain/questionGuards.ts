import { isRecord, readArray, readEnum, readNumber, readString } from '../../../utils/guards';
import { QUIZ_CATEGORIES, type DifficultyLevel, type QuizOption, type QuizQuestion } from './types';

export const MAX_BANK_SIZE = 500;
export const MAX_OPTIONS = 8;
export const MAX_TAGS = 8;
export const MAX_TEXT_LENGTH = 1000;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const LEVELS: readonly DifficultyLevel[] = [1, 2, 3, 4, 5];

function readText(rec: Record<string, unknown>, field: string): string | undefined {
  const text = readString(rec, field, { maxLength: MAX_TEXT_LENGTH, minLength: 1 });
  return text !== undefined && text.trim().length > 0 ? text : undefined;
}

function parseOption(value: unknown): QuizOption | null {
  if (!isRecord(value)) return null;
  const id = readString(value, 'id', { maxLength: 64, pattern: ID_PATTERN });
  const text = readText(value, 'text');
  return id === undefined || text === undefined ? null : { id, text };
}

/** A bounded list of distinct labels that match the pattern, or null. */
function readLabels(
  rec: Record<string, unknown>,
  field: string,
  maxItems: number,
  pattern: RegExp,
): string[] | null {
  const items = readArray(rec, field, { maxItems });
  if (items === undefined) return null;
  const labels: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string' || item.length > 64 || !pattern.test(item) || labels.includes(item)) return null;
    labels.push(item);
  }
  return labels;
}

/**
 * The single guard for quiz questions. It rebuilds the question field by
 * field, so unknown fields never reach the application state.
 */
export function parseQuizQuestion(value: unknown): QuizQuestion | null {
  if (!isRecord(value)) return null;
  const id = readString(value, 'id', { maxLength: 64, pattern: ID_PATTERN });
  const prompt = readText(value, 'prompt');
  const explanation = readText(value, 'explanation');
  const category = readEnum(value, 'category', QUIZ_CATEGORIES);
  const levelNumber = readNumber(value, 'level', { min: 1, max: 5, integer: true });
  const level = LEVELS.find((candidate) => candidate === levelNumber);
  const rawOptions = readArray(value, 'options', { maxItems: MAX_OPTIONS });
  const correctOptionIds = readLabels(value, 'correctOptionIds', MAX_OPTIONS, ID_PATTERN);
  const tags = readLabels(value, 'tags', MAX_TAGS, TAG_PATTERN);

  if (
    id === undefined ||
    prompt === undefined ||
    explanation === undefined ||
    category === undefined ||
    level === undefined ||
    rawOptions === undefined ||
    rawOptions.length < 2 ||
    correctOptionIds === null ||
    correctOptionIds.length === 0 ||
    tags === null
  ) {
    return null;
  }

  const options: QuizOption[] = [];
  for (const rawOption of rawOptions) {
    const option = parseOption(rawOption);
    if (option === null || options.some((existing) => existing.id === option.id)) return null;
    options.push(option);
  }
  if (!correctOptionIds.every((correctId) => options.some((option) => option.id === correctId))) return null;

  return { id, prompt, category, level, options, correctOptionIds, explanation, tags };
}

export interface BankValidation {
  readonly questions: QuizQuestion[];
  readonly rejected: number;
}

/** Keeps valid questions with unique ids and reports how many entries were dropped. */
export function parseQuestionBank(value: unknown): BankValidation {
  if (!Array.isArray(value)) return { questions: [], rejected: 0 };
  const entries: readonly unknown[] = value;
  const seen = new Set<string>();
  const questions: QuizQuestion[] = [];
  let rejected = Math.max(0, entries.length - MAX_BANK_SIZE);

  for (const entry of entries.slice(0, MAX_BANK_SIZE)) {
    const question = parseQuizQuestion(entry);
    if (question !== null && !seen.has(question.id)) {
      seen.add(question.id);
      questions.push(question);
    } else {
      rejected += 1;
    }
  }
  return { questions, rejected };
}
