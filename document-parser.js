'use strict';

const zlib = require('node:zlib');
const PARSER_VERSION = 4;
const path = require('node:path');

const CATEGORY_ALIASES = [
  { id: 'gimbal', names: ['手持云台', '云台', '稳定器', 'gimbal', 'pocket', 'osmo'] },
  { id: 'panorama', names: ['全景运动相机', '全景相机', '运动相机', 'insta360', 'gopro', 'action'] },
  { id: 'mirrorless', names: ['微单相机', '微单', '无反', 'mirrorless'] },
  { id: 'compact', names: ['卡片相机', '卡片机', '卡片', 'compact'] },
  { id: 'ccd', names: ['ccd相机', 'ccd', 'ccd机'] },
  { id: 'tripod', names: ['落地三脚架', '三脚架', '支架', 'tripod'] }
];

const FIELD_ALIASES = {
  modelName: ['型号', '机型', '设备型号', '产品型号', '相机型号', '商品型号', 'model', 'modelname', 'model_name'],
  sn: ['sn', 'sn号', 'sn码', '串码', '串码sn', '串码（sn）', '序列号', '序列码', '机身码', '机身编号', '设备编号', '设备序列号', 'serial', 'serialnumber', 'serialsn'],
  condition: ['成色', '新旧', '新旧程度', '外观', '外观成色', '状况', 'condition'],
  warrantyStatus: ['是否在保', '在保', '保修状态', '是否保修', '在保状态', 'warranty', 'warrantystatus'],
  activationDate: ['激活时间', '激活日期', '首次激活', '首次激活时间', '开机时间', '启用时间', 'activationdate', 'activation', 'startdate'],
  warrantyEnd: ['在保到期时间', '在保到期', '保修到期', '保修到期时间', '保至', '保修截止', '到期时间', 'warrantyend', 'warrantyexpire', 'warrantyenddate'],
  refreshEnd: ['随心换到期时间', '随心换到期', '无忧换到期时间', '无忧换到期', '随心换', '无忧换', '换新到期', 'care+到期', 'care到期', 'refreshend', 'exchangedate'],
  sold: ['是否已出售', '是否出售', '已出售', '售出', '是否售出', '售出状态', 'sold', 'issold'],
  note: ['备注', '说明', '其他', '其他说明', '注释', 'note', 'remark', 'remarks'],
  category: ['大类', '分类', '类别', '品类', '产品分类', 'category', 'type'],
  subcategory: ['小类目', '小类', '子类', '子分类', '品牌', '品牌分类', '系列', 'subcategory', 'brand', 'series']
};

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)));
}

function cleanText(value) {
  return decodeXml(String(value || ''))
    .replace(/\u0000/g, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function normalizeHeader(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[（(]/g, '')
    .replace(/[）)]/g, '')
    .replace(/[：:]/g, '')
    .replace(/[_\-\/\\]/g, '');
}

function buildAliasLookup() {
  const lookup = new Map();
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    aliases.forEach((alias) => lookup.set(normalizeHeader(alias), field));
  });
  return lookup;
}

const HEADER_LOOKUP = buildAliasLookup();

function findZipEnd(buffer) {
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readZipEntries(buffer) {
  const eocd = findZipEnd(buffer);
  if (eocd < 0) throw new Error('文件不是有效的 ZIP/XLSX/DOCX 结构');
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < total; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, { name, compression, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipFile(buffer, entry) {
  if (!entry) return null;
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error('ZIP 本地文件头损坏');
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.compression === 0) return compressed;
  if (entry.compression === 8) return zlib.inflateRawSync(compressed);
  throw new Error('不支持 ZIP 压缩方式：' + entry.compression);
}

function readZipText(buffer, entries, name) {
  const entry = entries.get(name);
  if (!entry) return '';
  return readZipFile(buffer, entry).toString('utf8');
}

function extractXlsxText(fragment) {
  const texts = [];
  const regex = /<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/gi;
  let match;
  while ((match = regex.exec(fragment))) texts.push(decodeXml(match[1]));
  return cleanText(texts.join(''));
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const regex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let match;
  while ((match = regex.exec(xml))) strings.push(extractXlsxText(match[1]));
  return strings;
}

function columnIndex(reference) {
  const letters = String(reference || '').match(/[A-Z]+/i);
  if (!letters) return 0;
  let value = 0;
  for (const char of letters[0].toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return Math.max(0, value - 1);
}

function attribute(attrs, name) {
  const match = String(attrs || '').match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseWorksheet(xml, sharedStrings, sheetName) {
  const matrix = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml))) {
    const row = [];
    const cellRegex = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] || cellMatch[2] || '';
      const inner = cellMatch[3] || '';
      const reference = attribute(attrs, 'r');
      const type = attribute(attrs, 't');
      const index = columnIndex(reference);
      let value = '';
      if (type === 'inlineStr') {
        value = extractXlsxText(inner);
      } else {
        const rawValueMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
        const rawValue = rawValueMatch ? decodeXml(rawValueMatch[1]) : '';
        if (type === 's') value = sharedStrings[Number(rawValue)] || '';
        else if (type === 'b') value = rawValue === '1' ? '是' : '否';
        else value = cleanText(rawValue);
      }
      row[index] = cleanText(value);
    }
    if (row.some((cell) => cleanText(cell))) matrix.push({ row, sheetName });
  }
  return matrix;
}

function workbookSheets(buffer, entries) {
  const workbook = readZipText(buffer, entries, 'xl/workbook.xml');
  const relationships = readZipText(buffer, entries, 'xl/_rels/workbook.xml.rels');
  const relMap = new Map();
  if (relationships) {
    const regex = /<Relationship\b([^>]*)\/?>/gi;
    let match;
    while ((match = regex.exec(relationships))) relMap.set(attribute(match[1], 'Id'), attribute(match[1], 'Target'));
  }
  const sheets = [];
  if (workbook) {
    const regex = /<sheet\b([^>]*)\/?>/gi;
    let match;
    while ((match = regex.exec(workbook))) {
      const name = attribute(match[1], 'name') || '工作表';
      const relationId = attribute(match[1], 'r:id') || attribute(match[1], 'id');
      let target = relMap.get(relationId) || '';
      if (target) {
        target = target.replace(/^\//, '');
        target = target.startsWith('xl/') ? target : path.posix.normalize(path.posix.join('xl', target));
      }
      if (target && entries.has(target)) sheets.push({ name, target });
    }
  }
  if (!sheets.length) {
    Array.from(entries.keys()).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort().forEach((target, index) => sheets.push({ name: '工作表' + (index + 1), target }));
  }
  return sheets;
}

function parseBoolean(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (/^(是|在保|有效|已出售|已售|售出|true|yes|y|1|有)$/i.test(text)) return true;
  if (/^(否|不在保|无效|未出售|未售|库存中|false|no|n|0|无)$/i.test(text)) return false;
  if (text.includes('已售') || text.includes('出售')) return true;
  if (text.includes('未售') || text.includes('在库')) return false;
  return null;
}

function parseWarranty(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return 'unknown';
  if (/未知|不确定|待确认|unknown|\?/.test(text)) return 'unknown';
  if (/是|在保|有效|保内|true|yes|y|1/.test(text)) return 'yes';
  if (/否|不在保|无效|过保|脱保|false|no|n|0/.test(text)) return 'no';
  return 'unknown';
}

function excelSerialToISO(serial) {
  const number = Number(serial);
  if (!Number.isFinite(number) || number < 1 || number > 80000) return '';
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(number) * 86400000);
  return date.toISOString().slice(0, 10);
}

function parseDateValue(value) {
  const text = cleanText(value);
  if (!text) return '';
  const candidates = text.match(/(?:\d{4}[年.\/-]\d{1,2}[月.\/-]\d{1,2}日?|\d{8}|\d{5})/g);
  if (candidates && candidates.length > 1 && /\s(?:-|—|–|~|至|到)\s/.test(text)) return parseDateValue(candidates[candidates.length - 1]);
  if (/^\d{5}$/.test(text)) {
    const serial = excelSerialToISO(Number(text));
    if (serial) return serial;
  }
  const compact = text.replace(/[年./]/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/\s+/g, '');
  let match = compact.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
  match = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return match[1] + '-' + match[2] + '-' + match[3];
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  return '';
}

function sanitizeSn(value) {
  return cleanText(value).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function mapCategory(value) {
  const header = normalizeHeader(value);
  if (!header) return '';
  const exact = CATEGORY_ALIASES.find((item) => item.names.some((name) => normalizeHeader(name) === header));
  if (exact) return exact.id;
  const partial = CATEGORY_ALIASES.find((item) => item.names.some((name) => header.includes(normalizeHeader(name)) || normalizeHeader(name).includes(header)));
  return partial ? partial.id : '';
}

function inferCategory(modelName, note = '') {
  const text = (cleanText(modelName) + ' ' + cleanText(note)).toLowerCase();
  if (/pocket|osmo|云台|gimbal|稳定器/.test(text)) return 'gimbal';
  if (/insta360|ace\s*pro|gopro|action|运动相机|全景/.test(text)) return 'panorama';
  if (/ccd|ixus|iuxs|coolpix|powershot.*ccd/.test(text)) return 'ccd';
  if (/三脚架|tripod|富宝图|富图宝|曼富图|思锐/.test(text)) return 'tripod';
  if (/g7\s*x\s*3|g7x|rx100|卡片|zv-1|zv1/.test(text)) return 'compact';
  if (/r50|r6|r7|r8|r10|a7|a6000|a6400|z50|zfc|x-t|x-s|微单|无反|mirrorless/.test(text)) return 'mirrorless';
  return 'mirrorless';
}

function inferBrand(modelName, fallback = '其他') {
  const text = cleanText(modelName).toLowerCase();
  const brands = [
    ['大疆', /大疆|dji|osmo|pocket/], ['影石', /影石|insta360|ace\s*pro/], ['GoPro', /gopro/],
    ['佳能', /佳能|canon|eos|powershot|ixus/], ['索尼', /索尼|sony|alpha|a7|a6|zv-1|zv1|rx100/],
    ['尼康', /尼康|nikon|coolpix/], ['富士', /富士|fujifilm|fuji/], ['松下', /松下|panasonic|lumix/],
    ['卡西欧', /卡西欧|casio/], ['富宝图', /富宝图|富图宝|fotopro/], ['曼富图', /曼富图|manfrotto/], ['思锐', /思锐|sirui/]
  ];
  const matched = brands.find(([, regex]) => regex.test(text));
  return matched ? matched[0] : fallback;
}

function normalizeRecord(record, source) {
  const modelName = cleanText(record.modelName);
  const sn = sanitizeSn(record.sn);
  const categoryId = mapCategory(record.category) || inferCategory(modelName, record.note);
  const subcategoryName = cleanText(record.subcategory);
  return {
    source,
    importKey: source,
    categoryId,
    subcategoryName,
    modelName,
    sn,
    condition: cleanText(record.condition),
    warrantyStatus: parseWarranty(record.warrantyStatus),
    activationDate: parseDateValue(record.activationDate),
    warrantyEnd: parseDateValue(record.warrantyEnd),
    refreshEnd: parseDateValue(record.refreshEnd || record.refreshEndDate),
    sold: parseBoolean(record.sold),
    note: cleanText(record.note)
  };
}

function headerScore(row) {
  let score = 0;
  row.forEach((cell) => { if (HEADER_LOOKUP.has(normalizeHeader(cell))) score += 1; });
  return score;
}

function recordsFromMatrix(matrix, options = {}) {
  if (!matrix.length) return { records: [], warnings: [] };
  let headerIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < Math.min(matrix.length, 25); index += 1) {
    const score = headerScore(matrix[index].row);
    if (score > bestScore) { bestScore = score; headerIndex = index; }
  }
  if (headerIndex < 0 || bestScore < 2) return { records: [], warnings: ['没有识别到有效表头（至少需要型号或 SN 等字段）。'] };
  const columns = new Map();
  matrix[headerIndex].row.forEach((cell, index) => {
    const field = HEADER_LOOKUP.get(normalizeHeader(cell));
    if (field && !columns.has(field)) columns.set(field, index);
  });
  const records = [];
  const warnings = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const item = matrix[index];
    const repeatedHeaderScore = item.row.filter((cell) => HEADER_LOOKUP.has(normalizeHeader(cell))).length;
    if (repeatedHeaderScore >= 2) continue;
    const record = {};
    columns.forEach((columnIndex, field) => { record[field] = item.row[columnIndex] || ''; });
    const source = (item.sheetName || '工作表') + ':' + (index + 1);
    const normalized = normalizeRecord(record, source);
    if (!normalized.modelName && !normalized.sn) continue;
    if (!normalized.subcategoryName) normalized.subcategoryName = options.useSheetAsSubcategory && item.sheetName ? item.sheetName : inferBrand(normalized.modelName);
    if (!normalized.sn) warnings.push('第 ' + (index + 1) + ' 行未填写 SN，将作为待补录机型同步。');
    else if (normalized.sn.length < 5) warnings.push('第 ' + (index + 1) + ' 行 SN 长度不足，将标记为待核对。');
    records.push(normalized);
  }
  return { records, warnings };
}

function parseDelimited(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) || '';
  const counts = [
    { delimiter: ',', count: (firstLine.match(/,/g) || []).length },
    { delimiter: '\t', count: (firstLine.match(/\t/g) || []).length },
    { delimiter: ';', count: (firstLine.match(/;/g) || []).length }
  ].sort((a, b) => b.count - a.count);
  const delimiter = counts[0].count ? counts[0].delimiter : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cleanText(cell)); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cleanText(cell)); cell = '';
      if (row.some((value) => value)) rows.push({ row, sheetName: 'CSV' });
      row = [];
    } else cell += char;
  }
  row.push(cleanText(cell));
  if (row.some((value) => value)) rows.push({ row, sheetName: 'CSV' });
  return rows;
}

function extractWordText(fragment) {
  const withBreaks = String(fragment || '')
    .replace(/<w:tab\b[^>]*\/>/gi, ' ')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n');
  const texts = [];
  const regex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
  let match;
  while ((match = regex.exec(withBreaks))) texts.push(decodeXml(match[1]));
  return cleanText(texts.join(''));
}

function parseWordTables(documentXml) {
  const matrix = [];
  const tableRegex = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/gi;
  let tableMatch;
  let tableNumber = 0;
  while ((tableMatch = tableRegex.exec(documentXml))) {
    tableNumber += 1;
    const rowRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableMatch[1]))) {
      const row = [];
      const cellRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1]))) row.push(extractWordText(cellMatch[1]));
      if (row.some((value) => value)) matrix.push({ row, sheetName: 'Word表格' + tableNumber });
    }
  }
  return matrix;
}

function parseWordParagraphs(documentXml) {
  const withoutTables = documentXml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/gi, '\n');
  const paragraphRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
  const records = [];
  let current = {};
  let paragraphMatch;
  let recordIndex = 0;
  function push() {
    if (Object.keys(current).length && (current.modelName || current.sn)) {
      recordIndex += 1;
      current.__row = recordIndex;
      records.push(current);
    }
    current = {};
  }
  while ((paragraphMatch = paragraphRegex.exec(withoutTables))) {
    const text = extractWordText(paragraphMatch[1]);
    if (!text) continue;
    const match = text.match(/^\s*([^：:]{1,16})\s*[：:]\s*([\s\S]*)$/);
    if (!match) continue;
    const field = HEADER_LOOKUP.get(normalizeHeader(match[1]));
    if (!field) continue;
    const value = cleanText(match[2]);
    if ((field === 'modelName' && (current.modelName || current.sn)) || (field === 'sn' && current.sn)) push();
    current[field] = value;
  }
  push();
  return records;
}

function parseBuffer(buffer, filename = '') {
  const extension = path.extname(filename).toLowerCase();
  if (['.csv', '.tsv', '.txt'].includes(extension)) {
    const text = buffer.toString('utf8').replace(/^\ufeff/, '');
    return { format: 'csv', records: recordsFromMatrix(parseDelimited(text)) };
  }
  if (['.docx', '.docm', '.dotx', '.dotm'].includes(extension)) {
    const entries = readZipEntries(buffer);
    const documentXml = readZipText(buffer, entries, 'word/document.xml');
    if (!documentXml) throw new Error('Word 文件中没有找到 word/document.xml');
    const tableResult = recordsFromMatrix(parseWordTables(documentXml));
    const paragraphRecords = parseWordParagraphs(documentXml).map((record) => { const normalized = normalizeRecord(record, 'Word段落:' + (record.__row || '')); if (!normalized.subcategoryName) normalized.subcategoryName = inferBrand(normalized.modelName); return normalized; });
    const records = tableResult.records.concat(paragraphRecords.filter((record) => record.sn || record.modelName));
    return { format: extension.replace('.', '') || 'docx', records: { records, warnings: tableResult.warnings || [] } };
  }
  if (['.xlsx', '.xlsm', '.xltx', '.xltm'].includes(extension)) {
    const entries = readZipEntries(buffer);
    const sharedStrings = parseSharedStrings(readZipText(buffer, entries, 'xl/sharedStrings.xml'));
    const sheets = workbookSheets(buffer, entries);
    const matrix = [];
    sheets.forEach((sheet) => matrix.push(...parseWorksheet(readZipText(buffer, entries, sheet.target), sharedStrings, sheet.name)));
    return { format: extension.replace('.', '') || 'xlsx', records: recordsFromMatrix(matrix, { useSheetAsSubcategory: true }) };
  }
  if (extension === '.xls') throw new Error('暂不支持旧版 .xls，请在 Excel 中另存为 .xlsx 或 .xlsm 后导入。');
  if (extension === '.xlsb') throw new Error('暂不支持 Excel 二进制工作簿 .xlsb，请另存为 .xlsx 或 .xlsm 后导入。');
  if (extension === '.doc') throw new Error('暂不支持旧版 .doc，请在 Word 中另存为 .docx 或 .docm 后导入。');
  throw new Error('不支持的文件格式：' + (extension || '未知'));
}

function parseDocument(buffer, filename) {
  const parsed = parseBuffer(buffer, filename);
  const result = parsed.records || { records: [], warnings: [] };
  const records = (result.records || []).filter((record) => record.sn || record.modelName);
  const warnings = (result.warnings || []).slice(0, 100);
  return { format: parsed.format, records, warnings, total: records.length };
}

module.exports = { parseDocument, PARSER_VERSION };
