const fs = require('fs');
const content = fs.readFileSync('c:/Users/SergeyRaihshtat/Desktop/sergey/contractorsystem/contractorsystem/src/components/features/SmartLetterGenerator.tsx', 'utf8');

let stack = [];
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Match only actual JSX tags (starting with < and followed by name or /name)
    // Avoid matching imports or strings
    let tagRegex = /<(div|motion\.div|AnimatePresence)\b|<\/(div|motion\.div|AnimatePresence)>/g;
    let match;
    while ((match = tagRegex.exec(line)) !== null) {
        let tag = match[0];
        let tagName = match[1] || match[2];
        let isClosing = tag.startsWith('</');
        
        // Check if self-closing
        let restOfLine = line.substring(match.index);
        let endOfTag = restOfLine.indexOf('>');
        let isSelfClosing = !isClosing && endOfTag !== -1 && restOfLine.substring(0, endOfTag + 1).includes('/>');

        if (isSelfClosing) {
            console.log(`Line ${i + 1}: Self-closing <${tagName}>`);
        } else if (isClosing) {
            let last = stack.pop();
            console.log(`Line ${i + 1}: Closing </${tagName}>, popped <${last.name}> from line ${last.line}`);
            if (last.name !== tagName) {
                console.error(`!!! Mismatch at line ${i+1}: expected ${last.name}, got ${tagName}`);
            }
        } else {
            stack.push({ name: tagName, line: i + 1 });
            console.log(`Line ${i + 1}: Opening <${tagName}>, stack size ${stack.length}`);
        }
    }
}

console.log('Final stack:', stack);
if (stack.length === 0) {
    console.log('SUCCESS: All tags are balanced!');
} else {
    console.log('FAILURE: Unbalanced tags found!');
}
