import { PDFParse } from 'pdf-parse';

export interface MinistryHousingPricelistItem {
  [key: string]: unknown;
  item_code: string;
  description: string;
  type: 'CHAPTER' | 'SUBCHAPTER' | 'ITEM' | 'NOTE';
  unit: string | null;
  quantity: number;
  unit_price_excl_vat: number;
}

export interface MinistryHousingPricelistParseResult {
  project_name: string;
  client_name: string;
  source: 'HOUSING_MINISTRY';
  items: MinistryHousingPricelistItem[];
}

interface RawMinistryHousingBlock {
  item: string;
  subchapter: string;
  chapter: string;
  parts: string[];
}

const ROW_START_RE = /^(\d{4})\s+(\d{3})\s+(\d{1,2})(?:\s+(.*))?$/;
const MONEY_RE = /^-?\d+(?:,\d{3})*(?:\.\d+)?$/;
const TRAILING_UNIT_AND_PRICE_RE = /^(.*)\s+(\S{1,16})\s+(-?\d+(?:,\d{3})*(?:\.\d+)?)$/;
const PAGE_MARKER_RE = /^-- \d+ of \d+ --$/;
const PAGE_FOOTER_RE = /^\d+\s+2025/;
const MIN_ITEMS_FOR_TRUSTED_PARSE = 20;

const APPENDIX_STOP_PHRASES = [
  'קבוצות עצים לצורך תמחור',
  'הנחיות לבחירת מתקני משחק',
  'הנחיות לבחירת ריהוט',
];

function normalizeSpaces(value: unknown) {
  return String(value || '')
    .replace(/[\u00a0\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMoney(value: unknown) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldSkipPdfLine(line: string) {
  return (
    !line ||
    PAGE_MARKER_RE.test(line) ||
    PAGE_FOOTER_RE.test(line) ||
    (line.includes('סעיף') && line.includes('תיאור') && line.includes('מחיר')) ||
    line.includes('מחירון משרד הבינוי והשיכון לעבודות פיתוח וסלילה')
  );
}

function getAppendixStopIndex(line: string) {
  const indexes = APPENDIX_STOP_PHRASES
    .map((phrase) => line.indexOf(phrase))
    .filter((index) => index >= 0);

  return indexes.length ? Math.min(...indexes) : -1;
}

function isAtAppendixBoundary(line: string, currentBlock: RawMinistryHousingBlock | null) {
  const chapterNumber = Number(currentBlock?.chapter || 0);
  return chapterNumber >= 90 && getAppendixStopIndex(line) >= 0;
}

function buildItemCode(block: RawMinistryHousingBlock) {
  const chapter = block.chapter.padStart(2, '0');
  const subchapter = block.subchapter.padStart(3, '0');
  const item = block.item.padStart(4, '0');

  if (item === '0000' && subchapter === '000') {
    return chapter;
  }

  if (item === '0000') {
    return `${chapter}.${subchapter}`;
  }

  return `${chapter}.${subchapter}.${item}`;
}

function getItemType(
  block: RawMinistryHousingBlock,
  unit: string | null,
  price: number,
): MinistryHousingPricelistItem['type'] {
  if (block.item === '0000' && block.subchapter === '000') {
    return 'CHAPTER';
  }

  if (block.item === '0000') {
    return 'SUBCHAPTER';
  }

  if (price === 0 || unit === 'הערה') {
    return 'NOTE';
  }

  return 'ITEM';
}

function extractDescriptionUnitAndPrice(parts: string[]) {
  const raw = parts.join('\t');
  const fields = raw
    .split(/\t+/)
    .map(normalizeSpaces)
    .filter(Boolean);

  let price = 0;
  let unit: string | null = null;
  let descriptionFields = fields;

  const lastField = fields.at(-1);
  if (lastField && MONEY_RE.test(lastField)) {
    price = parseMoney(lastField);
    descriptionFields = fields.slice(0, -1);

    if (descriptionFields.length) {
      unit = descriptionFields.at(-1) || null;
      descriptionFields = descriptionFields.slice(0, -1);
    }
  } else {
    const trailingMatch = normalizeSpaces(raw).match(TRAILING_UNIT_AND_PRICE_RE);
    if (trailingMatch) {
      descriptionFields = [trailingMatch[1]];
      unit = normalizeSpaces(trailingMatch[2]) || null;
      price = parseMoney(trailingMatch[3]);
    }
  }

  return {
    description: normalizeSpaces(descriptionFields.join(' ')),
    unit,
    price,
  };
}

function collectRawBlocks(text: string) {
  const blocks: RawMinistryHousingBlock[] = [];
  let currentBlock: RawMinistryHousingBlock | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();

    if (isAtAppendixBoundary(line, currentBlock) && currentBlock) {
      const stopIndex = getAppendixStopIndex(line);
      line = line.slice(0, stopIndex).trim();
      if (line) {
        currentBlock.parts.push(line);
      }
      break;
    }

    if (shouldSkipPdfLine(line)) {
      continue;
    }

    const rowMatch = line.match(ROW_START_RE);
    if (rowMatch) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }

      currentBlock = {
        item: rowMatch[1],
        subchapter: rowMatch[2],
        chapter: rowMatch[3],
        parts: rowMatch[4] ? [rowMatch[4]] : [],
      };
      continue;
    }

    if (currentBlock) {
      currentBlock.parts.push(line);
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
}

function parseMinistryHousingText(text: string): MinistryHousingPricelistItem[] {
  if (!text.includes('משרד הבינוי והשיכון') || !text.includes('מחירון')) {
    return [];
  }

  return collectRawBlocks(text)
    .map((block) => {
      const { description, unit, price } = extractDescriptionUnitAndPrice(block.parts);

      if (!description) {
        return null;
      }

      return {
        item_code: buildItemCode(block),
        description,
        type: getItemType(block, unit, price),
        unit,
        quantity: 1,
        unit_price_excl_vat: price,
      } satisfies MinistryHousingPricelistItem;
    })
    .filter((item): item is MinistryHousingPricelistItem => Boolean(item));
}

export async function parseMinistryHousingPricelistPdf(
  data: Buffer | Uint8Array,
): Promise<MinistryHousingPricelistParseResult | null> {
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    const items = parseMinistryHousingText(result.text);
    const pricedItems = items.filter((item) => item.type === 'ITEM' && item.unit_price_excl_vat > 0);

    if (pricedItems.length < MIN_ITEMS_FOR_TRUSTED_PARSE) {
      return null;
    }

    return {
      project_name: 'מחירון משרד הבינוי והשיכון לעבודות פיתוח וסלילה',
      client_name: 'משרד הבינוי והשיכון',
      source: 'HOUSING_MINISTRY',
      items,
    };
  } finally {
    await parser.destroy();
  }
}
