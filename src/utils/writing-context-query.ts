// Retrieval hints only. Transliterating an acronym never verifies its meaning,
// the applicability of a document, or the authority of an instruction.
const latin:Record<string,string>={'א':'a','ב':'b','ג':'g','ד':'d','ה':'h','ו':'v','ז':'z','ח':'h','ט':'t','י':'y','כ':'k','ך':'k','ל':'l','מ':'m','ם':'m','נ':'n','ן':'n','ס':'s','ע':'a','פ':'p','ף':'p','צ':'ts','ץ':'ts','ק':'k','ר':'r','ש':'sh','ת':'t'};
export function writingRetrievalQuery(question:string):string{
    const hints=new Set<string>();
    for(const match of question.matchAll(/([א-ת]{1,5})[״"׳']([א-ת]{1,3})/gu)){
        const letters=match[1]+match[2];
        const variants=[letters,...(letters.length>=4&&/^[בהולכמ]/u.test(letters)?[letters.slice(1)]:[])];
        for(const value of variants)hints.add([...value].map(letter=>latin[letter]??letter).join(''));
    }
    return [question,...hints].join(' ');
}
