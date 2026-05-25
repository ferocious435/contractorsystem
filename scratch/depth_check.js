const fs = require('fs');
const content = fs.readFileSync('src/components/features/SmartLetterGenerator.tsx', 'utf8');

// Remove comments to simplify
const cleanContent = content.replace(/{\/\*[\s\S]*?\*\/}/g, '');

const stack = [];
const regex = /<(\/?[a-zA-Z\d\.]+)([^>]*?)(\/?)>/g;
let match;

const tagsToCheck = ['div', 'AnimatePresence', 'motion.div', 'motion.button', 'motion.section'];

while ((match = regex.exec(cleanContent)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];
    const isClosing = tagName.startsWith('/');
    const isSelfClosing = match[3] === '/';
    const name = isClosing ? tagName.substring(1) : tagName;

    if (tagsToCheck.includes(name)) {
        if (isSelfClosing) {
            // Do nothing
        } else if (isClosing) {
            const last = stack.pop();
            if (last !== name) {
                const linesBefore = content.substring(0, match.index).split('\n').length;
                console.log(`ERROR at line ${linesBefore}: Expected </${last}>, got </${name}>`);
            }
        } else {
            stack.push(name);
        }
    }
}

console.log('Remaining stack:', stack);
