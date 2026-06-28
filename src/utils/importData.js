import { readZipEntries } from './zip.js';

const textDecoder = new TextDecoder();

export function importRowsFromFile(buffer, entity, fileName = '') {
  const name = String(fileName || '').toLowerCase();
  const rows = name.endsWith('.xlsx') || looksLikeZip(buffer)
    ? rowsFromXlsx(buffer)
    : rowsFromCsv(textDecoder.decode(stripBom(new Uint8Array(buffer))));
  return rowsToRecords(rows, entity);
}

export function rowsFromCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => String(value || '').trim()));
}

export function rowsFromXlsx(buffer) {
  const files = readZipEntries(buffer);
  const sheetName = firstSheetPath(files);
  if (!sheetName || !files[sheetName]) throw new Error('没有找到可导入的工作表。');
  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml']);
  return parseSheetXml(textDecoder.decode(files[sheetName]), sharedStrings)
    .filter((row) => row.some((value) => String(value || '').trim()));
}

function firstSheetPath(files) {
  if (files['xl/worksheets/sheet1.xml']) return 'xl/worksheets/sheet1.xml';
  return Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
}

function parseSharedStrings(bytes) {
  if (!bytes) return [];
  const xml = textDecoder.decode(bytes);
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((text) => xmlText(text[1])).join('')
  );
}

function parseSheetXml(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attr(attrs, 'r');
      const column = ref ? columnIndex(ref.replace(/\d+/g, '')) : row.length;
      while (row.length < column) row.push('');
      const type = attr(attrs, 't');
      const rawValue = firstMatch(body, /<v>([\s\S]*?)<\/v>/) ?? inlineString(body);
      row[column] = type === 's' ? sharedStrings[Number(rawValue)] || '' : xmlText(rawValue || '');
    }
    rows.push(row);
  }
  return rows;
}

function rowsToRecords(rows, entity) {
  if (!rows.length) return [];
  const fields = entity?.fields || [];
  const headers = rows[0].map((item) => normalizeHeader(item));
  const fieldByHeader = new Map();
  for (const field of fields) {
    fieldByHeader.set(normalizeHeader(field.label), field);
    fieldByHeader.set(normalizeHeader(field.id), field);
  }
  const mapping = headers.map((header) => fieldByHeader.get(header) || null);
  return rows.slice(1)
    .map((row) => {
      const data = {};
      mapping.forEach((field, index) => {
        if (!field) return;
        const value = normalizeImportValue(row[index], field);
        if (value !== undefined) data[field.id] = value;
      });
      return data;
    })
    .filter((data) => Object.keys(data).length);
}

import { isMultiChoiceField, isSingleChoiceField, isRelationField, isFileLikeField } from '../core/fieldTypeHelpers.js';

function normalizeImportValue(value, field) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (field.type === 'number') {
    const number = text === '' ? null : Number(text.replace(/[,%]/g, ''));
    return number === null || field.format !== 'percent' ? number : number / 100;
  }
  if (isMultiChoiceField(field)) return splitMultiValue(text).map((item) => optionId(field, item));
  if (isSingleChoiceField(field)) return optionId(field, text);
  if (isRelationField(field)) return [];
  if (isFileLikeField(field)) return undefined;
  return text;
}

function optionId(field, value) {
  const option = (field.options || []).find((item) => item.id === value || item.label === value);
  return option?.id || value;
}

function splitMultiValue(value) {
  return String(value || '').split(/[、,;；|]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase();
}

function looksLikeZip(buffer) {
  const bytes = new Uint8Array(buffer);
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function stripBom(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.slice(3);
  return bytes;
}

function attr(input, name) {
  return firstMatch(input, new RegExp(`${name}="([^"]*)"`));
}

function firstMatch(input, pattern) {
  const match = String(input || '').match(pattern);
  return match?.[1];
}

function inlineString(body) {
  const match = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
  if (!match) return '';
  return [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => xmlText(item[1])).join('');
}

function xmlText(value) {
  return String(value ?? '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function columnIndex(name) {
  return [...String(name || '')].reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1;
}
