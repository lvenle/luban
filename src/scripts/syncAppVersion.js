import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const now = new Date();
const version = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
  .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
  .join('.');

function updateJson(relativePath, update) {
  const filePath = path.join(projectRoot, relativePath);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  update(value);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function replace(relativePath, pattern, replacement) {
  const filePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const next = source.replace(pattern, replacement);
  if (next === source && !source.includes(replacement)) {
    throw new Error(`Unable to update version in ${relativePath}`);
  }
  fs.writeFileSync(filePath, next);
}

updateJson('package.json', (value) => { value.version = version; });
updateJson('package-lock.json', (value) => {
  value.version = version;
  if (value.packages?.['']) value.packages[''].version = version;
});

replace('src/server.js', /const APP_VERSION = '[^']+';/, `const APP_VERSION = '${version}';`);
replace('src/agent/runtime-adapter.js', /productVersion = '[^']+',/, `productVersion = '${version}',`);
replace('public/app-context.js', /export const APP_VERSION = '[^']+';/, `export const APP_VERSION = '${version}';`);
replace('public/version.js', /window\.LUBAN_VERSION='[^']+';/, `window.LUBAN_VERSION='${version}';`);

console.log(`Application version synchronized to ${version}`);
