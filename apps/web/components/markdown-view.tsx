/**
 * Treść Markdown jako elementy React (ADR 0063): drzewo węzłów z `parseMarkdown` z `@hulajnogi/shared`, bez HTML
 * i bez `dangerouslySetInnerHTML`. Ten sam komponent renderuje stronę (komponent serwerowy) i podgląd w panelu
 * (komponent kliencki), więc nie używa stanu ani efektów. Adres `https:` otwiera nową kartę, ścieżka idzie przez
 * `next/link`, a `mailto:`, `tel:` i kotwice są zwykłymi odnośnikami. Adres spoza białej listy parser już odrzucił;
 * sprawdzamy go jeszcze raz, bo drzewo może pochodzić z innego źródła.
 */
import {
  isAllowedHref,
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownProfile,
} from '@hulajnogi/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

function Inline({ nodes }: { nodes: readonly MarkdownInline[] }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'strong':
        return (
          <strong key={i}>
            <Inline nodes={node.children} />
          </strong>
        );
      case 'emphasis':
        return (
          <em key={i}>
            <Inline nodes={node.children} />
          </em>
        );
      case 'link': {
        const children = <Inline nodes={node.children} />;
        if (!isAllowedHref(node.href)) return <span key={i}>{children}</span>;
        if (node.href.startsWith('https:'))
          return (
            <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        if (node.href.startsWith('/'))
          return (
            <Link key={i} href={node.href}>
              {children}
            </Link>
          );
        return (
          <a key={i} href={node.href}>
            {children}
          </a>
        );
      }
    }
  });
}

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case 'heading':
      return block.level === 2 ? (
        <h2 id={block.id}>
          <Inline nodes={block.children} />
        </h2>
      ) : (
        <h3 id={block.id}>
          <Inline nodes={block.children} />
        </h3>
      );
    case 'paragraph':
      return (
        <p>
          <Inline nodes={block.children} />
        </p>
      );
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <Inline nodes={item} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
  }
}

interface MarkdownViewProps {
  /** Źródło Markdown z profilem pola; zamiast niego można podać gotowe drzewo (`blocks`). */
  source?: string | null;
  profile?: MarkdownProfile;
  blocks?: readonly MarkdownBlock[];
  className?: string;
}

export function MarkdownView({ source, profile = 'document', blocks, className }: MarkdownViewProps) {
  const tree = blocks ?? (source ? parseMarkdown(source, profile).blocks : []);
  return (
    <div className={className}>
      {tree.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

/** Treść jednego akapitu bez opakowania (tytuły i krótkie opisy w sekcjach strony). */
export function MarkdownInlineView({
  source,
  profile = 'inline',
}: {
  source: string | null | undefined;
  profile?: MarkdownProfile;
}) {
  if (!source) return null;
  const tree = parseMarkdown(source, profile).blocks;
  return tree.map((block, i) =>
    block.type === 'paragraph' ? (
      <span key={i}>
        {i > 0 && ' '}
        <Inline nodes={block.children} />
      </span>
    ) : (
      <Block key={i} block={block} />
    ),
  );
}
