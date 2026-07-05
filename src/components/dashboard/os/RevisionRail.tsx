'use client';

/**
 * RevisionRail — the glanceable spaced-repetition status of the Alfa OS
 * dashboard (ff_student_os_v1).
 *
 * Phase 3b rebuild: this is now a READ-ONLY glance — a Card with a due-count
 * Badge and a one-line status. The full review CTA (<ReviewsDueCard>) has been
 * DEMOTED behind the "More ways to study" disclosure in StudentOSDashboard, so
 * the above-the-fold surface keeps a single primary action.
 *
 * No new data contracts — the glance still reads `useReviewCards` only for a
 * count. Bilingual via isHi (P7). Presentation only.
 */

import { useReviewCards } from '@/lib/swr';
import { Card, Badge, Skeleton } from '@/components/ui/primitives';

interface RevisionRailProps {
  isHi: boolean;
  studentId: string | undefined;
}

export default function RevisionRail({ isHi, studentId }: RevisionRailProps) {
  const { data: reviewCards, isLoading, error } = useReviewCards(studentId, 20);
  const dueCount = Array.isArray(reviewCards) ? reviewCards.length : 0;

  return (
    <Card
      variant="flat"
      className="os-reveal-card px-5 py-4"
      style={{ ['--reveal-i' as string]: '3' }}
      aria-label={isHi ? 'दोहराव' : 'Revision'}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-fluid-xs font-bold uppercase tracking-wide text-muted-foreground">
          {isHi ? 'दोहराव' : 'Revision'}
        </h2>
        {dueCount > 0 && (
          <Badge tone="info" variant="soft" icon={<span>↻</span>} className="tabular-nums">
            {dueCount}
          </Badge>
        )}
      </div>

      {isLoading && !reviewCards ? (
        <Skeleton className="h-3 w-3/4" />
      ) : error ? (
        <p className="text-fluid-sm text-muted-foreground" role="status">
          {isHi
            ? 'अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
            : "Couldn't load right now — pull to refresh."}
        </p>
      ) : dueCount > 0 ? (
        <p className="text-fluid-sm text-muted-foreground">
          {isHi
            ? `${dueCount} विषय दोहराने को तैयार — नीचे "पढ़ाई के और तरीके" में शुरू करो।`
            : `${dueCount} topics ready to review — start from "More ways to study" below.`}
        </p>
      ) : (
        <p className="text-fluid-sm text-muted-foreground">
          {isHi
            ? 'अभी कोई दोहराव बाकी नहीं — बढ़िया! नए पाठ पर ध्यान दो।'
            : 'Nothing due right now — nice work. Focus on a fresh lesson.'}
        </p>
      )}
    </Card>
  );
}
