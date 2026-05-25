
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function main() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const projectId = "d7362181-c47b-46b5-b0c8-3e53bf9058eb";

    const { data: contradictions, error } = await supabase
        .from("contradictions")
        .select("*")
        .eq("project_id", projectId)
        .order("severity", { ascending: false });

    if (error) {
        console.error("Error fetching results:", error);
        return;
    }

    console.log(JSON.stringify(contradictions, null, 2));
}

main();
