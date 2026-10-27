import './load-ui.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

let views;
try { views=await import('../../src/components/pricelists/PricelistsCatalogView.tsx'); }
catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND')throw error; }
const note='הערה מלאה על תנאי המדידה וההובלה C-CE6070. '.repeat(18);
const pricelist={id:'synthetic-list',name:'מחירון בדיקה C-CE6070',created_at:'2026-10-27',item_count:6,item_row_count:3,structural_row_count:3};
const items=[
  {id:'chapter',item_type:'CHAPTER',item_code:'51...',description:'עבודות עפר',rate:999},
  {id:'subchapter',item_type:'SUBCHAPTER',item_code:'51.03..',description:'מילוי נברר',rate:999},
  {id:'note',item_type:'NOTE',item_code:'51.03.0000',description:note,rate:999},
  {id:'priced',item_type:'ITEM',item_code:'51.03.0110',description:'אספקת חומר C',unit:'מ״ק',rate:1234.56},
  {id:'zero',item_type:'ITEM',item_code:'51.03.0111',description:'מחיר אפס מפורש',unit:'יח׳',rate:0},
  {id:'unknown',item_type:'ITEM',item_code:'51.03.0112',description:'מחיר חסר',unit:null,rate:null},
];
const noop=()=>{};
const props={pricelist,items,searchTerm:'',hasMore:true,isLoadingItems:false,totalItems:7,onSearch:noop,onLoadMore:async()=>{},onClose:noop};
function renderItems(extra={}) {assert.equal(typeof views?.PricelistItemsView,'function','The actual item inspection view is missing');return renderToStaticMarkup(React.createElement(views.PricelistItemsView,{...props,...extra}));}
const row=(html,id)=>html.match(new RegExp(`<tr[^>]*data-item-id="${id}"[\\s\\S]*?<\\/tr>`,'u'))?.[0]||'';

test('chapters and notes are structural rows and never display their stored rate as money',()=>{
  const html=renderItems();
  for(const id of ['chapter','subchapter','note']) {assert.ok(row(html,id));assert.ok(!row(html,id).includes('₪'));assert.ok(!row(html,id).includes('999'));}
  assert.ok(row(html,'priced').includes('1,234.56'));assert.ok(row(html,'priced').includes('₪'));
});
test('an explicit zero price is retained while an unknown price stays unknown',()=>{
  const html=renderItems();assert.match(row(html,'zero'),/>0 ₪<|>0\s*₪</u);assert.ok(row(html,'unknown').includes('—'));assert.ok(!row(html,'unknown').includes('₪'));
});
test('long notes and their full context stay available from the item',()=>{
  const html=renderItems();assert.ok(row(html,'note').includes(note));assert.ok(row(html,'priced').includes(note));assert.ok(!html.includes('הנחיה פעילה'));assert.ok(!html.includes('line-clamp'));
});
test('four fixed columns preserve codes units and the source precision',()=>{
  const html=renderItems();for(const width of [136,320,80,160])assert.ok(html.includes(`width:${width}px`));assert.ok(html.includes('51.03.0110'));assert.ok(html.includes('מ״ק'));assert.ok(html.includes('מחיר יחידה ללא מע״מ'));
});
test('a later page failure leaves the previously loaded rows and a usable retry',()=>{
  const html=renderItems({itemError:'טעינת ההמשך נכשלה. הסעיפים שנקראו נשמרו.'});assert.ok(html.includes('role="alert"'));assert.ok(html.includes('טעינת ההמשך נכשלה'));for(const item of items)assert.ok(html.includes(item.description));assert.ok(html.includes('ניסיון נוסף לטעינת הסעיפים'));
});
test('loading and empty search describe their actual states without fabricating records',()=>{
  assert.ok(renderItems({items:[],isLoadingItems:true}).includes('טוען סעיפים'));assert.ok(renderItems({items:[],hasMore:false,searchTerm:'לא קיים'}).includes('לא נמצאו סעיפים'));
});
test('catalog rendering never uploads or deletes and shows import failure without claiming success',()=>{
  assert.equal(typeof views?.PricelistsCatalogView,'function');let calls=0;const html=renderToStaticMarkup(React.createElement(views.PricelistsCatalogView,{pricelists:[pricelist],selectedPricelist:null,items:[],searchTerm:'',hasMore:false,isLoadingItems:false,isUploading:false,uploadProgress:null,notice:{type:'error',message:'הייבוא לא הושלם'},onUpload:async()=>{calls++;},onDelete:async()=>{calls++;},onSelect:noop,onClose:noop,onSearch:noop,onLoadMore:async()=>{}}));assert.ok(html.includes('הייבוא לא הושלם'));assert.ok(html.includes(pricelist.name));assert.equal(calls,0);
});

test('an unread catalog does not claim that zero pricelists exist',()=>{
  assert.equal(typeof views?.PricelistsCatalogView,'function');const html=renderToStaticMarkup(React.createElement(views.PricelistsCatalogView,{pricelists:[],selectedPricelist:null,items:[],searchTerm:'',hasMore:false,isLoadingItems:false,isUploading:false,uploadProgress:null,notice:null,catalogError:'קריאת המחירונים נכשלה',onUpload:async()=>{},onDelete:async()=>{},onSelect:noop,onClose:noop,onSearch:noop,onLoadMore:async()=>{}}));assert.ok(html.includes('לא נטען'));assert.ok(!html.includes('0 מחירונים'));
});

test('an indeterminate file-reading stage never claims a known row count',()=>{
  const html=renderToStaticMarkup(React.createElement(views.PricelistsCatalogView,{pricelists:[],selectedPricelist:null,items:[],searchTerm:'',hasMore:false,isLoadingItems:false,isUploading:true,uploadProgress:{current:0,total:1,step:'מנתח קובץ באמצעות AI (Gemini)...'},notice:null,onUpload:async()=>{},onDelete:async()=>{},onSelect:noop,onClose:noop,onSearch:noop,onLoadMore:async()=>{}}));const text=html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');assert.ok(!/0\s+מתוך\s+1\s+שורות/u.test(text));assert.ok(html.includes('disabled'));
});
