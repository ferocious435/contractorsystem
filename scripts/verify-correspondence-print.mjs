import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const {PrintableLetterContent}=await import('../src/components/pricing/PrintableLetter.tsx');
test('ordinary correspondence print has text and headers without financial totals or an approval signature',()=>{
 const html=renderToStaticMarkup(React.createElement(PrintableLetterContent,{correspondence:true,projectName:'פרויקט',subject:'בקשת הנחיה',recipient:'מנהל הפרויקט',legalText:'נא לקבל הנחיה כתובה.',items:[]}));
 assert.ok(html.includes('נא לקבל הנחיה כתובה.'));assert.ok(html.includes('בקשת הנחיה'));
 for(const unwanted of ['סה&quot;כ לתשלום','מע&quot;מ','אישור המזמין / מפקח','לא אושר צירוף כספי'])assert.equal(html.includes(unwanted),false,unwanted);
});
