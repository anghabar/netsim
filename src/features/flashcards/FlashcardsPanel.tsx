import { useEffect, useMemo, useState } from 'react';
import { useNetworkStore } from '../../store/useNetworkStore';
import type { StorageWriteError } from '../../utils/storage/keyValueStorage';
import { ALL_CARDS, BUILT_IN_DECKS, findCard } from './data/decks';
import { activeStreak, dayIndex, summarizeProgress } from './domain/deck';
import { RATING_CHOICES, currentCardId } from './domain/session';
import type { ReviewQuality } from './domain/types';
import { localOffsetMinutes } from './feature.slice';

const button =
  'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

const SAVE_ERROR_TEXT: Record<StorageWriteError, string> = {
  'too-large': 'the saved data is too large',
  'quota-exceeded': 'browser storage is full',
  unavailable: 'browser storage is unavailable',
};

export default function FlashcardsPanel() {
  const deck = useNetworkStore((state) => state.flashcardsDeck);
  const session = useNetworkStore((state) => state.flashcardsSession);
  const saveError = useNetworkStore((state) => state.flashcardsSaveError);
  const load = useNetworkStore((state) => state.flashcardsLoad);
  const start = useNetworkStore((state) => state.flashcardsStart);
  const revealCard = useNetworkStore((state) => state.flashcardsReveal);
  const rate = useNetworkStore((state) => state.flashcardsRate);
  const skipCard = useNetworkStore((state) => state.flashcardsSkip);
  const end = useNetworkStore((state) => state.flashcardsEnd);
  const reset = useNetworkStore((state) => state.flashcardsReset);
  const clock = useNetworkStore((state) => state.runtime.clock);

  const [now, setNow] = useState<number>(() => clock());
  const [showHint, setShowHint] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => summarizeProgress(ALL_CARDS, deck.progress, now), [deck.progress, now]);
  const streak = activeStreak(deck.streak, dayIndex(now, localOffsetMinutes(now)));

  const cardId = session !== null ? currentCardId(session) : null;
  const card = cardId !== null ? findCard(cardId) : null;

  const refresh = (): void => {
    setShowHint(false);
    setNow(clock());
  };
  const onStart = (deckId: string | null): void => {
    refresh();
    start(deckId);
  };
  const onRate = (quality: ReviewQuality): void => {
    rate(quality);
    refresh();
  };
  const onSkip = (): void => {
    skipCard();
    refresh();
  };
  const onEnd = (): void => {
    end();
    refresh();
  };

  return (
    <div className="flex flex-col gap-4 text-white">
      {saveError !== null && (
        <p role="alert" className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-100">
          Progress could not be saved: {SAVE_ERROR_TEXT[saveError]}. It is kept until this page is closed.
        </p>
      )}

      {session !== null && card !== null && (
        <>
          <p className="text-xs text-zinc-400">
            Card {session.index + 1} of {session.queue.length} · {session.recalled}/{session.studied} recalled
          </p>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{card.difficulty}</p>
            <p className="mt-2 text-base font-medium">{card.front}</p>
            {!session.revealed && showHint && card.hint !== undefined && (
              <p className="mt-3 text-sm text-zinc-300">{card.hint}</p>
            )}
            {session.revealed && <p className="mt-4 whitespace-pre-line text-sm text-zinc-200">{card.back}</p>}
          </div>
          {session.revealed ? (
            <div className="grid grid-cols-2 gap-2">
              {RATING_CHOICES.map((choice) => (
                <button
                  key={choice.quality}
                  type="button"
                  title={choice.hint}
                  onClick={() => onRate(choice.quality)}
                  className={button}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={revealCard} className={button}>
                Show answer
              </button>
              {card.hint !== undefined && (
                <button type="button" onClick={() => setShowHint((value) => !value)} className={button}>
                  {showHint ? 'Hide hint' : 'Hint'}
                </button>
              )}
              <button type="button" onClick={onSkip} className={button}>
                Skip
              </button>
            </div>
          )}
          <button type="button" onClick={onEnd} className={button}>
            End session
          </button>
        </>
      )}

      {session !== null && card === null && (
        <>
          <p className="text-sm text-zinc-200">
            Session finished: {session.studied} studied, {session.recalled} recalled.
          </p>
          <button type="button" onClick={onEnd} className={button}>
            Back to decks
          </button>
        </>
      )}

      {session === null && (
        <>
          <p className="text-xs text-zinc-400">
            {summary.due} due · {summary.fresh} new · {summary.learning} learning · {summary.mastered} mastered (
            {summary.masteryPercent}%) · {streak}-day streak (best {deck.streak.best})
          </p>
          <button type="button" disabled={summary.due === 0} onClick={() => onStart(null)} className={button}>
            Study due cards ({summary.due})
          </button>
          <ul className="flex flex-col gap-2">
            {BUILT_IN_DECKS.map((entry) => {
              const due = summarizeProgress(entry.cards, deck.progress, now).due;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={due === 0}
                    onClick={() => onStart(entry.id)}
                    className={`${button} w-full text-left`}
                  >
                    <span className="block font-medium">{entry.name}</span>
                    <span className="block text-xs text-zinc-400">{entry.description}</span>
                    <span className="mt-1 block text-xs text-zinc-500">
                      {due} due · {entry.cards.length} cards
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {confirmReset ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
              <span>Delete all flashcard progress?</span>
              <button
                type="button"
                onClick={() => {
                  reset();
                  setConfirmReset(false);
                  refresh();
                }}
                className={button}
              >
                Delete
              </button>
              <button type="button" onClick={() => setConfirmReset(false)} className={button}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmReset(true)} className={button}>
              Reset progress
            </button>
          )}
          <p className="text-[11px] text-zinc-500">Progress is stored only in this browser.</p>
        </>
      )}
    </div>
  );
}
