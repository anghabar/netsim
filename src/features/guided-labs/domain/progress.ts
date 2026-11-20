import { isRecord, parseJsonText, readArray, readBoolean, readNumber, type Result } from '../../../utils/guards';
import type { KeyValueStorage, StorageWriteError } from '../../../utils/storage/keyValueStorage';
import { defineStorageSlot } from '../../../utils/storage/storageSlot';
import { LAB_ID_PATTERN, MAX_LAB_BYTES, parseGuidedLab } from './guards';
import type { GuidedLab, LabCheckResult } from './types';

export const GUIDED_LABS_SLOT = defineStorageSlot('netsim.guided-labs.progress.v1', { maxBytes: 20000 });
export const PROGRESS_VERSION = 1;
const MAX_LABS = 64;
const MAX_TASKS = 12;

export interface LabProgressEntry {
  /** Ids of the tasks whose criteria all passed at least once. */
  doneTasks: string[];
  completed: boolean;
}

export type GuidedProgress = Record<string, LabProgressEntry>;

export const EMPTY_PROGRESS: GuidedProgress = Object.freeze({});

/** Rebuilds the stored progress field by field; anything malformed is dropped. */
export function parseProgress(text: string | null): GuidedProgress {
  if (text === null) return {};
  const json = parseJsonText(text, { maxBytes: GUIDED_LABS_SLOT.maxBytes });
  if (!json.ok || !isRecord(json.value)) return {};
  if (readNumber(json.value, 'version', { min: PROGRESS_VERSION, max: PROGRESS_VERSION, integer: true }) === undefined) {
    return {};
  }
  const labs = json.value.labs;
  if (!isRecord(labs)) return {};
  const out: GuidedProgress = {};
  for (const id of Object.keys(labs).slice(0, MAX_LABS)) {
    const entry = labs[id];
    if (!LAB_ID_PATTERN.test(id) || !isRecord(entry)) continue;
    const raw = readArray(entry, 'doneTasks', { maxItems: MAX_TASKS }) ?? [];
    const doneTasks = raw.filter((t): t is string => typeof t === 'string' && LAB_ID_PATTERN.test(t));
    out[id] = { doneTasks, completed: readBoolean(entry, 'completed') === true };
  }
  return out;
}

/** Adds what a check proved; progress never goes backwards. */
export function recordCheck(progress: GuidedProgress, result: LabCheckResult): GuidedProgress {
  if (!LAB_ID_PATTERN.test(result.labId)) return progress;
  const previous = Object.prototype.hasOwnProperty.call(progress, result.labId) ? progress[result.labId] : undefined;
  const done = new Set(previous?.doneTasks ?? []);
  for (const task of result.tasks) if (task.pass) done.add(task.taskId);
  return {
    ...progress,
    [result.labId]: { doneTasks: [...done], completed: previous?.completed === true || result.pass },
  };
}

export const ACTIVE_LAB_SLOT = defineStorageSlot('netsim.guided-labs.active.v1', { maxBytes: MAX_LAB_BYTES + 100 });

/**
 * The lab in progress is stored as its validated definition so it can be resumed
 * after a reload without another download.
 */
export function saveActiveLab(storage: KeyValueStorage, lab: GuidedLab | null): void {
  if (lab === null) storage.remove(ACTIVE_LAB_SLOT);
  else storage.write(ACTIVE_LAB_SLOT, JSON.stringify(lab));
}

export function loadActiveLab(storage: KeyValueStorage): GuidedLab | null {
  const text = storage.read(ACTIVE_LAB_SLOT);
  if (text === null) return null;
  const json = parseJsonText(text, { maxBytes: ACTIVE_LAB_SLOT.maxBytes });
  if (!json.ok) return null;
  const lab = parseGuidedLab(json.value);
  return lab.ok ? lab.value : null;
}

export const loadProgress =(storage: KeyValueStorage): GuidedProgress => parseProgress(storage.read(GUIDED_LABS_SLOT));

export function saveProgress(storage: KeyValueStorage, progress: GuidedProgress): Result<void, StorageWriteError> {
  return storage.write(GUIDED_LABS_SLOT, JSON.stringify({ version: PROGRESS_VERSION, labs: progress }));
}
