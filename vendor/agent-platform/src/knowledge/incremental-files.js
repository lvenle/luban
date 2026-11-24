import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, isAbsolute } from 'node:path';

function checkPath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.split(/[\\/]/).some(part => !part || part === '..' || part === '.')) throw Error('Invalid knowledge file path');
}

// Only changed files enter the transaction. Publication is synchronous so readers in
// this process cannot observe half a commit. An interrupted commit is rolled back
// at startup unless SQLite already records the new revision.
export function recoverFiles(base, revision) {
  const tx = join(base, '.update');
  const journal = join(tx, 'journal.json');
  if (existsSync(journal)) {
    const { version, changes } = JSON.parse(readFileSync(journal, 'utf8'));
    if (revision !== version) {
      for (const { path, existed } of changes) {
        checkPath(path);
        const target = join(base, 'current', path), backup = join(tx, 'before', path);
        if (existsSync(backup)) {
          rmSync(target, { force: true }); mkdirSync(dirname(target), { recursive: true }); renameSync(backup, target);
        } else if (!existed) rmSync(target, { force: true });
      }
    }
  }
  rmSync(tx, { recursive: true, force: true });
}

export function migrateCurrent(base, version) {
  if (!version || existsSync(join(base, 'current'))) return;
  const legacy = join(base, version);
  if (existsSync(legacy)) renameSync(legacy, join(base, 'current'));
}

export class IncrementalFiles {
  constructor(base) { this.base = base; this.root = join(base, 'current'); this.tx = join(base, '.update'); this.changes = new Map(); }
  async read(path, encoding = 'utf8') {
    checkPath(path);
    if (this.changes.has(path)) {
      if (this.changes.get(path) === 'delete') { const e = Error('File removed'); e.code = 'ENOENT'; throw e; }
      return readFile(join(this.tx, 'after', path), encoding);
    }
    return readFile(join(this.root, path), encoding);
  }
  async write(path, content) {
    checkPath(path);
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    try { if ((await readFile(join(this.root, path))).equals(data)) { this.changes.delete(path); return; } }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const target = join(this.tx, 'after', path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, data, { mode: 0o600 }); this.changes.set(path, 'write');
  }
  remove(path) { checkPath(path); this.changes.set(path, 'delete'); }
  async discard() { if (!existsSync(join(this.tx, 'journal.json'))) await rm(this.tx, { recursive: true, force: true }); }
  commit(version, publish) {
    const changes = [...this.changes].map(([path, action]) => ({ path, action, existed: existsSync(join(this.root, path)) }));
    mkdirSync(this.tx, { recursive: true, mode: 0o700 });
    writeFileSync(join(this.tx, 'journal.json'), JSON.stringify({ version, changes }), { mode: 0o600 });
    let published = false;
    try {
      for (const { path, action, existed } of changes) {
        const target = join(this.root, path), backup = join(this.tx, 'before', path);
        if (existed) { mkdirSync(dirname(backup), { recursive: true }); renameSync(target, backup); }
        if (action === 'write') { mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); renameSync(join(this.tx, 'after', path), target); }
      }
      publish(); published = true;
    } finally {
      if (published) { try { recoverFiles(this.base, version); } catch { /* startup retries committed cleanup */ } }
      else recoverFiles(this.base, null);
    }
  }
}

export function listFiles(root, prefix = '') {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? listFiles(join(root, entry.name), prefix + entry.name + '/')
    : entry.isFile() ? [prefix + entry.name] : []);
}
