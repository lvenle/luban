import { inflateRawSync, gunzipSync } from 'node:zlib';

/** 最小 zip / tar.gz 解压：纯 JS 实现，避免引入外部依赖。所有路径经 zip-slip 校验。 */
const safeEntryPath = path => typeof path === 'string' && path && !path.startsWith('/') && !path.includes('\\') &&
  !path.split('/').some(part => !part || part === '.' || part === '..');

function normalize(path) {
  path = path.replace(/^\.\//, '').replace(/\/+/g, '/');
  return path;
}

function extractZip(bytes) {
  const files = [];
  const view = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let offset = 0;
  while (offset + 30 <= view.length) {
    const sig = view.readUInt32LE(offset);
    if (sig !== 0x04034b50) { offset += 1; continue; }
    const method = view.readUInt16LE(offset + 8);
    const compSize = view.readUInt32LE(offset + 18);
    const nameLen = view.readUInt16LE(offset + 26);
    const extraLen = view.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    if (nameStart + nameLen > view.length) break;
    const rawName = view.toString('utf8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    if (dataStart + compSize > view.length) break;
    const name = normalize(rawName);
    if (name && !name.endsWith('/') && safeEntryPath(name)) {
      const comp = view.subarray(dataStart, dataStart + compSize);
      const data = method === 8 ? inflateRawSync(comp) : method === 0 ? Buffer.from(comp) : null;
      if (data === null) throw new Error(`不支持的 zip 压缩方式：${name}`);
      files.push({ path: name, bytes: data });
    }
    offset = dataStart + compSize;
  }
  if (!files.length) throw new Error('zip 包中没有可用的文件');
  return files;
}

function extractTarGz(bytes) {
  const tar = gunzipSync(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  const files = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    let name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '');
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim(), 8) || 0;
    const type = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    const norm = normalize(name);
    if ((type === '0' || type === '\0') && norm && !norm.endsWith('/') && safeEntryPath(norm)) {
      files.push({ path: norm, bytes: Buffer.from(tar.subarray(dataStart, dataStart + size)) });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (!files.length) throw new Error('tar.gz 包中没有可用的文件');
  return files;
}

export function extractArchive(bytes, filename) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.zip')) return extractZip(bytes);
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return extractTarGz(bytes);
  throw new Error('仅支持 .zip / .tar.gz 技能包');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }

/** Create a standards-compliant uncompressed ZIP archive from relative file entries. */
export function createZip(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8'), data = Buffer.from(entry.bytes), crc = crc32(data);
    if (!safeEntryPath(entry.path) || data.length > 0xffffffff || name.length > 0xffff) throw new Error('Invalid ZIP entry');
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name); offset += header.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(central), localBytes = Buffer.concat(local), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, end]);
}
