'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
async function main() {
  const directory = path.resolve(__dirname, '../release');
  const files = fs.readdirSync(directory).filter(name => /\.(exe|dmg|zip|AppImage)$/.test(name)).sort();
  if (!files.length) throw new Error('No release artifacts found.');
  const lines = [];
  for (const name of files) {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join(directory, name))) hash.update(chunk);
    lines.push(hash.digest('hex') + '  ' + name);
  }
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  console.log('Wrote checksums for ' + files.length + ' release artifacts.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
