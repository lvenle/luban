import {open, realpath, readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
export class TaskFiles {
  constructor(directory) { this.directory = directory; }
  async path(name) {
    if (!name || name.length > 180 || /[\\/\x00-\x1f]/.test(name) || name.startsWith('.') || ['MEMORY.md','task.json','任务说明.txt','回复.md','未完成回复.md','工具记录.json'].includes(name)) throw new Error('Use a plain output filename, not a path or reserved name');
    return join(await realpath(this.directory), name);
  }
  async write(name, content) {
    if (Buffer.byteLength(content) > 500000) throw new Error('File exceeds 500 KB');
    const file = await open(await this.path(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(content); } finally { await file.close(); }
    return {path:join(this.directory,name), bytes:Buffer.byteLength(content)};
  }
  async read(name) {
    const file = await open(await this.path(name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 500000) throw new Error('Not a small regular file');
      return await file.readFile('utf8');
    } finally { await file.close(); }
  }
  async list() { return (await readdir(this.directory, {withFileTypes:true})).filter(x=>x.isFile() && !x.name.startsWith('.')).map(x=>x.name); }
}
