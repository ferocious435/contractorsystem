
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const projectId = "d7362181-c47b-46b5-b0c8-3e53bf9058eb";

    const { data: docs } = await supabase.from("documents").select("title, category, extracted_text").eq("project_id", projectId);
    
    if (!docs) return;

    const contract = docs.find(d => d.category === 'CONTRACT');
    const execution = docs.find(d => d.category === 'EXECUTION');

    console.log("--- CONTRACT SAMPLE ---");
    console.log(contract?.extracted_text?.substring(0, 5000));
    console.log("\n--- EXECUTION SAMPLE ---");
    console.log(execution?.extracted_text?.substring(0, 5000));
}

main();
