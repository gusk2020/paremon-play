#!/usr/bin/env node
// node tools/build_standalone.mjs <full-sha> <output-dir>  -> <output-dir>/paremon-playtest-standalone-<sha7>.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './standalone.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = process.argv[2] || 'unknown', out = path.resolve(process.argv[3] || 'dist');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `paremon-playtest-standalone-${sha.slice(0, 7)}.html`);
fs.writeFileSync(file, build(root, sha));
console.log(file, fs.statSync(file).size);
