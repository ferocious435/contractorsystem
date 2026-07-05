import type { SupabaseClient } from "@supabase/supabase-js";

export const DOCUMENTS_BUCKET = "documents";

type DocumentStorageRecord = {
    title?: string | null;
    file_url?: string | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
};

export type DocumentPreviewKind = "pdf" | "image" | "text" | "office" | "unsupported";

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".txt": "text/plain; charset=utf-8",
    ".text": "text/plain; charset=utf-8",
    ".log": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".html": "text/plain; charset=utf-8",
    ".htm": "text/plain; charset=utf-8",
    ".ifc": "text/plain; charset=utf-8",
    ".dxf": "text/plain; charset=utf-8",
    ".reg": "text/plain; charset=utf-8",
    ".boq": "text/plain; charset=utf-8",
    ".bq": "text/plain; charset=utf-8",
    ".qty": "text/plain; charset=utf-8",
    ".tlv": "text/plain; charset=utf-8",
    ".skn": "text/plain; charset=utf-8",
};

const OFFICE_CONTENT_TYPES_BY_ZIP_MARKER: Array<[string, string]> = [
    ["word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["mimetypeapplication/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.text"],
    ["mimetypeapplication/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.spreadsheet"],
    ["mimetypeapplication/vnd.oasis.opendocument.presentation", "application/vnd.oasis.opendocument.presentation"],
];

function cleanPath(value: string) {
    return decodeURIComponent(value.split("?")[0].replace(/^\/+/, ""));
}

function getFileExtension(value?: string | null) {
    const path = String(value || "").trim().toLowerCase().split("?")[0];
    return path.match(/\.[a-z0-9]{1,12}$/)?.[0] || "";
}

export function getDocumentStorageBucket(doc: DocumentStorageRecord) {
    return doc.storage_bucket || DOCUMENTS_BUCKET;
}

export function getDocumentStoragePath(doc: DocumentStorageRecord) {
    if (doc.storage_path) {
        return cleanPath(doc.storage_path);
    }

    const fileUrl = String(doc.file_url || "").trim();
    if (!fileUrl) {
        return null;
    }

    if (!/^https?:\/\//i.test(fileUrl)) {
        return cleanPath(fileUrl);
    }

    const match = fileUrl.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/([^?#]+)/);
    if (!match) {
        return null;
    }

    return cleanPath(match[2]);
}

export function isPdfDocument(doc: DocumentStorageRecord) {
    const title = String(doc.title || "").toLowerCase();
    const path = String(getDocumentStoragePath(doc) || doc.file_url || "").toLowerCase();
    return title.endsWith(".pdf") || path.endsWith(".pdf") || path.includes(".pdf");
}

export function getDocumentFileName(doc: DocumentStorageRecord) {
    const title = String(doc.title || "").trim();
    if (title) return title;

    const storagePath = getDocumentStoragePath(doc);
    const lastSegment = storagePath?.split("/").filter(Boolean).pop();
    return lastSegment || "document";
}

export function getDocumentContentType(doc: DocumentStorageRecord, buffer?: Buffer) {
    if (buffer?.subarray(0, 1024).toString("latin1").includes("%PDF-")) {
        return "application/pdf";
    }

    if (buffer && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "image/jpeg";
    }

    if (
        buffer
        && buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47
        && buffer[4] === 0x0d
        && buffer[5] === 0x0a
        && buffer[6] === 0x1a
        && buffer[7] === 0x0a
    ) {
        return "image/png";
    }

    if (
        buffer
        && buffer.length >= 12
        && buffer.subarray(0, 4).toString("ascii") === "RIFF"
        && buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
        return "image/webp";
    }

    if (
        buffer
        && buffer.length >= 6
        && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a")
    ) {
        return "image/gif";
    }

    if (
        buffer
        && buffer.length >= 4
        && buffer[0] === 0x50
        && buffer[1] === 0x4b
        && [0x03, 0x05, 0x07].includes(buffer[2])
    ) {
        const zipSample = buffer.subarray(0, Math.min(buffer.length, 2_000_000)).toString("latin1");
        const officeMatch = OFFICE_CONTENT_TYPES_BY_ZIP_MARKER.find(([marker]) => zipSample.includes(marker));
        if (officeMatch) return officeMatch[1];
    }

    return (
        CONTENT_TYPES_BY_EXTENSION[getFileExtension(doc.title)]
        || CONTENT_TYPES_BY_EXTENSION[getFileExtension(getDocumentStoragePath(doc))]
        || CONTENT_TYPES_BY_EXTENSION[getFileExtension(doc.file_url)]
        || "application/octet-stream"
    );
}

export function getDocumentPreviewKind(doc: DocumentStorageRecord, contentType = getDocumentContentType(doc)): DocumentPreviewKind {
    const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase() || "";
    const extension = getFileExtension(doc.title) || getFileExtension(getDocumentStoragePath(doc)) || getFileExtension(doc.file_url);

    if (normalizedContentType === "application/pdf" || extension === ".pdf") return "pdf";
    if (normalizedContentType.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) return "image";
    if (normalizedContentType.startsWith("text/") || ["application/json", "application/xml"].includes(normalizedContentType)) return "text";
    if (
        normalizedContentType.includes("word")
        || normalizedContentType.includes("excel")
        || normalizedContentType.includes("spreadsheet")
        || normalizedContentType.includes("presentation")
        || normalizedContentType.includes("opendocument")
        || [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp"].includes(extension)
    ) return "office";

    return "unsupported";
}

export async function createDocumentSignedUrl(supabase: SupabaseClient, doc: DocumentStorageRecord, expiresInSeconds = 300) {
    const path = getDocumentStoragePath(doc);
    if (!path) {
        throw new Error("Document storage path is missing");
    }

    const { data, error } = await supabase
        .storage
        .from(getDocumentStorageBucket(doc))
        .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
        throw new Error(error?.message || "Failed to create signed document URL");
    }

    return data.signedUrl;
}

export async function downloadDocumentBuffer(supabase: SupabaseClient, doc: DocumentStorageRecord) {
    const path = getDocumentStoragePath(doc);

    if (path) {
        const { data, error } = await supabase
            .storage
            .from(getDocumentStorageBucket(doc))
            .download(path);

        if (error || !data) {
            throw new Error(error?.message || "Failed to download document from storage");
        }

        return Buffer.from(await data.arrayBuffer());
    }


    throw new Error("Document storage path is missing");
}
