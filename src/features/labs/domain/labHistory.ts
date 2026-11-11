import type { LabProgress } from '../../../types/NetworkTypes';
import { err, isRecord, ok, parseJsonText, readArray, readNumber, readString, type Result } from '../../../utils/guards';
import type { KeyValueStorage, StorageWriteError } from '../../../utils/storage/keyValueStorage';
import { defineStorageSlot } from '../../../utils/storage/storageSlot';
import {
  MAX_ATTEMPTS,
  MAX_ATTEMPT_SECONDS,
  MAX_HINTS_COUNTED,
  MAX_SCORE,
  MAX_STEPS_PER_LAB,
  scoreRatio,
} from './labRules';

/** Finished lab attempts, newest last. */
export const LAB_HISTORY_SLOT = defineStorageSlot('netsim.labs.history.v1', { maxBytes: 512000 });
export const LAB_HISTORY_VERSION = 1;
export const MAX_HISTORY_ENTRIES = 200;
export const MAX_VALIDATION_IDS = 200;

const ID_LENGTH = 120;
const VALIDATION_ID_LENGTH = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export interface HistorySummary {
  completedLabs: number;
  perfectLabs: number;
  totalStars: number;
  totalTime: number;
  totalLabs: number;
  /** True when every lab of the catalog has a three-star attempt. */
  catalogPerfect: boolean;
}

/** An attempt is identified by its lab and its start date. */
export function attemptRef(progress: Pick<LabProgress, 'labId' | 'startedAt'>): string {
  return `${progress.labId}\n${progress.startedAt}`;
}

function readIsoDate(rec: Record<string, unknown>, field: string): string | undefined {
  const text = readString(rec, field, { maxLength: 30, pattern: ISO_DATE });
  return text !== undefined && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function readIds(
  rec: Record<string, unknown>,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] | undefined {
  const items = readArray(rec, field, { maxItems });
  if (items === undefined) return undefined;
  const ids: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string' || item.length > maxLength) return undefined;
    ids.push(item);
  }
  return ids;
}

/** Validates an untrusted value and rebuilds the entry from its known fields only. */
export function toLabProgress(value: unknown): LabProgress | null {
  if (!isRecord(value)) return null;
  const labId = readString(value, 'labId', { maxLength: ID_LENGTH, minLength: 1 });
  const userId = readString(value, 'userId', { maxLength: ID_LENGTH });
  const startedAt = readIsoDate(value, 'startedAt');
  const currentStep = readNumber(value, 'currentStep', { min: 0, max: MAX_STEPS_PER_LAB - 1, integer: true });
  const score = readNumber(value, 'score', { min: 0, max: MAX_SCORE });
  const maxScore = readNumber(value, 'maxScore', { min: 0, max: MAX_SCORE });
  const stars = readNumber(value, 'stars', { min: 0, max: 3, integer: true });
  const attempts = readNumber(value, 'attempts', { min: 0, max: MAX_ATTEMPTS, integer: true });
  const timeSpent = readNumber(value, 'timeSpent', { min: 0, max: MAX_ATTEMPT_SECONDS });
  const hintsUsed = readNumber(value, 'hintsUsed', { min: 0, max: MAX_HINTS_COUNTED, integer: true });
  const completedSteps = readIds(value, 'completedSteps', MAX_STEPS_PER_LAB, ID_LENGTH);
  const validationsPassed = readIds(value, 'validationsPassed', MAX_VALIDATION_IDS, VALIDATION_ID_LENGTH);
  const validationsFailed = readIds(value, 'validationsFailed', MAX_VALIDATION_IDS, VALIDATION_ID_LENGTH);
  if (labId === undefined || userId === undefined || startedAt === undefined || currentStep === undefined) return null;
  if (score === undefined || maxScore === undefined || stars === undefined || attempts === undefined) return null;
  if (timeSpent === undefined || hintsUsed === undefined || completedSteps === undefined) return null;
  if (validationsPassed === undefined || validationsFailed === undefined) return null;

  const rawCompletedAt: unknown = Object.prototype.hasOwnProperty.call(value, 'completedAt')
    ? value.completedAt
    : undefined;
  const completedAt = readIsoDate(value, 'completedAt');
  if (rawCompletedAt !== undefined && completedAt === undefined) return null;

  const progress: LabProgress = {
    labId,
    userId,
    startedAt,
    currentStep,
    completedSteps,
    score: Math.min(score, maxScore),
    maxScore,
    stars,
    attempts,
    timeSpent: Math.floor(timeSpent),
    hintsUsed,
    validationsPassed,
    validationsFailed,
  };
  if (completedAt !== undefined) progress.completedAt = completedAt;
  return progress;
}

/** Copy of a finished attempt that fits the persisted bounds. */
export function compactProgress(progress: LabProgress): LabProgress {
  const entry: LabProgress = {
    labId: progress.labId,
    userId: progress.userId,
    startedAt: progress.startedAt,
    currentStep: progress.currentStep,
    completedSteps: progress.completedSteps.slice(0, MAX_STEPS_PER_LAB),
    score: Math.min(progress.score, progress.maxScore),
    maxScore: progress.maxScore,
    stars: progress.stars,
    attempts: progress.attempts,
    timeSpent: progress.timeSpent,
    hintsUsed: progress.hintsUsed,
    validationsPassed: progress.validationsPassed.slice(-MAX_VALIDATION_IDS),
    validationsFailed: progress.validationsFailed.slice(-MAX_VALIDATION_IDS),
  };
  if (progress.completedAt !== undefined) entry.completedAt = progress.completedAt;
  return entry;
}

/** Keeps well-formed entries; a repeated attempt keeps its last occurrence. */
export function parseLabHistory(items: readonly unknown[]): LabProgress[] {
  const byAttempt = new Map<string, LabProgress>();
  for (const item of items.slice(-MAX_HISTORY_ENTRIES)) {
    const progress = toLabProgress(item);
    if (progress === null) continue;
    const ref = attemptRef(progress);
    byAttempt.delete(ref);
    byAttempt.set(ref, progress);
  }
  return [...byAttempt.values()];
}

/** Adds an attempt, replacing an earlier record of the same attempt; the list stays bounded. */
export function upsertAttempt(history: readonly LabProgress[], entry: LabProgress): LabProgress[] {
  const ref = attemptRef(entry);
  return [...history.filter((item) => attemptRef(item) !== ref), entry].slice(-MAX_HISTORY_ENTRIES);
}

/** Highest attempt number recorded for a lab (0 when there is none). */
export function previousAttemptCount(history: readonly LabProgress[], labId: string): number {
  return history.reduce((max, entry) => (entry.labId === labId ? Math.max(max, entry.attempts) : max), 0);
}

export function isSuccessfulAttempt(progress: LabProgress): boolean {
  return progress.completedAt !== undefined && progress.stars > 0;
}

function compareAttempts(a: LabProgress, b: LabProgress): number {
  if (a.stars !== b.stars) return a.stars - b.stars;
  return scoreRatio(a.score, a.maxScore) - scoreRatio(b.score, b.maxScore);
}

/** Best attempt for a lab: more stars, then higher score, then most recent. */
export function bestAttempt(history: readonly LabProgress[], labId: string): LabProgress | undefined {
  let best: LabProgress | undefined;
  for (const entry of history) {
    if (entry.labId !== labId) continue;
    if (best === undefined || compareAttempts(entry, best) >= 0) best = entry;
  }
  return best;
}

/** Aggregates per lab (best attempt), so repeating a lab never inflates the totals. */
export function summarizeHistory(history: readonly LabProgress[], catalogLabIds: readonly string[]): HistorySummary {
  const summary: HistorySummary = {
    completedLabs: 0,
    perfectLabs: 0,
    totalStars: 0,
    totalTime: history.reduce((sum, entry) => sum + entry.timeSpent, 0),
    totalLabs: catalogLabIds.length,
    catalogPerfect:
      catalogLabIds.length > 0 && catalogLabIds.every((labId) => bestAttempt(history, labId)?.stars === 3),
  };
  for (const labId of new Set(history.map((entry) => entry.labId))) {
    const best = bestAttempt(history, labId);
    if (best === undefined || !isSuccessfulAttempt(best)) continue;
    summary.completedLabs += 1;
    summary.totalStars += best.stars;
    if (best.stars === 3) summary.perfectLabs += 1;
  }
  return summary;
}

/** Reads the stored history; anything missing, corrupt or out of bounds yields an empty list. */
export function loadLabHistory(storage: KeyValueStorage): LabProgress[] {
  const text = storage.read(LAB_HISTORY_SLOT);
  if (text === null) return [];
  const json = parseJsonText(text, { maxBytes: LAB_HISTORY_SLOT.maxBytes });
  if (!json.ok || !isRecord(json.value) || json.value.version !== LAB_HISTORY_VERSION) return [];
  const entries = readArray(json.value, 'entries', { maxItems: MAX_HISTORY_ENTRIES });
  return entries === undefined ? [] : parseLabHistory(entries);
}

/**
 * Writes the history. When it does not fit (slot size or quota) the oldest
 * half is dropped and the write is retried. Returns how many entries were kept.
 */
export function saveLabHistory(
  storage: KeyValueStorage,
  history: readonly LabProgress[],
): Result<number, StorageWriteError> {
  let entries = history.slice(-MAX_HISTORY_ENTRIES);
  for (;;) {
    const written = storage.write(LAB_HISTORY_SLOT, JSON.stringify({ version: LAB_HISTORY_VERSION, entries }));
    if (written.ok) return ok(entries.length);
    if (written.error === 'unavailable' || entries.length <= 1) return err(written.error);
    entries = entries.slice(Math.ceil(entries.length / 2));
  }
}

export function clearStoredLabHistory(storage: KeyValueStorage): void {
  storage.remove(LAB_HISTORY_SLOT);
}
