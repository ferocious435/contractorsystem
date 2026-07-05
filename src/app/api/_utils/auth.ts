import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

type ApiFailure = {
    ok: false;
    response: NextResponse;
};

type ApiSuccess<T extends object = object> = {
    ok: true;
    user: User;
} & T;

export function apiError(message: string, status: number) {
    return NextResponse.json({ success: false, error: message }, { status });
}

export function unauthorized() {
    return apiError("Unauthorized", 401);
}

export function forbidden(message = "Project not found or forbidden") {
    return apiError(message, 403);
}

export async function requireUser(supabase: SupabaseClient): Promise<ApiSuccess | ApiFailure> {
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();

    if (error || !user) {
        return { ok: false, response: unauthorized() };
    }

    return { ok: true, user };
}

export async function requireOwnedProject(
    supabase: SupabaseClient,
    projectId: string
): Promise<ApiSuccess<{ project: { id: string } }> | ApiFailure> {
    const auth = await requireUser(supabase);
    if (!auth.ok) return auth;

    const { data: project, error } = await supabase
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!project) {
        return { ok: false, response: forbidden() };
    }

    return { ok: true, user: auth.user, project };
}

export async function requireOwnedDocument<TDoc extends Record<string, unknown> = Record<string, unknown>>(
    supabase: SupabaseClient,
    documentId: string,
    columns = "*"
): Promise<ApiSuccess<{ document: TDoc }> | ApiFailure> {
    const auth = await requireUser(supabase);
    if (!auth.ok) return auth;

    const { data: document, error } = await supabase
        .from("documents")
        .select(columns)
        .eq("id", documentId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!document) {
        return { ok: false, response: forbidden("Document not found or forbidden") };
    }

    return { ok: true, user: auth.user, document: document as unknown as TDoc };
}
