'use client';

/**
 * Student missions page (S1.6 / U7). Thin surface over the play module — the
 * page enumerates MISSION_CONFIGS and, for each, renders MissionCard. Progress
 * is derived by `deriveMissionProgress()` from snapshots the server surfaces
 * via /api/play/mission-progress (assessment/backend owned). When the endpoint
 * is not yet wired (404), we degrade to 0-progress rather than error.
 *
 * The mission steps deep-link to the canonical activity pages (/dive,
 * /challenge, /quiz, /foxy) with `?mission=<id>` as a read-only breadcrumb
 * the target pages may render (non-blocking).
 *
 * P7 bilingual. P10 bundle: base page + play module only; MissionCard chunks
 * are dynamic-imported. P13 no PII in client logs.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import {
  MISSION_CONFIGS,
  type MissionConfig,
  type MissionStep,
} from '@alfanumrik/lib/play/mission-configs';
import {
  deriveMissionProgress,
  type MissionProgressInputs,
} from '@alfanumrik/lib/play/mission-progress';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import type { MissionStepView } from '@alfanumrik/ui/play/MissionStepList';

const MissionCard = dynamic(
  () => import('@alfanumrik/ui/play/MissionCard').then((m) => m.default ?? m),
  { ssr: false },
);

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const EMPTY_INPUTS: MissionProgressInputs = {
  diveArtifacts: [],
  challengeAttempts: [],
  quizSessions: [],
  foxySessions: [],
};

function stepHref(step: MissionStep): string | undefined {
  switch (step.kind) {
    case 'concept':
      return '/quiz';
    case 'mystery':
      return '/dive';
    case 'experiment':
      return '/simulations';
    case 'teach_back':
      return '/foxy';
    default:
      return undefined;
  }
}

function stepLabel(step: MissionStep, isHi: boolean): { en: string; hi: string } {
  switch (step.kind) {
    case 'concept':
      return {
        en: `Concept · ${step.subject} · ch. ${step.chapterNumber}`,
        hi: `अवधारणा · ${step.subject} · अ. ${step.chapterNumber}`,
      };
    case 'mystery':
      return {
        en: `Mystery · ${step.phenomenonSlug}`,
        hi: `रहस्य · ${step.phenomenonSlug}`,
      };
    case 'experiment':
      return {
        en: `Experiment · quiz ch. ${step.followupQuizChapter}`,
        hi: `प्रयोग · क्विज़ अ. ${step.followupQuizChapter}`,
      };
    case 'teach_back':
      return {
        en: `Teach-back · ${step.foxyMode}`,
        hi: `पुनः शिक्षण · ${step.foxyMode}`,
      };
    default:
      return { en: 'Step', hi: 'चरण' };
  }
}

export default function MissionsPage() {
  const { isHi, isLoggedIn } = useAuth();

  const { data: inputs } = useSWR<MissionProgressInputs | null>(
    isLoggedIn ? '/api/play/mission-progress' : null,
    async (url: string) => {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      return res.json() as Promise<MissionProgressInputs>;
    },
    { refreshInterval: 60_000 },
  );

  const resolvedInputs = inputs ?? EMPTY_INPUTS;

  const missionViews = useMemo(
    () =>
      MISSION_CONFIGS.map((cfg) => {
        const prog = deriveMissionProgress(cfg, resolvedInputs);
        const steps: MissionStepView[] = cfg.steps.map((step, i) => {
          const label = stepLabel(step, isHi);
          const done = prog.steps[i]?.done ?? false;
          return {
            id: `${cfg.id}:${i}`,
            label: label.en,
            labelHi: label.hi,
            href: stepHref(step),
            status: done ? 'done' : 'todo',
          };
        });
        const completedSteps = steps.filter((s) => s.status === 'done').length;
        return {
          cfg,
          steps,
          completedSteps,
        };
      }),
    [resolvedInputs, isHi],
  );

  return (
    <main className="max-w-3xl mx-auto p-4 flex flex-col gap-4">
      <header>
        <h1
          className="text-2xl font-extrabold m-0 font-heading"
          style={{ color: 'var(--text-1)' }}
        >
          {t(isHi, 'Missions', 'मिशन')}
        </h1>
        <p className="text-sm mt-1 m-0" style={{ color: 'var(--text-3)' }}>
          {t(
            isHi,
            'Multi-step quests across concepts, mysteries, experiments and teach-backs.',
            'अवधारणाओं, रहस्यों, प्रयोगों और शिक्षण-वापसी की बहु-चरणीय खोज।',
          )}
        </p>
      </header>
      <SectionErrorBoundary section="Missions">
        <div className="flex flex-col gap-3">
          {missionViews.map(({ cfg, steps, completedSteps }) => (
            <MissionCard
              key={cfg.id}
              missionId={cfg.id}
              title={cfg.title}
              titleHi={cfg.titleHi}
              completedSteps={completedSteps}
              totalSteps={cfg.steps.length}
              steps={steps}
              isHi={isHi}
            />
          ))}
        </div>
      </SectionErrorBoundary>
    </main>
  );
}
