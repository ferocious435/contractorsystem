import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const dist = path.resolve(process.argv[2] || '.next');
const directory = path.join(dist, 'static', 'css');
const files = fs.readdirSync(directory).filter(file => file.endsWith('.css'));
assert.ok(files.length, 'The production build must contain stylesheets');
const css = files.map(file => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
for (const [selector, property] of [
    ['fixed', 'position:fixed'], ['inset-0', 'inset:'], ['flex', 'display:flex'],
    ['grid', 'display:grid'], ['rounded-2xl', 'border-radius:'], ['overflow-auto', 'overflow:auto'],
]) {
    const rule = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))?.[1] || '';
    assert.ok(rule.replace(/\s/g, '').includes(property), `Production CSS must implement ${selector}: ${property}`);
}
console.log('PASS: production layout, modal positioning, scrolling and rounded panels have generated CSS.');
