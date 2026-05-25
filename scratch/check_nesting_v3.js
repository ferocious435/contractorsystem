
const fs = require('fs');
const content = fs.readFileSync('c:/Users/SergeyRaihshtat/Desktop/sergey/contractorsystem/contractorsystem/src/components/features/SmartLetterGenerator.tsx', 'utf8');

function checkBalancing(text) {
    let stack = [];
    let lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let lineNum = i + 1;
        
        // Remove comments
        let cleanLine = line.replace(/{\/\*.*?\*\/}/g, '').replace(/\/\/.*$/g, '');
        
        // Find all opening tags <div...
        // But exclude self-closing tags <div.../>
        const openingRegex = /<div(?![^>]*\/>)[^>]*>/g;
        const closingRegex = /<\/div>/g;
        
        let match;
        while ((match = openingRegex.exec(cleanLine)) !== null) {
            stack.push({ line: lineNum, content: match[0] });
        }
        
        while ((match = closingRegex.exec(cleanLine)) !== null) {
            if (stack.length === 0) {
                console.log(`Extra closing div at line ${lineNum}`);
            } else {
                stack.pop();
            }
        }
    }
    
    console.log(`Final stack depth: ${stack.length}`);
    if (stack.length > 0) {
        console.log(`Unclosed divs started at lines: ${stack.map(s => s.line).join(', ')}`);
        stack.forEach(s => {
            console.log(`Line ${s.line}: ${s.content}`);
        });
    }
}

checkBalancing(content);
