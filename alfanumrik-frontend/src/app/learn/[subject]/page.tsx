import LearnPageClient from './LearnPageClient';

export function generateStaticParams() {
  return [
    { subject: 'math' },
    { subject: 'science' },
    { subject: 'english' },
    { subject: 'hindi' },
    { subject: 'social_science' },
  ];
}

export default function LearnPage() {
  return <LearnPageClient />;
}
