import { inflateRawSync } from 'node:zlib';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = textEncoder.encode(file.name);
    const data = typeof file.data === 'string' ? textEncoder.encode(file.data) : new Uint8Array(file.data);
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data
    ]);
    localParts.push(local);
    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name
      ])
    );
    offset += local.length;
  }
  const central = concat(centralParts);
  const local = concat(localParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(local.length),
    u16(0)
  ]);
  return concat([local, central, end]);
}

export function readZip(buffer) {
  const entries = readZipEntries(buffer);
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, textDecoder.decode(data)]));
}

export function readZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const files = {};
  let offset = 0;
  while (offset < bytes.length - 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const sig = view.getUint32(0, true);
    if (sig !== 0x04034b50) break;
    const compression = view.getUint16(8, true);
    const compressedSize = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = textDecoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    if (compression === 0) {
      files[name] = data;
    } else if (compression === 8) {
      files[name] = new Uint8Array(inflateRawSync(data));
    } else {
      throw new Error('不支持这个 zip 压缩格式。');
    }
    offset = dataStart + compressedSize;
  }
  return files;
}

export function packageToZipPayload(pkg) {
  const files = [
    { name: 'manifest.json', data: JSON.stringify(pkg.manifest, null, 2) },
    { name: 'schema.json', data: JSON.stringify(pkg.schema, null, 2) },
    { name: 'ui.json', data: JSON.stringify(pkg.ui, null, 2) },
    { name: 'actions.json', data: JSON.stringify(pkg.actions, null, 2) },
    { name: 'prompts.json', data: JSON.stringify(pkg.prompts || {}, null, 2) }
  ];
  if (pkg.sampleData) files.push({ name: 'sample-data.json', data: JSON.stringify(pkg.sampleData, null, 2) });
  return createZip(files);
}

export function zipPayloadToPackage(buffer) {
  const files = readZip(buffer);
  const required = ['manifest.json', 'schema.json', 'ui.json', 'actions.json'];
  for (const name of required) {
    if (!files[name]) throw new Error(`软件包缺少 ${name}`);
  }
  return {
    manifest: JSON.parse(files['manifest.json']),
    schema: JSON.parse(files['schema.json']),
    ui: JSON.parse(files['ui.json']),
    actions: JSON.parse(files['actions.json']),
    prompts: files['prompts.json'] ? JSON.parse(files['prompts.json']) : {},
    sampleData: files['sample-data.json'] ? JSON.parse(files['sample-data.json']) : undefined
  };
}
