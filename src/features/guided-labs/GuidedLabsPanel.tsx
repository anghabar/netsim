import { useState } from 'react';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import type { FeaturePanelProps } from '../featureRegistry';
import { useNetworkStore } from '../../store/useNetworkStore';
import { isLabInProgress } from '../../store/topologyAutosave';
import { getActiveLab, setActiveLab } from './domain/activeLab';
import { describeLoadError, LAB_LISTINGS, loadGuidedLab, type LabFetcher } from './domain/catalog';
import { evaluateLab } from './domain/criteria';
import { loadProgress, recordCheck, saveProgress, type GuidedProgress } from './domain/progress';
import { buildGuidedLabTopology } from './domain/setup';
import type { GuidedLab, LabCheckResult } from './domain/types';

const browserFetch: LabFetcher = (url, init) => fetch(url, init);

const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' } as const;

function ResultMark({ pass }: { pass: boolean | null }) {
  if (pass === null) return <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />;
  return pass ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
  ) : (
    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
  );
}

export default function GuidedLabsPanel(_props: FeaturePanelProps) {
  const [progress, setProgress] = useState<GuidedProgress>(() => loadProgress(useNetworkStore.getState().runtime.storage));
  const [lab, setLab] = useState<GuidedLab | null>(getActiveLab);
  const [result, setResult] = useState<LabCheckResult | null>(null);
  const [hints, setHints] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const labRunning = useNetworkStore((state) => isLabInProgress(state.currentLabSession));

  const start = async (id: string): Promise<void> => {
    const state = useNetworkStore.getState();
    // The canvas is read at click time: replacing a non-empty canvas needs a second click.
    if ((state.devices.length > 0 || state.cables.length > 0) && confirmId !== id) {
      setConfirmId(id);
      setNotice(null);
      return;
    }
    setConfirmId(null);
    setBusy(true);
    setNotice(null);
    const loaded = await loadGuidedLab(id, browserFetch, import.meta.env.BASE_URL);
    if (!loaded.ok) {
      setBusy(false);
      setNotice(describeLoadError(loaded.error));
      return;
    }
    const { ids, random } = state.runtime;
    const built = buildGuidedLabTopology(loaded.value, { ids, random });
    if (!built.ok) {
      setBusy(false);
      setNotice('The lab topology could not be built.');
      return;
    }
    const replaced = state.replaceTopology(built.value);
    setBusy(false);
    if (!replaced.ok) {
      setNotice(
        replaced.error === 'lab-in-progress'
          ? 'Finish or reset the current lab before starting a guided lab.'
          : 'The lab topology was rejected by validation.',
      );
      return;
    }
    setActiveLab(loaded.value);
    setLab(loaded.value);
    setResult(null);
    setHints({});
  };

  const check = (): void => {
    if (lab === null) return;
    const { devices, cables, runtime } = useNetworkStore.getState();
    const checked = evaluateLab(lab, devices, cables);
    setResult(checked);
    const next = recordCheck(progress, checked);
    setProgress(next);
    // Progress stays in this browser; a full or disabled store only loses it after the visit.
    saveProgress(runtime.storage, next);
  };

  const leave = (): void => {
    setActiveLab(null);
    setLab(null);
    setResult(null);
    setNotice(null);
  };

  if (lab === null) {
    return (
      <div className="min-w-0 space-y-3 p-1">
        <p className="text-xs leading-snug text-zinc-400">
          Short hands-on labs. Each one loads a topology onto the canvas; you configure it in the consoles and press
          Check. Progress is kept only in this browser.
        </p>
        {labRunning && (
          <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            A lab is in progress. Finish or reset it to start a guided lab.
          </p>
        )}
        {notice !== null && (
          <p role="status" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {notice}
          </p>
        )}
        <ul className="space-y-2">
          {LAB_LISTINGS.map((item) => {
            const entry = Object.prototype.hasOwnProperty.call(progress, item.id) ? progress[item.id] : undefined;
            const awaiting = confirmId === item.id;
            return (
              <li key={item.id} className="min-w-0 rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="flex flex-wrap items-center gap-x-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <span>{LEVEL_LABEL[item.level]}</span>
                  <span>{item.minutes} min</span>
                  {entry?.completed === true && <span className="text-emerald-400">Completed</span>}
                </div>
                <p className="mt-1 break-words text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-1 break-words text-xs text-zinc-300">{item.summary}</p>
                {awaiting && (
                  <p className="mt-2 text-xs text-amber-200">
                    This replaces everything on the canvas. Press the button again to continue.
                  </p>
                )}
                <button
                  type="button"
                  disabled={busy || labRunning}
                  onClick={() => void start(item.id)}
                  className="mt-2 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50"
                >
                  {awaiting ? 'Replace canvas and start' : entry !== undefined ? 'Start again' : 'Start'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const resultFor = (taskId: string) => result?.tasks.find((t) => t.taskId === taskId);

  return (
    <div className="min-w-0 space-y-3 p-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-bold text-white">{lab.title}</h3>
        <button type="button" onClick={leave} className="text-xs text-zinc-300 underline hover:text-white">
          All labs
        </button>
      </div>
      <p className="break-words text-xs text-zinc-300">{lab.summary}</p>
      <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-300">
        {lab.objectives.map((objective) => (
          <li key={objective} className="break-words">
            {objective}
          </li>
        ))}
      </ul>

      <ol className="space-y-3">
        {lab.tasks.map((task, index) => {
          const taskResult = resultFor(task.id);
          const shown = hints[task.id] ?? 0;
          return (
            <li key={task.id} className="min-w-0 rounded-xl border border-white/10 bg-black/30 p-3">
              <p className="break-words text-sm font-semibold text-white">
                {index + 1}. {task.title}
              </p>
              <p className="mt-1 break-words text-xs text-zinc-300">{task.description}</p>
              <ul className="mt-2 space-y-1">
                {task.criteria.map((criterion, i) => {
                  const r = taskResult?.results[i];
                  return (
                    <li key={`${criterion.type}-${i}`} className="flex min-w-0 items-start gap-2 text-xs text-zinc-200">
                      <ResultMark pass={r === undefined ? null : r.pass} />
                      <span className="min-w-0 break-words">
                        {criterion.label}
                        {r !== undefined && !r.pass && <span className="block text-red-300">{r.detail}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {task.hints.slice(0, shown).map((hint) => (
                <p key={hint} className="mt-2 break-words rounded-lg bg-sky-500/10 px-2 py-1 text-xs text-sky-200">
                  Hint: {hint}
                </p>
              ))}
              {shown < task.hints.length && (
                <button
                  type="button"
                  onClick={() => setHints((current) => ({ ...current, [task.id]: shown + 1 }))}
                  className="mt-2 text-xs text-sky-300 underline hover:text-white"
                >
                  {shown === 0 ? 'Show a hint' : 'Show another hint'}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={check}
        className="w-full rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-bold text-black hover:bg-emerald-400"
      >
        Check
      </button>
      {result !== null && (
        <p role="status" className={`text-xs font-semibold ${result.pass ? 'text-emerald-300' : 'text-amber-200'}`}>
          {result.pass
            ? 'Lab complete. Every check passes.'
            : `${result.tasks.filter((t) => t.pass).length} of ${result.tasks.length} tasks done.`}
        </p>
      )}
    </div>
  );
}
