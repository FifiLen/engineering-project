/* global Buffer, console */
// Szablony startowe wydruków DOCX (ADR 0067, D4): paragon z korektą, potwierdzenie przejazdu, protokół zadania
// serwisowego, karta hulajnogi i systemowa lista pól. Pliki są w repozytorium (seed wgrywa je jako wersję 1,
// a po zmianie pliku jako nową wersję szablonu, którego aktywna wersja pochodzi z seeda), a ten skrypt je
// odtwarza: `node packages/db/seed/templates/build.mjs`.
//
// Bez zależności: minimalny WordprocessingML (dokument, style, ustawienia, stopka z polami „strona X z Y”, grafiki)
// spakowany własnym zapisem ZIP (deflate z `node:zlib`, stała data plików, więc wynik jest powtarzalny).
// Znaczniki docxtemplater (`{pole}`, pętle `{#lista}…{/lista}`, warunki `{#flaga}…{/flaga}` i `{^flaga}…{/flaga}`)
// stoją każdy w jednym fragmencie tekstu; ścieżki z kropką bez wyrażeń (ADR 0067). Logo i pieczęć to stałe grafiki
// w pliku szablonu (pytanie 5), a linia „Podpis” stoi w warunku `{#staff.present}`.
// `manifest.json` obok zapisuje rodzaj dokumentu, nazwę, znaczniki i rozmiar po rozpakowaniu każdego pliku.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

const dir = import.meta.dirname;
const LOGO = readFileSync(join(dir, '..', '..', '..', '..', 'docs', 'projekt', 'ikona', 'icon.png'));

// Kolory z docs/projekt/tokens.json: tekst, tekst pomocniczy, linie, kobalt (jedyny kolor akcji).
const INK = '16181D';
const MUTED = '6B6E75';
const LINE = 'E3E3DE';
const ACCENT = '2B3FF5';

// ---------------------------------------------------------------------------------------------------------------
// ZIP (bez ZIP64, metoda 8 dla XML, metoda 0 dla PNG)
// ---------------------------------------------------------------------------------------------------------------

/** Stała data i czas plików w archiwum (18 listopada 2026, 12:00) w formacie DOS. */
const DOS_TIME = (12 << 11) | (0 << 5) | 0;
const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 18;

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const store = name.endsWith('.png');
    const body = store ? data : deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nazwy w UTF-8
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------------------------------------------------------------------------------------------------------------
// PNG pieczęci: dwa kobaltowe pierścienie na przezroczystym tle (stała grafika, bez tekstu)
// ---------------------------------------------------------------------------------------------------------------

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = y * (width * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // głębia
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const STAMP = (() => {
  const size = 240;
  const c = size / 2;
  const rings = [
    [104, 114],
    [86, 90],
  ];
  return png(size, size, (x, y) => {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    // Wygładzenie krawędzi: pokrycie piksela przez pierścień w przedziale [od, do].
    const cover = Math.max(...rings.map(([from, to]) => Math.max(0, Math.min(1, d - from + 0.5, to - d + 0.5))));
    return [0x2b, 0x3f, 0xf5, Math.round(cover * 210)];
  });
})();

// ---------------------------------------------------------------------------------------------------------------
// WordprocessingML
// ---------------------------------------------------------------------------------------------------------------

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Fragment tekstu; `b` pogrubienie (Inter SemiBold przez styl), `color`, `size` w punktach. */
function run(text, { b = false, color, size, mono = false } = {}) {
  // Kolejność elementów jak w schemacie WordprocessingML (rFonts, b, color, sz).
  const props = [
    mono ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '',
    b ? '<w:b/>' : '',
    color ? `<w:color w:val="${color}"/>` : '',
    size ? `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** Akapit z fragmentów (tekst albo wynik `run`); `style`, `align`, `after` (odstęp po, w punktach). */
function para(parts, { style, align, after, keepNext = false } = {}) {
  const items = (Array.isArray(parts) ? parts : [parts]).map((p) => (p.startsWith('<w:') ? p : run(p))).join('');
  const props = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    keepNext ? '<w:keepNext/>' : '',
    after !== undefined ? `<w:spacing w:after="${after * 20}"/>` : '',
    align ? `<w:jc w:val="${align}"/>` : '',
  ].join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${items}</w:p>`;
}

const heading = (text) => para(text, { style: 'Heading2', keepNext: true });
/** Akapit z samym znacznikiem otwarcia albo zamknięcia warunku (`paragraphLoop` usuwa go z wyniku). */
const tagPara = (tag) => para(run(tag));

let drawingId = 0;
function image(relId, name, widthCm, heightCm) {
  const cx = Math.round(widthCm * 360000);
  const cy = Math.round(heightCm * 360000);
  drawingId += 1;
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${drawingId}" name="${name}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/** Szerokość strony A4 bez marginesów 2 cm: 11906 − 2 × 1134 twipów. */
const TEXT_WIDTH = 9638;

function cell(content, { width, header = false, align } = {}) {
  const paragraphs = (Array.isArray(content) ? content : [content]).map((c) =>
    c.startsWith('<w:p') ? c : para(header ? run(c, { b: true, color: MUTED, size: 8 }) : run(c), { align, after: 0 }),
  );
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? `<w:shd w:val="clear" w:color="auto" w:fill="F6F6F3"/>` : ''}</w:tcPr>` +
    `${paragraphs.join('')}</w:tc>`
  );
}

/**
 * Tabela z wierszem nagłówka; `rows` to wiersze komórek. Pętla po wierszu: `{#lista}` w pierwszej komórce
 * i `{/lista}` w ostatniej tego samego wiersza, więc docxtemplater powtarza cały wiersz.
 */
function table(columns, rows, { header = true } = {}) {
  const total = columns.reduce((s, c) => s + c.w, 0);
  const widths = columns.map((c) => Math.round((c.w / total) * TEXT_WIDTH));
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const head = header
    ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${columns
        .map((c, i) => cell(c.label, { width: widths[i], header: true, align: c.align }))
        .join('')}</w:tr>`
    : '';
  const body = rows
    .map(
      (r) =>
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => cell(c, { width: widths[i], align: columns[i].align })).join('')}</w:tr>`,
    )
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="Tabela"/><w:tblW w:w="${TEXT_WIDTH}" w:type="dxa"/>` +
    `<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl>` +
    para('', { after: 4 })
  );
}

/**
 * Tabela dwóch kolumn „etykieta: wartość” bez nagłówka. Trzeci element pary to opcjonalny warunek wiersza
 * (pole typu „tak/nie” z katalogu): `{#warunek}` przed etykietą i `{/warunek}` po wartości w tym samym wierszu,
 * więc docxtemplater pokazuje albo usuwa cały wiersz.
 */
const facts = (pairs) =>
  table(
    [
      { label: '', w: 34 },
      { label: '', w: 66 },
    ],
    pairs.map(([label, value, condition]) => [
      para([...(condition ? [run(`{#${condition}}`)] : []), run(label, { color: MUTED })], { after: 0 }),
      para([...value, ...(condition ? [run(`{/${condition}}`)] : [])], { after: 0 }),
    ]),
    { header: false },
  );

/** Nagłówek dokumentu: logo, nazwa firmy, tytuł i numer obiektu. */
function documentHeader(titleParts, subtitleParts) {
  return [
    para([image('rIdLogo', 'Logo', 1.2, 1.2), run('  '), run('{company.name}', { b: true, size: 11 })], { after: 6 }),
    para(titleParts, { style: 'Title' }),
    para(subtitleParts, { style: 'Subtitle' }),
  ].join('');
}

/** Linia podpisu z imieniem i nazwiskiem operatora i pieczęcią; dokument zlecony w aplikacji jej nie ma. */
const signature = () =>
  [
    tagPara('{#staff.present}'),
    para('', { after: 12 }),
    table(
      [
        { label: '', w: 60 },
        { label: '', w: 40 },
      ],
      [
        [
          [
            para(run('Podpis: ______________________________'), { after: 2 }),
            para(run('{staff.name}', { color: MUTED, size: 8 }), { after: 0 }),
          ],
          para([image('rIdStamp', 'Pieczęć', 2.4, 2.4)], { align: 'center', after: 0 }),
        ],
      ],
      { header: false },
    ),
    tagPara('{/staff.present}'),
  ].join('');

const companyFooterNote = () =>
  para(
    [
      run('{company.name}', { color: MUTED, size: 8 }),
      run(' · ', { color: MUTED, size: 8 }),
      run('{company.address}', { color: MUTED, size: 8 }),
      run(' · NIP ', { color: MUTED, size: 8 }),
      run('{company.taxId}', { color: MUTED, size: 8 }),
      run(' · pomoc: ', { color: MUTED, size: 8 }),
      run('{company.supportPhone}', { color: MUTED, size: 8 }),
      run(', ', { color: MUTED, size: 8 }),
      run('{company.supportEmail}', { color: MUTED, size: 8 }),
    ],
    { style: 'Footer', after: 4 },
  );

function documentXml(body) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}` +
    `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>` +
    `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`
  );
}

/** Pole Worda (PAGE, NUMPAGES) wyliczane przy renderowaniu. */
const field = (instr) =>
  `<w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>` +
  `<w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` +
  `<w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r>` +
  `<w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r>` +
  `<w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>`;

/**
 * Stopka: nota firmy (dane z panelu) nad linią z identyfikatorem wydruku i numerem strony. Nota była ostatnim
 * akapitem treści po pustym akapicie, więc przy długim protokole sama spadała na drugą stronę; w stopce jest na każdej
 * stronie i nie zabiera miejsca treści. Lista pól (szablon systemowy) nie ma noty.
 */
const footer = ({ companyNote }) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS}>` +
  (companyNote ? companyFooterNote() : '') +
  `<w:p><w:pPr><w:pStyle w:val="Footer"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="${LINE}"/></w:pBdr>` +
  `<w:tabs><w:tab w:val="right" w:pos="${TEXT_WIDTH}"/></w:tabs></w:pPr>` +
  `${run('{document.footer}', { color: MUTED, size: 8 })}<w:r><w:tab/></w:r>` +
  `${run('strona ', { color: MUTED, size: 8 })}${field('PAGE')}${run(' z ', { color: MUTED, size: 8 })}${field('NUMPAGES')}</w:p></w:ftr>`;

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter" w:eastAsia="Inter" w:cs="Inter"/>` +
  `<w:color w:val="${INK}"/><w:sz w:val="19"/><w:szCs w:val="19"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:before="120" w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
  `<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="${MUTED}"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
  `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr>` +
  `<w:rPr><w:b/><w:color w:val="${ACCENT}"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>` +
  `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>` +
  `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
  `<w:style w:type="table" w:styleId="Tabela"><w:name w:val="Tabela"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>` +
  `<w:top w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/>` +
  `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/></w:tblBorders>` +
  `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>` +
  `</w:styles>`;

const SETTINGS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:defaultTabStop w:val="709"/><w:characterSpacingControl w:val="doNotCompress"/>` +
  `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const FONT_TABLE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:font w:name="Inter"><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font></w:fonts>`;

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>` +
  `<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>` +
  `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>` +
  `<Relationship Id="rIdFonts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>` +
  `<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>` +
  `<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>` +
  `<Relationship Id="rIdStamp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pieczec.png"/></Relationships>`;

const coreXml = (title) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
  `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
  `<dc:title>${esc(title)}</dc:title><dc:creator>[nazwa]</dc:creator><dc:language>pl-PL</dc:language>` +
  `<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-18T12:00:00Z</dcterms:created>` +
  `<dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-18T12:00:00Z</dcterms:modified></cp:coreProperties>`;

const APP_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
  `<Application>hulajnogi seed/templates/build.mjs</Application></Properties>`;

function docx(title, body, { companyNote = true } = {}) {
  const FOOTER = footer({ companyNote });
  drawingId = 0;
  const entries = [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['docProps/core.xml', coreXml(title)],
    ['docProps/app.xml', APP_XML],
    ['word/document.xml', documentXml(body)],
    ['word/styles.xml', STYLES],
    ['word/settings.xml', SETTINGS],
    ['word/fontTable.xml', FONT_TABLE],
    ['word/footer1.xml', FOOTER],
    ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ].map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') }));
  entries.push({ name: 'word/media/logo.png', data: LOGO }, { name: 'word/media/pieczec.png', data: STAMP });
  return {
    bytes: zip(entries),
    xml: [documentXml(body), FOOTER].join('\n'),
    uncompressedBytes: entries.reduce((sum, e) => sum + e.data.length, 0),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Treść szablonów
// ---------------------------------------------------------------------------------------------------------------

// Znaczniki szablonów rodzajów to wyłącznie pola, pętle i warunki z katalogu core (`DOCUMENT_CATALOG`
// w packages/core/src/documents/catalog.ts) i pola wspólne (`company.*`, `document.*`, `template.*`, `staff.*`);
// pole pętli stoi tylko w swojej pętli, a warunek tylko na polu typu „tak/nie” (walidacja `validateTemplateTags`).

const RECEIPT = docx(
  'Potwierdzenie sprzedaży',
  [
    documentHeader(
      [
        run('{^isCorrection}Potwierdzenie sprzedaży{/isCorrection}'),
        run('{#isCorrection}Korekta potwierdzenia sprzedaży{/isCorrection}'),
      ],
      [run('{receipt.number}'), run(' · '), run('{receipt.issuedAt}'), run(' · dokument niefiskalny')],
    ),
    tagPara('{#isCorrection}'),
    para([
      run('Korekta dotyczy dokumentu ', { color: MUTED }),
      run('{corrected.number}', { b: true }),
      run(' z ', { color: MUTED }),
      run('{corrected.issuedAt}'),
      run('. Przyczyna: ', { color: MUTED }),
      run('{correction.reason}'),
      run('.', { color: MUTED }),
    ]),
    tagPara('{/isCorrection}'),
    facts([
      ['Sprzedawca', [run('{seller.name}'), run(', '), run('{seller.address}')]],
      ['NIP sprzedawcy', [run('{seller.taxId}')]],
      ['Nabywca', [run('{customer.name}'), run(', tel. '), run('{customer.phone}')]],
      ['Przejazd', [run('{receipt.rentalNumber}')], 'hasRental'],
      ['Zapłata', [run('{receipt.paymentSource}')]],
    ]),
    heading('Pozycje'),
    table(
      [
        { label: 'Opis', w: 48 },
        { label: 'Ilość', w: 11, align: 'right' },
        { label: 'Cena jedn.', w: 15, align: 'right' },
        { label: 'VAT', w: 10, align: 'right' },
        { label: 'Wartość', w: 16, align: 'right' },
      ],
      [['{#items}{description}', '{quantity}', '{unitPrice}', '{vatRate}', '{amount}{/items}']],
    ),
    heading('Podsumowanie VAT'),
    table(
      [
        { label: 'Stawka', w: 25 },
        { label: 'Netto', w: 25, align: 'right' },
        { label: 'VAT', w: 25, align: 'right' },
        { label: 'Brutto', w: 25, align: 'right' },
      ],
      [
        ['{#vatGroups}{rate}', '{net}', '{vat}', '{gross}{/vatGroups}'],
        [
          para(run('Razem', { b: true }), { after: 0 }),
          para(run('{totals.net}', { b: true }), { align: 'right', after: 0 }),
          para(run('{totals.vat}', { b: true }), { align: 'right', after: 0 }),
          para(run('{totals.gross}', { b: true }), { align: 'right', after: 0 }),
        ],
      ],
    ),
    tagPara('{#hasOutsideVat}'),
    para(
      run('„np.”: pozycja nie podlega VAT (kara umowna za pozostawienie hulajnogi poza strefą).', {
        color: MUTED,
        size: 8,
      }),
    ),
    tagPara('{/hasOutsideVat}'),
    signature(),
  ].join(''),
);

const RENTAL = docx(
  'Potwierdzenie przejazdu',
  [
    documentHeader(
      [run('Potwierdzenie przejazdu '), run('{rental.number}')],
      [run('{rental.startedAt}'), run(' – '), run('{rental.endedAt}'), run(' · '), run('{rental.state}')],
    ),
    facts([
      ['Klient', [run('{customer.name}'), run(', tel. '), run('{customer.phone}')]],
      ['Hulajnoga', [run('{scooter.number}'), run(' · '), run('{scooter.model}')]],
      ['Rezerwacja', [run('{rental.reservedAt}')]],
      ['Początek', [run('{start.place}')]],
      ['Koniec', [run('{end.place}')]],
      ['Strefa zakończenia', [run('{end.zone}')]],
      ['Czas jazdy', [run('{rental.rideMinutes}'), run(' min · pauza '), run('{rental.pauseMinutes}'), run(' min')]],
      ['Dystans', [run('{rental.distanceKm}'), run(' km')]],
      ['Zakończenie', [run('{rental.endMode}')]],
    ]),
    heading('Kwoty'),
    facts([
      ['Cennik', [run('wersja '), run('{rental.tariffVersion}')]],
      ['Odblokowanie', [run('{amounts.unlockFee}')]],
      ['Jazda', [run('{amounts.ride}')]],
      ['Pauza', [run('{amounts.pause}')], 'hasPause'],
      ['Opłata za odholowanie', [run('{amounts.towingFee}')], 'hasTowingFee'],
      ['Razem', [run('{amounts.total}', { b: true })]],
      ['Potwierdzenie sprzedaży', [run('{rental.receiptNumber}')], 'hasReceipt'],
    ]),
    tagPara('{#hasTowingFee}'),
    para(
      run('Opłata za odholowanie to kara umowna za pozostawienie hulajnogi poza strefą (poza VAT).', {
        color: MUTED,
        size: 8,
      }),
    ),
    tagPara('{/hasTowingFee}'),
    tagPara('{#includeTimeline}'),
    heading('Przebieg'),
    table(
      [
        { label: 'Czas', w: 28 },
        { label: 'Zdarzenie', w: 72 },
      ],
      [['{#timeline}{at}', '{event}{/timeline}']],
    ),
    tagPara('{/includeTimeline}'),
    signature(),
  ].join(''),
);

const SERVICE = docx(
  'Protokół zadania serwisowego',
  [
    documentHeader(
      [run('Protokół serwisowy '), run('{task.number}')],
      [run('{task.type}'), run(' · '), run('{task.status}'), run(' · priorytet '), run('{task.priority}')],
    ),
    facts([
      ['Hulajnoga', [run('{scooter.number}'), run(' · '), run('{scooter.model}')]],
      ['Przebieg', [run('{scooter.odometerKm}'), run(' km')]],
      ['Bateria', [run('{scooter.batteryPct}'), run('%')]],
      ['Wykonawca', [run('{task.assignee}')]],
      ['Utworzone', [run('{task.createdAt}')]],
      ['Termin', [run('{task.dueAt}')]],
      ['Zakończone', [run('{task.finishedAt}')]],
    ]),
    tagPara('{#hasTicket}'),
    para([
      run('Zgłoszenie ', { color: MUTED }),
      run('{ticket.number}', { b: true }),
      run(': ', { color: MUTED }),
      run('{ticket.categories}'),
      run(' · zgłaszający ', { color: MUTED }),
      run('{customer.name}'),
      run(', tel. ', { color: MUTED }),
      run('{customer.phone}'),
    ]),
    tagPara('{/hasTicket}'),
    tagPara('{#hasNote}'),
    heading('Wykonane prace'),
    para(run('{task.note}')),
    tagPara('{/hasNote}'),
    heading('Części'),
    tagPara('{#hasParts}'),
    table(
      [
        { label: 'Kod', w: 18 },
        { label: 'Część', w: 42 },
        { label: 'Ilość', w: 10, align: 'right' },
        { label: 'Cena jedn.', w: 15, align: 'right' },
        { label: 'Wartość', w: 15, align: 'right' },
      ],
      [
        ['{#parts}{sku}', '{name}', '{quantity}', '{unitPrice}', '{cost}{/parts}'],
        [
          para(run('Razem', { b: true }), { after: 0 }),
          '',
          '',
          '',
          para(run('{partsTotal}', { b: true }), { align: 'right', after: 0 }),
        ],
      ],
    ),
    tagPara('{/hasParts}'),
    tagPara('{^hasParts}'),
    para(run('Nie użyto części z magazynu.', { color: MUTED })),
    tagPara('{/hasParts}'),
    tagPara('{#hasOutcome}'),
    heading('Skutek dla hulajnogi'),
    para(run('{task.outcome}')),
    tagPara('{/hasOutcome}'),
    tagPara('{#includeTimeline}'),
    heading('Przebieg'),
    table(
      [
        { label: 'Czas', w: 28 },
        { label: 'Zdarzenie', w: 72 },
      ],
      [['{#timeline}{at}', '{event}{/timeline}']],
    ),
    tagPara('{/includeTimeline}'),
    signature(),
  ].join(''),
);

const SCOOTER = docx(
  'Karta hulajnogi',
  [
    documentHeader(
      [run('Karta hulajnogi '), run('{scooter.number}')],
      [run('Historia z ostatnich '), run('{history.days}'), run(' dni, od '), run('{history.from}')],
    ),
    facts([
      ['Model', [run('{scooter.model}'), run(' · '), run('{scooter.modelCode}')]],
      ['Numer seryjny', [run('{scooter.serial}')]],
      ['Wariant', [run('{scooter.variant}')]],
      ['Stan', [run('{scooter.status}')]],
      ['Oprogramowanie', [run('{scooter.firmware}')]],
      ['Przebieg', [run('{scooter.odometerKm}'), run(' km')]],
      ['Bateria', [run('{scooter.batteryPct}'), run('%')]],
      ['Ostatnia łączność', [run('{scooter.lastSeenAt}')]],
      ['We flocie od', [run('{scooter.inServiceSince}')]],
      ['Strona hulajnogi', [run('{scooter.url}')]],
    ]),
    heading('Zadania serwisowe'),
    tagPara('{#hasTasks}'),
    table(
      [
        { label: 'Zadanie', w: 14 },
        { label: 'Rodzaj', w: 22 },
        { label: 'Stan', w: 18 },
        { label: 'Utworzone', w: 23 },
        { label: 'Zakończone', w: 23 },
      ],
      [['{#tasks}{number}', '{type}', '{status}', '{createdAt}', '{finishedAt}{/tasks}']],
    ),
    tagPara('{/hasTasks}'),
    tagPara('{^hasTasks}'),
    para(run('Brak zadań w okresie.', { color: MUTED })),
    tagPara('{/hasTasks}'),
    heading('Zgłoszenia'),
    tagPara('{#hasTickets}'),
    table(
      [
        { label: 'Zgłoszenie', w: 16 },
        { label: 'Kategorie', w: 40 },
        { label: 'Stan', w: 20 },
        { label: 'Utworzone', w: 24 },
      ],
      [['{#tickets}{number}', '{categories}', '{status}', '{createdAt}{/tickets}']],
    ),
    tagPara('{/hasTickets}'),
    tagPara('{^hasTickets}'),
    para(run('Brak zgłoszeń w okresie.', { color: MUTED })),
    tagPara('{/hasTickets}'),
    signature(),
  ].join(''),
);

// Lista pól rodzaju dokumentu dla autora szablonu (`GET /admin/document-types/{type}/fields.docx`): szablon
// systemowy, nie rodzaj dokumentu, więc nie trafia do `document_templates`.
const FIELDS = docx(
  'Lista pól szablonu',
  [
    para([image('rIdLogo', 'Logo', 1.2, 1.2), run('  '), run('{company.name}', { b: true, size: 11 })], { after: 6 }),
    para([run('Lista pól: '), run('{documentType.label}')], { style: 'Title' }),
    para([run('Rodzaj '), run('{documentType.code}'), run(' · wygenerowano '), run('{document.generatedAt}')], {
      style: 'Subtitle',
    }),
    para(
      run(
        'Znaczniki wpisuj w szablonie dokładnie tak, jak w kolumnie „Znacznik”. Pętla powtarza wiersz tabeli: otwarcie pętli wpisz w pierwszej komórce wiersza, a zamknięcie w ostatniej. Warunek pokazuje fragment, gdy pole typu „tak/nie” jest prawdziwe, a warunek z daszkiem (^), gdy jest fałszywe.',
        { color: MUTED },
      ),
    ),
    table(
      [
        { label: 'Znacznik', w: 32 },
        { label: 'Opis', w: 34 },
        { label: 'Typ', w: 12 },
        { label: 'Przykład', w: 22 },
      ],
      [[[para(run('{#fields}{tag}', { mono: true }), { after: 0 })], '{label}', '{kind}', '{example}{/fields}']],
    ),
  ].join(''),
  { companyNote: false },
);

// ---------------------------------------------------------------------------------------------------------------
// Zapis plików i manifestu
// ---------------------------------------------------------------------------------------------------------------

/** Pętle po listach; pozostałe sekcje to warunki na polach typu „tak/nie”, które nie zmieniają zakresu pól. */
const LISTS = new Set(['items', 'vatGroups', 'timeline', 'parts', 'tasks', 'tickets', 'fields']);

/**
 * Użyte ścieżki w tym samym zapisie co API (`usedFields` z `validateTemplateTags` w core, kolumna
 * `document_template_versions.fields`): pole, warunek albo pętla po ścieżce, pole pętli jako `parts[].sku`
 * (także w warunku wewnątrz pętli), posortowane i bez powtórzeń. Zgodność z inspekcją API sprawdza test.
 */
function tags(xml) {
  const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  const out = new Set();
  const scope = [];
  const inLoop = (path) => {
    const loop = scope.at(-1);
    return loop ? `${loop}[].${path}` : path;
  };
  for (const [, tag] of text.matchAll(/\{([^{}]+)\}/g)) {
    if (tag.startsWith('#') || tag.startsWith('^')) {
      const path = tag.slice(1);
      out.add(LISTS.has(path) ? path : inLoop(path));
      // Warunek nie zmienia zakresu pól: zostaje pętla, w której stoi.
      scope.push(LISTS.has(path) ? path : (scope.at(-1) ?? null));
    } else if (tag.startsWith('/')) {
      scope.pop();
    } else {
      out.add(inLoop(tag));
    }
  }
  return [...out].sort();
}

const TEMPLATES = [
  {
    file: 'paragon.docx',
    documentType: 'RECEIPT',
    name: 'Potwierdzenie sprzedaży',
    description: 'Paragon i korekta: pozycje, grupy VAT, sprzedawca i nabywca z chwili wystawienia.',
    built: RECEIPT,
  },
  {
    file: 'potwierdzenie-przejazdu.docx',
    documentType: 'RENTAL_CONFIRMATION',
    name: 'Potwierdzenie przejazdu',
    description: 'Czas, dystans, początek i koniec, kwoty z rozliczeniem i opcjonalny przebieg.',
    built: RENTAL,
  },
  {
    file: 'protokol-serwisowy.docx',
    documentType: 'SERVICE_PROTOCOL',
    name: 'Protokół serwisowy',
    description: 'Zadanie serwisowe: wykonane prace, części, skutek dla hulajnogi i podpis serwisanta.',
    built: SERVICE,
  },
  {
    file: 'karta-hulajnogi.docx',
    documentType: 'SCOOTER_CARD',
    name: 'Karta hulajnogi',
    description: 'Dane hulajnogi i modelu, adres strony z kodu QR, zadania i zgłoszenia z wybranego okresu.',
    built: SCOOTER,
  },
  {
    file: 'lista-pol.docx',
    documentType: null,
    name: 'Lista pól szablonu',
    description: 'Szablon systemowy listy pól rodzaju dokumentu dla autora szablonu.',
    built: FIELDS,
  },
];

const manifest = TEMPLATES.map(({ file, documentType, name, description, built }) => {
  writeFileSync(join(dir, file), built.bytes);
  return {
    file,
    documentType,
    name,
    description,
    fields: tags(built.xml),
    sizeBytes: built.bytes.length,
    uncompressedBytes: built.uncompressedBytes,
  };
});
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(manifest.map((m) => `${m.file}: ${m.sizeBytes} B, ${m.fields.length} znaczników`).join('\n'));
