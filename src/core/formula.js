const FUNCTIONS = new Set([
  'IF', 'ROUND', 'CONCAT', 'DATEADD', 'DATEDIFF', 'ABS', 'MIN', 'MAX',
  'LEN', 'UPPER', 'LOWER', 'TODAY',
  'AND', 'OR', 'NOT', 'ISNULL', 'ISBLANK', 'NOW'
]);

export class FormulaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FormulaError';
  }
}

export function compileFormula(expression, entity, existingBindings = {}) {
  const source = String(expression || '').trim().replaceAll('&amp;&amp;', '&&').replaceAll('&amp;', '&');
  if (!source) throw new FormulaError('公式不能为空。');
  const ast = new Parser(tokenize(source)).parse();
  const bindings = {};
  const dependencies = [];
  bindFields(ast, entity, existingBindings, bindings, dependencies);
  return { expression: source, ast, bindings, dependencies: [...new Set(dependencies)] };
}

export function normalizeFormulaField(field, entity) {
  const raw = field.formula || {};
  const expression = raw.expression || field.expression || '';
  const resultType = raw.resultType || field.resultType || 'number';
  const normalizedResultType = normalizeResultType(resultType);
  if (!['number', 'date', 'text'].includes(normalizedResultType)) throw new FormulaError(`公式结果类型不支持：${resultType}`);
  const compiled = compileFormula(expression, entity, raw.bindings || {});
  let displayExpression = compiled.expression;
  const displayBindings = {};
  for (const [token, fieldId] of Object.entries(compiled.bindings)) {
    const sourceField = entity.fields.find((item) => item.id === fieldId);
    const displayToken = sourceField?.label || token;
    displayExpression = displayExpression.replaceAll(`{${token}}`, `{${displayToken}}`);
    displayBindings[displayToken] = fieldId;
  }
  field.formula = {
    expression: displayExpression,
    resultType: normalizedResultType,
    bindings: displayBindings,
    dependencies: compiled.dependencies
  };
  delete field.expression;
  delete field.resultType;
  return field;
}

export function evaluateFormulaField(field, entity, data, options = {}) {
  const formula = field.formula || {};
  const compiled = compileFormula(formula.expression, entity, formula.bindings || {});
  const value = evaluateNode(compiled.ast, data || {}, options);
  return coerceResult(value, formula.resultType || 'number');
}

export function calculateFormulaFields(entity, data, options = {}) {
  const next = { ...(data || {}) };
  const errors = {};
  // Resolve select/multiSelect option IDs to labels so formulas compare by display value
  for (const field of entity?.fields || []) {
    if (field.type === 'select' && next[field.id] != null) {
      const option = (field.options || []).find((opt) => opt.id === next[field.id]);
      if (option) next[field.id] = option.label;
    }
    if (field.type === 'multiSelect' && Array.isArray(next[field.id])) {
      next[field.id] = next[field.id].map((id) => {
        const option = (field.options || []).find((opt) => opt.id === id);
        return option ? option.label : id;
      });
    }
  }
  for (const field of entity?.fields || []) {
    if (field.type !== 'formula') continue;
    try {
      next[field.id] = evaluateFormulaField(field, entity, next, options);
    } catch (error) {
      next[field.id] = null;
      errors[field.id] = error instanceof Error ? error.message : String(error);
    }
  }
  return { data: next, formulaErrors: errors };
}

export function formulaDependents(entity, fieldId) {
  return (entity?.fields || []).filter((field) =>
    field.type === 'formula' && (field.formula?.dependencies || []).includes(fieldId)
  );
}

export function renameFormulaBinding(field, fieldId, nextLabel) {
  if (field.type !== 'formula' || !field.formula?.bindings) return;
  const bindings = { ...field.formula.bindings };
  let expression = field.formula.expression || '';
  for (const [token, id] of Object.entries(bindings)) {
    if (id !== fieldId) continue;
    expression = expression.replaceAll(`{${token}}`, `{${nextLabel}}`);
    delete bindings[token];
    bindings[nextLabel] = fieldId;
  }
  field.formula = { ...field.formula, expression, bindings };
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '{') {
      const end = source.indexOf('}', index + 1);
      if (end < 0) throw new FormulaError('字段引用缺少右花括号。');
      const label = source.slice(index + 1, end).trim();
      if (!label) throw new FormulaError('字段引用不能为空。');
      tokens.push({ type: 'field', value: label });
      index = end + 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index++];
        if (current === quote) { closed = true; break; }
        if (current === '\\') {
          if (index >= source.length) break;
          const escaped = source[index++];
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
        } else value += current;
      }
      if (!closed) throw new FormulaError('字符串缺少结束引号。');
      tokens.push({ type: 'literal', value });
      continue;
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] || ''))) {
      const match = source.slice(index).match(/^(?:\d+\.?\d*|\.\d+)/);
      tokens.push({ type: 'literal', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];
      const upper = match.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') tokens.push({ type: 'literal', value: upper === 'TRUE' });
      else if (upper === 'NULL') tokens.push({ type: 'literal', value: null });
      else tokens.push({ type: 'identifier', value: upper });
      index += match.length;
      continue;
    }
    const pair = source.slice(index, index + 2);
    if (['>=', '<=', '!=', '==', '&&', '||'].includes(pair)) {
      tokens.push({ type: 'operator', value: pair }); index += 2; continue;
    }
    if ('+-*/><=&'.includes(char)) { tokens.push({ type: 'operator', value: char === '&' ? '+' : char }); index += 1; continue; }
    if (char === '(' || char === ')' || char === ',') { tokens.push({ type: char, value: char }); index += 1; continue; }
    throw new FormulaError(`公式包含不支持的字符：${char}`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.index = 0; }
  current() { return this.tokens[this.index]; }
  consume(type, value) {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) return null;
    this.index += 1;
    return token;
  }
  expect(type, value, message) {
    const token = this.consume(type, value);
    if (!token) throw new FormulaError(message || `公式语法错误，期望 ${value || type}。`);
    return token;
  }
  parse() {
    const expression = this.logicalOr();
    this.expect('eof', undefined, '公式末尾存在无法解析的内容。');
    return expression;
  }
  logicalOr() {
    let node = this.logicalAnd();
    while (this.consume('operator', '||')) node = { type: 'binary', operator: '||', left: node, right: this.logicalAnd() };
    return node;
  }
  logicalAnd() {
    let node = this.comparison();
    while (this.consume('operator', '&&')) node = { type: 'binary', operator: '&&', left: node, right: this.comparison() };
    return node;
  }
  comparison() {
    let node = this.additive();
    while (this.current().type === 'operator' && ['=', '==', '!=', '>', '>=', '<', '<='].includes(this.current().value)) {
      const operator = this.current().value; this.index += 1;
      node = { type: 'binary', operator, left: node, right: this.additive() };
    }
    return node;
  }
  additive() {
    let node = this.multiplicative();
    while (this.current().type === 'operator' && ['+', '-'].includes(this.current().value)) {
      const operator = this.current().value; this.index += 1;
      node = { type: 'binary', operator, left: node, right: this.multiplicative() };
    }
    return node;
  }
  multiplicative() {
    let node = this.unary();
    while (this.current().type === 'operator' && ['*', '/'].includes(this.current().value)) {
      const operator = this.current().value; this.index += 1;
      node = { type: 'binary', operator, left: node, right: this.unary() };
    }
    return node;
  }
  unary() {
    if (this.current().type === 'operator' && ['+', '-'].includes(this.current().value)) {
      const operator = this.current().value; this.index += 1;
      return { type: 'unary', operator, argument: this.unary() };
    }
    return this.primary();
  }
  primary() {
    const literal = this.consume('literal');
    if (literal) return { type: 'literal', value: literal.value };
    const field = this.consume('field');
    if (field) return { type: 'field', token: field.value };
    const identifier = this.consume('identifier');
    if (identifier) {
      if (!FUNCTIONS.has(identifier.value)) throw new FormulaError(`不支持的函数：${identifier.value}`);
      this.expect('(', undefined, `函数 ${identifier.value} 后需要左括号。`);
      const args = [];
      if (!this.consume(')')) {
        do { args.push(this.logicalOr()); } while (this.consume(','));
        this.expect(')', undefined, `函数 ${identifier.value} 缺少右括号。`);
      }
      return { type: 'call', name: identifier.value, args };
    }
    if (this.consume('(')) {
      const node = this.logicalOr();
      this.expect(')', undefined, '公式缺少右括号。');
      return node;
    }
    throw new FormulaError('公式语法错误。');
  }
}

function bindFields(node, entity, existingBindings, bindings, dependencies) {
  if (!node) return;
  if (node.type === 'field') {
    const boundId = existingBindings[node.token];
    const candidates = (entity?.fields || []).filter((field) =>
      (boundId && field.id === boundId) || (!boundId && (field.label === node.token || field.id === node.token))
    );
    if (candidates.length !== 1) throw new FormulaError(candidates.length ? `字段引用不唯一：${node.token}` : `找不到字段：${node.token}`);
    const field = candidates[0];
    if (field.type === 'formula') throw new FormulaError(`公式不能引用公式字段：${field.label}`);
    if (field.type === 'relation') throw new FormulaError(`公式不能引用关联字段：${field.label}`);
    node.fieldId = field.id;
    bindings[node.token] = field.id;
    dependencies.push(field.id);
    return;
  }
  if (node.left) bindFields(node.left, entity, existingBindings, bindings, dependencies);
  if (node.right) bindFields(node.right, entity, existingBindings, bindings, dependencies);
  if (node.argument) bindFields(node.argument, entity, existingBindings, bindings, dependencies);
  for (const arg of node.args || []) bindFields(arg, entity, existingBindings, bindings, dependencies);
}

function evaluateNode(node, data, options) {
  if (node.type === 'literal') return node.value;
  if (node.type === 'field') return data[node.fieldId];
  if (node.type === 'unary') return node.operator === '-' ? -numberValue(evaluateNode(node.argument, data, options)) : numberValue(evaluateNode(node.argument, data, options));
  if (node.type === 'binary') {
    const left = evaluateNode(node.left, data, options);
    if (node.operator === '&&') return truthy(left) && truthy(evaluateNode(node.right, data, options));
    if (node.operator === '||') return truthy(left) || truthy(evaluateNode(node.right, data, options));
    return evaluateBinary(node.operator, left, evaluateNode(node.right, data, options));
  }
  if (node.type === 'call') {
    if (node.name === 'IF') {
      if (node.args.length !== 3) throw new FormulaError('IF 需要 3 个参数。');
      return truthy(evaluateNode(node.args[0], data, options))
        ? evaluateNode(node.args[1], data, options)
        : evaluateNode(node.args[2], data, options);
    }
    return callFunction(node.name, node.args.map((arg) => evaluateNode(arg, data, options)), options);
  }
  throw new FormulaError('无法计算公式。');
}

function evaluateBinary(operator, left, right) {
  if (operator === '+') {
    if (typeof left === 'string' || typeof right === 'string') return String(left ?? '') + String(right ?? '');
    return numberValue(left) + numberValue(right);
  }
  if (operator === '-') return numberValue(left) - numberValue(right);
  if (operator === '*') return numberValue(left) * numberValue(right);
  if (operator === '/') {
    const divisor = numberValue(right);
    if (divisor === 0) throw new FormulaError('不能除以 0。');
    return numberValue(left) / divisor;
  }
  const comparison = compare(left, right);
  if (operator === '=' || operator === '==') return comparison === 0;
  if (operator === '!=') return comparison !== 0;
  if (operator === '>') return comparison > 0;
  if (operator === '>=') return comparison >= 0;
  if (operator === '<') return comparison < 0;
  if (operator === '<=') return comparison <= 0;
  throw new FormulaError(`不支持的运算符：${operator}`);
}

function callFunction(name, args, options) {
  if (name === 'ROUND') return round(numberValue(args[0]), args[1] === undefined ? 0 : numberValue(args[1]));
  if (name === 'CONCAT') return args.map((value) => String(value ?? '')).join('');
  if (name === 'DATEADD') return addDays(args[0], numberValue(args[1]));
  if (name === 'DATEDIFF') return dateDiff(args[0], args[1]);
  if (name === 'ABS') return Math.abs(numberValue(args[0]));
  if (name === 'MIN') return Math.min(...args.map(numberValue));
  if (name === 'MAX') return Math.max(...args.map(numberValue));
  if (name === 'LEN') return String(args[0] ?? '').length;
  if (name === 'UPPER') return String(args[0] ?? '').toUpperCase();
  if (name === 'LOWER') return String(args[0] ?? '').toLowerCase();
  if (name === 'TODAY') return today(options.timeZone || 'Asia/Shanghai', options.now);
  if (name === 'NOW') return today(options.timeZone || 'Asia/Shanghai', options.now);
  if (name === 'AND') return args.every((value) => truthy(value));
  if (name === 'OR') return args.some((value) => truthy(value));
  if (name === 'NOT') return !truthy(args[0]);
  if (name === 'ISNULL' || name === 'ISBLANK') return args[0] === null || args[0] === undefined || args[0] === '';
  throw new FormulaError(`不支持的函数：${name}`);
}

function numberValue(value) {
  if (value === null || value === '' || value === undefined) return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new FormulaError(`无法转换为数字：${value}`);
  return number;
}

function round(value, digits) {
  const places = Math.max(0, Math.min(12, Math.trunc(digits)));
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseDate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new FormulaError(`无法转换为日期：${value}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dateString(timestamp) { return new Date(timestamp).toISOString().slice(0, 10); }
function addDays(value, days) { return dateString(parseDate(value) + Math.trunc(days) * 86400000); }
function dateDiff(end, start) { return Math.trunc((parseDate(end) - parseDate(start)) / 86400000); }
function today(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function truthy(value) { return Boolean(value); }
function normalizeResultType(type) {
  const map = { string: 'text', boolean: 'text', integer: 'number', float: 'number', double: 'number', datetime: 'text', percentage: 'number' };
  return map[type] || type || 'number';
}
function compare(left, right) {
  if (left === right) return 0;
  const leftNumber = Number(left); const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber < rightNumber ? -1 : 1;
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN');
}
function coerceResult(value, resultType) {
  const type = normalizeResultType(resultType);
  if (value === null || value === undefined) return null;
  if (type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (type === 'text') return String(value);
  if (type === 'date') {
    try { return dateString(parseDate(value)); } catch { return value; }
  }
  throw new FormulaError(`公式结果类型不支持：${resultType}`);
}
