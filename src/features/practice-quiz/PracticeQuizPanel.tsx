import { useEffect, useState } from 'react';
import { useNetworkStore } from '../../store/useNetworkStore';
import { QUESTION_BANK } from './data/questionBank';
import { DEFAULT_QUIZ_CONFIG, summarize } from './domain/engine';

const button =
  'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export default function PracticeQuizPanel() {
  const session = useNetworkStore((state) => state.quizSession);
  const start = useNetworkStore((state) => state.quizStart);
  const answer = useNetworkStore((state) => state.quizAnswer);
  const tick = useNetworkStore((state) => state.quizTick);
  const reset = useNetworkStore((state) => state.quizReset);

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const running = session !== null && session.finishedAt === null;

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setRemaining(tick()), 500);
    return () => clearInterval(timer);
  }, [running, tick]);

  const begin = (): void => {
    setSelected([]);
    setRemaining(null);
    start();
  };

  const question = session?.current ?? null;
  const multiple = question !== null && question.correctOptionIds.length > 1;

  const toggle = (optionId: string): void => {
    setSelected((previous) => {
      if (!multiple) return [optionId];
      return previous.includes(optionId) ? previous.filter((id) => id !== optionId) : [...previous, optionId];
    });
  };

  const submit = (): void => {
    if (selected.length === 0) return;
    answer(selected);
    setSelected([]);
  };

  const result = session !== null && session.finishedAt !== null ? summarize(session) : null;

  return (
    <div className="flex flex-col gap-4 text-white">
      {session === null && (
        <>
          <p className="text-sm text-zinc-300">
            {DEFAULT_QUIZ_CONFIG.length} questions picked from a built-in bank of {QUESTION_BANK.length}. The order
            adapts to your answers. The quiz is a self-assessment that runs entirely in this browser: the score is the
            plain percentage of correct answers and is not a prediction for any exam.
          </p>
          <button type="button" onClick={begin} className={button}>
            Start quiz
          </button>
        </>
      )}

      {session !== null && question !== null && (
        <>
          <p className="text-xs text-zinc-400">
            Question {session.answers.length + 1} of {session.total}
            {remaining !== null ? ` · ${formatClock(remaining)} left` : ''}
          </p>
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            {question.category} · level {question.level}
            {multiple ? ` · choose ${question.correctOptionIds.length}` : ''}
          </p>
          <p className="text-base font-medium">{question.prompt}</p>
          <ul className="flex flex-col gap-2">
            {question.options.map((option) => {
              const checked = selected.includes(option.id);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggle(option.id)}
                    className={`${button} w-full text-left ${checked ? 'border-cyan-400/60 bg-cyan-500/10' : ''}`}
                  >
                    {option.text}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" disabled={selected.length === 0} onClick={submit} className={button}>
            Submit answer
          </button>
          <button type="button" onClick={reset} className={button}>
            Quit quiz
          </button>
        </>
      )}

      {session !== null && result !== null && (
        <>
          <div>
            <p className="text-3xl font-bold">{result.percent}%</p>
            <p className="text-sm text-zinc-300">
              {result.correct} of {result.total} correct · {result.passed ? 'at or above' : 'below'} the{' '}
              {session.config.passPercent}% practice threshold
              {result.timedOut ? ' · time ran out' : ''}
            </p>
          </div>
          <ul className="text-sm text-zinc-300">
            {result.byCategory.map((score) => (
              <li key={score.category}>
                {score.category}: {score.correct}/{score.total}
              </li>
            ))}
          </ul>
          {result.weakTags.length > 0 && (
            <p className="text-sm text-amber-200">Review next: {result.weakTags.join(', ')}</p>
          )}
          {result.missed.map((item) => (
            <article key={item.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-sm font-medium">{item.prompt}</p>
              <p className="mt-2 text-sm text-zinc-300">{item.explanation}</p>
            </article>
          ))}
          <button type="button" onClick={begin} className={button}>
            Try again
          </button>
          <button type="button" onClick={reset} className={button}>
            Close results
          </button>
        </>
      )}
    </div>
  );
}
