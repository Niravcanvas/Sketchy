import Link from 'next/link';
import { IconArrowLeft } from '@/components/icons/icon-arrow-left';
import { copy } from '@/copy';

export function NavBackButton({ href, label = copy.howToPlay.nav.back }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className="absolute left-4 top-4 z-10 flex h-10 items-center justify-center rounded-full border-3 border-ink bg-paper-2 px-3 shadow-hard-sm transition-transform duration-150 hover:-translate-y-0.5 sm:left-8 sm:top-8 md:px-4"
      aria-label={label}
    >
      <IconArrowLeft className="h-5 w-5 text-ink" />
      <span className="hidden ml-1 font-display text-sm font-bold uppercase tracking-wide text-ink md:inline">
        {label}
      </span>
    </Link>
  );
}
