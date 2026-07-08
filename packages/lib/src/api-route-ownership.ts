import { NextResponse } from 'next/server';
import { logger } from '@alfanumrik/lib/logger';

export interface DeprecatedRouteTelemetry {
  workflow: 'quiz' | 'parent' | 'ncert-solve' | 'ai-tutor' | 'cron';
  route: string;
  canonicalRoute: string;
  removalCondition: string;
  compatibilityType: 'compatibility' | 'internal-only' | 'deprecated';
}

export const DEPRECATION_SUNSET_DATE = '2026-09-30';

export function logDeprecatedRouteHit(meta: DeprecatedRouteTelemetry): void {
  logger.warn('api.deprecated_route.hit', {
    ...meta,
    sunsetDate: DEPRECATION_SUNSET_DATE,
    metric: 'api_deprecated_route_hit',
  });
}

export function withDeprecationHeaders<T>(
  response: NextResponse<T>,
  meta: Pick<DeprecatedRouteTelemetry, 'canonicalRoute' | 'compatibilityType'>,
): NextResponse<T> {
  response.headers.set('Deprecation', 'true');
  response.headers.set('Sunset', DEPRECATION_SUNSET_DATE);
  response.headers.set('Link', `<${meta.canonicalRoute}>; rel="successor-version"`);
  response.headers.set('X-Alfanumrik-Route-Status', meta.compatibilityType);
  return response;
}
