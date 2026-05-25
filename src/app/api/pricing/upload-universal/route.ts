import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { geminiFlashModel, BOQ_PARSING_PROMPT } from '@/lib/gemini';

export async function POST(req: Request) {
  const supabase = await createClient();
  
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const projectId = formData.get('projectId') as string;
    const pricelistName = formData.get('name') as string || file.name;
    const isGlobal = formData.get('isGlobal') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // 1. Получаем данные пользователя для contractor_id
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    } catch (e) {
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
    if (parsedData.items && parsedData.items.length > 0) {
      const itemsToInsert = parsedData.items.map((item: any) => ({
        pricelist_id: pricelist.id,
        item_code: item.item_code || '',
        description: item.description || '',
        unit: item.unit || '',
        rate: item.unit_price_excl_vat || 0,
        quantity: item.quantity || 0,
        item_type: item.type || 'ITEM' // Используем тип от AI (CHAPTER, SUBCHAPTER, NOTE, ITEM)
      }));

      const { error: itemsError } = await supabase
        .from('pricelist_items')
        .insert(itemsToInsert);

      if (itemsError) {
        console.error('Error inserting items:', itemsError);
        // Не прерываем, так как прайс-лист уже создан
      }
    }

    // 6. Сохраняем сам файл в документы для истории
    const fileName = `${Date.now()}_${file.name}`;
    const { data: storageData, error: storageError } = await supabase.storage
      .from('documents')
      .upload(`${user.id}/${fileName}`, file);

    if (!storageError) {
      const { data: publicUrl } = supabase.storage
        .from('documents')
        .getPublicUrl(`${user.id}/${fileName}`);

      await supabase.from('documents').insert({
        project_id: projectId || null,
        title: pricelistName,
        category: 'PRICELIST',
        file_url: publicUrl.publicUrl,
        ai_status: 'SCANNED',
        parsed_json: parsedData
      });
    }

    return NextResponse.json({
      success: true,
      pricelistId: pricelist.id,
      itemCount: parsedData.items?.length || 0,
      projectName: parsedData.project_name
    });

  } catch (error: any) {
    console.error('Universal Upload Error:', error);
    return NextResponse.json({ 
      error: 'Failed to process file', 
      details: error.message 
    }, { status: 500 });
  }
}
