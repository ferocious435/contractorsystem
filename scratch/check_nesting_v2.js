
const fs = require('fs');
const content = fs.readFileSync('c:/Users/SergeyRaihshtat/Desktop/sergey/contractorsystem/contractorsystem/src/components/features/SmartLetterGenerator.tsx', 'utf8');

function checkBalancing(text) {
    let stack = [];
    let lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let lineNum = i + 1;
        
        // Remove comments to avoid false matches
        let cleanLine = line.replace(/{\/\*.*?\*\/}/g, '').replace(/\/\/.*$/g, '');
        
        let divOpens = (cleanLine.match(/<div/g) || []).length;
        let divCloses = (cleanLine.match(/<\/div>/g) || []).length;
        
        for (let j = 0; j < divOpens; j++) stack.push(lineNum);
        for (let j = 0; j < divCloses; j++) {
            if (stack.length === 0) {
                console.log(`Extra closing div at line ${lineNum}`);
            } else {
                stack.pop();
            }
        }
        
        // Also track { and } for JSX expressions
        let braceOpens = (cleanLine.match(/{/g) || []).length;
        let braceCloses = (cleanLine.match(/}/g) || []).length;
        // This is tricky because of JS objects but let's see
    }
    console.log(`Final stack depth: ${stack.length}`);
    if (stack.length > 0) {
        console.log(`Last 20 unclosed divs started at lines: ${stack.slice(-20).join(', ')}`);
    }
}

checkBalancing(content);
