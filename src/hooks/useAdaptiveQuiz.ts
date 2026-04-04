'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * useAdaptiveQuiz — Mid-quiz adaptive difficulty hook.
 *
 * Strategy:
 *   1. First `batchSize` questions loaded from regular quiz-generator (batch)
 *   2. After question `batchSize`, fetch next question adaptively (one at a time)
 *   3. Prefetch: while student answers question N, fetch question N+2 in background
 *   4. If adaptive fetch fails, fall back to pre-loaded batch questions
 *
 * P3 anti-cheat: tracks time_spent per question for cheat detection.
 * P5: grade is always a string.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdaptiveQuizConfig {
  studentId: string;
  subject: string;
  grade: string; // P5: always string "6"-"12"
  totalQuestions: number;
  /** Initial batch of questions from regular quiz-generator */
  initialQuestions: Question[];
  /** Session ID for the current quiz */
  sessionId: string;
  /** Optional chapter filter */
  chapterNumber?: number | null;
}

export interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
}

interface ResponseRecord {
  question_id: string;
  is_correct: boolean;
  time_spent: number;
  selected_option: number;
}

export interface AdaptiveInfo {
  difficulty: number;
  reason: string;
  bloomCeiling: string;
  runningScore: string;
}

interface AdaptiveQuizReturn {
  /** Current question to display */
  currentQuestion: Question | null;
  /** 1-based question number */
  questionNumber: number;
  /** Total questions in the quiz */
  totalQuestions: number;
  /** Submit an answer and advance to next question */
  submitAnswer: (selectedOption: number, timeSpent: number) => void;
  /** Whether the next question is being loaded */
  isLoadingNext: boolean;
  /** Adaptive difficulty metadata (null until adaptive mode kicks in) */
  adaptiveInfo: AdaptiveInfo | null;
  /** All responses collected so far */
  responses: ResponseRecord[];
  /** Whether the quiz is complete */
  isComplete: boolean;
  /** All questions answered so far (for results) */
  answeredQuestions: Question[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Number of questions to serve from the initial batch before switching to adaptive */
const BATCH_THRESHOLD = 3;

/** How far ahead to prefetch (fetch question N+PREFETCH_OFFSET while answering N) */
const PREFETCH_OFFSET = 2;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAdaptiveQuiz(config: AdaptiveQuizConfig): AdaptiveQuizReturn {
  const {
    studentId,
    subject,
    grade,
    totalQuestions,
    initialQuestions,
    sessionId,
    chapterNumber,
  } = config;

  // All questions available (initial batch + adaptively fetched)
  const [questions, setQuestions] = useState<Question[]>(() => [...initialQuestions]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [adaptiveInfo, setAdaptiveInfo] = useState<AdaptiveInfo | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  // Track which question IDs we've already used (for exclude_ids)
  const usedIdsRef = useRef<Set<string>>(
    new Set(initialQuestions.map((q) => q.id)),
  );

  // Prefetch cache: question fetched ahead of time
  const prefetchRef = useRef<{
    promise: Promise<{ question: Question; meta: AdaptiveInfo } | null> | null;
    resolved: { question: Question; meta: AdaptiveInfo } | null;
  }>({ promise: null, resolved: null });

  // Prevent duplicate fetches
  const fetchingRef = useRef(false);

  /**
   * Fetch a single adaptive question from the quiz-generator edge function.
   */
  const fetchAdaptiveQuestion = useCallback(
    async (
      currentResponses: ResponseRecord[],
    ): Promise<{ question: Question; meta: AdaptiveInfo } | null> => {
      try {
        const responsesPayload = currentResponses.map((r) => ({
          question_id: r.question_id,
          is_correct: r.is_correct,
          time_spent: r.time_spent,
        }));

        const { data, error } = await supabase.functions.invoke('quiz-generator', {
          body: {
            action: 'next_question',
            student_id: studentId,
            subject,
            grade, // P5: string
            session_id: sessionId,
            responses_so_far: responsesPayload,
            exclude_ids: [...usedIdsRef.current],
            chapter_number: chapterNumber ?? null,
          },
        });

        if (error || !data?.question) {
          console.warn('Adaptive question fetch failed:', error ?? 'no question returned');
          return null;
        }

        const meta: AdaptiveInfo = {
          difficulty: data.meta?.adjusted_difficulty ?? 2,
          reason: data.meta?.reason ?? '',
          bloomCeiling: data.meta?.bloom_ceiling ?? 'understand',
          runningScore: data.meta?.running_score ?? '',
        };

        return { question: data.question as Question, meta };
      } catch (err) {
        console.warn('Adaptive question fetch error:', err);
        return null;
      }
    },
    [studentId, subject, grade, sessionId, chapterNumber],
  );

  /**
   * Start prefetching the next adaptive question in background.
   * Called when the student is answering the current question.
   */
  const startPrefetch = useCallback(
    (currentResponses: ResponseRecord[]) => {
      if (prefetchRef.current.promise || fetchingRef.current) return;

      fetchingRef.current = true;
      const promise = fetchAdaptiveQuestion(currentResponses).then((result) => {
        prefetchRef.current.resolved = result;
        fetchingRef.current = false;
        return result;
      });
      prefetchRef.current.promise = promise;
    },
    [fetchAdaptiveQuestion],
  );

  /**
   * Submit an answer and advance to the next question.
   */
  const submitAnswer = useCallback(
    (selectedOption: number, timeSpent: number) => {
      const question = questions[currentIdx];
      if (!question || isComplete) return;

      const isCorrect = selectedOption === question.correct_answer_index;

      const response: ResponseRecord = {
        question_id: question.id,
        is_correct: isCorrect,
        time_spent: timeSpent,
        selected_option: selectedOption,
      };

      const newResponses = [...responses, response];
      setResponses(newResponses);

      const nextIdx = currentIdx + 1;

      // Check if quiz is complete
      if (nextIdx >= totalQuestions) {
        setIsComplete(true);
        return;
      }

      // If we already have the next question in our array, use it
      if (nextIdx < questions.length) {
        setCurrentIdx(nextIdx);

        // Start prefetch for future adaptive question if we're past the batch threshold
        if (nextIdx >= BATCH_THRESHOLD - 1) {
          // Clear previous prefetch state
          prefetchRef.current = { promise: null, resolved: null };
          startPrefetch(newResponses);
        }
        return;
      }

      // Need to fetch the next question adaptively
      setIsLoadingNext(true);

      const consumePrefetchOrFetch = async () => {
        let result: { question: Question; meta: AdaptiveInfo } | null = null;

        // Check if prefetch has a result ready
        if (prefetchRef.current.resolved) {
          result = prefetchRef.current.resolved;
          prefetchRef.current = { promise: null, resolved: null };
        } else if (prefetchRef.current.promise) {
          // Wait for in-flight prefetch
          result = await prefetchRef.current.promise;
          prefetchRef.current = { promise: null, resolved: null };
        } else {
          // No prefetch available — fetch now
          result = await fetchAdaptiveQuestion(newResponses);
        }

        if (result) {
          usedIdsRef.current.add(result.question.id);
          setQuestions((prev) => [...prev, result!.question]);
          setAdaptiveInfo(result.meta);
          setCurrentIdx(nextIdx);
        } else {
          // Adaptive fetch failed — mark complete if no more questions available
          // (This is a graceful degradation; the quiz ends early)
          console.warn('No adaptive question available, ending quiz early');
          setIsComplete(true);
        }

        setIsLoadingNext(false);

        // Start prefetch for the question after this one
        if (result) {
          prefetchRef.current = { promise: null, resolved: null };
          startPrefetch(newResponses);
        }
      };

      consumePrefetchOrFetch();
    },
    [
      questions,
      currentIdx,
      responses,
      totalQuestions,
      isComplete,
      fetchAdaptiveQuestion,
      startPrefetch,
    ],
  );

  // Kick off first prefetch when approaching the batch threshold
  useEffect(() => {
    if (
      currentIdx === BATCH_THRESHOLD - PREFETCH_OFFSET &&
      responses.length >= BATCH_THRESHOLD - PREFETCH_OFFSET &&
      !prefetchRef.current.promise
    ) {
      startPrefetch(responses);
    }
  }, [currentIdx, responses, startPrefetch]);

  return {
    currentQuestion: questions[currentIdx] ?? null,
    questionNumber: currentIdx + 1,
    totalQuestions,
    submitAnswer,
    isLoadingNext,
    adaptiveInfo,
    responses,
    isComplete,
    answeredQuestions: questions.slice(0, responses.length),
  };
}
