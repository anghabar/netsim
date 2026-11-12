import { useState } from 'react';
import { useNetworkStore } from '../../../store/useNetworkStore';
import { isLabInProgress } from '../../../store/topologyAutosave';
import { cn } from '../../../utils/cn';
import { applyQuickTopology, describeQuickTopologyError } from '../applyQuickTopology';
import { QUICK_TOPOLOGIES } from '../domain/catalog';
import {
  cancelQuickTopology,
  chooseQuickTopology,
  confirmQuickTopology,
  IDLE_STEP,
  type QuickTopologyStep,
} from '../domain/confirmation';

type Notice = { tone: 'success' | 'error'; text: string };

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Sidebar tab that lists the built-in starter topologies and loads one onto the canvas. */
export function QuickTopologiesTab() {
  const deviceCount = useNetworkStore((state) => state.devices.length);
  const cableCount = useNetworkStore((state) => state.cables.length);
  const labRunning = useNetworkStore((state) => isLabInProgress(state.currentLabSession));
  const [step, setStep] = useState<QuickTopologyStep>(IDLE_STEP);
  const [notice, setNotice] = useState<Notice | null>(null);

  const pendingId = step.kind === 'awaiting-confirmation' ? step.topologyId : null;

  const load = (topologyId: string): void => {
    const applied = applyQuickTopology(topologyId, useNetworkStore.getState());
    setNotice(
      applied.ok
        ? {
            tone: 'success',
            text: `Loaded "${applied.value.title}": ${plural(applied.value.deviceCount, 'device')}, ${plural(applied.value.cableCount, 'cable')}.`,
          }
        : { tone: 'error', text: describeQuickTopologyError(applied.error) },
    );
  };

  const handleChoose = (topologyId: string): void => {
    // Read the canvas at click time, not from the last render.
    const state = useNetworkStore.getState();
    const decision = chooseQuickTopology(topologyId, {
      deviceCount: state.devices.length,
      cableCount: state.cables.length,
    });
    setStep(decision.step);
    setNotice(null);
    if (decision.apply !== null) load(decision.apply);
  };

  const handleConfirm = (topologyId: string): void => {
    const decision = confirmQuickTopology(step, topologyId);
    setStep(decision.step);
    if (decision.apply !== null) load(decision.apply);
  };

  return (
    <div className="space-y-3">
      <p className="px-2 text-[11px] leading-snug text-zinc-400">
        Load a small ready-made topology onto the canvas. Everything is built locally in your browser.
      </p>

      {labRunning && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          A lab is in progress. Finish or reset it to load a quick topology.
        </p>
      )}

      <ul className="space-y-2">
        {QUICK_TOPOLOGIES.map((topology) => {
          const awaiting = pendingId === topology.id;
          return (
            <li key={topology.id} className="space-y-2">
              <button
                type="button"
                disabled={labRunning}
                aria-expanded={awaiting}
                onClick={() => handleChoose(topology.id)}
                className={cn(
                  'w-full rounded-2xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-netsim-cyan/60',
                  awaiting
                    ? 'border-amber-400/50 bg-amber-500/10'
                    : 'border-white/[0.06] bg-white/[0.02] hover:border-netsim-cyan/30 hover:bg-netsim-cyan/[0.08]',
                  labRunning && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="block text-xs font-black uppercase tracking-tight text-zinc-100">
                  {topology.title}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">{topology.summary}</span>
                <span className="mt-1 block font-mono text-[9px] text-zinc-500">
                  {plural(topology.nodes.length, 'device')} · {plural(topology.links.length, 'cable')}
                </span>
              </button>

              {awaiting && (
                <div
                  role="alertdialog"
                  aria-label={`Replace the current topology with ${topology.title}`}
                  className="space-y-2 rounded-2xl border border-amber-400/30 bg-black/40 px-3 py-2.5"
                >
                  <p className="text-[11px] leading-snug text-amber-100">
                    This removes the current topology ({plural(deviceCount, 'device')}, {plural(cableCount, 'cable')})
                    and cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleConfirm(topology.id)}
                      className="flex-1 rounded-xl bg-amber-400 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-black hover:bg-amber-300"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(cancelQuickTopology())}
                      className="flex-1 rounded-xl border border-white/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-300 hover:bg-white/10"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p
        role="status"
        aria-live="polite"
        className={cn(
          'min-h-[1rem] px-2 text-[11px]',
          notice?.tone === 'error' ? 'text-red-300' : 'text-emerald-300',
        )}
      >
        {notice?.text ?? ''}
      </p>
    </div>
  );
}
