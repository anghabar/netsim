import { useState } from 'react';
import { CheckCircle, Clock, Play } from 'lucide-react';
import type { Lab, LabProgress } from '../../../types/NetworkTypes';
import { isSuccessfulAttempt } from '../domain/labHistory';
import { scorePercent } from '../domain/labRules';
import { StarRow } from './StarRow';

const DIFFICULTY_STYLES = new Map<string, string>([
  ['basic', 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'],
  ['intermediate', 'border-blue-500/20 bg-blue-500/10 text-blue-400'],
  ['advanced', 'border-purple-500/20 bg-purple-500/10 text-purple-400'],
]);
const DEFAULT_DIFFICULTY_STYLE = 'border-zinc-500/20 bg-zinc-500/10 text-zinc-400';

interface LabCardProps {
  lab: Lab;
  best: LabProgress | undefined;
  /** True when starting the lab would replace a non-empty canvas. */
  replacesCanvas: boolean;
  onStart: (labId: string, examMode: boolean) => void;
}

export function LabCard({ lab, best, replacesCanvas, onStart }: LabCardProps) {
  const [examMode, setExamMode] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const completed = best !== undefined && isSuccessfulAttempt(best);
  const percent = best ? scorePercent(best.score, best.maxScore) : 0;
  const difficultyStyle = DIFFICULTY_STYLES.get(lab.difficulty) ?? DEFAULT_DIFFICULTY_STYLE;

  const handleStart = () => {
    if (replacesCanvas && !confirming) {
      setConfirming(true);
      return;
    }
    onStart(lab.id, examMode);
  };

  const startLabel = confirming
    ? 'Replace canvas and start'
    : examMode
      ? 'Start exam'
      : completed
        ? 'Repeat lab'
        : 'Start lab';

  return (
    <article
      aria-label={`Lab: ${lab.title}`}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 hover:border-blue-500/50"
    >
      <div className="flex-1 space-y-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-white">{lab.title}</h3>
          <StarRow count={best?.stars ?? 0} />
        </div>
        <p className="line-clamp-2 text-sm text-zinc-400">{lab.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${difficultyStyle}`}>
            {lab.difficulty}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} aria-hidden="true" />
            {lab.estimatedTime} min
          </span>
          <span>{lab.certification.toUpperCase()}</span>
        </div>
        <ul className="space-y-1">
          {lab.objectives.slice(0, 2).map((objective, index) => (
            <li key={index} className="flex items-start gap-2 text-xs text-zinc-400">
              <CheckCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-emerald-500/70" />
              <span className="line-clamp-1">{objective}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3 border-t border-zinc-800 bg-black/20 p-4">
        {best && (
          <p className="flex justify-between text-[10px] text-zinc-400">
            <span>Best attempt</span>
            <span>{percent}%</span>
          </p>
        )}

        <button
          type="button"
          role="switch"
          aria-checked={examMode}
          onClick={() => setExamMode((value) => !value)}
          className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200"
        >
          <span className={`h-4 w-8 rounded-full p-0.5 ${examMode ? 'bg-red-600' : 'bg-zinc-700'}`}>
            <span className={`block h-3 w-3 rounded-full bg-white ${examMode ? 'translate-x-4' : ''}`} />
          </span>
          Exam mode (timed, no hints)
        </button>

        {confirming && (
          <p className="text-xs text-amber-300" role="status">
            Starting this lab replaces the devices currently on the canvas.
          </p>
        )}

        <button
          type="button"
          onClick={handleStart}
          className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white ${
            examMode || confirming ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
          }`}
        >
          <Play size={14} aria-hidden="true" className="fill-current" />
          {startLabel}
        </button>
      </div>
    </article>
  );
}
