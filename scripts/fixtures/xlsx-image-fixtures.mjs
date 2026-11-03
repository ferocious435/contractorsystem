import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{zipSync,strToU8}=createRequire(require.resolve('officeparser'))('fflate');
const s='http://schemas.openxmlformats.org/spreadsheetml/2006/main',r='http://schemas.openxmlformats.org/officeDocument/2006/relationships',p='http://schemas.openxmlformats.org/package/2006/relationships',d='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',a='http://schemas.openxmlformats.org/drawingml/2006/main';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export const xlsxRow=(number,cells)=>`<row r="${number}">${cells.map(([cell,text])=>`<c r="${cell}" t="inlineStr"><is><t xml:space="preserve">${escape(text)}</t></is></c>`).join('')}</row>`;
const rels=items=>`<Relationships xmlns="${p}">${items.join('')}</Relationships>`;
const marker=(name,position)=>`<xdr:${name}><xdr:col>${position.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${position.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${name}>`;
export function xlsxWithImages(sheets,media={},extra={}){
 const files={
  '[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')}</Types>`,
  '_rels/.rels':rels([`<Relationship Id="rId1" Type="${r}/officeDocument" Target="xl/workbook.xml"/>`]),
  'xl/workbook.xml':`<workbook xmlns="${s}" xmlns:r="${r}"><sheets>${sheets.map((sheet,i)=>`<sheet name="${escape(sheet.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':rels(sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${r}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`)),
  ...Object.fromEntries(Object.entries(media).map(([name,bytes])=>['xl/media/'+name,bytes]))
 };
 for(const [index,sheet]of sheets.entries()){
  const n=index+1,pictures=sheet.pictures||[],hasDrawing=pictures.length||sheet.unknownGraphic;
  files[`xl/worksheets/sheet${n}.xml`]=`<worksheet xmlns="${s}" xmlns:r="${r}"><sheetData>${(sheet.rows||[]).join('')}</sheetData>${hasDrawing?'<drawing r:id="rIdDrawing"/>':''}</worksheet>`;
  if(!hasDrawing)continue;
  files[`xl/worksheets/_rels/sheet${n}.xml.rels`]=rels([`<Relationship Id="rIdDrawing" Type="${r}/drawing" Target="../drawings/drawing${n}.xml"/>`]);
  files[`xl/drawings/drawing${n}.xml`]=`<xdr:wsDr xmlns:xdr="${d}" xmlns:a="${a}" xmlns:r="${r}">${pictures.map((picture,i)=>`<xdr:twoCellAnchor>${marker('from',picture.from||{col:0,row:1})}${marker('to',picture.to||{col:2,row:3})}<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i+1}" name="Picture${i+1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:${picture.external?'link':'embed'}="rIdImage${i+1}"/>${picture.crop?'<a:srcRect l="10000" t="0" r="0" b="0"/>':''}<a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`).join('')}${sheet.unknownGraphic?'<xdr:graphicFrame><xdr:nvGraphicFramePr/><a:graphic><a:graphicData uri="unknown-type"/></a:graphic></xdr:graphicFrame>':''}</xdr:wsDr>`;
  files[`xl/drawings/_rels/drawing${n}.xml.rels`]=rels(pictures.map((picture,i)=>`<Relationship Id="rIdImage${i+1}" Type="${r}/image" Target="${escape(picture.target||'../media/'+picture.name)}"${picture.external?' TargetMode="External"':''}/>`));
 }
 Object.assign(files,extra);return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name,value])=>[name,typeof value==='string'?strToU8(value):value]))));
}
