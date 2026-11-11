/**
 * Two-step confirmation before a quick topology replaces a canvas that is not
 * empty. Pure state transitions; the component only stores the current step.
 */

export interface CanvasSummary {
  deviceCount: number;
  cableCount: number;
}

export type QuickTopologyStep =
  | { kind: 'idle' }
  | { kind: 'awaiting-confirmation'; topologyId: string };

export interface QuickTopologyDecision {
  /** Id of the topology to apply now, or null when nothing must be applied. */
  apply: string | null;
  step: QuickTopologyStep;
}

export const IDLE_STEP: QuickTopologyStep = Object.freeze({ kind: 'idle' });

export const isCanvasEmpty = (canvas: CanvasSummary): boolean =>
  canvas.deviceCount === 0 && canvas.cableCount === 0;

/** First step: applies at once on an empty canvas, otherwise asks for confirmation. */
export function chooseQuickTopology(topologyId: string, canvas: CanvasSummary): QuickTopologyDecision {
  if (isCanvasEmpty(canvas)) return { apply: topologyId, step: IDLE_STEP };
  return { apply: null, step: { kind: 'awaiting-confirmation', topologyId } };
}

/** Second step: applies only the topology that is awaiting confirmation. */
export function confirmQuickTopology(step: QuickTopologyStep, topologyId: string): QuickTopologyDecision {
  if (step.kind === 'awaiting-confirmation' && step.topologyId === topologyId) {
    return { apply: topologyId, step: IDLE_STEP };
  }
  return { apply: null, step };
}

export function cancelQuickTopology(): QuickTopologyStep {
  return IDLE_STEP;
}
