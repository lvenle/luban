import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tools = [];
const toolMap = {};

export function register({ name, description, risk = 'low', schema, handler }) {
  const entry = { name, description, risk, schema, handler };
  tools.push(entry);
  toolMap[name] = entry;
}

export function getToolDefinitions() {
  return tools.map((t) => t.schema);
}

export function getTool(name) {
  return toolMap[name];
}

export function getTools() {
  return [...tools];
}

export function discoverTools() {
  const dir = join(__dirname, 'tools');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js');
  for (const file of files) {
    const path = join(dir, file);
    if (statSync(path).isFile()) {
      import(`file://${path}`);
    }
  }
}
