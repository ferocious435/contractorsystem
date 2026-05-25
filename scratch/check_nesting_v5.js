
const fs = require('fs');
const content = fs.readFileSync('c:/Users/SergeyRaihshtat/Desktop/sergey/contractorsystem/contractorsystem/src/components/features/SmartLetterGenerator.tsx', 'utf8');

function checkBalancing(text) {
    let stack = [];
    let lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let lineNum = i + 1;
        
        let cleanLine = line.replace(/{\/\*.*?\*\/}/g, '').replace(/\/\/.*$/g, '');
        
        const openingRegex = /<div(?![^>]*\/>)[^>]*>/g;
        const closingRegex = /<\/div>/g;
        
        let match;
        while ((match = openingRegex.exec(cleanLine)) !== null) {
            stack.push(lineNum);
        }
        
        while ((match = closingRegex.exec(cleanLine)) !== null) {
            if (stack.length === 0) {
                console.log(`[Line ${lineNum}] Extra closing div`);
            } else {
                stack.pop();
            }
        }
        
        if (lineNum >= 270 && lineNum <= 776) {
            // console.log(`[Line ${lineNum}] Stack: ${stack.length}`);
        }
    }
    
    // Let's find where the stack depth is not what we expect.
    // Expected at 731: 1 (only 274)
}

// Let's just print the stack depth transitions
let currentDepth = 0;
let stack = [];
content.split('\n').forEach((line, i) => {
    let lineNum = i + 1;
    let cleanLine = line.replace(/{\/\*.*?\*\/}/g, '').replace(/\/\/.*$/g, '');
    const openingRegex = /<div(?![^>]*\/>)[^>]*>/g;
    const closingRegex = /<\/div>/g;
    
    let o; while((o = openingRegex.exec(cleanLine))) { stack.push(lineNum); }
    let c; while((c = closingRegex.exec(cleanLine))) { if(stack.length > 0) stack.pop(); else console.log(`Extra close at ${lineNum}`); }
    
    if (lineNum === 321) console.log(`After Header (321): ${stack.length} (Expected 1)`);
    if (lineNum === 511) console.log(`After Left Panel (511): ${stack.length} (Expected 2)`);
    if (lineNum === 731) console.log(`After Right Panel (731): ${stack.length} (Expected 1)`);
    if (lineNum === 746) console.log(`After Footer (746): ${stack.length} (Expected 1)`);
});
