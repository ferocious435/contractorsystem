/** The file contains the current editor text; no short-lived Blob URL is needed. */
export function letterTextDownload(subject:string,text:string):{href:string;filename:string}{
    let name=(subject.trim().toWellFormed()||'מכתב עבודה').replace(/[\\/:*?"<>|\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,'_');
    name=Array.from(name).slice(0,120).join('').replace(/[. ]+$/u,'')||'מכתב עבודה';
    if(/^(?:con|prn|aux|nul|com\d|lpt\d)$/iu.test(name))name='מכתב_'+name;
    return {href:'data:text/plain;charset=utf-8,'+encodeURIComponent('\ufeff'+text.toWellFormed()),filename:name+'.txt'};
}
