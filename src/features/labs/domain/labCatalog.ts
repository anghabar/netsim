import type { Lab } from '../../../types/NetworkTypes';
import { isRecord, readArray, readEnum, readNumber, readString } from '../../../utils/guards';
import { MAX_LAB_MINUTES, MAX_STEPS_PER_LAB, MAX_STEP_POINTS } from './labRules';

export const MAX_VALIDATIONS_PER_STEP = 50;
export const MAX_LAB_DEVICES = 64;
export const MAX_LAB_CONNECTIONS = 256;

const ID = { maxLength: 120, minLength: 1 };
const LABEL = { maxLength: 300, minLength: 1 };
const TAG = { maxLength: 40, minLength: 1 };
const TEXT = { maxLength: 8000 };

function isTextList(rec: Record<string, unknown>, field: string, maxItems: number): boolean {
  const items = readArray(rec, field, { maxItems });
  return items !== undefined && items.every((item) => typeof item === 'string' && item.length <= TEXT.maxLength);
}

function isLabValidation(value: unknown): boolean {
  return (
    isRecord(value) &&
    readString(value, 'type', TAG) !== undefined &&
    readString(value, 'errorMessage', TEXT) !== undefined &&
    typeof value.check === 'function'
  );
}

/** Returns the step id when the step is well formed, otherwise null. */
function readStepId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const id = readString(value, 'id', ID);
  const validation = readArray(value, 'validation', { maxItems: MAX_VALIDATIONS_PER_STEP });
  if (id === undefined || validation === undefined || !validation.every(isLabValidation)) return null;
  if (readString(value, 'title', LABEL) === undefined || readString(value, 'description', TEXT) === undefined) return null;
  if (!isTextList(value, 'instructions', 100)) return null;
  if (value.hints !== undefined && !isTextList(value, 'hints', 50)) return null;
  if (readNumber(value, 'points', { min: 0, max: MAX_STEP_POINTS }) === undefined) return null;
  return id;
}

/** Bounded device groups and connections, so building a lab topology can never run away. */
function isLabTopology(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const groups = readArray(value, 'devices', { maxItems: MAX_LAB_DEVICES });
  const connections = readArray(value, 'connections', { maxItems: MAX_LAB_CONNECTIONS });
  if (groups === undefined || connections === undefined) return false;
  let total = 0;
  for (const group of groups) {
    if (!isRecord(group) || readString(group, 'type', TAG) === undefined) return false;
    const count = readNumber(group, 'count', { min: 1, max: MAX_LAB_DEVICES, integer: true });
    if (count === undefined) return false;
    total += count;
  }
  if (total > MAX_LAB_DEVICES) return false;
  return connections.every(
    (connection) =>
      isRecord(connection) &&
      readString(connection, 'from', ID) !== undefined &&
      readString(connection, 'to', ID) !== undefined &&
      readEnum(connection, 'type', ['copper', 'fiber']) !== undefined,
  );
}

/**
 * Checks every field the runtime reads from a lab definition. Difficulty and
 * certification are only checked as short labels; the UI falls back to a
 * neutral style for labels it does not know.
 */
export function isLabDefinition(value: unknown): value is Lab {
  if (!isRecord(value)) return false;
  if (readString(value, 'id', ID) === undefined || readString(value, 'title', LABEL) === undefined) return false;
  if (readString(value, 'description', TEXT) === undefined) return false;
  if (readString(value, 'difficulty', TAG) === undefined || readString(value, 'certification', TAG) === undefined) {
    return false;
  }
  if (readNumber(value, 'estimatedTime', { min: 0, max: MAX_LAB_MINUTES }) === undefined) return false;
  if (!isTextList(value, 'objectives', 100) || !isLabTopology(value.topology)) return false;
  const steps = readArray(value, 'steps', { maxItems: MAX_STEPS_PER_LAB });
  if (steps === undefined || steps.length === 0) return false;
  const stepIds = steps.map(readStepId);
  return stepIds.every((stepId) => stepId !== null) && new Set(stepIds).size === stepIds.length;
}

/** Keeps well-formed labs only; the first lab wins when ids repeat. */
export function sanitizeCatalog(candidates: readonly unknown[]): Lab[] {
  const seen = new Set<string>();
  const labs: Lab[] = [];
  for (const candidate of candidates) {
    if (!isLabDefinition(candidate) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    labs.push(candidate);
  }
  return labs;
}
