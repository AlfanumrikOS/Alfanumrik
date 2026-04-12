import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/school-config
 *
 * Returns the school branding config for the current subdomain.
 * The middleware injects x-school-* headers when a valid school
 * subdomain is detected. This endpoint reads those headers and
 * returns them as JSON for the client-side SchoolContext.
 *
 * No auth required — school branding is public information.
 * No authorizeRequest() needed — this is a read-only config endpoint
 * that only reflects headers already set by the middleware.
 */
export async function GET(request: NextRequest) {
  const schoolId = request.headers.get('x-school-id');

  if (!schoolId) {
    return NextResponse.json(
      { isSchoolContext: false },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=300',
        },
      }
    );
  }

  return NextResponse.json(
    {
      isSchoolContext: true,
      id: schoolId,
      name: decodeURIComponent(request.headers.get('x-school-name') || 'School'),
      slug: request.headers.get('x-school-slug') || '',
      logoUrl: request.headers.get('x-school-logo') || null,
      primaryColor: request.headers.get('x-school-primary-color') || '#7C3AED',
      secondaryColor: request.headers.get('x-school-secondary-color') || '#F97316',
    },
    {
      headers: {
        // Cache for 5 minutes — matches middleware school cache TTL
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    }
  );
}
