// Build and verify the single-file playtest HTML: the game, the logo and all 35 monster pictures in ONE file.
// Why: opened from Android (content:// URI) a page cannot load sibling files, so relative <img src> paths break.
// How: no game logic is touched. Pictures live in a table keyed by their repository path; artSrc() (which builds the path
// at run time) is wrapped so it looks the picture up; the static logo becomes a data: URI. Each table entry is turned into a
// blob: URL once at start (re-parsing ~150KB data: URIs on every render would be slow on a phone); data: URI is the fallback.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SPECIES = ['centipede', 'dragon', 'golem', 'knight', 'skeleton'];
export const KEYS = SPECIES.flatMap(s => [0, 1, 2, 3, 4, 5, 6].map(i => `paremon_monsters2/${s}_${i}.png`));
const LOGO = 'paremon_logo_center_crop2.png';
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const b64 = f => fs.readFileSync(f).toString('base64');

const ART_RE = /const artSrc=\(m,c\)=>(`paremon_monsters2\/\$\{[^`]*\}\.png`);/;
const IMG_RE = /src="\$\{artSrc\(([^)]*)\)\}"/g;

export function build(root, sha = 'unknown') {
  let html = fs.readFileSync(path.join(root, 'paremon_crossplatform_v17.html'), 'utf8');
  const need = (cond, msg) => { if (!cond) throw new Error('build: ' + msg); };
  const art = html.match(ART_RE); need(art, 'artSrc definition not found');
  need((html.match(IMG_RE) || []).length === 3, 'expected exactly 3 dynamic picture templates');
  need(html.split('src="paremon_logo_center_crop2.png"').length === 2, 'logo <img> not found exactly once');
  const table = {};
  for (const k of KEYS) table[k] = b64(path.join(root, k));
  const embed = `/* standalone: pictures embedded (no files, no network) */\nconst EMBED_B64=${JSON.stringify(table)};\n`
    + `const EMBED=(()=>{const o={};for(const k in EMBED_B64){const d='data:image/png;base64,'+EMBED_B64[k];try{const s=atob(EMBED_B64[k]),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);o[k]=URL.createObjectURL(new Blob([a],{type:'image/png'}))}catch(e){o[k]=d}}return o})();\n`;
  // 1) table first thing inside the script
  need(html.split("'use strict';").length === 2, "'use strict' marker");
  html = html.replace("'use strict';", () => "'use strict';\n" + embed);
  // 2) artSrc keeps its exact path logic as artKey(); artSrc looks the picture up
  html = html.replace(ART_RE, (_, tpl) => `const artKey=(m,c)=>${tpl};const artSrc=(m,c)=>EMBED[artKey(m,c)];`);
  // 3) every dynamic <img> also carries its repository path (for tests/debugging)
  html = html.replace(IMG_RE, (_, args) => `data-art="\${artKey(${args})}" src="\${artSrc(${args})}"`);
  // 4) static logo
  html = html.replace('src="paremon_logo_center_crop2.png"', () => `data-art="${LOGO}" src="data:image/png;base64,${b64(path.join(root, LOGO))}"`);
  html = html.replace('<!doctype html>', `<!doctype html><!-- paremon standalone playtest, commit ${sha}; self-contained: no external files, no network -->`);
  verify(html, root);
  return html;
}

// Throws if the file is not a complete, self-contained build.
export function verify(html, root) {
  const bad = [];
  const m = html.match(/const EMBED_B64=(\{.*?\});\n/s);
  if (!m) throw new Error('verify: embedded picture table missing');
  let table; try { table = JSON.parse(m[1]); } catch { throw new Error('verify: embedded picture table is not valid JSON'); }
  for (const k of KEYS) {
    if (!(k in table)) { bad.push(`missing ${k}`); continue; }
    const buf = Buffer.from(table[k], 'base64');
    if (buf.subarray(1, 4).toString() !== 'PNG') bad.push(`not a PNG: ${k}`);
    else if (root && sha256(buf) !== sha256(fs.readFileSync(path.join(root, k)))) bad.push(`differs from repository file: ${k}`);
  }
  if (Object.keys(table).length !== KEYS.length) bad.push(`table has ${Object.keys(table).length} entries, expected ${KEYS.length}`);
  const logo = html.match(/data-art="paremon_logo_center_crop2\.png" src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
  if (!logo) bad.push('logo is not embedded');
  else if (Buffer.from(logo[1], 'base64').subarray(1, 4).toString() !== 'PNG') bad.push('logo is not a PNG');
  else if (root && sha256(Buffer.from(logo[1], 'base64')) !== sha256(fs.readFileSync(path.join(root, LOGO)))) bad.push('logo differs from repository file');
  // no remaining path-based picture loading
  const stripped = html.replace(/const EMBED_B64=\{.*?\};\n/s, '').replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'DATA');
  if (/\bsrc="(?!DATA|\$\{artSrc)/.test(stripped)) bad.push('an <img src> that is not embedded');
  if (/https?:\/\//i.test(stripped)) bad.push('absolute URL present');
  if (/<script[^>]+src=|<link[^>]+href=|(?<![A-Za-z])url\(\s*['"]?(?!data:)/i.test(stripped)) bad.push('external script/style/url() reference');
  if (!/const artSrc=\(m,c\)=>EMBED\[artKey\(m,c\)\]/.test(html)) bad.push('artSrc does not use the embedded table');
  if (bad.length) throw new Error('verify: ' + bad.join('; '));
  return true;
}
