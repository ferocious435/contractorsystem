const fs = require('fs');
const content = fs.readFileSync('src/components/features/SmartLetterGenerator.tsx', 'utf8');

const singleQuotes = (content.match(/'/g) || []).length;
const doubleQuotes = (content.match(/"/g) || []).length;
const backticks = (content.match(/`/g) || []).length;

console.log(`Single: ${singleQuotes}, Double: ${doubleQuotes}, Backticks: ${backticks}`);

// Check for unclosed multiline strings
const multilineMatches = content.match(/`[\s\S]*?`/g) || [];
console.log(`Multiline backticks: ${multilineMatches.length}`);
