
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
            stack.push({ line: lineNum, content: match[0] });
        }
        
        while ((match = closingRegex.exec(cleanLine)) !== null) {
            if (stack.length === 0) {
                console.log(`[Line ${lineNum}] Extra closing div`);
            } else {
                stack.pop();
                if (stack.length === 0) {
                    console.log(`[Line ${lineNum}] Stack empty`);
                }
            }
        }
    }
}

checkBalancing(content);
