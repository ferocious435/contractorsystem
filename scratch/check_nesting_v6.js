const fs = require('fs');
const content = fs.readFileSync('c:/Users/SergeyRaihshtat/Desktop/sergey/contractorsystem/contractorsystem/src/components/features/SmartLetterGenerator.tsx', 'utf8');

let stack = [];
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Find all tags
    let tags = line.match(/<div|<\/div>|<motion\.div|<\/motion\.div>|<AnimatePresence|<\/AnimatePresence>/g);
    if (tags) {
        tags.forEach(tag => {
            if (tag.startsWith('</')) {
                let last = stack.pop();
                console.log(`Line ${i + 1}: Closing ${tag}, popped ${last}`);
            } else {
                // Check if self-closing
                let tagIndex = line.indexOf(tag);
                let remaining = line.substring(tagIndex);
                let endOfTag = remaining.indexOf('>');
                if (endOfTag !== -1 && remaining.substring(0, endOfTag).includes('/>')) {
                    console.log(`Line ${i + 1}: Self-closing ${tag}`);
                } else {
                    stack.push(tag);
                    console.log(`Line ${i + 1}: Opening ${tag}, stack size ${stack.length}`);
                }
            }
        });
    }
}

console.log('Final stack:', stack);
