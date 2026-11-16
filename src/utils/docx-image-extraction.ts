import { createHash } from 'node:crypto';
import path from 'node:path';
import type { OfficeContentNode, OfficeParserAST } from 'officeparser';
import { extractImageTextLocally } from '@/utils/local-document-ocr';
import { DOCX_READING_VERSION, hasDocumentBodyText, type DocxReadingVerification } from '@/utils/document-source-readiness';

type ZipFile = { path: string; content: Buffer };
type ImageRecord = DocxReadingVerification['images'][number];
export type DocxImageRecord = ImageRecord;
export type WordLayoutShape={part:string;paragraph:number;name:string;issue:string};
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
    options: { onLayout?:(bytes:Buffer,shapes:WordLayoutShape[])=>void; recognizeImage?:(imageBuffer:Buffer)=>Promise<{text:string;confidence:number}>; onImage?:(value:{record:DocxImageRecord;bytes:Buffer|null})=>void } = {},
): Promise<{ text: string; imageContextText: string; requiresReview: boolean; readingVerification: DocxReadingVerification }> {
    const tools = await packageTools();
    const files = await tools.extractFiles(buffer, () => true, { maxUncompressedBytes: 512 * 1024 * 1024, maxZipEntries: 10000 });
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const sourceHash = sha256(buffer);
    const layoutShapes:WordLayoutShape[]=[];
    const verification: DocxReadingVerification = {
        version: DOCX_READING_VERSION, sourceHash, complete: false,
        expectedImageReferences: 0, images: [], issues: [],
    };
    const recognize = options.recognizeImage || extractImageTextLocally;
    const cache = new Map<string, Promise<{ text: string; confidence: number }>>();
    const legacyIssues:string[]=[];
    const replacements = new Map<string, { record: ImageRecord; text: string }>();
    const normalizedParts = new Map<string, Document>();
    const legacyIssue=(message:string)=>{if(!legacyIssues.includes(message))legacyIssues.push(message);};
    const issue = (message: string,legacy=true) => { if (!verification.issues.includes(message)) verification.issues.push(message);if(legacy)legacyIssue(message); };
    const wordParts = files.filter((file) => BODY_PART.test(file.path));
    if (!wordParts.some((file) => file.path === 'word/document.xml')) throw new Error('DOCX_MAIN_PART_MISSING');

    for (const file of wordParts) {
        const doc = tools.parseXmlString(file.content.toString('utf8'));
        const relPath = path.posix.join(path.posix.dirname(file.path), '_rels', `${path.posix.basename(file.path)}.rels`);
        const relXml = byPath.get(relPath);
        const relationships = relXml ? descendants(tools.parseXmlString(relXml.toString('utf8')), (el) => el.localName === 'Relationship') : [];
        const rels = new Map(relationships.map((el) => [el.getAttribute('Id'), { target: el.getAttribute('Target') || '', external: el.getAttribute('TargetMode') === 'External', type: el.getAttribute('Type') || '' }]));
        const imageId = (el: Element) => el.getAttributeNS(REL_NS, 'embed') || el.getAttributeNS(REL_NS, 'link') || el.getAttributeNS(REL_NS, 'id') || '';
        const paragraphs=descendants(doc,el=>el.namespaceURI===WORD_NS&&el.localName==='p');
        const alternatives=new WeakMap<Element,string[]>();
        const parentParagraph=(node:Node)=>{
            for(let at:Node|null=node;at;at=at.parentNode){
                const idx=paragraphs.indexOf(at as Element);
                if(idx>=0)return idx+1;
            }
            return 0;
        };
        let occurrence = 0;
        const visit = async (node: Node): Promise<void> => {
            for (const child of elements(node)) {
                if (child.localName === 'AlternateContent') {
                    const branches = elements(child);
                    const branch = branches.find((el) => el.localName === 'Choice' && descendants(el, (x) => ['blip', 'imagedata'].includes(x.localName)).length)
                        || branches.find((el) => el.localName === 'Fallback') || branches[0];
                    if (branch) {
                        const branchText=(value:Element)=>descendants(value,el=>el.namespaceURI===WORD_NS&&el.localName==='t').map(el=>el.textContent||'').join(' ').replace(/\s+/g,' ').trim();
                        if(branches.some(value=>branchText(value)!==branchText(branch)))issue(`${file.path}:ALTERNATE_TEXT_CONTENT_UNVERIFIED`,false);
                        const fallbackRefs=branches.filter(el=>el!==branch).flatMap(el=>descendants(el,n=>['blip','imagedata'].includes(n.localName)));
                        for(const nested of Array.from(branch.childNodes)){
                            const copy=nested.cloneNode(true);
                            for(const ref of descendants(copy,n=>['blip','imagedata'].includes(n.localName))){
                                const main=rels.get(imageId(ref));
                                const ids=fallbackRefs.filter(f=>{const alt=rels.get(imageId(f));return main&&alt&&!main.external&&!alt.external&&main.type===alt.type&&(()=>{const resource=(target:string)=>path.posix.normalize(target.startsWith('/')?target.slice(1):path.posix.join(path.posix.dirname(file.path),target));const a=byPath.get(resource(main.target)),b=byPath.get(resource(alt.target));return !!a&&!!b&&sha256(a)===sha256(b);})();}).map(imageId);
                                if(ids.length)alternatives.set(ref,[...new Set(ids)]);
                                if(fallbackRefs.some(f=>!ids.includes(imageId(f))))issue(`${file.path}:ALTERNATE_IMAGE_CONTENT_UNVERIFIED`,false);
                            }
                            node.insertBefore(copy,child);
                        }
                    } else issue(`${file.path}:EMPTY_ALTERNATE_CONTENT`);
                    node.removeChild(child);
                    // Restart this container after resolving one alternate branch.
                    return visit(node);
                }
                if (['drawing', 'pict', 'object', 'altChunk'].includes(child.localName)) {
                    const refs = descendants(child, (el) => ['blip', 'imagedata'].includes(el.localName) || Boolean(rels.get(imageId(el))?.type.endsWith('/image')));
                    const vmlShapes=descendants(child,el=>el.namespaceURI===VML_NS&&['shape','rect','roundrect','oval','line','polyline','curve','arc','group','image'].includes(el.localName));
                    const hasUnrepresentedVML=child.localName==='pict'&&!isStandardHorizontalRule(child)&&vmlShapes.some(shape=>shape.localName==='group'||!descendants(shape,el=>el.namespaceURI===VML_NS&&el.localName==='imagedata').length);
                    const legacyUnsupported=['object','altChunk'].includes(child.localName)||(!refs.length&&!isStandardHorizontalRule(child));
                    const unsupported = ['object', 'altChunk'].includes(child.localName) || hasUnrepresentedVML || (!refs.length && !isStandardHorizontalRule(child));
                    if (unsupported) issue(`${file.path}:UNSUPPORTED_${child.localName.toUpperCase()}`,legacyUnsupported);
                    const drawingText = descendants(child, (el) => el.namespaceURI === WORD_NS && el.localName === 't')
                        .map((el) => el.textContent || '');
                    const boxes=descendants(child,el=>el.namespaceURI===WORD_NS&&el.localName==='txbxContent');
                    const inlineCaption=child.localName==='pict'&&vmlShapes.length===1&&vmlShapes[0].localName==='shape'&&refs.length===1&&boxes.length===1&&drawingText.length>0
                        &&descendants(boxes[0],el=>el.namespaceURI===WORD_NS&&el.localName==='t').length===drawingText.length
                        &&!descendants(boxes[0],el=>el.namespaceURI===WORD_NS&&['tbl','instrText','drawing','pict','del','fldChar','object'].includes(el.localName)).length;
                    const needsLayout=drawingText.some(value=>value.trim())&&!inlineCaption;
                    if(needsLayout)issue(`${file.path}:DRAWING_TEXT_LAYOUT_UNVERIFIED`);
                    if(child.localName!=='pict'&&needsLayout)layoutShapes.push({part:file.path,name:'',paragraph:parentParagraph(child),issue:`${file.path}:DRAWING_TEXT_LAYOUT_UNVERIFIED`});
                    if(inlineCaption)legacyIssue(`${file.path}:DRAWING_TEXT_LAYOUT_UNVERIFIED`);
                    if(child.localName==='pict'&&(unsupported||needsLayout)){
                        const names=elements(child).filter(el=>el.namespaceURI===VML_NS&&el.localName!=='shapetype').map(el=>el.getAttribute('id')||'');
                        for(const reason of [...(unsupported?['UNSUPPORTED_PICT']:[]),...(needsLayout?['DRAWING_TEXT_LAYOUT_UNVERIFIED']:[])]){
                            for(const name of names.length?names:[''])layoutShapes.push({part:file.path,name,paragraph:parentParagraph(child),issue:file.path+':'+reason});
                        }
                    }
                    const tokens: string[] = [];
                    for (const ref of refs) {
                        const id = imageId(ref);
                        const rel = rels.get(id);
                        const resource = rel?.target ? path.posix.normalize(rel.target.startsWith('/') ? rel.target.slice(1) : path.posix.join(path.posix.dirname(file.path), rel.target)) : '';
                        const bytes = byPath.get(resource);
                        const record: ImageRecord = {
                            anchor: `${file.path}#${id || 'missing'}:${++occurrence}`,
                            paragraph:parentParagraph(child),relationshipId:id,alternateRelationships:alternatives.get(ref),
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
                        options.onImage?.({record:{...record},bytes:record.reason==='EXTERNAL_OR_UNSAFE_IMAGE'||!bytes?null:Buffer.from(bytes)});
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
    if(options.onLayout&&layoutShapes.length){
        const passive=new Map(files.map(f=>[f.path,f.content]));
        let allowed=true;
        for(const f of files){
            if(/(?:^|\/)(?:embeddings|activeX|externalLinks)\/|vbaProject|\.(?:bin|svg)$/i.test(f.path)){allowed=false;break;}
            if(!/\.(?:xml|rels)$/i.test(f.path))continue;
            const xml=f.content.toString('utf8');
            if(/<!DOCTYPE|<!ENTITY|\b(?:DDEAUTO|DDE|INCLUDEPICTURE|INCLUDETEXT|LINK)\s+[\"']/i.test(xml)){allowed=false;break;}
            const fieldDoc=tools.parseXmlString(xml);
            const safePageField=(value:string)=>/^\s*(?:PAGE|NUMPAGES|SECTIONPAGES)\s*(?:\\\*\s*(?:MERGEFORMAT|Arabic|ROMAN|roman|ALPHABETIC|alphabetic))?\s*$/.test(value);
            if(descendants(fieldDoc,el=>el.namespaceURI===WORD_NS&&['altChunk','object'].includes(el.localName)).length
                ||descendants(fieldDoc,el=>el.namespaceURI===WORD_NS&&el.localName==='instrText').some(el=>!safePageField(el.textContent||''))
                ||descendants(fieldDoc,el=>el.namespaceURI===WORD_NS&&el.localName==='fldSimple').some(el=>!safePageField(el.getAttributeNS(WORD_NS,'instr')||''))){allowed=false;break;}
            if(!f.path.endsWith('.rels'))continue;
            const document=tools.parseXmlString(xml);
            for(const rel of descendants(document,el=>el.localName==='Relationship')){
                const target=rel.getAttribute('Target')||'';
                const type=rel.getAttribute('Type')?.split('/').at(-1);
                if(type==='attachedTemplate'||type==='hyperlink'){rel.parentNode?.removeChild(rel);continue;}
                if(rel.getAttribute('TargetMode')==='External'||/^(?:[a-z][a-z\d+.-]*:|\\\\|\/\/)/i.test(target)){allowed=false;break;}
                let internal='';
                try{const value=decodeURIComponent(target);internal=path.posix.normalize(value.startsWith('/')?value.slice(1):path.posix.join(path.posix.dirname(path.posix.dirname(f.path)),value));}catch{allowed=false;break;}
                if(!byPath.has(internal)){allowed=false;break;}
            }
            passive.set(f.path,Buffer.from(tools.serializeXml(document),'utf8'));
        }
        if(allowed)options.onLayout(Buffer.from(tools.zipSync(Object.fromEntries(passive))),layoutShapes);
    }

    // OfficeParser does not place Word review comments. Bind them to their
    // original ranges before rendering; a comment is an annotation, never an instruction.
    const commentPart = normalizedParts.get('word/comments.xml');
    const placeComments = () => {
        if (!commentPart) return;
        const comments = descendants(commentPart, el => el.namespaceURI === WORD_NS && el.localName === 'comment');
        const anchors = [...normalizedParts].filter(([part]) => !/^word\/comments\d*\.xml$/.test(part))
            .flatMap(([part, doc]) => descendants(doc, el => el.namespaceURI === WORD_NS
                && ['commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(el.localName)).map(element => ({part, element})));
        const ids = new Set<string>();
        for (const comment of comments) {
            const id = comment.getAttributeNS(WORD_NS, 'id') || '';
            const matching = anchors.filter(a => a.element.getAttributeNS(WORD_NS, 'id') === id);
            const references = matching.filter(a => a.element.localName === 'commentReference');
            const starts = matching.filter(a => a.element.localName === 'commentRangeStart');
            const ends = matching.filter(a => a.element.localName === 'commentRangeEnd');
            const containingParagraph=(node:Node)=>{for(let at:Node|null=node;at;at=at.parentNode)if((at as Element).namespaceURI===WORD_NS&&(at as Element).localName==='p')return at;return null;};
            const duplicate = comments.filter(c => c.getAttributeNS(WORD_NS, 'id') === id).length !== 1;
            const validRange = starts.length === 0 && ends.length === 0 || starts.length === 1 && ends.length === 1
                && starts[0].part === ends[0].part && matching.indexOf(starts[0]) < matching.indexOf(ends[0])
                && references.length===1&&matching.indexOf(ends[0])<matching.indexOf(references[0])
                && containingParagraph(ends[0].element)===containingParagraph(references[0].element);
            if (!/^\d+$/.test(id) || ids.has(id) || duplicate || references.length !== 1 || !validRange
                || matching.some(a => a.part !== references[0]?.part)
                || matching.some(a => !['p','r'].includes((a.element.parentNode as Element)?.localName))) {
                issue(`word/comments.xml:COMMENT_ANCHOR_UNVERIFIED:${id}`); continue;
            }
            ids.add(id);
            if (descendants(comment, el => el.namespaceURI === WORD_NS && ['tbl','instrText','fldSimple','del'].includes(el.localName)).length) {
                issue(`word/comments.xml:COMMENT_LAYOUT_UNVERIFIED:${id}`); continue;
            }
            const content = descendants(comment, el => el.namespaceURI === WORD_NS && el.localName === 'p').map(paragraph =>
                descendants(paragraph, el => el.namespaceURI === WORD_NS && ['t','tab','br','cr'].includes(el.localName))
                    .map(el => el.localName === 't' ? el.textContent || '' : el.localName === 'tab' ? '\t' : '\n').join('')).join('\n');
            const annotation = `\n[DOCX_COMMENT ${id} author=${JSON.stringify(comment.getAttributeNS(WORD_NS,'author') || '')} date=${JSON.stringify(comment.getAttributeNS(WORD_NS,'date') || '')} kind=ANNOTATION]\n${content}\n[END_DOCX_COMMENT]\n`;
            for (const {element} of matching) {
                const doc = element.ownerDocument!, parent = element.parentNode as Element;
                const text = doc.createElementNS(WORD_NS,'w:t'); text.setAttribute('xml:space','preserve');
                text.appendChild(doc.createTextNode(element.localName === 'commentReference' ? annotation
                    : `\n[DOCX_COMMENT_RANGE_${element.localName === 'commentRangeStart' ? 'START' : 'END'} ${id}]\n`));
                if (parent.localName === 'r') parent.replaceChild(text,element);
                else { const run = doc.createElementNS(WORD_NS,'w:r'); run.appendChild(text); parent.replaceChild(run,element); }
            }
        }
        for (const {element} of anchors) if (element.parentNode) issue(`word/comments.xml:COMMENT_ANCHOR_UNVERIFIED:${element.getAttributeNS(WORD_NS,'id') || ''}`);
        for (const [part, doc] of normalizedParts) byPath.set(part,Buffer.from(tools.serializeXml(doc),'utf8'));
    };

    const { OfficeParser } = await import('officeparser');
    const parseNative = async () => await OfficeParser.parseOffice(Buffer.from(tools.zipSync(Object.fromEntries(byPath))), {
        fileType: 'docx', ocr: false, extractAttachments: false, newlineDelimiter: '\n',
    }) as OfficeParserAST;
    let ast = await parseNative();
    for (const warning of ast.warnings || []) issue(`PARSER:${warning.code}`);
    async function renderText(preserveNotes: boolean,legacyContext=false) {
        const consumed = new Set<string>(), issues = [...(legacyContext?legacyIssues:verification.issues)];
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
            try {
                // An onNode string bypasses the parser's collection of attached notes.
                // Replace image tokens after normal rendering when references are present.
                const value = String((await ast.to('text', { textConfig: { preserveLayout: true }, ...(!preserveNotes ? { onNode } : {}) })).value || '');
                return preserveNotes ? replace(value) : value;
            } finally { ast.content = original; }
        };
        let text = await render(ast.content);
        for (const [name, nodes] of Object.entries(ast.auxiliary || {})) {
            if (Array.isArray(nodes) && nodes.length) text += `\n[DOCX_PART ${name}]\n${await render(nodes)}\n[END_DOCX_PART]\n`;
        }
        // Unreferenced notes or structures unsupported by the AST remain explicit gaps.
        for (const [part, doc] of normalizedParts) {
            const missing = [...replacements].filter(([token, data]) => data.record.part === part && !consumed.has(token));
            const native = descendants(doc, (el) => el.namespaceURI === WORD_NS && el.localName === 't').map((el) => el.textContent || '');
            const unrendered = native.map((value) => {
                let remaining = value;
                for (const token of consumed) remaining = remaining.replaceAll(token, '');
                return remaining;
            }).filter((value) => value.trim() && !text.replace(/\s+/g, ' ').includes(value.replace(/\s+/g, ' ').trim()));
            if (missing.length || unrendered.length) {
                const reason = `${part}:CONTENT_NOT_POSITIONED_BY_PARSER`;
                if (!issues.includes(reason)) issues.push(reason);
                text += `\n[DOCX_PART ${part} reason=CONTENT_NOT_POSITIONED_BY_PARSER]\n${replace(unrendered.join('\n'))}\n[END_DOCX_PART]\n`;
            }
        }
        if (issues.length) text += `\n${issues.map((reason) => `[DOCX_ISSUE ${reason}]`).join('\n')}`;
        return { text: text.trim(), issues };
    }
    // Native annotations may improve without changing the image prompt or its verified cache key.
    const legacy = await renderText(false,true);
    if (commentPart) { placeComments(); ast = await parseNative(); for (const warning of ast.warnings || []) issue(`PARSER:${warning.code}`); }
    const hasNotes = [...normalizedParts.values()].some(doc => descendants(doc, el => el.namespaceURI === WORD_NS
        && ['footnoteReference', 'endnoteReference'].includes(el.localName)).length > 0);
    const rendered = await renderText(hasNotes);
    verification.issues = rendered.issues;
    verification.complete = verification.images.every((image) => image.status === 'READ' && !image.numericReviewRequired)
        && verification.issues.length === 0;
    return { text: rendered.text, imageContextText: legacy.text, requiresReview: !verification.complete, readingVerification: verification };
}
