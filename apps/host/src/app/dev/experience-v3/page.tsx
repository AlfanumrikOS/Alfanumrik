import { timingSafeEqual } from 'node:crypto';
import { notFound } from 'next/navigation';
import {
  ActionQueue,
  Button,
  ExperienceV3Root,
  MetricTrust,
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
  const isHi = params.locale === 'hi';
  const longCopy = params.copy === 'long';
  const manifest = getRoleManifest(role);
  const englishPreview = {
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
  const hindiPreview = {
    student: {
      context: 'कक्षा 8 · गणित · वर्तमान अनुकूली सीखने की योजना', eyebrow: 'आपके लिए अगला सबसे उपयोगी कदम',
      title: 'रैखिक समीकरणों की समझ को अगले स्तर तक जारी रखें', description: 'बारह मिनट का केंद्रित पाठ पूरा करें और फिर अपनी समझ जाँचने के लिए छोटा मास्टरी अभ्यास करें।',
      reason: 'आपके पिछले अभ्यास से पता चलता है कि आप एक-चरण वाले समीकरणों से दो-चरण वाले समीकरणों की ओर बढ़ने के लिए तैयार हैं।',
      queueTitle: 'आपकी व्यक्तिगत सीखने की योजना', first: 'कल की गलतफहमी का प्रमाण देखकर दोहराएँ', second: 'लगातार किए गए प्रयास को पहचानें और आगे बढ़ें',
    },
    teacher: {
      context: 'कक्षा 8बी · गणित · वर्तमान शैक्षणिक अवधि', eyebrow: 'आज ध्यान देने योग्य छात्र',
      title: 'तीन छात्रों को प्रमाण-आधारित हस्तक्षेप की आवश्यकता है', description: 'हाल के आकलित अभ्यास में इन छात्रों ने चिह्न बदलने से जुड़ी एक जैसी गलतफहमी दोहराई है।',
      reason: 'दो अलग अभ्यास सत्रों में एक ही गलतफहमी दिखाई दी, इसलिए सहायता देने से पहले साझा प्रमाण की समीक्षा करना उपयोगी है।',
      queueTitle: 'आज की शिक्षक कार्य-सूची', first: 'साझा गलतफहमी का विस्तृत प्रमाण देखें', second: 'छात्रों के लिए केंद्रित सुधार अभ्यास निर्धारित करें',
    },
    parent: {
      context: 'आरव · कक्षा 8 · इस सप्ताह की सीखने की स्थिति', eyebrow: 'इस सप्ताह की स्पष्ट स्थिति',
      title: 'आरव सही दिशा में आगे बढ़ रहा है', description: 'प्रयास लगातार बना हुआ है और दो प्राथमिक विषयों में आकलित मास्टरी में सुधार दिखाई दिया है।',
      reason: 'चार केंद्रित सीखने के सत्र और शिक्षक के नवीनतम प्रमाण से स्थिर प्रगति की पुष्टि होती है।',
      queueTitle: 'अभिभावक के रूप में आप क्या कर सकते हैं', first: 'आज के प्रयास के लिए प्रोत्साहित करें', second: 'आने वाली सीखने की योजना को साथ में देखें',
    },
    'school-admin': {
      context: 'अल्फ़ानुमरिक पब्लिक स्कूल · सभी उपलब्ध शैक्षणिक अवधियाँ', eyebrow: 'विद्यालय के अपवाद और प्राथमिकताएँ',
      title: 'दो छात्र समूहों को समन्वित हस्तक्षेप की आवश्यकता है', description: 'कक्षा 8 गणित और कक्षा 10 विज्ञान में नवीनतम आकलित मास्टरी सहमत सीमा से नीचे चली गई है।',
      reason: 'नवीनतम नियंत्रित आकलन प्रमाण ने विद्यालय की स्वीकृत हस्तक्षेप सीमा पार की है।',
      queueTitle: 'विद्यालय के प्राथमिक निर्णय', first: 'कक्षा 8 समूह का सहायक प्रमाण देखें', second: 'शिक्षक सहायता क्षमता की पुष्टि करें',
    },
    'super-admin': {
      context: 'उत्पादन वातावरण · सभी संस्थान · प्लेटफ़ॉर्म-व्यापी डेटा', eyebrow: 'प्लेटफ़ॉर्म संचालन आदेश',
      title: 'प्लेटफ़ॉर्म स्थिर है, लेकिन दो समस्याओं की समीक्षा आवश्यक है', description: 'सीखने की शुरुआत स्वस्थ है, जबकि एक संस्थान और एक बिलिंग प्रक्रिया में त्रुटियाँ सामान्य सीमा से अधिक हैं।',
      reason: 'पिछले तीस मिनट में दोनों संकेतों ने अपनी नियंत्रित संचालन सीमाएँ पार की हैं।',
      queueTitle: 'अधिकृत ऑपरेटर कार्य-सूची', first: 'संस्थान की एपीआई विफलताओं का प्रमाण देखें', second: 'बिलिंग पुनः-प्रयास की लंबित सूची की समीक्षा करें',
    },
  }[role];
  const preview = isHi ? hindiPreview : englishPreview;
  const expansion = isHi
    ? ' यह विस्तारित स्थानीयकृत पाठ छोटे फोन, बड़े अक्षर, सुरक्षित क्षेत्र और अलग-अलग ब्राउज़र आकारों पर सामग्री के पुनःप्रवाह की समीक्षा के लिए जानबूझकर लंबा रखा गया है।'
    : ' This deliberately expanded copy exercises reflow on small phones, large text, safe areas and different browser widths.';
  const pageTitle = isHi ? 'शांत बुद्धिमत्ता, अगले सही निर्णय पर केंद्रित' : 'Calm intelligence, focused on the next decision';
  const pageDescription = isHi
    ? 'यह कोड-आधारित पूर्वावलोकन उत्पादन के समान उत्तरदायी शेल, नियंत्रित घटकों और भूमिका-आधारित सूचना संरचना का उपयोग करता है।'
    : 'This code-backed preview uses the same responsive shell, governed components and role information architecture as production.';

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
        <div lang={isHi ? 'hi' : 'en'} data-testid="v3-preview-content" data-preview-locale={isHi ? 'hi' : 'en'} data-preview-copy={longCopy ? 'long' : 'standard'}>
          <div data-testid="preview-limitations"><Surface variant="sunken" padding="sm" className="mb-4">
            <p className="v3-muted" style={{ marginBottom: 0 }}>{isHi ? 'केवल अनधिकृत घटक और उत्तरदायी व्यवहार का पूर्वावलोकन—यह प्रमाणित लॉगिन, वास्तविक भूमिका डेटा, सहायक तकनीक या मैनुअल ब्राउज़र प्रमाणन का स्थान नहीं लेता।' : 'Unauthenticated component and responsive-behaviour preview only—this does not replace certified login, real role data, assistive-technology or manual browser testing.'}</p>
          </Surface></div>
          <PageHeader
            eyebrow={isHi ? 'वन एक्सपीरियंस पूर्वावलोकन' : 'One Experience preview'}
            title={pageTitle}
            description={`${pageDescription}${longCopy ? expansion : ''}`}
            metadata={<><StatusBadge tone="success">{isHi ? 'पूर्वावलोकन डेटा' : 'Preview data'}</StatusBadge><StatusBadge>{isHi ? 'अभी अपडेट किया गया' : 'Updated just now'}</StatusBadge></>}
          />
          <div style={{ display: 'grid', gap: '1rem' }}>
          <RecommendationCard
            accent={role}
            eyebrow={preview.eyebrow}
            title={preview.title}
            description={`${preview.description}${longCopy ? expansion : ''}`}
            reason={`${preview.reason}${longCopy ? expansion : ''}`}
            progress={62}
            primaryAction={{ label: 'Start next activity', href: manifest.homeHref }}
            secondaryAction={{ label: 'View the plan', href: manifest.homeHref }}
          />
          <Surface variant="raised" padding="lg">
            <ActionQueue
              title={preview.queueTitle}
              items={[
                { id: 'one', title: preview.first, description: isHi ? 'कार्रवाई से पहले सहायक प्रमाण खोलें और उसकी समीक्षा करें।' : 'Open the supporting evidence before taking action.', status: <StatusBadge tone="warning">{isHi ? 'प्राथमिक' : 'Priority'}</StatusBadge>, actionLabel: isHi ? 'समीक्षा' : 'Review', href: manifest.homeHref },
                { id: 'two', title: preview.second, description: isHi ? 'जब आप तैयार हों, अगला स्पष्ट कदम उपलब्ध है।' : 'A clear next step is ready when you are.', status: <StatusBadge tone="success">{isHi ? 'तैयार' : 'Ready'}</StatusBadge>, actionLabel: isHi ? 'खोलें' : 'Open', href: manifest.homeHref },
              ]}
            />
          </Surface>
          <Surface variant="raised" padding="sm">
            <div data-testid="preview-metric-trust">
              <strong>{isHi ? 'प्रमाणित निर्णय संकेत' : 'Governed decision signal'}</strong>
              <MetricTrust
                locale={isHi ? 'hi' : 'en'}
                source={isHi ? 'भूमिका-क्षेत्रित पूर्वावलोकन डेटा स्रोत' : 'Role-scoped preview data source'}
                definition={isHi ? 'यह जानबूझकर लंबी परिभाषा 320 पिक्सेल स्क्रीन पर डेटा विवरण के सुरक्षित पुनःप्रवाह को सत्यापित करती है।' : 'This deliberately long definition verifies safe data-detail wrapping at the 320-pixel viewport.'}
                freshness={null}
                estimated
              />
            </div>
          </Surface>
          </div>
        </div>
      </RoleShell>
    </ExperienceV3Root>
  );
}
