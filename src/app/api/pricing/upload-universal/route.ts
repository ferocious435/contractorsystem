import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { geminiFlashModel, BOQ_PARSING_PROMPT } from '@/lib/gemini';
import { syncContractBoqToLedger } from '@/utils/pricing-ledger-contract-sync';
import { parseMinistryHousingPricelistPdf } from '@/utils/ministry-housing-pricelist-parser';
import { createHash } from 'crypto';

const ALLOWED_PRICELIST_ITEM_TYPES = new Set(['CHAPTER', 'SUBCHAPTER', 'ITEM', 'NOTE']);
const UPLOAD_ITEM_BATCH_SIZE = 500;

type ParsedPricelistUploadData = {
  project_name?: string;
  client_name?: string;
  source?: unknown;
  version_label?: unknown;
  parser_version?: unknown;
  intro_text?: unknown;
  outro_text?: unknown;
  terms_text?: unknown;
  page_count?: unknown;
  parse_stats?: unknown;
  items: Array<Record<string, unknown>>;
};

type ParsedPricelistUploadDraft = Omit<ParsedPricelistUploadData, 'items'> & {
  items?: Array<Record<string, unknown>>;
};

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePricelistItemType(value: unknown) {
  const itemType = String(value || 'ITEM').toUpperCase();
  return ALLOWED_PRICELIST_ITEM_TYPES.has(itemType) ? itemType : 'ITEM';
}

function hasContractPricedQuantities(items: Array<Record<string, unknown>> | undefined) {
  return (items || []).some((item) => {
    const quantity = toNumber(item.quantity, 0);
    const unitPrice = toNumber(item.unit_price_excl_vat ?? item.rate, 0);
    return Number.isFinite(quantity) && Number.isFinite(unitPrice) && quantity > 0 && unitPrice > 0;
  });
}

function stripFinalExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '');
}

function hasParsedPricelistItems(
  parsedData: ParsedPricelistUploadDraft | null | undefined,
): parsedData is ParsedPricelistUploadData {
  return Array.isArray(parsedData?.items) && parsedData.items.length > 0;
}

function normalizeSourceType(value: unknown) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function inferPricelistSourceType(fileName: string, parsedData: ParsedPricelistUploadDraft | null | undefined) {
  const explicitSource = normalizeSourceType(parsedData?.source);
  if (explicitSource) {
    return explicitSource;
  }

  const text = `${fileName} ${parsedData?.project_name || ''} ${parsedData?.client_name || ''}`.toLowerCase();
  if (
    text.includes('housing ministry') ||
    text.includes('ministry of housing') ||
    text.includes('משהב') ||
    text.includes('משבה') ||
    text.includes('משרד הבינוי') ||
    text.includes('שיכון')
  ) {
    return 'HOUSING_MINISTRY';
  }

  if (text.includes('dekel') || text.includes('דקל')) {
    return 'DEKEL';
  }

  if (text.includes('quote') || text.includes('הצעת מחיר')) {
    return 'CONTRACTOR_QUOTE';
  }

  if (
    text.includes('boq') ||
    text.includes('tlv') ||
    text.includes('skn') ||
    text.includes('כתב כמויות') ||
    text.includes('כמויות') ||
    text.includes('לביצוע')
  ) {
    return 'PROJECT_BOQ';
  }

  return 'CUSTOM_ANALYSIS';
}

function shouldSyncUploadedPricelistToContractBoq(sourceType: string, fileName: string, parsedData: ParsedPricelistUploadData) {
  if (sourceType !== 'PROJECT_BOQ') {
    return false;
  }

  return hasContractPricedQuantities(parsedData.items) && !/מחירון|דקל|משהב|משבה|housing|ministry/i.test(fileName);
}

async function insertPricelistItemsInBatches(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemsToInsert: Array<Record<string, unknown>>,
) {
  for (let i = 0; i < itemsToInsert.length; i += UPLOAD_ITEM_BATCH_SIZE) {
    const batch = itemsToInsert.slice(i, i + UPLOAD_ITEM_BATCH_SIZE);
    const { error } = await supabase
      .from('pricelist_items')
      .insert(batch);

    if (error) {
      throw error;
    }
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  let createdPricelistId: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('projectId') as string;
    const requestedGlobal = formData.get('isGlobal') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const pricelistName = String(formData.get('name') || stripFinalExtension(file.name) || file.name);

    // 1. Получаем данные пользователя для contractor_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const canCreateGlobal = profile?.role === 'admin' || profile?.role === 'super_admin';
    if (requestedGlobal && !canCreateGlobal) {
      return NextResponse.json({ error: 'Only admins can create global pricelists' }, { status: 403 });
    }

    const isGlobal = requestedGlobal && canCreateGlobal;

    if (!projectId && !requestedGlobal) {
      return NextResponse.json({ error: 'projectId is required for project pricelist uploads' }, { status: 400 });
    }

    if (projectId) {
      const { data: ownedProject, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('contractor_id', user.id)
        .maybeSingle();

      if (projectError) throw projectError;

      if (!ownedProject) {
        return NextResponse.json({ error: 'Project not found or forbidden' }, { status: 403 });
      }
    }

    // 2. Подготовка файла для Gemini
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const base64File = fileBuffer.toString('base64');
    const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    let parsedData: ParsedPricelistUploadDraft | null = isPdf
      ? await parseMinistryHousingPricelistPdf(fileBuffer)
      : null;

    // 3. Вызов Gemini Vision для парсинга структуры
    if (!parsedData) {
      const result = await geminiFlashModel.generateContent([
        {
          inlineData: {
            data: base64File,
            mimeType: mimeType
          }
        },
        BOQ_PARSING_PROMPT
      ]);

      const responseText = result.response.text();
      const cleanJson = responseText.replace(/```json|```/g, '').trim();

      try {
        parsedData = JSON.parse(cleanJson);
      } catch {
        console.error('Failed to parse Gemini JSON:', cleanJson);
        return NextResponse.json({ error: 'AI failed to generate valid JSON structure', raw: responseText }, { status: 500 });
      }
    }

    if (!hasParsedPricelistItems(parsedData)) {
      return NextResponse.json({
        error: 'No pricelist items were extracted from this file',
        details: 'המערכת לא מצאה סעיפי מחירון בקובץ. הקובץ לא נשמר כדי לא ליצור מחירון ריק.'
      }, { status: 422 });
    }

    const sourceType = inferPricelistSourceType(file.name, parsedData);
    const contentHash = createHash('sha256').update(fileBuffer).digest('hex');
    const fileName = `${Date.now()}_${file.name}`;
    const storagePath = `${user.id}/${fileName}`;
    const storageBucket = 'documents';
    const { error: storageError } = await supabase.storage
      .from(storageBucket)
      .upload(storagePath, file);

    if (storageError) {
      throw storageError;
    }

    // 4. Создание записи в таблице pricelists
    const { data: pricelist, error: pError } = await supabase
      .from('pricelists')
      .insert({
        name: pricelistName || parsedData.project_name || file.name,
        description: `AI Parsed from ${file.name}. Client: ${parsedData.client_name || 'Unknown'}`,
        contractor_id: user.id,
        project_id: isGlobal ? null : projectId,
        is_global: isGlobal,
        source_type: sourceType,
        source_file_name: file.name,
        source_storage_bucket: storageBucket,
        source_storage_path: storagePath,
        content_hash: contentHash,
        publisher: parsedData.client_name || null,
        version_label: parsedData.version_label || null,
        parser_version: parsedData.parser_version || null,
        parse_status: 'READY',
        intro_text: parsedData.intro_text || null,
        outro_text: parsedData.outro_text || null,
        terms_text: parsedData.terms_text || null,
        metadata: {
          source: parsedData.source || sourceType,
          parse_stats: parsedData.parse_stats || null,
          page_count: parsedData.page_count || null,
        }
      })
      .select()
      .single();

    if (pError) throw pError;
    createdPricelistId = pricelist.id;

    // 5. Массовая вставка элементов (pricelist_items)
    const shouldSyncContractBoq = Boolean(
      projectId &&
      !isGlobal &&
      shouldSyncUploadedPricelistToContractBoq(sourceType, file.name, parsedData)
    );

    const itemsToInsert = parsedData.items.map((item: Record<string, unknown>, index: number) => ({
      pricelist_id: pricelist.id,
      item_code: item.item_code || '',
      description: item.description || '',
      unit: item.unit || '',
      rate: toNumber(item.unit_price_excl_vat ?? item.rate, 0),
      quantity: toNumber(item.quantity, 0),
      item_type: normalizePricelistItemType(item.type),
      notes: item.notes || null,
      page_number: item.page_number || null,
      sort_order: item.sort_order || index + 1,
      hierarchy_path: item.hierarchy_path || null,
      source_excerpt: item.source_excerpt || null,
      metadata: typeof item.metadata === 'object' && item.metadata !== null ? item.metadata : {},
      raw_row: item,
    }));

    await insertPricelistItemsInBatches(supabase, itemsToInsert);

    const ledgerSync = shouldSyncContractBoq
      ? await syncContractBoqToLedger(supabase, projectId, {
          pricelistIds: [pricelist.id],
          forceContractBoq: true,
          contractorId: user.id
        })
      : null;

    // 6. Сохраняем запись документа для истории и предпросмотра исходника
    if (projectId) {
      await supabase.from('documents').insert({
        project_id: projectId,
        title: pricelistName,
        category: 'PRICELIST',
        file_url: null,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        ai_status: 'SCANNED',
        parsed_json: parsedData
      });
    }

    return NextResponse.json({
      success: true,
      pricelistId: pricelist.id,
      ledgerSync,
      itemCount: parsedData.items?.length || 0,
      projectName: parsedData.project_name
    });

  } catch (error: unknown) {
    console.error('Universal Upload Error:', error);
    if (createdPricelistId) {
      await supabase.from('pricelists').delete().eq('id', createdPricelistId);
    }

    const details = error instanceof Error ? error.message : 'Unknown upload error';
    return NextResponse.json({
      error: 'Failed to process file',
      details
    }, { status: 500 });
  }
}
