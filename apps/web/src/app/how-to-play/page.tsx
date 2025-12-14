import { HowToPlayView } from '@/components/how-to-play/how-to-play-view';

/**
 * `/how-to-play` (game-design.md §2): a Server Component wrapper so
 * the `?from=` query param — where Skip/finish should return to (home, a lobby, a room's
 * join gate) — comes in as a plain server-read prop rather than the client
 * `useSearchParams()` hook, which would otherwise force this whole route out of static
 * rendering behind a Suspense boundary for no real benefit here.
 */
export default async function HowToPlayPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return <HowToPlayView from={from ?? null} />;
}
