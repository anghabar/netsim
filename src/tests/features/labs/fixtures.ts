import type { Lab, LabProgress, LabStep, LabValidationContext } from '../../../types/NetworkTypes';

export const T0 = Date.UTC(2026, 0, 1);

export const emptyContext: LabValidationContext = { devices: [], cables: [], commands: [], topology: {} };

/** One switch and one host joined by a copper cable. */
export const SMALL_TOPOLOGY: Lab['topology'] = {
  devices: [
    { type: 'Switch', count: 1, config: { model: 'Huawei-S5700-28TP' } },
    { type: 'PC', count: 1 },
  ],
  connections: [{ from: 'Switch:GE0/0/1', to: 'PC1:eth0', type: 'copper' }],
};

export function makeStep(
  id: string,
  points: number,
  check: (context: LabValidationContext) => boolean = () => true,
): LabStep {
  return {
    id,
    title: `Step ${id}`,
    description: '',
    instructions: ['Do the thing'],
    commands: {},
    validation: [{ type: 'config', description: 'check', check, errorMessage: `${id} failed` }],
    hints: ['A hint'],
    points,
  };
}

export function makeLab(
  steps: LabStep[] = [makeStep('s1', 40), makeStep('s2', 60)],
  overrides: Partial<Lab> = {},
): Lab {
  return {
    id: 'lab-a',
    title: 'Lab A',
    description: 'A lab',
    difficulty: 'basic',
    certification: 'hcia',
    estimatedTime: 30,
    prerequisites: [],
    objectives: ['Objective'],
    topology: { devices: [], connections: [] },
    steps,
    rewards: { stars: 3, experience: 0 },
    metadata: { author: 'test', version: '1', created: '2026-01-01', updated: '2026-01-01' },
    ...overrides,
  };
}

export function makeProgress(overrides: Partial<LabProgress> = {}): LabProgress {
  return {
    labId: 'lab-a',
    userId: 'guest-user',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:10:00.000Z',
    currentStep: 1,
    completedSteps: ['s1', 's2'],
    score: 100,
    maxScore: 100,
    stars: 3,
    attempts: 1,
    timeSpent: 600,
    hintsUsed: 0,
    validationsPassed: [],
    validationsFailed: [],
    ...overrides,
  };
}
