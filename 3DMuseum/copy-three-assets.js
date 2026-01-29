import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Find the path to the three.js module
const threeEntryPoint = require.resolve('three');
let threePath = path.dirname(threeEntryPoint);
// Walk up from the entry point to find the package.json
while (!fs.existsSync(path.join(threePath, 'package.json'))) {
  const parentPath = path.dirname(threePath);
  if (parentPath === threePath) {
    throw new Error('Could not find package.json for three');
  }
  threePath = parentPath;
}
// Path to the basis transcoder files
const basisPath = path.join(threePath, 'examples/jsm/libs/basis');
// Destination path in the public directory
const destPath = path.resolve('./public/basis');

// Remove the destination directory if it exists, then copy
fs.rmSync(destPath, { recursive: true, force: true });
fs.cpSync(basisPath, destPath, { recursive: true });

console.log('Copied three.js basis transcoder files to public/basis');