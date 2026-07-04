'use client';

/* ═══════════════════════════════════════════════════════════════
   /dev/ui — canonical primitive showcase (Phase 2 Batch A)

   Dev-only visual review surface. NOT linked in nav. Renders every
   Batch-A primitive in all variants / sizes / tones / states so the
   design system can be reviewed at a glance. Responsive (375 → 1280).
   ═══════════════════════════════════════════════════════════════ */

import { useRef, useState } from 'react';
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
  Field,
  Input,
  Textarea,
  Select,
  Checkbox,
  Radio,
  RadioGroup,
  Switch,
  Dialog,
  DialogTitle,
  DialogBody,
  DialogFooter,
  ConfirmDialog,
  Drawer,
  BottomSheet,
  Tooltip,
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

function OverlaysSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dialogPrimaryRef = useRef<HTMLButtonElement>(null);

  return (
    <Section
      title="Overlays (Batch B2)"
      note="Portal + focus-trap + scroll-lock + scrim foundation. Open one and Tab — focus is trapped; close and focus returns to the trigger button."
    >
      <Row label="Dialog">
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          initialFocusRef={dialogPrimaryRef}
        >
          <DialogTitle>Enable exam mode?</DialogTitle>
          <DialogBody>
            Exam mode counts down and disables hints. Focus is trapped in this
            dialog — Tab cycles the two buttons only. Press Escape or click the
            scrim to dismiss.
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button ref={dialogPrimaryRef} onClick={() => setDialogOpen(false)}>
              Start exam
            </Button>
          </DialogFooter>
        </Dialog>
      </Row>

      <Row label="Confirm">
        <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
          Confirm action
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onConfirm={() => setConfirmOpen(false)}
          title="Submit quiz?"
          description="You have 2 unanswered questions. Submit anyway?"
          confirmLabel="Submit"
          cancelLabel="Keep going"
        />

        <Button variant="danger" onClick={() => setDestructiveOpen(true)}>
          Delete (destructive)
        </Button>
        <ConfirmDialog
          open={destructiveOpen}
          onClose={() => setDestructiveOpen(false)}
          onConfirm={() => {
            setDeleting(true);
            setTimeout(() => {
              setDeleting(false);
              setDestructiveOpen(false);
            }, 900);
          }}
          title="Delete this class?"
          description="This permanently removes the class and all enrollments. Destructive confirms disable Escape + scrim close, so you must choose explicitly."
          confirmLabel="Delete class"
          cancelLabel="Cancel"
          destructive
          loading={deleting}
        />
      </Row>

      <Row label="Drawer">
        <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
          Open drawer (right)
        </Button>
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Filters"
          description="Refine the leaderboard."
          closeLabel="Close filters"
          footer={
            <Button fullWidth onClick={() => setDrawerOpen(false)}>
              Apply
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <RadioGroup
              name="drawer-grade"
              label="Grade"
              defaultValue="9"
              options={[
                { value: '6', label: 'Grade 6' },
                { value: '9', label: 'Grade 9' },
                { value: '12', label: 'Grade 12' },
              ]}
            />
            <Switch label="Only my class" />
          </div>
        </Drawer>
      </Row>

      <Row label="Bottom sheet">
        <Button variant="secondary" onClick={() => setSheetOpen(true)}>
          Open bottom sheet
        </Button>
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Quick actions"
          description="Drag the handle down to dismiss (touch), or use the handle button / Escape."
          handleLabel="Close sheet"
          footer={
            <Button fullWidth onClick={() => setSheetOpen(false)}>
              Done
            </Button>
          }
        >
          <ul className="flex flex-col gap-2">
            {['Share progress', 'Download report', 'Report an issue'].map((item) => (
              <li key={item}>
                <Button variant="ghost" fullWidth onClick={() => setSheetOpen(false)}>
                  {item}
                </Button>
              </li>
            ))}
          </ul>
        </BottomSheet>
      </Row>

      <Row label="Tooltip">
        <Tooltip content="Experience points earned today" side="top">
          <Button variant="secondary">Hover / focus me (top)</Button>
        </Tooltip>
        <Tooltip content="Opens on keyboard focus too" side="bottom">
          <Button variant="ghost">Tab to me (bottom)</Button>
        </Tooltip>
        <Tooltip content="Tap shows, tap-away hides" side="right">
          <IconButton
            label="Info"
            variant="secondary"
            icon={<span aria-hidden="true" className="font-bold">i</span>}
          />
        </Tooltip>
      </Row>
    </Section>
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

  // Forms — controlled demo state
  const [difficulty, setDifficulty] = useState('medium');
  const [notify, setNotify] = useState(true);
  const [agree, setAgree] = useState(false);

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

        {/* ══════════════════════════════════════════════════════════
            FORM PRIMITIVES (Batch B1)
            ══════════════════════════════════════════════════════════ */}
        <div className="border-t border-surface-3 pt-8">
          <p className="text-fluid-xs font-semibold uppercase tracking-widest text-muted-foreground">Batch B1</p>
          <h2 className="mt-1 text-fluid-3xl font-bold text-foreground">Form Primitives</h2>
          <p className="mt-2 text-fluid-md text-muted-foreground">
            Field wires label + hint + error + aria automatically. Every control is native under the hood.
          </p>
        </div>

        {/* ── Input ── */}
        <Section title="Input" note="Field auto-wires id / aria-describedby / aria-invalid; default · filled · hint · error · disabled · required · adornments">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input placeholder="e.g. Aarav Sharma" />
            </Field>
            <Field label="Email" hint="We never share your email.">
              <Input type="email" defaultValue="aarav@example.com" />
            </Field>
            <Field label="School code" required requiredText="required">
              <Input placeholder="6-digit code" inputMode="numeric" />
            </Field>
            <Field label="Password" error="At least 8 characters.">
              <Input type="password" defaultValue="abc" />
            </Field>
            <Field label="Disabled" disabled>
              <Input placeholder="Not editable" />
            </Field>
            <Field label="Weight" hint="Metric.">
              <Input type="number" trailingAdornment="kg" defaultValue={42} />
            </Field>
            <Field label="Search">
              <Input type="search" leadingAdornment={<span>🔍</span>} placeholder="Find a chapter" />
            </Field>
            <Field label="Sizes">
              <div className="flex flex-col gap-2">
                <Input size="sm" placeholder="sm" />
                <Input size="md" placeholder="md (48px)" />
                <Input size="lg" placeholder="lg" />
              </div>
            </Field>
          </div>
        </Section>

        {/* ── Textarea ── */}
        <Section title="Textarea" note="min-rows, vertical-only resize, error state">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Feedback" hint="Tell us what could be better.">
              <Textarea placeholder="Your answer…" minRows={3} />
            </Field>
            <Field label="Explanation" required error="This field is required.">
              <Textarea minRows={4} />
            </Field>
          </div>
        </Section>

        {/* ── Select ── */}
        <Section title="Select" note="native select + token chevron; placeholder option; error state">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Subject" hint="Pick one to start.">
              <Select
                placeholder="Choose a subject…"
                options={[
                  { value: 'math', label: 'Mathematics' },
                  { value: 'sci', label: 'Science' },
                  { value: 'sst', label: 'Social Science' },
                ]}
              />
            </Field>
            <Field label="Grade" required error="Please select your grade.">
              <Select placeholder="Select grade…">
                <option value="6">Grade 6</option>
                <option value="7">Grade 7</option>
                <option value="8">Grade 8</option>
              </Select>
            </Field>
            <Field label="Disabled" disabled>
              <Select placeholder="Unavailable" />
            </Field>
          </div>
        </Section>

        {/* ── Checkbox ── */}
        <Section title="Checkbox" note="44px hit area, indeterminate, hint/error, disabled">
          <div className="flex flex-col gap-2">
            <Checkbox label="Email me weekly progress reports" defaultChecked />
            <Checkbox label="Enable practice reminders" hint="A gentle nudge each evening." />
            <Checkbox label="Select all chapters" indeterminate />
            <Checkbox label="I agree to the terms" error="You must accept to continue." />
            <Checkbox label="Unavailable option" disabled />
          </div>
        </Section>

        {/* ── Radio / RadioGroup ── */}
        <Section title="Radio / RadioGroup" note="fieldset + legend grouping; native roving focus; vertical & horizontal">
          <div className="grid gap-6 sm:grid-cols-2">
            <RadioGroup
              name="difficulty"
              label="Difficulty"
              hint="You can change this any time."
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: 'easy', label: 'Easy' },
                { value: 'medium', label: 'Medium' },
                { value: 'hard', label: 'Hard' },
              ]}
            />
            <RadioGroup
              name="mode"
              label="Mode"
              required
              orientation="horizontal"
              error="Choose a mode to begin."
              options={[
                { value: 'practice', label: 'Practice' },
                { value: 'exam', label: 'Exam' },
                { value: 'timed', label: 'Timed', disabled: true },
              ]}
            />
          </div>
        </Section>

        {/* ── Switch ── */}
        <Section title="Switch" note="role=switch, native checkbox, reduced-motion thumb travel">
          <div className="flex flex-col gap-2">
            <Switch label="Sound effects" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <Switch label="Dark mode (CEO-gated)" disabled />
            <Switch label="Label first" labelPosition="start" defaultChecked />
          </div>
        </Section>

        {/* ── Realistic sample form ── */}
        <Section title="Sample form" note="Field composition end-to-end — labels, hints, required, submit">
          <Card variant="elevated" className="max-w-md">
            <CardHeader>
              <h3 className="text-fluid-lg font-bold text-foreground">Create your profile</h3>
            </CardHeader>
            <CardBody>
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => e.preventDefault()}
              >
                <Field label="Display name" required>
                  <Input placeholder="What should Foxy call you?" />
                </Field>
                <Field label="Grade" required hint="CBSE grades 6–12.">
                  <Select
                    placeholder="Select grade…"
                    options={[
                      { value: '6', label: 'Grade 6' },
                      { value: '9', label: 'Grade 9' },
                      { value: '12', label: 'Grade 12' },
                    ]}
                  />
                </Field>
                <Field label="Learning goal" optional optionalText="(optional)">
                  <Textarea minRows={2} placeholder="e.g. Ace my board exams" />
                </Field>
                <Checkbox
                  label="I agree to the terms & privacy policy"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                />
                <Button type="submit" fullWidth disabled={!agree}>
                  Create profile
                </Button>
              </form>
            </CardBody>
          </Card>
        </Section>

        {/* ── Hindi / Devanagari wiring proof ── */}
        <Section title="Bilingual (Hindi)" note="lang='hi' — proves Devanagari renders + label/hint/error wiring is copy-agnostic (P7)">
          <Card variant="flat" lang="hi" className="max-w-md">
            <CardBody className="flex flex-col gap-4">
              <Field label="पूरा नाम" required requiredText="आवश्यक" hint="अपना नाम हिंदी या अंग्रेज़ी में लिखें।">
                <Input placeholder="जैसे: आरव शर्मा" />
              </Field>
              <Field label="कक्षा" required error="कृपया अपनी कक्षा चुनें।">
                <Select
                  placeholder="कक्षा चुनें…"
                  options={[
                    { value: '6', label: 'कक्षा 6' },
                    { value: '9', label: 'कक्षा 9' },
                    { value: '12', label: 'कक्षा 12' },
                  ]}
                />
              </Field>
              <RadioGroup
                name="hi-difficulty"
                label="कठिनाई स्तर"
                defaultValue="medium"
                options={[
                  { value: 'easy', label: 'आसान' },
                  { value: 'medium', label: 'मध्यम' },
                  { value: 'hard', label: 'कठिन' },
                ]}
              />
              <Switch label="ध्वनि प्रभाव चालू करें" defaultChecked />
            </CardBody>
          </Card>
        </Section>

        <OverlaysSection />
      </div>
    </main>
  );
}
