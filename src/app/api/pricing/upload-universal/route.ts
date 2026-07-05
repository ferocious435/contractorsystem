import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { geminiFlashModel, BOQ_PARSING_PROMPT } from '@/lib/gemini';
import { syncContractBoqToLedger } from '@/utils/pricing-ledger-contract-sync';

const ALLOWED_PRICELIST_ITEM_TYPES = new Set(['CHAPTER', 'SUBCHAPTER', 'ITEM', 'NOTE']);

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

export async function POST(req: Request) {
  const supabase = await createClient();

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('projectId') as string;
    const pricelistName = formData.get('name') as string || file.name;
    const requestedGlobal = formData.get('isGlobal') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

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
    const base64File = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = file.type;

    // 3. Вызов Gemini Vision для парсинга структуры
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
    let parsedData;

    try {
      parsedData = JSON.parse(cleanJson);
    } catch {
      console.error('Failed to parse Gemini JSON:', cleanJson);
      return NextResponse.json({ error: 'AI failed to generate valid JSON structure', raw: responseText }, { status: 500 });
    }

    // 4. Создание записи в таблице pricelists
    const { data: pricelist, error: pError } = await supabase
      .from('pricelists')
      .insert({
        name: pricelistName || parsedData.project_name || file.name,
        description: `AI Parsed from ${file.name}. Client: ${parsedData.client_name || 'Unknown'}`,
        contractor_id: user.id,
        project_id: projectId || null,
        is_global: isGlobal
      })
      .select()
      .single();

    if (pError) throw pError;

    // 5. Массовая вставка элементов (pricelist_items)
    const shouldSyncContractBoq = Boolean(projectId && !isGlobal && hasContractPricedQuantities(parsedData.items));

    if (parsedData.items && parsedData.items.length > 0) {
      const itemsToInsert = parsedData.items.map((item: Record<string, unknown>) => ({
        pricelist_id: pricelist.id,
        item_code: item.item_code || '',
        description: item.description || '',
        unit: item.unit || '',
        rate: toNumber(item.unit_price_excl_vat ?? item.rate, 0),
        quantity: toNumber(item.quantity, 0),
        item_type: normalizePricelistItemType(item.type)
      }));

      const { error: itemsError } = await supabase
        .from('pricelist_items')
        .insert(itemsToInsert);

      if (itemsError) {
        console.error('Error inserting items:', itemsError);
        if (shouldSyncContractBoq) {
          throw itemsError;
        }
      }
    }

    const ledgerSync = shouldSyncContractBoq
      ? await syncContractBoqToLedger(supabase, projectId, {
          pricelistIds: [pricelist.id],
          forceContractBoq: true,
          contractorId: user.id
        })
      : null;

    // 6. Сохраняем сам файл в документы для истории
    const fileName = `${Date.now()}_${file.name}`;
    const storagePath = `${user.id}/${fileName}`;
    const { error: storageError } = await supabase.storage
      .from('documents')
      .upload(storagePath, file);

    if (!storageError && projectId) {
      await supabase.from('documents').insert({
        project_id: projectId,
        title: pricelistName,
        category: 'PRICELIST',
        file_url: null,
        storage_bucket: 'documents',
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
    const details = error instanceof Error ? error.message : 'Unknown upload error';
    return NextResponse.json({
      error: 'Failed to process file',
      details
    }, { status: 500 });
  }
}
