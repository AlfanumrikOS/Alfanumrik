/**
 * Parent child-scope URL helpers.
 *
 * `childId` is a navigation hint only. Pages must resolve it against children
 * returned by an authenticated, guardian-scoped API before using it for data
 * access. Link-code sessions must pass their verified pinned child as the
 * fallback and must not accept a different URL value.
 */

export const PARENT_CHILD_ID_PARAM = 'childId';

type SearchParamsReader = Pick<URLSearchParams, 'get' | 'toString'>;

export interface ParentScopedChild {
  id: string;
}

export function readParentChildId(searchParams: Pick<SearchParamsReader, 'get'> | null | undefined): string | null {
  const value = searchParams?.get(PARENT_CHILD_ID_PARAM)?.trim();
  return value ? value : null;
}

export function withParentChildId(href: string, childId: string | null | undefined): string {
  if (!childId) return href;

  const [beforeHash, hash = ''] = href.split('#', 2);
  const [pathname, query = ''] = beforeHash.split('?', 2);
  const params = new URLSearchParams(query);
  params.set(PARENT_CHILD_ID_PARAM, childId);
  const serialized = params.toString();
  return `${pathname}${serialized ? `?${serialized}` : ''}${hash ? `#${hash}` : ''}`;
}

export function replaceParentChildId(
  pathname: string,
  searchParams: Pick<SearchParamsReader, 'toString'> | null | undefined,
  childId: string | null,
): string {
  const params = new URLSearchParams(searchParams?.toString() ?? '');
  if (childId) params.set(PARENT_CHILD_ID_PARAM, childId);
  else params.delete(PARENT_CHILD_ID_PARAM);
  const serialized = params.toString();
  return `${pathname}${serialized ? `?${serialized}` : ''}`;
}

/**
 * Resolve an URL-requested child only from an already-authorized linked list.
 * An unknown/foreign id never becomes active; the caller's verified fallback
 * (or the first linked child) wins instead.
 */
export function resolveLinkedChild<T extends ParentScopedChild>(
  children: readonly T[],
  requestedChildId: string | null | undefined,
  fallbackChildId?: string | null,
): T | null {
  if (requestedChildId) {
    const requested = children.find((child) => child.id === requestedChildId);
    if (requested) return requested;
  }

  if (fallbackChildId) {
    const fallback = children.find((child) => child.id === fallbackChildId);
    if (fallback) return fallback;
  }

  return children[0] ?? null;
}
