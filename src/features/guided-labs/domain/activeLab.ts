import type { GuidedLab } from './types';

let active: GuidedLab | null = null;

/** The lab being worked on; it survives closing and reopening the panel during the visit. */
export const getActiveLab = (): GuidedLab | null => active;

export function setActiveLab(lab: GuidedLab | null): void {
  active = lab;
}
