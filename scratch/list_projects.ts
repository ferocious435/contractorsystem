
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("--- Projects ---");
    const { data: projects, error: pError } = await supabase.from("projects").select("id, name");
    if (pError) {
        console.error("Error fetching projects:", pError);
        return;
    }

    for (const project of projects) {
        const { data: docs } = await supabase.from("documents").select("category").eq("project_id", project.id);
        const categories = docs?.map(d => d.category) || [];
        const hasContract = categories.some(c => ["CONTRACT", "BOQ", "SPECS"].includes(c));
        const hasExecution = categories.some(c => ["EXECUTION", "SITE_REPORT"].includes(c));

        console.log(`Project: ${project.name} (${project.id})`);
        console.log(`- Docs: ${categories.length}`);
        console.log(`- Has Contract: ${hasContract}`);
        console.log(`- Has Execution: ${hasExecution}`);
        
        if (hasContract && hasExecution) {
            console.log("  => READY FOR SCAN");
        }
    }
}

main();
