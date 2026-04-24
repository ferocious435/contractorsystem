import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function loadDekel() {
  console.log('Loading Dekel Pricelist...');

  // 1. Get a contractor ID (we just take the first one for the demo)
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .limit(1);

  if (profileError || !profiles || profiles.length === 0) {
    console.error('Could not find a contractor profile', profileError);
    return;
  }
  const contractorId = profiles[0].id;
  console.log(`Using Contractor ID: ${contractorId}`);

  // 2. Read Excel
  const excelPath = 'C:\\Users\\SergeyRaihshtat\\Documents\\MASHMAUET\\HOMER\\DEKEL\\כל חוזה דקל 17.6.25.xlsx';
  if (!fs.existsSync(excelPath)) {
    console.error(`Excel file not found at ${excelPath}`);
    return;
  }

  const workbook = xlsx.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Skip header, get array of arrays
  const data: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  // 3. Create Pricelist
  const { data: pricelist, error: plError } = await supabase
    .from('pricelists')
    .insert({
      contractor_id: contractorId,
      name: 'מחירון דקל 17.6.25',
      description: 'מחירון דקל מיובא אוטומטית',
      is_global: true
    })
    .select()
    .single();

  if (plError || !pricelist) {
    console.error('Failed to create pricelist:', plError);
    return;
  }

  console.log(`Created Pricelist: ${pricelist.id}`);

  // 4. Parse Items
  // Columns: 'סוג שירות' (0), 'פריט SSC' (1), 'טקסט ארוך' (2), 'מספר פעילות' (3), 'כמות' (4), 'יחידת מידה בסיסית' (5), 'תעריף' (6)
  
  const itemsToInsert = [];
  
  for (let i = 1; i < data.length; i++) { // Skip header row 0
    const row = data[i];
    if (!row || row.length < 2) continue;
    
    const service_type = row[0] ? String(row[0]) : '';
    const item_code = row[1] ? String(row[1]) : '';
    const description = row[2] ? String(row[2]) : '';
    const activity_number = row[3] ? String(row[3]) : '';
    const quantity = parseFloat(row[4]) || 0;
    const unit = row[5] ? String(row[5]).trim() : '';
    const rate = parseFloat(row[6]) || 0;

    // Determine type
    // If rate is 0 and unit is empty, it might be a chapter or subchapter.
    // Let's use item_code format.
    // e.g., '95...' -> CHAPTER
    // '95.01..' -> SUBCHAPTER
    // Otherwise -> ITEM
    let item_type = 'ITEM';
    if (item_code.endsWith('...')) {
        item_type = 'CHAPTER';
    } else if (item_code.endsWith('..') || item_code.endsWith('.')) {
        item_type = 'SUBCHAPTER';
    }

    itemsToInsert.push({
      pricelist_id: pricelist.id,
      item_type,
      item_code,
      description,
      unit: unit || null,
      quantity,
      rate,
      service_type,
      activity_number: activity_number || null
    });
  }

  console.log(`Parsed ${itemsToInsert.length} items. Inserting in batches...`);

  // 5. Insert in batches of 1000
  const BATCH_SIZE = 1000;
  for (let i = 0; i < itemsToInsert.length; i += BATCH_SIZE) {
    const batch = itemsToInsert.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('pricelist_items').insert(batch);
    if (error) {
      console.error(`Error inserting batch ${i}:`, error);
    } else {
      console.log(`Inserted ${i + batch.length}/${itemsToInsert.length} items`);
    }
  }

  console.log('Finished loading Dekel!');
}

loadDekel().catch(console.error);
