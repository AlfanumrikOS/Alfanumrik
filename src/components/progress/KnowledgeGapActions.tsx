'use client';

import { useRouter } from 'next/navigation';
import { Card, Badge, Button, SectionHeader, EmptyState } from '@/components/ui';
import type { KnowledgeGap } from '@/lib/types';

/* ── Types ── */
interface KnowledgeGapActionsProps {
  gaps: KnowledgeGap[];
  isHi: boolean;
}

/* ── Severity helpers ── */
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function computeSeverity(confidenceScore: number | null): 'critical' | 'high' | 'medium' {
  const score = confidenceScore ?? 0;
  if (score > 0.7) return 'critical';
  if (score > 0.4) return 'high';
  return 'medium';
}

const SEVERITY_CONFIG: Record<string, { color: string; dot: string; label: string; labelHi: string }> = {
  critical: { color: '#DC2626', dot: '\u{1F534}', label: 'Critical', labelHi: 'गंभीर' },
  high:     { color: '#F59E0B', dot: '\u{1F7E1}', label: 'Moderate', labelHi: 'मध्यम' },
  medium:   { color: '#3B82F6', dot: '\u{1F535}', label: 'Minor', labelHi: 'छोटा' },
};

/* ── Component ── */
export default function KnowledgeGapActions({ gaps, isHi }: KnowledgeGapActionsProps) {
  const router = useRouter();

  // Enrich and sort gaps
  const enrichedGaps = gaps.map(g => ({
    ...g,
    severity: computeSeverity(g.confidence_score),
  }));

  const sortedGaps = [...enrichedGaps].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
  );

  const gapCount = sortedGaps.length;

  return (
    <div>
      <SectionHeader icon="&#128269;">
        {isHi
          ? `${gapCount} ज्ञान की कमियाँ पाई गईं`
          : `${gapCount} Knowledge Gap${gapCount !== 1 ? 's' : ''} Found`
        }
      </SectionHeader>

      {gapCount === 0 ? (
        <Card className="!p-4 text-center">
          <div className="text-2xl mb-1">&#10004;&#65039;</div>
          <div className="text-sm text-[var(--text-3)]">
            {isHi ? 'कोई ज्ञान की कमी नहीं मिली!' : 'No knowledge gaps detected!'}
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedGaps.map((gap) => {
            const cfg = SEVERITY_CONFIG[gap.severity] ?? SEVERITY_CONFIG.medium;
            const topicName = gap.topic_title ?? gap.target_concept_name;
            const missingName = gap.missing_prerequisite_name;

            return (
              <Card key={gap.id} className="!p-4">
                {/* Title row */}
                <div className="flex items-start gap-2 mb-2">
                  <span className="shrink-0 text-sm">{cfg.dot}</span>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-bold truncate">{topicName}</h4>
                    <p className="text-xs text-[var(--text-3)] mt-0.5">
                      {isHi ? `कमी: ${missingName}` : `Missing: ${missingName}`}
                    </p>
                  </div>
                  <Badge color={cfg.color} size="sm">
                    {isHi ? cfg.labelHi : cfg.label}
                  </Badge>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  <Button
                    variant="soft"
                    size="sm"
                    color="var(--orange)"
                    className="flex-1"
                    onClick={() =>
                      router.push(
                        `/foxy?topic=${encodeURIComponent(topicName)}&mode=learn`
                      )
                    }
                  >
                    {isHi ? 'फॉक्सी से सीखो' : 'Fix with Foxy'}
                  </Button>
                  <Button
                    variant="soft"
                    size="sm"
                    color="var(--purple)"
                    className="flex-1"
                    onClick={() =>
                      router.push(
                        `/quiz?topic=${encodeURIComponent(topicName)}`
                      )
                    }
                  >
                    {isHi ? 'क्विज़ दो' : 'Take Quiz'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
