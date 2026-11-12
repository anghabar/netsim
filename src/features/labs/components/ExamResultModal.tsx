import { Trophy, XCircle } from 'lucide-react';
import type { LabSession } from '../../../types/NetworkTypes';
import {
  EXAM_PASS_RATIO,
  MAX_EXAM_STRIKES,
  evaluateExam,
  formatDuration,
  type ExamFailureReason,
} from '../domain/labRules';

const REASON_LABELS: Record<ExamFailureReason, string> = {
  score: `Score below ${Math.round(EXAM_PASS_RATIO * 100)}%`,
  time: 'Time limit reached',
  strikes: 'Too many strikes',
};

interface ExamResultModalProps {
  session: LabSession;
  onClose: () => void;
  onRetry: () => void;
}

export function ExamResultModal({ session, onClose, onRetry }: ExamResultModalProps) {
  if (session.isExamMode !== true) return null;

  const outcome = evaluateExam(session);
  const { score, maxScore } = session.progress;
  const stats = [
    { label: 'Score', value: `${outcome.percent}%`, detail: `${score}/${maxScore} pts` },
    {
      label: 'Time',
      value: formatDuration(outcome.timeSpentSeconds),
      detail: outcome.timeLimitSeconds > 0 ? `Limit ${formatDuration(outcome.timeLimitSeconds)}` : 'No limit',
    },
    { label: 'Strikes', value: String(outcome.strikes), detail: `Max ${MAX_EXAM_STRIKES}` },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="exam-result-title"
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 p-4 text-center backdrop-blur-md"
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-8 shadow-2xl">
        <div
          className={`mb-4 inline-flex rounded-full p-4 ${
            outcome.passed ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}
        >
          {outcome.passed ? <Trophy size={40} aria-hidden="true" /> : <XCircle size={40} aria-hidden="true" />}
        </div>
        <h2 id="exam-result-title" className="mb-3 text-2xl font-bold text-white">
          {outcome.passed ? 'Exam passed' : 'Exam not passed'}
        </h2>

        {outcome.reasons.length > 0 && (
          <ul className="mb-4 space-y-1 text-sm font-semibold text-red-400">
            {outcome.reasons.map((reason) => (
              <li key={reason}>{REASON_LABELS[reason]}</li>
            ))}
          </ul>
        )}

        <dl className="mb-6 grid grid-cols-3 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/5 bg-black/30 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{stat.label}</dt>
              <dd className="text-lg font-bold text-white">{stat.value}</dd>
              <dd className="text-[10px] text-zinc-600">{stat.detail}</dd>
            </div>
          ))}
        </dl>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 font-semibold text-zinc-300 hover:bg-zinc-800"
          >
            Back to labs
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
