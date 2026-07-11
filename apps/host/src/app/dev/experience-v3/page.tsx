import { timingSafeEqual } from 'node:crypto';
import { notFound } from 'next/navigation';
import {
  ActionQueue,
  Button,
  ExperienceV3Root,
  PageHeader,
  RecommendationCard,
  RoleShell,
  StatusBadge,
  Surface,
  type RoleId,
} from '@alfanumrik/ui/v3';
import { getRoleManifest } from '@alfanumrik/lib/experience-v3';

export const dynamic = 'force-dynamic';

function exactMatch(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function ExperienceV3Preview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // This route is deliberately absent from every production build/runtime,
  // regardless of code. Preview credentials must never create a public
  // production design gallery.
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') notFound();

  const params = await searchParams;
  const receivedCode = typeof params.code === 'string' ? params.code : '';
  const expectedCode = process.env.EXPERIENCE_V3_PREVIEW_CODE || '';
  if (!expectedCode || !exactMatch(receivedCode, expectedCode)) notFound();

  const candidate = typeof params.role === 'string' ? params.role : 'student';
  const role: RoleId = ['student', 'teacher', 'parent', 'school-admin', 'super-admin'].includes(candidate)
    ? candidate as RoleId
    : 'student';
  const manifest = getRoleManifest(role);
  const preview = {
    student: {
      context: 'Class 8 · Mathematics', eyebrow: 'Your next best action',
      title: 'Continue with linear equations', description: 'A focused 12-minute lesson followed by a short mastery check.',
      reason: 'Your last practice showed you are ready to move from one-step to two-step equations.',
      queueTitle: 'Your learning plan', first: 'Review yesterday’s misconception', second: 'Celebrate consistent effort',
    },
    teacher: {
      context: 'Class 8B · Mathematics', eyebrow: 'Attention queue',
      title: 'Three students need an intervention', description: 'Their recent evidence points to the same sign-change misconception.',
      reason: 'This group has repeated the misconception across two practice sessions.',
      queueTitle: 'Needs attention today', first: 'Inspect the shared misconception', second: 'Assign a focused recovery set',
    },
    parent: {
      context: 'Aarav · Class 8', eyebrow: 'This week',
      title: 'Aarav is on track', description: 'Effort is consistent and mastery improved in two priority topics.',
      reason: 'Four focused sessions and the latest teacher evidence show steady progress.',
      queueTitle: 'What you can do', first: 'Encourage today’s effort', second: 'Review the upcoming plan',
    },
    'school-admin': {
      context: 'Alfanumrik Public School · 2026–27', eyebrow: 'School exceptions',
      title: 'Two cohorts need intervention', description: 'Class 8 Mathematics and Class 10 Science moved below the agreed mastery range.',
      reason: 'The latest governed assessment evidence crossed the intervention threshold.',
      queueTitle: 'Priority decisions', first: 'Review the Class 8 cohort', second: 'Confirm teacher support capacity',
    },
    'super-admin': {
      context: 'Production · All institutions', eyebrow: 'Platform command',
      title: 'Platform is stable; two issues need review', description: 'Learning starts are healthy while one institution and one billing workflow show elevated errors.',
      reason: 'The issues crossed their governed operating thresholds in the last 30 minutes.',
      queueTitle: 'Operator queue', first: 'Inspect institution API failures', second: 'Review the billing retry backlog',
    },
  }[role];

  return (
    <ExperienceV3Root role={role}>
      <RoleShell
        role={role}
        navigation={manifest.desktop}
        mobileMoreItems={manifest.more}
        brand={{ name: 'Alfanumrik' }}
        context={<StatusBadge tone="role">{preview.context}</StatusBadge>}
        headerActions={<Button variant="secondary" size="sm">Notifications</Button>}
      >
        <PageHeader
          eyebrow="One Experience preview"
          title="Calm intelligence, focused on the next decision"
          description="This code-backed preview uses the same responsive shell, governed components and role information architecture as production."
          metadata={<><StatusBadge tone="success">Live data</StatusBadge><StatusBadge>Updated just now</StatusBadge></>}
        />
        <div style={{ display: 'grid', gap: '1rem' }}>
          <RecommendationCard
            accent={role}
            eyebrow={preview.eyebrow}
            title={preview.title}
            description={preview.description}
            reason={preview.reason}
            progress={62}
            primaryAction={{ label: 'Start next activity', href: manifest.homeHref }}
            secondaryAction={{ label: 'View the plan', href: manifest.homeHref }}
          />
          <Surface variant="raised" padding="lg">
            <ActionQueue
              title={preview.queueTitle}
              items={[
                { id: 'one', title: preview.first, description: 'Open the supporting evidence before taking action.', status: <StatusBadge tone="warning">Priority</StatusBadge>, actionLabel: 'Review', href: manifest.homeHref },
                { id: 'two', title: preview.second, description: 'A clear next step is ready when you are.', status: <StatusBadge tone="success">Ready</StatusBadge>, actionLabel: 'Open', href: manifest.homeHref },
              ]}
            />
          </Surface>
        </div>
      </RoleShell>
    </ExperienceV3Root>
  );
}
