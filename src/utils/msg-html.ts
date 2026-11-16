import type {MsgPart} from './msg-source-types';
/** Does not load remote or active content. Tables retain row/cell boundaries. */
export function readMsgHtml(bytes:Buffer,part:MsgPart,siblings:MsgPart[]):{text:string;issues:string[]} {
 const issues:string[]=[];let raw='';try{const declared=bytes.toString('latin1').match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1];raw=new TextDecoder(part.encoding==='utf16le'?'utf-16le':declared||'utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'').replace(/\0+$/,'');}catch{return {text:'',issues:['MSG_HTML_ENCODING_UNCONFIRMED']};}

 if(/<(?:script|object|embed|svg|canvas|iframe|video|audio)\b|display\s*:\s*none|visibility\s*:\s*hidden|\b(?:background(?:-image)?|list-style(?:-image)?)\s*:[^;}]*url\s*\(/i.test(raw))issues.push('MSG_HTML_UNVERIFIED_CONTENT');
 const decode=(s:string)=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,key:string)=>{if(key[0]==='#'){const n=parseInt(key.slice(key[1].toLowerCase()==='x'?2:1),key[1].toLowerCase()==='x'?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'\ufffd';}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[key.toLowerCase()];});
 for(const match of raw.matchAll(/<(?:img|v:imagedata)\b[^>]*>/gi)){
  const attribute=match[0].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i),src=decode(attribute?.[1]??attribute?.[2]??attribute?.[3]??'');
  if(!/^cid:/i.test(src))issues.push('MSG_HTML_EXTERNAL_IMAGE_UNREAD');else if(siblings.filter(p=>p.contentId===src.slice(4).replace(/^<|>$/g,'')).length!==1)issues.push('MSG_CID_TARGET_UNAVAILABLE');
 }
 if(/&[a-z][\w]+;/i.test(raw.replace(/&(amp|lt|gt|quot|apos|nbsp);/gi,'')))issues.push('MSG_HTML_ENTITY_UNCONFIRMED');
 let text=raw.replace(/<!--[\s\S]*?-->/g,'').replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<\/(?:td|th)\s*>/gi,'\t').replace(/<\/?(?:tr|table|p|div|br|li|h[1-6])\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,'');
 text=decode(text).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();return {text,issues:[...new Set(issues)]};
}
