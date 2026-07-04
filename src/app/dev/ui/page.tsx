'use client';

/* ═══════════════════════════════════════════════════════════════
   /dev/ui — canonical primitive showcase (Phase 2 Batch A)

   Dev-only visual review surface. NOT linked in nav. Renders every
   Batch-A primitive in all variants / sizes / tones / states so the
   design system can be reviewed at a glance. Responsive (375 → 1280).
   ═══════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import {
  Button,
  IconButton,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Badge,
  Chip,
  ProgressBar,
  ProgressRing,
  MasteryRing,
  Skeleton,
  SkeletonText,
  SkeletonCircle,
  EmptyState,
  type Tone,
  type ActionVariant,
  type ControlSize,
} from '@/components/ui/primitives';

const ACTION_VARIANTS: ActionVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const SIZES: ControlSize[] = ['sm', 'md', 'lg'];
const TONES: Tone[] = ['neutral', 'success', 'warning', 'danger', 'info', 'brand'];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-fluid-2xl font-bold text-foreground">{title}</h2>
        {note && <p className="mt-1 text-fluid-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-surface-3 pb-4 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-28 shrink-0 text-fluid-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export default function UiShowcasePage() {
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set(['success']));
  const toggleChip = (k: string) =>
    setSelectedChips((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <main className="min-h-dvh" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10 sm:px-6">
        <header>
          <p className="text-fluid-xs font-semibold uppercase tracking-widest text-muted-foreground">Dev · not in nav</p>
          <h1 className="mt-1 text-fluid-4xl font-bold text-foreground">Canonical UI Primitives</h1>
          <p className="mt-2 text-fluid-md text-muted-foreground">
            Phase 2 Batch A. Token-driven, accessible, bilingual-safe.
            <span lang="hi" className="ml-2">प्रीमियम घटक</span>
          </p>
        </header>

        {/* ── Button ── */}
        <Section title="Button" note="variants × sizes; loading, disabled, icons, full-width">
          {ACTION_VARIANTS.map((v) => (
            <Row key={v} label={v}>
              {SIZES.map((s) => (
                <Button key={s} variant={v} size={s}>
                  {s.toUpperCase()}
                </Button>
              ))}
              <Button variant={v} loading>Loading</Button>
              <Button variant={v} disabled>Disabled</Button>
            </Row>
          ))}
          <Row label="icons">
            <Button leadingIcon={<span>✦</span>}>Leading</Button>
            <Button variant="secondary" trailingIcon={<span>→</span>}>Trailing</Button>
          </Row>
          <Row label="full-width">
            <div className="w-full max-w-sm">
              <Button fullWidth leadingIcon={<span>▶</span>}>Full width primary</Button>
            </div>
          </Row>
        </Section>

        {/* ── IconButton ── */}
        <Section title="IconButton" note="square, aria-label required">
          {ACTION_VARIANTS.map((v) => (
            <Row key={v} label={v}>
              {SIZES.map((s) => (
                <IconButton key={s} variant={v} size={s} label={`${v} ${s}`} icon={<span>★</span>} />
              ))}
              <IconButton variant={v} label="loading" loading icon={<span>★</span>} />
              <IconButton variant={v} label="disabled" disabled icon={<span>★</span>} />
            </Row>
          ))}
        </Section>

        {/* ── Card ── */}
        <Section title="Card" note="flat / elevated / interactive + header/body/footer slots">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card variant="flat">
              <CardBody>
                <h3 className="text-fluid-md font-bold text-foreground">Flat</h3>
                <p className="mt-1 text-fluid-sm text-muted-foreground">Hairline border, no shadow.</p>
              </CardBody>
            </Card>
            <Card variant="elevated">
              <CardHeader>
                <h3 className="text-fluid-md font-bold text-foreground">Elevated</h3>
              </CardHeader>
              <CardBody>
                <p className="text-fluid-sm text-muted-foreground">Soft elevation shadow. Header + body + footer.</p>
              </CardBody>
              <CardFooter>
                <Button size="sm" variant="secondary">Action</Button>
              </CardFooter>
            </Card>
            <Card variant="interactive" onClick={() => { /* demo */ }}>
              <CardBody>
                <h3 className="text-fluid-md font-bold text-foreground">Interactive</h3>
                <p className="mt-1 text-fluid-sm text-muted-foreground">
                  Keyboard-focusable, hover lift, press feedback. Tab to me.
                </p>
              </CardBody>
            </Card>
          </div>
        </Section>

        {/* ── Badge ── */}
        <Section title="Badge" note="soft & solid × tones; AA text on every tone">
          <Row label="soft">
            {TONES.map((t) => (
              <Badge key={t} tone={t} variant="soft">{t}</Badge>
            ))}
          </Row>
          <Row label="solid">
            {TONES.map((t) => (
              <Badge key={t} tone={t} variant="solid">{t}</Badge>
            ))}
          </Row>
          <Row label="with icon">
            <Badge tone="success" variant="soft" icon={<span>✓</span>}>Verified</Badge>
            <Badge tone="warning" variant="solid" icon={<span>◐</span>}>Check</Badge>
          </Row>
        </Section>

        {/* ── Chip ── */}
        <Section title="Chip" note="selectable filter chip; aria-pressed carries state (not colour only)">
          <Row label="filters">
            {TONES.map((t) => (
              <Chip
                key={t}
                tone={t}
                selected={selectedChips.has(t)}
                onClick={() => toggleChip(t)}
                icon={selectedChips.has(t) ? <span>✓</span> : undefined}
              >
                {t}
              </Chip>
            ))}
          </Row>
          <Row label="disabled">
            <Chip disabled>Disabled</Chip>
            <Chip selected disabled>Selected disabled</Chip>
          </Row>
        </Section>

        {/* ── ProgressBar ── */}
        <Section title="ProgressBar" note="determinate, tone-aware, role=progressbar">
          <div className="flex max-w-md flex-col gap-4">
            <ProgressBar value={25} tone="danger" label="Chapter 1" showValue />
            <ProgressBar value={60} tone="warning" label="Chapter 2" showValue />
            <ProgressBar value={90} tone="success" label="Chapter 3" showValue />
            <ProgressBar value={45} tone="brand" size="sm" ariaLabel="Overall progress" />
          </div>
        </Section>

        {/* ── ProgressRing / MasteryRing ── */}
        <Section title="ProgressRing / MasteryRing" note="MasteryRing bands carry a required icon + label (deuteranopia-safe)">
          <Row label="progress">
            <ProgressRing value={72} tone="brand" />
            <ProgressRing value={40} tone="info" />
            <ProgressRing value={92} tone="success" size={88} strokeWidth={8}>
              <span className="text-fluid-xs font-bold text-foreground">A+</span>
            </ProgressRing>
          </Row>
          <Row label="mastery">
            <MasteryRing value={28} />
            <MasteryRing value={55} />
            <MasteryRing value={81} />
            <MasteryRing value={55} bandLabel={(k) => (k === 'mid' ? 'विकसित हो रहा' : undefined)} />
          </Row>
        </Section>

        {/* ── Skeleton ── */}
        <Section title="Skeleton" note="composable: Skeleton / SkeletonText / SkeletonCircle; no shimmer under reduced-motion">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card variant="flat">
              <CardBody>
                <div className="flex items-center gap-3">
                  <SkeletonCircle size="md" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-2 h-3 w-20" radius="sm" />
                  </div>
                </div>
                <SkeletonText lines={3} className="mt-4" />
              </CardBody>
            </Card>
            <Card variant="flat">
              <CardBody className="flex flex-col gap-3">
                <Skeleton className="h-24 w-full" radius="lg" />
                <SkeletonText lines={2} />
              </CardBody>
            </Card>
          </div>
        </Section>

        {/* ── EmptyState ── */}
        <Section title="EmptyState" note="icon + title + description + optional action; role=status">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card variant="flat">
              <EmptyState
                icon={<span>🦊</span>}
                title="No quizzes yet"
                description="Finish a chapter to unlock your first practice set."
                action={<Button size="sm">Start learning</Button>}
              />
            </Card>
            <Card variant="flat">
              <EmptyState compact icon={<span>📭</span>} title="Inbox zero" description="No new notifications." />
            </Card>
          </div>
        </Section>
      </div>
    </main>
  );
}
