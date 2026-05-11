/**
 * Editorial Atlas — primitives barrel.
 *
 * Import surface for the redesigned student/parent/teacher/school pages.
 * Everything below is intended to be used together; one-off cherry-picks
 * (e.g. AtlasPill on a legacy surface) work fine but risk visual drift —
 * legacy pages should keep using the legacy primitives until they migrate.
 */

export { AtlasIcon, type AtlasIconName, type AtlasIconProps } from './AtlasIcon';
export { AtlasCard, type AtlasCardProps } from './AtlasCard';
export { AtlasPill, type AtlasPillProps } from './AtlasPill';
export { AtlasButton, type AtlasButtonProps } from './AtlasButton';
export { AtlasSpark, type AtlasSparkProps } from './AtlasSpark';
export { AtlasKpi, type AtlasKpiProps } from './AtlasKpi';
export { AtlasTrend, type AtlasTrendProps, type AtlasTrendPoint } from './AtlasTrend';
export { AtlasShell, type AtlasShellProps, type AtlasShellNavItem } from './AtlasShell';
export {
  EditorialHeadline,
  EditorialHighlight,
  type EditorialHeadlineProps,
} from './EditorialHeadline';
