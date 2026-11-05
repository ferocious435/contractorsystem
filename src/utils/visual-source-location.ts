import type {ReadingLocation} from './visual-source-reading';

/** User-facing location from the recorded source; never infer a cell for a floating picture. */
export function visualSourceLocationLabel(location:ReadingLocation):string {
    let label='חלק במסמך';
    if(Number.isInteger(location.page)&&location.page!>0)label='עמוד '+location.page;
    else if(location.sheet)label='גיליון '+location.sheet+(location.cellRange?' · '+location.cellRange:' · מיקום חופשי');
    else if(location.part==='image')label='תמונה מקורית';
    else if(/^word\/header\d+\.xml$/.test(location.part||''))label='כותרת עליונה';
    else if(/^word\/footer\d+\.xml$/.test(location.part||''))label='כותרת תחתונה';
    else if(location.part==='word/document.xml')label='גוף המסמך';
    else if(/^word\/(?:footnotes|endnotes|comments)\d*\.xml$/.test(location.part||''))label='הערות המסמך';
    if(Number.isInteger(location.frame)&&location.frame!>0)label+=' · פריים '+location.frame;
    return location.msgPartName?location.msgPartName+' · '+label:label;
}
