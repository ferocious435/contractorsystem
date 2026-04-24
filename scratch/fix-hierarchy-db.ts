import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // Need service role for bulk update
const supabase = createClient(supabaseUrl, supabaseKey);


async function fixHierarchy() {
    console.log("Fixing Dekel hierarchy (v2)...");

    // 1. Mark CHAPTER (ending in ... or ..)
    // 95... is Root Section, 95.51.. is Chapter 51
    const { data: d1, error: err1 } = await supabase
        .from('pricelist_items')
        .update({ item_type: 'CHAPTER' })
        .or('item_code.like.%...,item_code.like.%..')
        .select();
    
    if (err1) console.error("Error updating CHAPTER:", err1);
    else console.log(`Updated ${d1?.length || 0} CHAPTERS (including 95.XX.. patterns)`);

    // 2. Mark SUBCHAPTER (ending in exactly one dot, like 95.51.01.)
    const { data: d2, error: err2 } = await supabase
        .from('pricelist_items')
        .update({ item_type: 'SUBCHAPTER' })
        .like('item_code', '%.')
        .not('item_code', 'like', '%..')
        .select();
    
    if (err2) console.error("Error updating SUBCHAPTER:", err2);
    else console.log(`Updated ${d2?.length || 0} SUBCHAPTERS`);

    // 3. Mark ITEM (no dots at the end)
    const { data: d3, error: err3 } = await supabase
        .from('pricelist_items')
        .update({ item_type: 'ITEM' })
        .not('item_code', 'like', '%.')
        .select();

    if (err3) console.error("Error updating ITEM:", err3);
    else console.log(`Updated ${d3?.length || 0} ITEMS`);

    console.log("Done fixing hierarchy!");
}

fixHierarchy();
