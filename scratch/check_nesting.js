
const fs = require('fs');
const content = fs.readFileSync('c:/Users/SergeyRaihshtat/Desktop/sergey/contractorsystem/contractorsystem/src/components/features/SmartLetterGenerator.tsx', 'utf8');

function checkBalancing(text) {
    let stack = [];
    let lines = text.split('\n');
    let inComment = false;
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let lineNum = i + 1;
        
        // Very basic regex for <div and </div
        // This is simplified and might miss some things but can help
        let openTags = (line.match(/<[a-zA-Z]+/g) || []);
        let closeTags = (line.match(/<\/[a-zA-Z]+/g) || []);
        
        // Just focus on divs for now as they are most common source of error
        let divOpens = (line.match(/<div/g) || []).length;
        let divCloses = (line.match(/<\/div>/g) || []).length;
        
        for (let j = 0; j < divOpens; j++) stack.push({ tag: 'div', line: lineNum });
        for (let j = 0; j < divCloses; j++) {
            if (stack.length === 0) {
                console.log(`Extra closing div at line ${lineNum}`);
            } else {
                stack.pop();
            }
        }
    }
    console.log(`Remaining open tags: ${stack.length}`);
    stack.forEach(s => console.log(`Open ${s.tag} from line ${s.line}`));
}

checkBalancing(content);
