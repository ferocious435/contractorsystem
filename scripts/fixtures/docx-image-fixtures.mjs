import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = createRequire(require.resolve('officeparser'))('fflate');
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
export const paragraph = text => `<w:p><w:r><w:t xml:space="preserve">${text.replaceAll('&','&amp;').replaceAll('<','&lt;')}</w:t></w:r></w:p>`;
export const drawing = (id='rId1') => `<w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
export const image = (id='rId1') => `<w:p><w:r>${drawing(id)}</w:r></w:p>`;
export const vml = (id='rId1') => `<w:pict><v:shape><v:imagedata r:id="${id}"/></v:shape></w:pict>`;
export const alternate = () => `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps">${drawing()}</mc:Choice><mc:Fallback>${vml()}</mc:Fallback></mc:AlternateContent></w:r></w:p>`;
const ns=`xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office"`;
const rel = (id,target,external=false) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"${external?' TargetMode="External"':''}/>`;
export const relationships = items => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(x=>rel(...x)).join('')}</Relationships>`;
export function docx({body=paragraph('Keep access open.'),media={'image1.png':png},rels=[['rId1','media/image1.png']],parts={}}={}) {
 const files={
  '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':`<w:document ${ns}><w:body>${body}</w:body></w:document>`,
  'word/_rels/document.xml.rels':relationships(rels),
  ...Object.fromEntries(Object.entries(media).map(([name,data])=>[`word/media/${name}`,data])),
  ...Object.fromEntries(Object.entries(parts).map(([name,body])=>[name,name.endsWith('.rels')?body:`<w:${name.includes('header')?'hdr':name.includes('footer')?'ftr':'footnotes'} ${ns}>${body}</w:${name.includes('header')?'hdr':name.includes('footer')?'ftr':'footnotes'}>`])),
 };
 return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,typeof value==='string'?strToU8(value):value]))));
}
