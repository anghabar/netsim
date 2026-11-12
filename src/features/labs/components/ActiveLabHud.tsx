import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Maximize2,
  MinusIcon,
  Timer,
  X,
} from 'lucide-react';
import type { Lab, LabProgress, LabSession, LabStep } from '../../../types/NetworkTypes';
import { useNetworkStore } from '../../../store/useNetworkStore';
import {
  MAX_EXAM_STRIKES,
  examRemainingSeconds,
  formatClock,
  formatDuration,
  scorePercent,
} from '../domain/labRules';
import { canGoToStep } from '../domain/labSession';
import { useNow } from '../hooks/useNow';
import { StarRow } from './StarRow';

interface StepViewProps {
  step: LabStep;
  stepNumber: number;
  completed: boolean;
  hintsShown: number;
  /** Undefined when hints are not allowed (exam mode). */
  onRevealHint: (() => void) | undefined;
}

function StepView({ step, stepNumber, completed, hintsShown, onRevealHint }: StepViewProps) {
  const submitCurrentStep = useNetworkStore((state) => state.submitCurrentStep);
  const [errors, setErrors] = useState<string[]>([]);
  const hints = step.hints ?? [];

  const handleCheck = () => {
    const result = submitCurrentStep();
    setErrors(result.status === 'failed' ? result.errors : []);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/20 text-[10px] font-bold text-blue-300">
          {stepNumber}
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white">{step.title}</h4>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">{step.description}</p>
        </div>
        {completed && (
          <CheckCircle size={14} aria-label="Step completed" className="ml-auto shrink-0 text-emerald-400" />
        )}
      </div>

      <ul className="space-y-2">
        {step.instructions.map((instruction, index) => (
          <li key={index} className="flex items-start gap-2 rounded-lg border border-white/5 bg-black/20 p-2 text-xs text-zinc-300">
            <ArrowRight size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-blue-400" />
            <span>{instruction}</span>
          </li>
        ))}
      </ul>

      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-300">
          {errors.map((error, index) => (
            <li key={index} className="flex items-start gap-2">
              <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </li>
          ))}
        </ul>
      )}

      {onRevealHint !== undefined && hints.length > 0 && (
        <div className="space-y-2">
          {hints.slice(0, hintsShown).map((hint, index) => (
            <p key={index} className="rounded-lg border border-blue-500/10 bg-blue-500/5 p-2 text-xs text-blue-200">
              {hint}
            </p>
          ))}
          {hintsShown < hints.length && (
            <button
              type="button"
              onClick={onRevealHint}
              className="flex items-center gap-2 text-[11px] font-semibold text-blue-400 hover:text-blue-300"
            >
              <Lightbulb size={12} aria-hidden="true" />
              Show hint ({hints.length - hintsShown} left)
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleCheck}
        className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
      >
        Check step
      </button>
    </section>
  );
}

function CompletionCard({ progress, onClose }: { progress: LabProgress; onClose: () => void }) {
  return (
    <section className="space-y-3 text-center" aria-live="polite">
      <h4 className="text-sm font-semibold text-white">Lab completed</h4>
      <StarRow count={progress.stars} size={20} />
      <p className="text-xs text-zinc-400">
        {scorePercent(progress.score, progress.maxScore)}% · {formatDuration(progress.timeSpent)} ·{' '}
        {progress.hintsUsed} hints
      </p>
      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
      >
        Close
      </button>
    </section>
  );
}

interface ActiveLabHudProps {
  session: LabSession;
  lab: Lab;
}

/** Floating panel for the active attempt. Mount it with a key per attempt so its local state resets. */
export function ActiveLabHud({ session, lab }: ActiveLabHudProps) {
  const goToLabStep = useNetworkStore((state) => state.goToLabStep);
  const forceEndExam = useNetworkStore((state) => state.forceEndExam);
  const resetLab = useNetworkStore((state) => state.resetLab);
  const recordHintUsed = useNetworkStore((state) => state.recordHintUsed);
  const [minimized, setMinimized] = useState(false);
  // Revealed hints per step live here, so going back to a step does not count them twice.
  const [hintsShown, setHintsShown] = useState<ReadonlyMap<string, number>>(() => new Map());

  const { currentStep, completedAt, completedSteps } = session.progress;
  const finished = completedAt !== undefined;
  const isExam = session.isExamMode === true;
  const now = useNow(isExam && !finished);
  const remaining = finished ? null : examRemainingSeconds(session, now);

  useEffect(() => {
    if (remaining === 0) forceEndExam();
  }, [remaining, forceEndExam]);

  const step = lab.steps.find((_item, index) => index === currentStep);
  const iconButton = 'rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white';

  const revealHint = (stepId: string) => {
    setHintsShown((current) => new Map(current).set(stepId, (current.get(stepId) ?? 0) + 1));
    recordHintUsed();
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      role="region"
      aria-label={`Active lab: ${lab.title}`}
      className="fixed right-6 top-24 z-40 flex w-96 flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900/95 shadow-2xl backdrop-blur-md"
    >
      <header className="flex cursor-move items-center justify-between gap-2 border-b border-zinc-700 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-bold text-white">{lab.title}</h3>
          <p className="text-[10px] text-zinc-400">
            {finished ? 'Completed' : `Step ${currentStep + 1} of ${lab.steps.length}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {remaining !== null && (
            <span className="mr-1 inline-flex items-center gap-1 text-xs font-bold text-red-300" aria-label="Time remaining">
              <Timer size={12} aria-hidden="true" />
              {formatClock(remaining)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setMinimized((value) => !value)}
            aria-label={minimized ? 'Expand lab panel' : 'Minimize lab panel'}
            className={iconButton}
          >
            {minimized ? <Maximize2 size={14} /> : <MinusIcon size={14} />}
          </button>
          <button type="button" onClick={resetLab} aria-label="Exit lab" className={iconButton}>
            <X size={16} />
          </button>
        </div>
      </header>

      {!minimized && (
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-4">
          {isExam && !finished && (
            <p className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-[10px] font-bold uppercase tracking-widest text-red-300">
              <span>Exam mode</span>
              <span>
                Strikes {session.examStrikes ?? 0}/{MAX_EXAM_STRIKES}
              </span>
            </p>
          )}

          {finished && <CompletionCard progress={session.progress} onClose={resetLab} />}

          {!finished && step !== undefined && (
            <>
              <StepView
                key={step.id}
                step={step}
                stepNumber={currentStep + 1}
                completed={completedSteps.includes(step.id)}
                hintsShown={hintsShown.get(step.id) ?? 0}
                onRevealHint={isExam ? undefined : () => revealHint(step.id)}
              />
              <nav className="flex items-center justify-between border-t border-zinc-800 pt-3" aria-label="Lab steps">
                <button
                  type="button"
                  onClick={() => goToLabStep(currentStep - 1)}
                  disabled={currentStep === 0}
                  aria-label="Previous step"
                  className={`${iconButton} disabled:cursor-not-allowed disabled:opacity-30`}
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="flex items-center gap-1">
                  {lab.steps.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => goToLabStep(index)}
                      disabled={!canGoToStep(session, lab, index)}
                      aria-label={`Go to step ${index + 1}`}
                      aria-current={index === currentStep ? 'step' : undefined}
                      className={`h-2 rounded-full ${
                        index === currentStep
                          ? 'w-5 bg-blue-400'
                          : completedSteps.includes(item.id)
                            ? 'w-2 bg-emerald-400'
                            : 'w-2 bg-zinc-700'
                      }`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => goToLabStep(currentStep + 1)}
                  disabled={!canGoToStep(session, lab, currentStep + 1)}
                  aria-label="Next step"
                  className={`${iconButton} disabled:cursor-not-allowed disabled:opacity-30`}
                >
                  <ChevronRight size={18} />
                </button>
              </nav>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}
