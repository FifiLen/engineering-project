import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_HREF_PATTERN,
  createSlugger,
  headingId,
  hrefHint,
  inlineText,
  isAllowedHref,
  markdownPlainText,
  MARKDOWN_MAX_ISSUES,
  mediaKeyFromFileName,
  parseMarkdown,
  tableOfContents,
  type MarkdownBlock,
  type MarkdownProfile,
} from './index.js';

const text = (value: string) => ({ type: 'text', value }) as const;
const paragraph = (...children: unknown[]) => ({ type: 'paragraph', children });
const blocksOf = (source: string, profile: MarkdownProfile = 'document') => parseMarkdown(source, profile).blocks;
const issuesOf = (source: string, profile: MarkdownProfile = 'document') =>
  parseMarkdown(source, profile).issues.map(({ code, line, column, construct }) => ({ code, line, column, construct }));

/** Każdy węzeł drzewa to tekst, pogrubienie, kursywa albo odnośnik z dozwolonym adresem: nic nie staje się HTML. */
function expectSafeTree(blocks: MarkdownBlock[]): void {
  const visit = (nodes: unknown[]) => {
    for (const node of nodes as Array<{ type: string; href?: string; children?: unknown[] }>) {
      expect(['text', 'strong', 'emphasis', 'link']).toContain(node.type);
      if (node.type === 'link') expect(isAllowedHref(node.href!)).toBe(true);
      if (node.children) visit(node.children);
    }
  };
  for (const block of blocks) {
    expect(['heading', 'paragraph', 'list']).toContain(block.type);
    if (block.type === 'list') block.items.forEach(visit);
    else visit(block.children);
  }
}

describe('Markdown: konstrukcje podzbioru (ADR 0063)', () => {
  it('akapity: pusta linia rozdziela, pojedynczy znak nowej linii to spacja, wcięcie do 3 spacji i końcowe spacje znikają', () => {
    expect(blocksOf('Pierwszy wiersz\n  drugi wiersz   \n\nNowy akapit')).toEqual([
      paragraph(text('Pierwszy wiersz drugi wiersz')),
      paragraph(text('Nowy akapit')),
    ]);
    expect(blocksOf('a\r\nb\rc')).toEqual([paragraph(text('a b c'))]);
    expect(blocksOf('')).toEqual([]);
    expect(blocksOf('\n \n\t\n')).toEqual([]);
  });

  it('pogrubienie, kursywa (gwiazdka i podkreślnik) i ich połączenie', () => {
    expect(blocksOf('Płacisz za **minuty**, parkujesz *w strefie* i _tylko_ tam.')).toEqual([
      paragraph(
        text('Płacisz za '),
        { type: 'strong', children: [text('minuty')] },
        text(', parkujesz '),
        { type: 'emphasis', children: [text('w strefie')] },
        text(' i '),
        { type: 'emphasis', children: [text('tylko')] },
        text(' tam.'),
      ),
    ]);
    expect(blocksOf('***bardzo***')).toEqual([
      paragraph({ type: 'strong', children: [{ type: 'emphasis', children: [text('bardzo')] }] }),
    ]);
    expect(blocksOf('**pogrubione z *kursywą* w środku**')).toEqual([
      paragraph({
        type: 'strong',
        children: [text('pogrubione z '), { type: 'emphasis', children: [text('kursywą')] }, text(' w środku')],
      }),
    ]);
    expect(blocksOf('__też pogrubione__')).toEqual([paragraph({ type: 'strong', children: [text('też pogrubione')] })]);
  });

  it('gwiazdka otoczona spacjami i podkreślnik w środku słowa zostają tekstem; gwiazdka w środku słowa działa', () => {
    expect(blocksOf('5 * 3 * 2 = 30')).toEqual([paragraph(text('5 * 3 * 2 = 30'))]);
    expect(blocksOf('plik nazwa_pliku_v2.docx')).toEqual([paragraph(text('plik nazwa_pliku_v2.docx'))]);
    expect(blocksOf('a*b*c')).toEqual([paragraph(text('a'), { type: 'emphasis', children: [text('b')] }, text('c'))]);
  });

  it('bez zagnieżdżania tego samego znacznika: wewnętrzny znacznik zostaje tekstem', () => {
    expect(blocksOf('*a _b_ c*')).toEqual([paragraph({ type: 'emphasis', children: [text('a _b_ c')] })]);
  });

  it('odnośniki z dozwolonymi adresami i formatowaniem w tekście', () => {
    expect(blocksOf('Parkuj w [wyznaczonych strefach](/#strefy).')).toEqual([
      paragraph(
        text('Parkuj w '),
        { type: 'link', href: '/#strefy', children: [text('wyznaczonych strefach')] },
        text('.'),
      ),
    ]);
    for (const href of ['https://rybnik.eu', 'mailto:pomoc@example.pl', 'tel:+48320000000', '/aktualnosci', '#faq']) {
      expect(blocksOf(`[x](${href})`)).toEqual([paragraph({ type: 'link', href, children: [text('x')] })]);
    }
    expect(blocksOf('[**ważne**](https://example.pl)')).toEqual([
      paragraph({
        type: 'link',
        href: 'https://example.pl',
        children: [{ type: 'strong', children: [text('ważne')] }],
      }),
    ]);
    expect(blocksOf('**[w pogrubieniu](/a)**')).toEqual([
      paragraph({ type: 'strong', children: [{ type: 'link', href: '/a', children: [text('w pogrubieniu')] }] }),
    ]);
  });

  it('nawiasy w adresie są zbalansowane, a `[nazwa]` bez adresu zostaje tekstem (znaczniki z dokumentów startowych)', () => {
    expect(blocksOf('[Rybnik](https://pl.wikipedia.org/wiki/Rybnik_(miasto)) dalej')).toEqual([
      paragraph(
        { type: 'link', href: 'https://pl.wikipedia.org/wiki/Rybnik_(miasto)', children: [text('Rybnik')] },
        text(' dalej'),
      ),
    ]);
    expect(blocksOf('Hulajnogi [nazwa] dla osób od [WIEK] lat [a] [b] (c)')).toEqual([
      paragraph(text('Hulajnogi [nazwa] dla osób od [WIEK] lat [a] [b] (c)')),
    ]);
    expect(blocksOf('[[nazwa]](/x)')).toEqual([paragraph({ type: 'link', href: '/x', children: [text('[nazwa]')] })]);
  });

  it('ucieczki zamieniają znaki składni w tekst; inny ukośnik zostaje', () => {
    expect(blocksOf('\\*nie kursywa\\* \\_ \\[a\\](b) \\\\ \\# \\- \\< \\q')).toEqual([
      paragraph(text('*nie kursywa* _ [a](b) \\ # - < \\q')),
    ]);
    expect(blocksOf('\\## nie nagłówek\n\n\\- nie lista\n\n1\\. nie lista\n\n\\> nie cytat')).toEqual([
      paragraph(text('## nie nagłówek')),
      paragraph(text('- nie lista')),
      paragraph(text('1. nie lista')),
      paragraph(text('> nie cytat')),
    ]);
  });

  it('listy punktowane i numerowane, kontynuacja elementu, zmiana rodzaju zaczyna nową listę', () => {
    expect(blocksOf('- jeden\n* dwa\n  ciąg dalszy\n\n1. pierwszy\n2. **drugi**\n- inna')).toEqual([
      { type: 'list', ordered: false, items: [[text('jeden')], [text('dwa ciąg dalszy')]] },
      { type: 'list', ordered: true, items: [[text('pierwszy')], [{ type: 'strong', children: [text('drugi')] }]] },
      { type: 'list', ordered: false, items: [[text('inna')]] },
    ]);
  });

  it('lista punktowana przerywa akapit, numerowana tylko od `1.`', () => {
    expect(blocksOf('Akapit\n- punkt')).toEqual([
      paragraph(text('Akapit')),
      { type: 'list', ordered: false, items: [[text('punkt')]] },
    ]);
    expect(blocksOf('Rok\n2026. był dobry')).toEqual([paragraph(text('Rok 2026. był dobry'))]);
    expect(blocksOf('Kroki:\n1. pierwszy')).toEqual([
      paragraph(text('Kroki:')),
      { type: 'list', ordered: true, items: [[text('pierwszy')]] },
    ]);
  });

  it('nagłówki `##` i `###` z kotwicą, zamykające `#` i spis treści tylko z `##`', () => {
    const result = parseMarkdown('## 1. Postanowienia ogólne ##\n\ntekst\n\n### Szczegóły *ważne*\n\n## Opłaty');
    expect(result.issues).toEqual([]);
    expect(result.blocks[0]).toEqual({
      type: 'heading',
      level: 2,
      id: '1-postanowienia-ogolne',
      children: [text('1. Postanowienia ogólne')],
    });
    expect(result.headings).toEqual([
      { level: 2, id: '1-postanowienia-ogolne', text: '1. Postanowienia ogólne' },
      { level: 3, id: 'szczegoly-wazne', text: 'Szczegóły ważne' },
      { level: 2, id: 'oplaty', text: 'Opłaty' },
    ]);
    expect(tableOfContents(result).map((h) => h.id)).toEqual(['1-postanowienia-ogolne', 'oplaty']);
    expect(blocksOf('#hashtag to tekst')).toEqual([paragraph(text('#hashtag to tekst'))]);
  });

  it('tekst bez formatowania do spisu treści i opisu strony', () => {
    const { blocks } = parseMarkdown('Zwykły **gruby** [link](/a)\n\n- a\n- b');
    expect(markdownPlainText(blocks)).toBe('Zwykły gruby link\n\na\nb');
    expect(inlineText([text('a'), { type: 'emphasis', children: [text('b')] }])).toBe('ab');
  });
});

describe('Markdown: błędy z wierszem i kolumną', () => {
  it.each([
    ['<br>', 'MD_HTML', 'html', 1],
    ['tekst <!-- komentarz -->', 'MD_HTML', 'html', 7],
    ['a </p>', 'MD_HTML', 'html', 3],
    ['![render](/media/a.png)', 'MD_NOT_ALLOWED', 'image', 1],
    ['kod `x`', 'MD_NOT_ALLOWED', 'code', 5],
    ['```', 'MD_NOT_ALLOWED', 'code', 1],
    ['~~~ts', 'MD_NOT_ALLOWED', 'code', 1],
    ['> cytat', 'MD_NOT_ALLOWED', 'blockquote', 1],
    ['| a | b |', 'MD_NOT_ALLOWED', 'table', 1],
    ['---', 'MD_NOT_ALLOWED', 'thematic-break', 1],
    ['* * *', 'MD_NOT_ALLOWED', 'thematic-break', 1],
    ['# Tytuł strony', 'MD_HEADING_LEVEL', 'heading', 1],
    ['#### Za głęboko', 'MD_HEADING_LEVEL', 'heading', 1],
    ['##', 'MD_NOT_ALLOWED', 'empty-heading', 1],
    ['**niezamknięte', 'MD_UNCLOSED', 'strong', 1],
    ['a *kursywa', 'MD_UNCLOSED', 'emphasis', 3],
    ['[odnośnik](/bez-końca', 'MD_UNCLOSED', 'link', 1],
    ['[a](https://x.pl "tytuł")', 'MD_NOT_ALLOWED', 'link-title', 5],
    ['[](/pusty)', 'MD_NOT_ALLOWED', 'empty-link', 1],
    ['[a](http://x.pl)', 'MD_LINK_SCHEME', 'link', 5],
  ] as const)('%s → %s (%s)', (source, code, construct, column) => {
    expect(issuesOf(source)).toEqual([{ code, line: 1, column, construct }]);
    expect(blocksOf(source)).toEqual([]);
  });

  it('wcięty kod, zagnieżdżona lista i nagłówek Setext', () => {
    expect(issuesOf('    kod')).toEqual([{ code: 'MD_NOT_ALLOWED', line: 1, column: 5, construct: 'code' }]);
    expect(issuesOf('- a\n  - b')).toEqual([{ code: 'MD_NESTED_LIST', line: 2, column: 3, construct: 'nested-list' }]);
    expect(issuesOf('- a\n    1. b')).toEqual([
      { code: 'MD_NESTED_LIST', line: 2, column: 5, construct: 'nested-list' },
    ]);
    expect(issuesOf('Tytuł\n===')).toEqual([
      { code: 'MD_NOT_ALLOWED', line: 2, column: 1, construct: 'setext-heading' },
    ]);
    expect(issuesOf('Tytuł\n---')).toEqual([
      { code: 'MD_NOT_ALLOWED', line: 2, column: 1, construct: 'setext-heading' },
    ]);
    expect(issuesOf('|---|---|')).toEqual([{ code: 'MD_NOT_ALLOWED', line: 1, column: 1, construct: 'table' }]);
    expect(issuesOf('a | b\n--- | ---')).toEqual([{ code: 'MD_NOT_ALLOWED', line: 2, column: 1, construct: 'table' }]);
  });

  it('kolumna w znakach (polskie litery i emoji liczą się jako jeden znak), wcięcie wliczone', () => {
    expect(issuesOf('Zażółć <b>')).toEqual([{ code: 'MD_HTML', line: 1, column: 8, construct: 'html' }]);
    expect(issuesOf('🛴 <b>')).toEqual([{ code: 'MD_HTML', line: 1, column: 3, construct: 'html' }]);
    expect(issuesOf('ok\n\n  **zła')).toEqual([{ code: 'MD_UNCLOSED', line: 3, column: 3, construct: 'strong' }]);
    expect(issuesOf('- [a](ftp://x)')).toEqual([{ code: 'MD_LINK_SCHEME', line: 1, column: 7, construct: 'link' }]);
  });

  it('podgląd pomija tylko błędny wiersz, a reszta akapitu i listy zostaje', () => {
    const result = parseMarkdown('Znajdź ją na mapie.\nPłacisz za **minuty**.\n## Nowość\nPo nagłówku.', 'inline');
    expect(result.issues).toEqual([{ code: 'MD_NOT_ALLOWED', line: 3, column: 1, construct: 'heading' }]);
    expect(result.blocks).toEqual([
      paragraph(text('Znajdź ją na mapie. Płacisz za '), { type: 'strong', children: [text('minuty')] }, text('.')),
      paragraph(text('Po nagłówku.')),
    ]);
    expect(blocksOf('- a\n- <b>b</b>\n  ciąg b\n- c')).toEqual([
      { type: 'list', ordered: false, items: [[text('a')], [text('c')]] },
    ]);
    expect(blocksOf('**zły\ndobry')).toEqual([paragraph(text('dobry'))]);
  });

  it('wiele błędów w jednym wierszu i limit liczby błędów', () => {
    expect(issuesOf('<b>pogrubione</b> `kod` <c>').map((i) => i.column)).toEqual([1, 14, 19, 25]);
    const many = Array.from({ length: 500 }, () => '<b>').join('\n\n');
    expect(parseMarkdown(many).issues).toHaveLength(MARKDOWN_MAX_ISSUES);
  });
});

describe('Markdown: profile sekcji', () => {
  const source = '## Nagłówek\n\nAkapit z **pogrubieniem** i [odnośnikiem](/a).\n\n- punkt';

  it('`document` przyjmuje wszystko z podzbioru', () => {
    expect(parseMarkdown(source, 'document').issues).toEqual([]);
  });

  it('`faq`: listy tak, nagłówki nie', () => {
    expect(issuesOf(source, 'faq')).toEqual([{ code: 'MD_NOT_ALLOWED', line: 1, column: 1, construct: 'heading' }]);
    expect(blocksOf(source, 'faq').map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('`inline`: tylko akapity, pogrubienie, kursywa i odnośniki', () => {
    expect(issuesOf(source, 'inline')).toEqual([
      { code: 'MD_NOT_ALLOWED', line: 1, column: 1, construct: 'heading' },
      { code: 'MD_NOT_ALLOWED', line: 5, column: 1, construct: 'list' },
    ]);
    expect(blocksOf('**a** *b* [c](/d)', 'inline')).toHaveLength(1);
  });

  it('nagłówek w profilu bez nagłówków to `MD_NOT_ALLOWED`, nawet przy złym poziomie', () => {
    expect(issuesOf('# Tytuł', 'faq')).toEqual([{ code: 'MD_NOT_ALLOWED', line: 1, column: 1, construct: 'heading' }]);
  });
});

describe('Markdown: złośliwe wejścia', () => {
  it.each([
    '[kliknij](javascript:alert(1))',
    '[kliknij](JAVASCRIPT:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    '[x](vbscript:msgbox)',
    '[x](//evil.example)',
    '[x](/\\evil.example)',
    '[x](https:/evil)',
    '[x](https:///evil)',
    '[x]( javascript:alert(1) )',
    '[x](java\tscript:alert(1))',
    '[x](file:///etc/passwd)',
  ])('odnośnik %s nie trafia do drzewa', (source) => {
    const result = parseMarkdown(source);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.blocks).toEqual([]);
  });

  it('HTML nigdy nie staje się elementem: `<script>` to błąd, a `<` bez litery zostaje tekstem bez dekodowania encji', () => {
    const result = parseMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\na < b, 3<4, <3 &lt;b&gt;',
    );
    expect(result.issues.map((i) => i.code)).toEqual(['MD_HTML', 'MD_HTML', 'MD_HTML']);
    expect(result.blocks).toEqual([paragraph(text('a < b, 3<4, <3 &lt;b&gt;'))]);
    expectSafeTree(result.blocks);
  });

  it('obraz z adresem `javascript:` jest odrzucony jako obraz', () => {
    expect(issuesOf('![x](javascript:alert(1))')).toEqual([
      { code: 'MD_NOT_ALLOWED', line: 1, column: 1, construct: 'image' },
    ]);
  });

  it('bardzo długie wiersze i patologiczne ciągi znaczników parsują się liniowo', () => {
    const inputs = [
      'a'.repeat(200_000),
      '['.repeat(50_000) + ']'.repeat(50_000),
      '[a]('.repeat(30_000),
      '*'.repeat(100_000) + 'x',
      '_a '.repeat(50_000),
      '**a '.repeat(40_000),
      '## ' + ' '.repeat(100_000) + 'x',
      '-'.repeat(100_000) + 'x',
      '- '.repeat(50_000) + 'x',
      '|' + '-|'.repeat(50_000),
      '\\'.repeat(100_001),
      '<'.repeat(100_000),
    ];
    const started = Date.now();
    for (const input of inputs) {
      const result = parseMarkdown(input);
      expect(result.issues.length).toBeLessThanOrEqual(MARKDOWN_MAX_ISSUES);
      expectSafeTree(result.blocks);
    }
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('wiele wierszy i losowe wejście nie rzucają wyjątków', () => {
    expect(parseMarkdown('x\n'.repeat(100_000)).blocks).toHaveLength(1);
    const alphabet = [
      '*',
      '_',
      '[',
      ']',
      '(',
      ')',
      '<',
      '>',
      '!',
      '`',
      '#',
      '-',
      '\\',
      ' ',
      '\n',
      'a',
      'ł',
      '1',
      '.',
      '|',
    ];
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 300; n++) {
      const input = Array.from({ length: 80 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
      const result = parseMarkdown(input);
      expectSafeTree(result.blocks);
      for (const issue of result.issues) {
        expect(issue.line).toBeGreaterThanOrEqual(1);
        expect(issue.column).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('adresy odnośników i przycisków', () => {
  it.each([
    ['https://rybnik.eu/strefy?x=1#a', true],
    ['mailto:pomoc@example.pl', true],
    ['tel:+48-32-000-00-00', true],
    ['/aktualnosci', true],
    ['/', true],
    ['#aplikacja', true],
    ['/#strefy', true],
    ['http://rybnik.eu', false],
    ['HTTPS://rybnik.eu', false],
    ['https://', false],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['javascript:alert(1)', false],
    ['data:image/png;base64,AAAA', false],
    ['aktualnosci', false],
    ['tel:pomoc', false],
    ['mailto:', false],
    ['/a b', false],
    ['/a\u0000', false],
    ['', false],
  ])('%s → %s', (href, allowed) => {
    expect(isAllowedHref(href)).toBe(allowed);
  });

  it('limit długości i podpowiedź `https:`', () => {
    expect(isAllowedHref(`/${'a'.repeat(2000)}`)).toBe(false);
    expect(isAllowedHref(`/${'a'.repeat(1999)}`)).toBe(true);
    expect(hrefHint('http://x.pl')).toBe('https');
    expect(hrefHint('javascript:x')).toBeNull();
    expect(parseMarkdown('[a](http://x.pl)').issues[0]?.href).toBe('http://x.pl');
  });

  it('wzorzec dla `CHECK` bazy jest tym samym wyrażeniem co reguła', () => {
    expect(ALLOWED_HREF_PATTERN.source).not.toMatch(/\(\?[=!<]/);
  });
});

describe('kotwice nagłówków i klucze grafik', () => {
  it.each([
    ['Zażółć gęślą jaźń', 'zazolc-gesla-jazn'],
    ['ŁÓDŹ, Śląsk i Żory', 'lodz-slask-i-zory'],
    ['  1. Postanowienia ogólne  ', '1-postanowienia-ogolne'],
    ['Opłaty — za co płacisz?', 'oplaty-za-co-placisz'],
    ['!!!', 'sekcja'],
    ['', 'sekcja'],
  ])('%s → %s', (input, id) => {
    expect(headingId(input)).toBe(id);
  });

  it('powtórzenia dostają kolejne przyrostki, a długi tytuł jest skrócony bez `-` na końcu', () => {
    const slug = createSlugger();
    expect(['Opłaty', 'Opłaty', 'opłaty!', 'Opłaty 2'].map(slug)).toEqual([
      'oplaty',
      'oplaty-2',
      'oplaty-3',
      'oplaty-2-2',
    ]);
    expect(headingId('ab '.repeat(50), 10)).toBe('ab-ab-ab-a');
    expect(headingId('abcd efgh', 5)).toBe('abcd');
    const { headings } = parseMarkdown('## Zasady\n\n## Zasady');
    expect(headings.map((h) => h.id)).toEqual(['zasady', 'zasady-2']);
  });

  it('klucz grafiki z nazwy pliku z przyrostkiem przy kolizji', () => {
    expect(mediaKeyFromFileName('Aktualność Kampus.webp')).toBe('aktualnosc-kampus');
    expect(mediaKeyFromFileName('aktualnosc-kampus.webp', ['aktualnosc-kampus'])).toBe('aktualnosc-kampus-2');
    expect(mediaKeyFromFileName('render.PNG', ['render', 'render-2'])).toBe('render-3');
  });
});

describe('dokumenty startowe z seeda przechodzą walidację', () => {
  const dir = fileURLToPath(new URL('../../../db/seed/documents/', import.meta.url));
  const files = readdirSync(dir).filter((name) => name.endsWith('.md'));

  it('są dokumenty prawne z iteracji 2 (i każdy kolejny dokument startowy)', () => {
    expect(files).toEqual(expect.arrayContaining(['polityka-prywatnosci.md', 'regulamin.md', 'zasady-jazdy.md']));
  });

  it.each(files)('%s (bez komentarza z pierwszej linii, który usuwa seed)', (name) => {
    const source = readFileSync(dir + name, 'utf8').replace(/^<!--[\s\S]*?-->\s*\n/, '');
    const result = parseMarkdown(source, 'document');
    expect(result.issues).toEqual([]);
    expect(result.headings.length).toBeGreaterThan(0);
    expectSafeTree(result.blocks);
  });

  it('komentarz HTML bez usunięcia byłby błędem', () => {
    const source = readFileSync(dir + 'regulamin.md', 'utf8');
    expect(parseMarkdown(source).issues[0]).toMatchObject({ code: 'MD_HTML', line: 1, column: 1 });
  });
});
