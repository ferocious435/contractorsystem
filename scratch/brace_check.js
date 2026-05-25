const fs = require('fs');
const content = fs.readFileSync('src/components/features/SmartLetterGenerator.tsx', 'utf8');

const stack = [];
const pairs = { '(': ')', '[': ']', '{': '}' };

for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (pairs[char]) {
        stack.push({ char, pos: i });
    } else if (Object.values(pairs).includes(char)) {
        if (stack.length === 0) {
            console.log(`ERROR: Unmatched closing ${char} at position ${i}`);
            continue;
        }
        const last = stack.pop();
        if (pairs[last.char] !== char) {
            console.log(`ERROR: Mismatched ${char} at position ${i}, expected ${pairs[last.char]} for ${last.char} at ${last.pos}`);
        }
    }
}

if (stack.length > 0) {
    stack.forEach(s => {
        const line = content.substring(0, s.pos).split('\n').length;
        console.log(`ERROR: Unclosed ${s.char} starting at line ${line}`);
    });
} else {
    console.log('Braces are balanced.');
}
