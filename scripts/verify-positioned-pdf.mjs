import assert from 'node:assert/strict';
import test from 'node:test';
import {PDFDocument, degrees} from 'pdf-lib';
import {readPositionedPdfLines, findPositionedDifference, confirmPositionedReading} from '../src/server/documents/pdf-positioned-text.server.ts';

const region = {x:0, y:0, width:1, height:0.8};
const makeLine = (text,x=0.1,y=0.25) => ({text,rect:{x,y,width:0.3,height:0.02},objectIndex:2,rotation:0});
const a = ['north pipeline segment W74 - W116 agreed', ''];
const b = ['north pipeline segment W116 - W116 agreed', ''];

test('same_word_in_adjacent_cells', () => {
    const line=makeLine(a[0]), duplicate={...makeLine(b[0],0.54),objectIndex:3};
    assert.equal(findPositionedDifference(a,b,[line,duplicate],region),null);
    assert.equal(findPositionedDifference(a,b,[makeLine(a[0],0.1,0.9)],region),null);
});
test('invisible_layer_disagrees', () => {
    const source=findPositionedDifference(a,b,[makeLine(a[0])],region);
    assert.ok(source);
    assert.equal(confirmPositionedReading(source,{text:b[0],uncertainties:[]}),false);
    assert.equal(findPositionedDifference(a,b,[makeLine(a[0]),{...makeLine('Other visible text'),objectIndex:9}],region),null);
});
test('mixed_direction_and_prefix', () => {
    const first=['גבול המקטע W74 - W116 וכך אושר בשטח'];
    const second=['גבול המקטע W74 - W116 כך אושר בשטח'];
    const source=findPositionedDifference(first,second,[makeLine(first[0])],region);
    assert.ok(source);
    assert.equal(confirmPositionedReading(source,{text:first[0],uncertainties:[]}),true);
    assert.equal(confirmPositionedReading(source,{text:second[0],uncertainties:[]}),false);
    assert.equal(confirmPositionedReading(source,{text:first[0],uncertainties:['unclear']}),false);
});
test('physical page coordinates include crop and right-angle rotation', async()=>{
    const doc=await PDFDocument.create(),p=doc.addPage([400,300]);
    p.setCropBox(30,20,320,240); p.setRotation(degrees(90));
    p.drawText('section one',{x:110,y:80,size:10});
    const [line]=await readPositionedPdfLines(Buffer.from(await doc.save()),1);
    assert.equal(line.text,'section one');assert.equal(line.rotation,90);
    assert.ok(line.rect.x>0.20&&line.rect.x<0.28);assert.ok(Math.abs(line.rect.y-0.25)<0.015);
    assert.ok(line.rect.height>line.rect.width);
});
