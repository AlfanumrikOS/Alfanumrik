'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui';
import { FoxyAvatar } from '@/components/ui';
import {
  type ChainCard,
  checkChainOrder,
  countMisplacedCards,
  applyHint,
} from '@/lib/challenge-engine';
import { CHALLENGE_COINS } from '@/lib/challenge-config';
import { onCorrectAnswer, onWrongAnswer, createFeedbackState } from '@/lib/feedback-engine';
import { playSound } from '@/lib/sounds';

/* ═══════════════════════════════════════════════════════════════
   ConceptChain — Core Drag-and-Drop Card Sequencing Game
   Students arrange concept cards into the correct sequential order.
   Supports HTML5 drag-and-drop + tap-swap fallback for touch.
   ═══════════════════════════════════════════════════════════════ */

interface ConceptChainProps {
  cards: ChainCard[];
  correctOrder: string[];
  distractorIds: string[];
  explanation: string;
  explanationHi: string;
  isHi: boolean;
  onSolved: (moves: number, hintsUsed: number, distractorsExcluded: number) => void;
}

export default function ConceptChain({
  cards,
  correctOrder,
  distractorIds,
  explanation,
  explanationHi,
  isHi,
  onSolved,
}: ConceptChainProps) {
  // Card order tracks IDs in their current visual order
  const [cardOrder, setCardOrder] = useState<string[]>(() => cards.map(c => c.id));
  const [moveCount, setMoveCount] = useState(0);
  const [failureCount, setFailureCount] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [showWrongPulse, setShowWrongPulse] = useState(false);
  const [foxyMessage, setFoxyMessage] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [distractorsExcluded, setDistractorsExcluded] = useState(0);

  const feedbackState = useRef(createFeedbackState());
  const dragItemRef = useRef<string | null>(null);
  const cardMap = useRef<Map<string, ChainCard>>(
    new Map(cards.map(c => [c.id, c]))
  );

  // Build base chain for engine functions (non-distractor cards in correct order)
  const baseChain = useRef<ChainCard[]>(
    correctOrder.map(id => cardMap.current.get(id)).filter(Boolean) as ChainCard[]
  );

  const distractorSet = useRef(new Set(distractorIds));
  const lockedSet = new Set(lockedIds);

  // ── Swap two cards ──
  const swapCards = useCallback((fromId: string, toId: string) => {
    if (lockedIds.includes(fromId) || lockedIds.includes(toId)) return;
    if (fromId === toId) return;

    setCardOrder(prev => {
      const newOrder = [...prev];
      const fromIdx = newOrder.indexOf(fromId);
      const toIdx = newOrder.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      [newOrder[fromIdx], newOrder[toIdx]] = [newOrder[toIdx], newOrder[fromIdx]];
      return newOrder;
    });
    setMoveCount(prev => prev + 1);
    setSelectedId(null);
    setWrongIds([]);
    setShowWrongPulse(false);
  }, [lockedIds]);

  // ── Drag-and-drop handlers ──
  const handleDragStart = useCallback((cardId: string) => {
    if (lockedIds.includes(cardId)) return;
    dragItemRef.current = cardId;
  }, [lockedIds]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((targetId: string) => {
    const fromId = dragItemRef.current;
    dragItemRef.current = null;
    if (!fromId) return;
    swapCards(fromId, targetId);
  }, [swapCards]);

  // ── Tap-swap handler ──
  const handleTap = useCallback((cardId: string) => {
    if (lockedIds.includes(cardId) || solved) return;

    if (selectedId === null) {
      setSelectedId(cardId);
    } else if (selectedId === cardId) {
      setSelectedId(null);
    } else {
      swapCards(selectedId, cardId);
    }
  }, [selectedId, lockedIds, solved, swapCards]);

  // ── Check answer ──
  const handleCheck = useCallback(() => {
    const isCorrect = checkChainOrder(cardOrder, baseChain.current);

    if (isCorrect) {
      // Count distractors that were pushed to the end / excluded from the chain
      const chainIdSet = new Set(correctOrder);
      const submittedChainOnly = cardOrder.filter(id => chainIdSet.has(id));
      const excludedDistractors = cardOrder.filter(id => distractorSet.current.has(id)).length;
      setDistractorsExcluded(excludedDistractors);

      const feedback = onCorrectAnswer(feedbackState.current);
      setFoxyMessage(isHi ? feedback.foxyLine.hi : feedback.foxyLine.en);
      playSound('complete');
      setSolved(true);
      setShowConfetti(true);
      setWrongIds([]);
      setShowWrongPulse(false);

      // Notify parent
      onSolved(moveCount, hintsUsed, excludedDistractors);
    } else {
      const misplaced = countMisplacedCards(cardOrder, baseChain.current);
      const feedback = onWrongAnswer(feedbackState.current);
      setFoxyMessage(isHi ? feedback.foxyLine.hi : feedback.foxyLine.en);
      playSound('incorrect');

      // Mark wrong cards
      const chainIdSet = new Set(correctOrder);
      const sortedCorrect = [...baseChain.current].sort((a, b) => a.position - b.position);
      const correctIds = sortedCorrect.map(c => c.id);
      const submittedChain = cardOrder.filter(id => chainIdSet.has(id));
      const wrong: string[] = [];
      for (let i = 0; i < correctIds.length; i++) {
        if (i >= submittedChain.length || submittedChain[i] !== correctIds[i]) {
          wrong.push(submittedChain[i] || '');
        }
      }
      // Also mark distractors that are between chain cards as wrong
      distractorIds.forEach(id => {
        const idx = cardOrder.indexOf(id);
        if (idx !== -1 && idx < correctOrder.length) {
          wrong.push(id);
        }
      });
      setWrongIds(wrong.filter(Boolean));
      setShowWrongPulse(true);
      setTimeout(() => setShowWrongPulse(false), 1200);

      setFailureCount(prev => prev + 1);
      setFoxyMessage(
        isHi
          ? `${misplaced} कार्ड गलत जगह पर हैं`
          : `${misplaced} card${misplaced !== 1 ? 's are' : ' is'} in the wrong place`
      );
    }
  }, [cardOrder, correctOrder, distractorIds, moveCount, hintsUsed, isHi, onSolved]);

  // ── Hint handler ──
  const handleHint = useCallback(() => {
    const result = applyHint(cardOrder, baseChain.current, lockedIds);
    setCardOrder(result.newOrder);
    setLockedIds(result.lockedIds);
    setHintsUsed(prev => prev + 1);
    setWrongIds([]);
    setShowWrongPulse(false);
    playSound('tap');
  }, [cardOrder, lockedIds]);

  // ── Render ──
  return (
    <div className="space-y-4 animate-fade-in">
      {/* Move counter */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-[var(--text-3)]">
          {isHi ? `${moveCount} चाल` : `${moveCount} move${moveCount !== 1 ? 's' : ''}`}
        </span>
        {hintsUsed > 0 && (
          <span className="text-xs text-[var(--text-3)]">
            {isHi ? `${hintsUsed} हिंट` : `${hintsUsed} hint${hintsUsed !== 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {/* Card list */}
      <div className="space-y-2" role="list" aria-label={isHi ? 'कॉन्सेप्ट कार्ड' : 'Concept cards'}>
        {cardOrder.map((cardId) => {
          const card = cardMap.current.get(cardId);
          if (!card) return null;

          const isLocked = lockedSet.has(cardId);
          const isDistractor = distractorSet.current.has(cardId);
          const isWrong = wrongIds.includes(cardId);
          const isSelected = selectedId === cardId;

          return (
            <div
              key={cardId}
              role="listitem"
              draggable={!isLocked && !solved}
              onDragStart={() => handleDragStart(cardId)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(cardId)}
              onClick={() => handleTap(cardId)}
              className={[
                'flex items-center gap-3 rounded-xl p-3.5 transition-all cursor-grab active:cursor-grabbing select-none',
                isLocked ? 'opacity-70 cursor-default' : '',
                isSelected ? 'ring-2 ring-[#F97316] ring-offset-2' : '',
                isWrong && showWrongPulse ? 'animate-pulse' : '',
                solved ? 'cursor-default' : '',
              ].join(' ')}
              style={{
                background: isLocked
                  ? 'var(--surface-2)'
                  : solved
                    ? 'rgba(34, 197, 94, 0.06)'
                    : 'var(--surface-1)',
                border: `2px solid ${
                  isWrong && isDistractor
                    ? '#DC2626'
                    : isWrong
                      ? '#DC2626'
                      : isSelected
                        ? '#F97316'
                        : isLocked
                          ? 'rgba(124, 58, 237, 0.2)'
                          : solved
                            ? 'rgba(34, 197, 94, 0.3)'
                            : 'var(--border)'
                }`,
                borderLeftWidth: 4,
                borderLeftColor: isWrong && isDistractor
                  ? '#DC2626'
                  : isWrong
                    ? '#DC2626'
                    : isLocked
                      ? '#7C3AED'
                      : solved
                        ? '#22C55E'
                        : '#7C3AED',
                touchAction: 'manipulation',
                minHeight: 48,
              }}
              aria-grabbed={isSelected}
              aria-label={isHi ? card.textHi : card.text}
            >
              {/* Drag handle or status icon */}
              <span className="text-[var(--text-3)] flex-shrink-0 text-sm w-5 text-center" aria-hidden="true">
                {isLocked ? '\u2713' : solved ? '\u2713' : '\u2630'}
              </span>

              {/* Card text */}
              <span className="text-sm font-medium flex-1 text-[var(--text-1)]">
                {isHi ? card.textHi : card.text}
              </span>

              {/* Distractor badge (only after wrong check) */}
              {isWrong && isDistractor && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(220, 38, 38, 0.1)', color: '#DC2626' }}
                >
                  {isHi ? 'अतिरिक्त' : 'Extra'}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Foxy feedback line */}
      {foxyMessage && (
        <div className="flex items-center gap-3 px-1 animate-fade-in">
          <FoxyAvatar state={solved ? 'happy' : 'encouraging'} size="sm" />
          <p className="text-sm font-medium text-[var(--text-2)]">{foxyMessage}</p>
        </div>
      )}

      {/* Confetti (CSS only) */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden" aria-hidden="true">
          {Array.from({ length: 30 }, (_, i) => (
            <span
              key={i}
              className="absolute block rounded-sm"
              style={{
                width: 8 + Math.random() * 8,
                height: 8 + Math.random() * 8,
                background: ['#F97316', '#7C3AED', '#22C55E', '#FBBF24', '#3B82F6'][i % 5],
                left: `${5 + Math.random() * 90}%`,
                top: -20,
                opacity: 0.9,
                animation: `confetti-fall ${1.5 + Math.random() * 1.5}s ease-out forwards`,
                animationDelay: `${Math.random() * 0.5}s`,
                transform: `rotate(${Math.random() * 360}deg)`,
              }}
            />
          ))}
          <style>{`
            @keyframes confetti-fall {
              0% { transform: translateY(0) rotate(0deg); opacity: 1; }
              100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {/* Solved: explanation + coins */}
      {solved && (
        <div className="rounded-xl p-4 space-y-3 animate-fade-in" style={{
          background: 'rgba(34, 197, 94, 0.06)',
          border: '1px solid rgba(34, 197, 94, 0.2)',
        }}>
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden="true">{'\u2705'}</span>
            <span className="text-sm font-bold text-[#16A34A]">
              {isHi ? 'सही जवाब!' : 'Correct!'}
            </span>
          </div>

          <p className="text-sm text-[var(--text-2)]">
            {isHi ? explanationHi : explanation}
          </p>

          <div className="flex items-center gap-2">
            <span className="text-sm" aria-hidden="true">{'\u{1FA99}'}</span>
            <span className="text-sm font-bold" style={{ color: '#F97316' }}>
              +{CHALLENGE_COINS.solve} {isHi ? 'सिक्के' : 'coins'}
            </span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!solved && (
        <div className="space-y-2">
          <Button
            variant="primary"
            fullWidth
            size="lg"
            onClick={handleCheck}
          >
            {isHi ? 'जवाब चेक करो' : 'Check Answer'}
          </Button>

          {failureCount >= 2 && (
            <Button
              variant="soft"
              fullWidth
              color="#7C3AED"
              onClick={handleHint}
            >
              {isHi ? 'हिंट चाहिए?' : 'Need a hint?'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
