export function renderReferencePage(params: {
    title: string; text: string; page: number; totalPages: number; projectId: string; referenceId: string;
}) {
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const link = (page: number, label: string) => `<a href="${escape(`/api/reference-library/text?${new URLSearchParams({
        projectId: params.projectId, referenceId: params.referenceId, page: String(page),
    }).toString()}`)}">${label}</a>`;
    return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(params.title)}</title><style>body{font-family:Arial,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;line-height:1.8}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}nav{display:flex;gap:2rem;align-items:center}</style>
<h1>${escape(params.title)}</h1><nav>${params.page > 1 ? link(params.page - 1, 'העמוד הקודם') : ''}
<span>עמוד ${params.page}${params.totalPages ? ` מתוך ${params.totalPages}` : ''}</span>
${params.page < params.totalPages ? link(params.page + 1, 'העמוד הבא') : ''}</nav><pre>${escape(params.text)}</pre></html>`;
}
