
const fs = require('fs');
const content = fs.readFileSync('c:/Users/SergeyRaihshtat/Desktop/sergey/contractorsystem/contractorsystem/src/components/features/SmartLetterGenerator.tsx', 'utf8');

let stack = [];
content.split('\n').forEach((line, i) => {
    let lineNum = i + 1;
    let cleanLine = line.replace(/{\/\*.*?\*\/}/g, '').replace(/\/\/.*$/g, '');
    const openingRegex = /<div(?![^>]*\/>)[^>]*>/g;
    const closingRegex = /<\/div>/g;
    
    let o; while((o = openingRegex.exec(cleanLine))) { 
        stack.push(lineNum); 
        if (lineNum >= 322 && lineNum <= 511) console.log(`[Line ${lineNum}] OPEN div, stack depth: ${stack.length}`);
    }
    let c; while((c = closingRegex.exec(cleanLine))) { 
        if(stack.length > 0) {
            stack.pop();
            if (lineNum >= 322 && lineNum <= 511) console.log(`[Line ${lineNum}] CLOSE div, stack depth: ${stack.length}`);
        } else {
            console.log(`Extra close at ${lineNum}`);
        }
    }
});
