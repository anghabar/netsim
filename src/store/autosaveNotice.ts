import type { AutosaveError } from './topologyAutosave';

const MESSAGES: Record<AutosaveError, string> = {
  'invalid-topology':
    'Your changes are not being saved because a device or cable has an invalid value. Fix it to resume saving.',
  'not-serializable': 'Your changes are not being saved because the topology cannot be stored.',
  'too-large': 'Your changes are not being saved because the topology is too large for browser storage.',
  'quota-exceeded': 'Your changes are not being saved because browser storage is full.',
  unavailable: 'Your changes are not being saved because browser storage is unavailable.',
};

export function autosaveErrorMessage(error: AutosaveError): string {
  return MESSAGES[error];
}

/** Shows a save failure to the user through the app's toast mechanism. */
export function notifyAutosaveError(
  error: AutosaveError,
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void,
): void {
  addToast(autosaveErrorMessage(error), 'error');
}
