import { NextResponse } from "next/server";
import { createClient as createAuthClient } from "@/utils/supabase/server";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { syncProjectContractBase } from "@/utils/project-contract-base-server";
import { syncContractBoqToLedger } from "@/utils/pricing-ledger-contract-sync";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isInvalidServiceRoleError(error: unknown) {
    if (!error || typeof error !== "object") {
        return false;
    }

    const candidate = error as { message?: unknown; code?: unknown; status?: unknown };
    const message = String(candidate.message || "").toLowerCase();
    const code = String(candidate.code || "").toLowerCase();
    const status = Number(candidate.status || 0);

    return status === 401
        || code === "invalid_api_key"
        || message.includes("invalid api key")
        || message.includes("jwt");
}

async function fetchOwnedProjects(
    supabase: SupabaseClient,
    requestedProjectIds: string[],
    userId: string,
) {
    return supabase
        .from("projects")
        .select("id")
        .eq("contractor_id", userId)
        .in("id", requestedProjectIds);
}

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
        const requestedPricelistIds = Array.isArray(body.pricelistIds)
            ? body.pricelistIds.filter((id: unknown) => typeof id === "string")
            : [];
        const forceContractBoq = Boolean(body.forceContractBoq && requestedPricelistIds.length);

        if (!requestedProjectIds.length) {
            return NextResponse.json({ error: "projectId or projectIds is required" }, { status: 400 });
        }

        let dataClient = serviceRoleKey
            ? createAdminClient(supabaseUrl, serviceRoleKey)
            : authClient;

        let { data: ownedProjects, error: projectsError } = await fetchOwnedProjects(
            dataClient,
            requestedProjectIds,
            user.id,
        );

        if (projectsError && dataClient !== authClient && isInvalidServiceRoleError(projectsError)) {
            console.warn("[sync-contract-base] Service role key is not usable; falling back to the authenticated user session.");
            dataClient = authClient;
            const fallbackResult = await fetchOwnedProjects(dataClient, requestedProjectIds, user.id);
            ownedProjects = fallbackResult.data;
            projectsError = fallbackResult.error;
        }

        if (projectsError) {
            throw projectsError;
        }

        const ownedIds = (ownedProjects || []).map((project) => project.id);

        const results = [];
        for (const projectId of ownedIds) {
            const resolution = await syncProjectContractBase(dataClient, projectId);
            const ledgerSync = await syncContractBoqToLedger(dataClient, projectId, {
                pricelistIds: requestedPricelistIds.length ? requestedPricelistIds : undefined,
                forceContractBoq,
                contractorId: user.id,
            });

            results.push({
                projectId,
                amount: resolution.amount,
                sourceTitle: resolution.sourceTitle,
                strategy: resolution.strategy,
                ledgerSync,
            });
        }

        return NextResponse.json({ results });
    } catch (error: unknown) {
        console.error("[sync-contract-base] Error:", error);
        const message = error instanceof Error ? error.message : "Failed to sync project contract amount";
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
