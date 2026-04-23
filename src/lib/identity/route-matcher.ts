export type IdentityRoute =
  | 'resolve'
  | 'profile'
  | 'sessions'
  | 'validate-session'
  | 'permissions'
  | 'onboarding-status'
  | 'not-found';

export function matchIdentityRoute(method: string, path: string): IdentityRoute {
  if (method === 'POST' && path === '/resolve') return 'resolve';
  if (method === 'GET' && /^\/profile\/[^/]+$/.test(path)) return 'profile';
  if (method === 'GET' && path === '/sessions') return 'sessions';
  if (method === 'POST' && path === '/sessions/validate') return 'validate-session';
  if (method === 'GET' && path === '/permissions') return 'permissions';
  if (method === 'GET' && path === '/onboarding-status') return 'onboarding-status';
  return 'not-found';
}
