import type { MediaRef } from '@hulajnogi/shared';
import { mediaSrc } from '../../lib/site/api';

/**
 * Grafika z biblioteki mediów zwykłym `<img>` z wymiarami (bez przesunięcia układu), leniwie i asynchronicznie;
 * hero dostaje `fetchPriority="high"` (ADR 0065). `next/image` odrzuciliśmy: grafiki są niezmienne i gotowe.
 */
export function MediaImage({
  media,
  className,
  priority,
}: {
  media: MediaRef;
  className?: string;
  priority?: boolean;
}) {
  return (
    <img
      src={mediaSrc(media.url)}
      alt={media.altText}
      width={media.width}
      height={media.height}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : undefined}
    />
  );
}
