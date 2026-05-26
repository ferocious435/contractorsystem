import { NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { syncProjectContractBase } from "@/utils/project-contract-base-server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: Request) {
    try {
        const authClient = await createAuthClient();
        const {
            data: { user },
        } = await authClient.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const requestedProjectIds = Array.isArray(body.projectIds)
            ? body.projectIds
            : body.projectId
              ? [body.projectId]
              : [];

        if (!requestedProjectIds.length) {
            return NextResponse.json({ error: "projectId or projectIds is required" }, { status: 400 });
        }

        const admin = createAdminClient(supabaseUrl, serviceRoleKey);

        const { data: ownedProjects, error: projectsError } = await admin
            .from("projects")
            .select("id")
            .eq("contractor_id", user.id)
            .in("id", requestedProjectIds);

        if (projectsError) {
            throw projectsError;
        }

        const ownedIds = (ownedProjects || []).map((project) => project.id);

        const results = [];
        for (const projectId of ownedIds) {
            const resolution = await syncProjectContractBase(admin as any, projectId);
            results.push({
                projectId,
                amount: resolution.amount,
                sourceTitle: resolution.sourceTitle,
                strategy: resolution.strategy,
            });
        }

        return NextResponse.json({ results });
    } catch (error: any) {
        console.error("[sync-contract-base] Error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to sync project contract amount" },
            { status: 500 }
        );
    }
}
