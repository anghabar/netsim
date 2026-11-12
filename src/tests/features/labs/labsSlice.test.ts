import { describe, expect, it } from 'vitest';
import { ALL_LABS } from '../../../data/labs/index';
import { LAB_HISTORY_SLOT, loadLabHistory, saveLabHistory } from '../../../features/labs/domain/labHistory';
import { createNetworkStore } from '../../../store/useNetworkStore';
import { createMemoryStorage, type KeyValueStorage } from '../../../utils/storage/keyValueStorage';
import { createTestStore } from '../../helpers/createTestStore';
import { SMALL_TOPOLOGY, T0, makeLab, makeProgress, makeStep } from './fixtures';

/** A store with a controllable clock and a two-step lab whose checks can be switched on. */
function setup(storage: KeyValueStorage = createMemoryStorage()) {
  let now = T0;
  let counter = 0;
  const store = createNetworkStore({
    storage,
    clock: () => now,
    ids: () => {
      counter += 1;
      return `id-${counter}`;
    },
    random: () => 0.5,
  });
  const gate = { s1: false, s2: false };
  const lab = makeLab([makeStep('s1', 40, () => gate.s1), makeStep('s2', 60, () => gate.s2)], {
    topology: SMALL_TOPOLOGY,
  });
  store.getState().addLab(lab);
  return {
    store,
    storage,
    gate,
    lab,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function passLab(ctx: ReturnType<typeof setup>, examMode = false): void {
  ctx.gate.s1 = true;
  ctx.gate.s2 = true;
  ctx.store.getState().startLab(ctx.lab.id, examMode);
  ctx.advance(60_000);
  ctx.store.getState().submitCurrentStep();
  ctx.store.getState().submitCurrentStep();
}

describe('lab catalog', () => {
  it('loads every built-in lab', () => {
    const store = createTestStore();
    store.getState().loadLabs();
    const loaded = new Set(store.getState().availableLabs.map((lab) => lab.id));
    expect(ALL_LABS.map((lab) => lab.id).filter((id) => !loaded.has(id))).toEqual([]);
  });

  it('ignores malformed labs and replaces a lab with the same id', () => {
    const store = createTestStore();
    store.getState().addLab({ ...makeLab(), steps: [] });
    expect(store.getState().availableLabs).toEqual([]);
    store.getState().addLab(makeLab());
    store.getState().addLab(makeLab(undefined, { title: 'Renamed' }));
    expect(store.getState().availableLabs.map((lab) => lab.title)).toEqual(['Renamed']);
  });
});

describe('startLab', () => {
  it('replaces the topology, closes stale consoles and snapshots the lab', () => {
    const { store, lab } = setup();
    const stale = store.getState().addDevice('PC');
    store.getState().openConsole(stale.id);
    store.getState().startLab(lab.id);

    const state = store.getState();
    expect(state.devices.map((device) => device.hostname)).toEqual(['Switch', 'PC1']);
    expect(state.cables).toHaveLength(1);
    expect(state.devices[0].ports[0].status).toBe('up');
    expect(state.openConsoleIds).toEqual([]);
    expect(state.currentLabSession?.progress).toMatchObject({
      startedAt: '2026-01-01T00:00:00.000Z',
      attempts: 1,
      maxScore: 100,
    });
    expect(state.currentLabSession?.topologySnapshot.devices).toHaveLength(2);
    expect(state.currentLabSession?.topologySnapshot.devices[0]).not.toBe(state.devices[0]);
  });

  it('can restart while an attempt is open and ignores unknown labs', () => {
    const { store, lab } = setup();
    store.getState().startLab(lab.id);
    store.getState().startLab(lab.id, true);
    expect(store.getState().currentLabSession?.isExamMode).toBe(true);
    expect(store.getState().devices).toHaveLength(2);
    store.getState().startLab('missing');
    expect(store.getState().currentLabSession?.labId).toBe(lab.id);
  });
});

describe('validate and advance', () => {
  it('does not advance, score or skip without a passed validation', () => {
    const { store, lab } = setup();
    const api = () => store.getState();
    api().startLab(lab.id);
    expect(api().submitCurrentStep()).toEqual({ status: 'failed', errors: ['s1 failed'] });
    expect(api().validateCurrentStep()).toBe(false);
    api().completeStep('s1');
    api().completeStep('s2');
    api().goToLabStep(1);
    expect(api().currentLabSession?.progress).toMatchObject({ currentStep: 0, score: 0, completedSteps: [] });
  });

  it('keeps the finished session for review and records the attempt once', () => {
    const { store, lab, gate, advance } = setup();
    const api = () => store.getState();
    api().startLab(lab.id);

    gate.s1 = true;
    expect(api().validateCurrentStep()).toBe(true);
    api().completeStep('s1');
    api().completeStep('s1');
    expect(api().currentLabSession?.progress).toMatchObject({ currentStep: 1, score: 40 });
    api().goToLabStep(0);
    expect(api().currentLabSession?.progress.currentStep).toBe(0);
    api().goToLabStep(1);

    gate.s2 = true;
    advance(90_000);
    expect(api().submitCurrentStep()).toEqual({ status: 'finished' });
    expect(api().currentLabSession?.progress).toMatchObject({
      score: 100,
      stars: 3,
      timeSpent: 90,
      completedAt: '2026-01-01T00:01:30.000Z',
    });

    api().finishLab();
    api().forceEndExam();
    expect(api().labHistory).toHaveLength(1);
    expect(api().getStarsForLab(lab.id)).toBe(3);
    expect(api().submitCurrentStep()).toEqual({ status: 'idle' });

    api().resetLab();
    expect(api().currentLabSession).toBeNull();
  });

  it('lowers the stars when hints were used', () => {
    const ctx = setup();
    ctx.store.getState().startLab(ctx.lab.id);
    for (let i = 0; i < 3; i += 1) ctx.store.getState().recordHintUsed();
    ctx.gate.s1 = true;
    ctx.gate.s2 = true;
    ctx.store.getState().submitCurrentStep();
    ctx.store.getState().submitCurrentStep();
    expect(ctx.store.getState().currentLabSession?.progress).toMatchObject({ hintsUsed: 3, stars: 2 });
  });
});

describe('exam mode', () => {
  it('gives stars only on a pass and numbers attempts from the records', () => {
    const ctx = setup();
    const api = () => ctx.store.getState();

    // Attempt 1: time runs out after the first step.
    ctx.gate.s1 = true;
    api().startLab(ctx.lab.id, true);
    api().recordHintUsed();
    api().submitCurrentStep();
    ctx.advance(31 * 60_000);
    api().forceEndExam();
    expect(api().currentLabSession?.progress).toMatchObject({ score: 40, timeSpent: 1800, stars: 0, hintsUsed: 0 });

    // Attempt 2: passed.
    ctx.advance(1000);
    passLab(ctx, true);
    expect(api().currentLabSession?.progress).toMatchObject({ attempts: 2, stars: 3, timeSpent: 60 });

    // Attempt 3: three strikes end the exam without stars.
    ctx.advance(1000);
    api().startLab(ctx.lab.id, true);
    api().submitCurrentStep();
    api().submitCurrentStep();
    expect(api().currentLabSession?.progress.completedAt).toBeDefined();
    ctx.advance(1000);
    api().startLab(ctx.lab.id, true);
    for (let i = 0; i < 3; i += 1) api().addExamStrike();
    expect(api().currentLabSession).toMatchObject({ examStrikes: 3, progress: { attempts: 4, stars: 0 } });
    expect(api().currentLabSession?.progress.completedAt).toBeDefined();

    expect(api().labHistory).toHaveLength(4);
    expect(api().getLabProgress(ctx.lab.id)?.stars).toBe(3);
  });
});

describe('history persistence', () => {
  it('restores the history in a new store and clears it on request', () => {
    const ctx = setup();
    passLab(ctx);

    const next = createTestStore({ storage: ctx.storage });
    expect(next.getState().labHistory).toEqual([]);
    next.getState().loadLabs();
    expect(next.getState().labHistory).toHaveLength(1);
    expect(next.getState().getStarsForLab(ctx.lab.id)).toBe(3);

    next.getState().clearLabHistory();
    expect(next.getState().labHistory).toEqual([]);
    expect(ctx.storage.read(LAB_HISTORY_SLOT)).toBeNull();
  });

  it('merges stored attempts before the first write', () => {
    const storage = createMemoryStorage();
    saveLabHistory(storage, [makeProgress({ labId: 'lab-b', startedAt: '2025-12-01T00:00:00.000Z' })]);
    const ctx = setup(storage);
    passLab(ctx);
    expect(loadLabHistory(storage).map((entry) => entry.labId)).toEqual(['lab-b', 'lab-a']);
  });

  it('ignores corrupt stored data', () => {
    const storage = createMemoryStorage();
    storage.write(LAB_HISTORY_SLOT, '{"version":1,"entries":[{"labId":"x"},');
    const store = createTestStore({ storage });
    store.getState().loadLabs();
    expect(store.getState().labHistory).toEqual([]);

    storage.write(LAB_HISTORY_SLOT, '{"version":1,"entries":[{"__proto__":{"polluted":true},"labId":7},null]}');
    const second = createTestStore({ storage });
    second.getState().loadLabs();
    expect(second.getState().labHistory).toEqual([]);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('keeps working in memory when the storage quota is exceeded', () => {
    const ctx = setup(createMemoryStorage({ quotaBytes: 8 }));
    passLab(ctx);
    expect(ctx.store.getState().labHistory).toHaveLength(1);
    expect(ctx.store.getState().currentLabSession?.progress.stars).toBe(3);
    expect(ctx.storage.read(LAB_HISTORY_SLOT)).toBeNull();
  });
});
