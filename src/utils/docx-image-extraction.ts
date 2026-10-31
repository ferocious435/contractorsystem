import { createHash } from 'node:crypto';
import path from 'node:path';
import type { OfficeContentNode, OfficeParserAST } from 'officeparser';
import { extractImageTextLocally } from '@/utils/local-document-ocr';
import { DOCX_READING_VERSION, hasDocumentBodyText, type DocxReadingVerification } from '@/utils/document-source-readiness';

type ZipFile = { path: string; content: Buffer };
type ImageRecord = DocxReadingVerification['images'][number];
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const VML_NS = 'urn:schemas-microsoft-com:vml';
const OFFICE_NS = 'urn:schemas-microsoft-com:office:office';
const BODY_PART = /^word\/(?:document\d*|header\d*|footer\d*|footnotes\d*|endnotes\d*|comments\d*)\.xml$/;
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

// Keep all package access behind the already installed Office parser, including its ZIP size limits.
async function packageTools() {
    // Keep Node's loader native. Webpack substitutes static createRequire calls
    // and package resolution with its own module IDs (or undefined for dynamic paths).
    const nodeModule = await import(/* webpackIgnore: true */ 'node:module');
    const entry = path.join(process.cwd(), 'node_modules', 'officeparser', 'dist', 'index.js');
    const loadModule = nodeModule.createRequire(path.join(process.cwd(), 'package.json'));
    const officeLoad = nodeModule.createRequire(entry);
    const { extractFiles } = loadModule(path.join(path.dirname(entry), 'utils/zipUtils.js')) as {
        extractFiles: (buffer: Buffer, filter: (name: string) => boolean, limits: Record<string, number>) => Promise<ZipFile[]>;
    };
    const { parseXmlString, serializeXml } = loadModule(path.join(path.dirname(entry), 'utils/xmlUtils.js')) as {
        parseXmlString: (xml: string) => Document;
        serializeXml: (node: Node) => string;
    };
    const { zipSync } = officeLoad('fflate') as { zipSync: (files: Record<string, Uint8Array>) => Uint8Array };
    return { extractFiles, parseXmlString, serializeXml, zipSync };
}

function elements(node: Node): Element[] {
    return Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1);
}

function descendants(node: Node, predicate: (element: Element) => boolean): Element[] {
    return elements(node).flatMap((child) => [ ...(predicate(child) ? [child] : []), ...descendants(child, predicate) ]);
}

/** Word's explicit standard horizontal rule carries no textual/image content.
 * Other VML shapes, text boxes, packages and links still require review.
 * OOXML attribute reference: Microsoft VML Horizontal/HorizontalStandard. */
function isStandardHorizontalRule(node: Element): boolean {
    const children = elements(node), shape = children[0];
    return node.namespaceURI === WORD_NS && node.localName === 'pict' && children.length === 1
        && shape.namespaceURI === VML_NS && ['rect', 'line'].includes(shape.localName)
        && ['t','true','1'].includes(shape.getAttributeNS(OFFICE_NS,'hr') || '')
        && ['t','true','1'].includes(shape.getAttributeNS(OFFICE_NS,'hrstd') || '')
        && elements(shape).length === 0 && !(shape.textContent || '').trim()
        && !shape.getAttributeNS(OFFICE_NS,'gfxdata') && !shape.getAttribute('href')
        && !Array.from(shape.attributes).some(attribute => attribute.namespaceURI === REL_NS);
}

function block(record: ImageRecord, text: string) {
    return `\n[DOCX_IMAGE ${record.anchor} resource=${record.mediaName} status=${record.status} reason=${record.reason || 'none'}]\n${text}\n[END_DOCX_IMAGE]\n`;
}

/** Extract DOCX text with a source inventory independent of the AST's image nodes. */
export async function extractDocxWithImages(
    buffer: Buffer,
    options: { recognizeImage?: typeof extractImageTextLocally } = {},
): Promise<{ text: string; requiresReview: boolean; readingVerification: DocxReadingVerification }> {
    const tools = await packageTools();
    const files = await tools.extractFiles(buffer, () => true, { maxUncompressedBytes: 512 * 1024 * 1024, maxZipEntries: 10000 });
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const sourceHash = sha256(buffer);
    const verification: DocxReadingVerification = {
        version: DOCX_READING_VERSION, sourceHash, complete: false,
        expectedImageReferences: 0, images: [], issues: [],
    };
    const recognize = options.recognizeImage || extractImageTextLocally;
    const cache = new Map<string, Promise<{ text: string; confidence: number }>>();
    const replacements = new Map<string, { record: ImageRecord; text: string }>();
    const normalizedParts = new Map<string, Document>();
    const issue = (message: string) => { if (!verification.issues.includes(message)) verification.issues.push(message); };
    const wordParts = files.filter((file) => BODY_PART.test(file.path));
    if (!wordParts.some((file) => file.path === 'word/document.xml')) throw new Error('DOCX_MAIN_PART_MISSING');

    for (const file of wordParts) {
        const doc = tools.parseXmlString(file.content.toString('utf8'));
        const relPath = path.posix.join(path.posix.dirname(file.path), '_rels', `${path.posix.basename(file.path)}.rels`);
        const relXml = byPath.get(relPath);
        const relationships = relXml ? descendants(tools.parseXmlString(relXml.toString('utf8')), (el) => el.localName === 'Relationship') : [];
        const rels = new Map(relationships.map((el) => [el.getAttribute('Id'), { target: el.getAttribute('Target') || '', external: el.getAttribute('TargetMode') === 'External', type: el.getAttribute('Type') || '' }]));
        const imageId = (el: Element) => el.getAttributeNS(REL_NS, 'embed') || el.getAttributeNS(REL_NS, 'link') || el.getAttributeNS(REL_NS, 'id') || '';
        let occurrence = 0;
        const visit = async (node: Node): Promise<void> => {
            for (const child of elements(node)) {
                if (child.localName === 'AlternateContent') {
                    const branches = elements(child);
                    const branch = branches.find((el) => el.localName === 'Choice' && descendants(el, (x) => ['blip', 'imagedata'].includes(x.localName)).length)
                        || branches.find((el) => el.localName === 'Fallback') || branches[0];
                    if (branch) {
                        for (const nested of Array.from(branch.childNodes)) node.insertBefore(nested.cloneNode(true), child);
                    } else issue(`${file.path}:EMPTY_ALTERNATE_CONTENT`);
                    node.removeChild(child);
                    // Restart this container after resolving one alternate branch.
                    return visit(node);
                }
                if (['drawing', 'pict', 'object', 'altChunk'].includes(child.localName)) {
                    const refs = descendants(child, (el) => ['blip', 'imagedata'].includes(el.localName) || Boolean(rels.get(imageId(el))?.type.endsWith('/image')));
                    const unsupported = ['object', 'altChunk'].includes(child.localName) || (!refs.length && !isStandardHorizontalRule(child));
                    if (unsupported) issue(`${file.path}:UNSUPPORTED_${child.localName.toUpperCase()}`);
                    const drawingText = descendants(child, (el) => el.namespaceURI === WORD_NS && el.localName === 't')
                        .map((el) => el.textContent || '');
                    if (drawingText.some((value) => value.trim())) issue(`${file.path}:DRAWING_TEXT_LAYOUT_UNVERIFIED`);
                    const tokens: string[] = [];
                    for (const ref of refs) {
                        const id = imageId(ref);
                        const rel = rels.get(id);
                        const resource = rel?.target ? path.posix.normalize(rel.target.startsWith('/') ? rel.target.slice(1) : path.posix.join(path.posix.dirname(file.path), rel.target)) : '';
                        const bytes = byPath.get(resource);
                        const record: ImageRecord = {
                            anchor: `${file.path}#${id || 'missing'}:${++occurrence}`,
                            part: file.path, mediaName: resource || id || 'missing-resource', sha256: bytes ? sha256(bytes) : null,
                            status: 'UNREADABLE', confidence: null, numericReviewRequired: false, reason: null,
                        };
                        let text = '';
                        if (!rel) record.reason = 'RELATIONSHIP_MISSING';
                        else if (rel.external || /^[a-z][a-z\d+.-]*:/i.test(rel.target) || !resource.startsWith('word/')) record.reason = 'EXTERNAL_OR_UNSAFE_IMAGE';
                        else if (!bytes?.length) record.reason = 'IMAGE_MISSING_OR_EMPTY';
                        else if (!/\.(?:png|jpe?g|bmp|gif|tiff?|webp)$/i.test(resource)) record.reason = 'IMAGE_FORMAT_UNSUPPORTED';
                        else {
                            try {
                                if (!cache.has(record.sha256!)) cache.set(record.sha256!, recognize(bytes));
                                const result = await cache.get(record.sha256!)!;
                                text = String(result.text || '').trim();
                                record.confidence = Number.isFinite(result.confidence) ? result.confidence : null;
                                record.numericReviewRequired = /\p{N}/u.test(text);
                                if (!hasDocumentBodyText(text)) record.reason = 'OCR_NO_READABLE_BODY';
                                else if (record.confidence === null || record.confidence < 65 || record.confidence > 100) { record.status = 'REQUIRES_REVIEW'; record.reason = 'OCR_LOW_CONFIDENCE'; }
                                else if (record.numericReviewRequired) { record.status = 'REQUIRES_REVIEW'; record.reason = 'OCR_NUMBERS_REQUIRE_REVIEW'; }
                                else record.status = 'READ';
                            } catch { record.reason = 'OCR_FAILED'; }
                        }
                        verification.images.push(record);
                        const token = `CS_DOCX_IMAGE_${sourceHash.slice(0, 16)}_${verification.images.length}_END`;
                        replacements.set(token, { record, text });
                        tokens.push(token);
                    }
                    const marker = doc.createElementNS(WORD_NS, 'w:t');
                    marker.setAttribute('xml:space', 'preserve');
                    marker.appendChild(doc.createTextNode([...tokens, ...drawingText].join('\n')));
                    node.replaceChild(marker, child);
                } else await visit(child);
            }
        };
        await visit(doc);
        normalizedParts.set(file.path, doc);
        byPath.set(file.path, Buffer.from(tools.serializeXml(doc), 'utf8'));
    }
    verification.expectedImageReferences = verification.images.length;

    const { OfficeParser } = await import('officeparser');
    const ast = await OfficeParser.parseOffice(Buffer.from(tools.zipSync(Object.fromEntries(byPath))), {
        fileType: 'docx', ocr: false, extractAttachments: false, newlineDelimiter: '\n',
    }) as OfficeParserAST;
    for (const warning of ast.warnings || []) issue(`PARSER:${warning.code}`);
    const consumed = new Set<string>();
    const replace = (value: string) => {
        let result = value;
        for (const [token, data] of replacements) {
            if (result.includes(token)) { consumed.add(token); result = result.replaceAll(token, block(data.record, data.text)); }
        }
        return result;
    };
    const onNode = (node: OfficeContentNode) => node.type === 'text' ? replace(node.text || '') : undefined;
    const render = async (nodes: OfficeContentNode[]) => {
        const original = ast.content;
        ast.content = nodes;
        try { return String((await ast.to('text', { textConfig: { preserveLayout: true }, onNode })).value || ''); }
        finally { ast.content = original; }
    };
    let text = await render(ast.content);
    for (const [name, nodes] of Object.entries(ast.auxiliary || {})) {
        if (Array.isArray(nodes) && nodes.length) text += `\n[DOCX_PART ${name}]\n${await render(nodes)}\n[END_DOCX_PART]\n`;
    }
    // Unreferenced notes or structures unsupported by the AST remain available, explicitly incomplete.
    for (const [part, doc] of normalizedParts) {
        const missing = [...replacements].filter(([token, data]) => data.record.part === part && !consumed.has(token));
        const native = descendants(doc, (el) => el.namespaceURI === WORD_NS && el.localName === 't').map((el) => el.textContent || '');
        const unrendered = native.map((value) => {
            let remaining = value;
            for (const token of consumed) remaining = remaining.replaceAll(token, '');
            return remaining;
        }).filter((value) => value.trim() && !text.replace(/\s+/g, ' ').includes(value.replace(/\s+/g, ' ').trim()));
        if (missing.length || unrendered.length) {
            issue(`${part}:CONTENT_NOT_POSITIONED_BY_PARSER`);
            text += `\n[DOCX_PART ${part} reason=CONTENT_NOT_POSITIONED_BY_PARSER]\n${replace(unrendered.join('\n'))}\n[END_DOCX_PART]\n`;
        }
    }
    verification.complete = verification.images.every((image) => image.status === 'READ' && !image.numericReviewRequired)
        && verification.issues.length === 0;
    if (verification.issues.length) text += `\n${verification.issues.map((reason) => `[DOCX_ISSUE ${reason}]`).join('\n')}`;
    return { text: text.trim(), requiresReview: !verification.complete, readingVerification: verification };
}
