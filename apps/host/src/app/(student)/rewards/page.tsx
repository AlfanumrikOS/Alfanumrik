import { redirect } from 'next/navigation';

/**
 * Backward-compatible redirect.
 *
 * `/rewards` was consolidated into `/leaderboard` (the rewards surface now lives
 * on the leaderboard page). Previously this route re-exported the leaderboard
 * page component, which served leaderboard content at the `/rewards` URL. We now
 * issue a real server-side redirect so any existing bookmarks / deep links to
 * `/rewards` resolve to the canonical `/leaderboard` URL instead of rendering a
 * duplicate surface.
 */
export default function RewardsRedirect() {
  redirect('/leaderboard');
}
