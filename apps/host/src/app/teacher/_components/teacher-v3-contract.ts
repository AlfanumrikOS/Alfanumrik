export function resolveTeacherClassScope(
  classes: ReadonlyArray<{ id: string }>,
  requestedClass: string | null,
  persistedClass: string | null,
): string | null {
  const allowed = new Set(classes.map((item) => item.id));
  if (requestedClass && allowed.has(requestedClass)) return requestedClass;
  if (persistedClass && allowed.has(persistedClass)) return persistedClass;
  return classes[0]?.id ?? null;
}

export function metricOrUnavailable(value: string | number | null | undefined, suffix = ''): string {
  return value == null ? '—' : `${value}${suffix}`;
}
