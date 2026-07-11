export type ExperienceRole = 'student' | 'teacher' | 'parent' | 'school-admin' | 'super-admin';
export type AuthRole = 'student' | 'teacher' | 'guardian' | 'institution_admin' | 'super_admin' | 'none';

export interface NavigationEntry {
  label: string;
  shortLabel?: string;
  href: string;
  capability: string;
  exact?: boolean;
  requiredPermission?: string;
  /** Any one permission may expose a grouped navigation destination. */
  requiredPermissions?: readonly string[];
}

export interface RoleManifest {
  role: ExperienceRole;
  homeHref: string;
  primary: NavigationEntry[];
  more: NavigationEntry[];
  desktop: NavigationEntry[];
}

export interface ResolvedCapabilities {
  role: ExperienceRole;
  capabilities: Readonly<Record<string, boolean>>;
  manifest: RoleManifest;
  canAccess: (capability: string) => boolean;
}

export interface TenantBranding {
  schoolName: string;
  logoUrl?: string;
  accent?: string;
  locale: 'en' | 'hi' | string;
  curriculum?: string;
  enabledModules: readonly string[];
}

export interface StudentScope {
  kind: 'student';
  learnerId: string;
  curriculum?: string;
  subjectId?: string;
  activePlanId?: string;
}

export interface TeacherScope {
  kind: 'teacher';
  schoolId: string;
  classId?: string;
  termId?: string;
  subjectId?: string;
}

export interface ParentScope {
  kind: 'parent';
  childId: string;
}

export interface SchoolScope {
  kind: 'school-admin';
  schoolId: string;
  academicYearId?: string;
  campusId?: string;
}

export interface SuperAdminScope {
  kind: 'super-admin';
  institutionId?: string;
  environment: 'production' | 'preview' | 'staging' | 'development';
  range?: string;
}

export type RoleScope = StudentScope | TeacherScope | ParentScope | SchoolScope | SuperAdminScope;
