import type { CSSProperties } from 'react';
import type { ExperienceV3RootProps } from './types';
import { ExperiencePresenceRegistration } from './ExperiencePresence';

const ACCENTS: Record<ExperienceV3RootProps['role'], string> = {
  student: '#B94718',
  teacher: '#176D68',
  parent: '#76516C',
  'school-admin': '#50652B',
  'super-admin': '#403C38',
};

export function ExperienceV3Root({ role, children, className }: ExperienceV3RootProps) {
  return (
    <div
      data-experience="v3"
      data-v3-role={role}
      className={className}
      style={{ '--v3-role-accent': ACCENTS[role] } as CSSProperties}
    >
      <ExperiencePresenceRegistration />
      {children}
    </div>
  );
}
