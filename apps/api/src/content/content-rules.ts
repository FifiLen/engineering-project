import type { ContentRulesContext } from '@hulajnogi/core';
import { CONTENT_ICONS, isAllowedHref, parseMarkdown, type MarkdownProfile } from '@hulajnogi/shared';

/**
 * Zależności reguł treści w core (ADR 0062, ADR 0063): parser Markdown z profilem pola, reguła adresów i lista
 * ikon z packages/shared. Core nie zależy od shared, więc API przekazuje je jako argument.
 */
export const CONTENT_RULES: ContentRulesContext = {
  markdown: (source, profile) => parseMarkdown(source, profile as MarkdownProfile),
  isAllowedHref,
  icons: CONTENT_ICONS,
};
