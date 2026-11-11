import { describe, expect, it } from 'vitest';
import {
  cancelQuickTopology,
  chooseQuickTopology,
  confirmQuickTopology,
  IDLE_STEP,
  isCanvasEmpty,
} from '../../../features/quick-topologies/domain/confirmation';

const EMPTY = { deviceCount: 0, cableCount: 0 };
const BUSY = { deviceCount: 3, cableCount: 2 };

describe('quick topology confirmation', () => {
  it('treats a canvas with any device or cable as not empty', () => {
    expect(isCanvasEmpty(EMPTY)).toBe(true);
    expect(isCanvasEmpty(BUSY)).toBe(false);
    expect(isCanvasEmpty({ deviceCount: 1, cableCount: 0 })).toBe(false);
    expect(isCanvasEmpty({ deviceCount: 0, cableCount: 1 })).toBe(false);
  });

  it('applies at once on an empty canvas', () => {
    expect(chooseQuickTopology('routed-campus', EMPTY)).toEqual({ apply: 'routed-campus', step: { kind: 'idle' } });
  });

  it('asks for confirmation before replacing a canvas that is not empty', () => {
    const decision = chooseQuickTopology('routed-campus', BUSY);
    expect(decision).toEqual({
      apply: null,
      step: { kind: 'awaiting-confirmation', topologyId: 'routed-campus' },
    });
    expect(confirmQuickTopology(decision.step, 'routed-campus')).toEqual({
      apply: 'routed-campus',
      step: { kind: 'idle' },
    });
  });

  it('never applies without a matching pending confirmation', () => {
    expect(confirmQuickTopology(IDLE_STEP, 'routed-campus')).toEqual({ apply: null, step: IDLE_STEP });
    const pending = chooseQuickTopology('routed-campus', BUSY).step;
    expect(confirmQuickTopology(pending, 'two-sites')).toEqual({ apply: null, step: pending });
  });

  it('moves the pending confirmation when another topology is chosen and clears it on cancel', () => {
    const second = chooseQuickTopology('two-sites', BUSY);
    expect(second.step).toEqual({ kind: 'awaiting-confirmation', topologyId: 'two-sites' });
    expect(cancelQuickTopology()).toEqual({ kind: 'idle' });
    expect(confirmQuickTopology(cancelQuickTopology(), 'two-sites').apply).toBeNull();
  });
});
