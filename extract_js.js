const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('No script found'); process.exit(1); }
fs.writeFileSync('/tmp/kc_check.js', m[1]);
console.log('Extracted');
