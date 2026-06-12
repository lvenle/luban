import { createZip } from './zip.js';

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cellRef(columnIndex, rowIndex) {
  let name = '';
  let index = columnIndex + 1;
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return `${name}${rowIndex + 1}`;
}

function sheetXml(rows) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => `<c r="${cellRef(columnIndex, rowIndex)}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`)
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${body}</sheetData>
</worksheet>`;
}

export function recordsToXlsx(records, entity) {
  const fields = entity?.fields?.length
    ? entity.fields
    : [...new Set(records.flatMap((record) => Object.keys(record.data || {})))].map((id) => ({ id, label: id }));
  const rows = [
    fields.map((field) => field.label || field.id),
    ...records.map((record) => fields.map((field) => displayExportValue(record.data?.[field.id], field)))
  ];
  return createZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${xml(entity?.name || '数据')}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows) }
  ]);
}

function displayExportValue(value, field = {}) {
  if (field.type === 'select') return optionLabel(field, value);
  if (field.type === 'multiSelect') return (Array.isArray(value) ? value : []).map((item) => optionLabel(field, item)).join('、');
  if (field.type === 'relation') return (Array.isArray(value) ? value : [value]).filter(Boolean).map((item) => item.displayValue || item).join('、');
  if (field.type === 'image' || field.type === 'file') return fileLabel(value);
  if (Array.isArray(value)) return value.join('、');
  if (value && typeof value === 'object') return value.displayValue || value.label || value.optionId || '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value ?? '';
}

function fileLabel(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(fileLabel).filter(Boolean).join('、');
  if (typeof value === 'object') return value.name || value.filename || value.label || value.url || '';
  return value;
}

function optionLabel(field, value) {
  const raw = value?.optionId || value?.id || value;
  const option = (field.options || []).find((item) => item.id === raw || item.label === raw);
  return option?.label || raw || '';
}
