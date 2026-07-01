import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

test('frontend and backend module graphs respect dependency boundaries', () => {
  const frontend = graphFor(resolve(root, 'public'));
  const backend = graphFor(resolve(root, 'src'));
  assert.deepEqual(cycles(frontend), [], 'frontend imports must be acyclic');
  assert.deepEqual(cycles(backend), [], 'backend imports must be acyclic');

  const featureFiles = [...frontend.keys()].filter((file) => /public\/(app-home|app-runtime|ai-assistant)\//.test(file));
  for (const file of featureFiles) {
    assert.equal(frontend.get(file).some((dependency) => dependency.endsWith('/public/app.js')), false, `${file} imports app.js`);
  }
  for (const [file, dependencies] of backend) {
    if (!file.includes('/src/models/')) continue;
    assert.equal(dependencies.some((dependency) => dependency.includes('/src/routes/')), false, `${file} imports a route`);
  }
});

function graphFor(directory) {
  const files = readdirSync(directory, { recursive: true })
    .filter((file) => file.endsWith('.js'))
    .map((file) => resolve(directory, file));
  const known = new Set(files);
  return new Map(files.map((file) => {
    const source = readFileSync(file, 'utf8');
    const dependencies = [...source.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)]
      .map((match) => {
        let target = resolve(dirname(file), match[1]);
        if (!extname(target)) target += '.js';
        return target;
      })
      .filter((target) => known.has(target) && target !== file);
    return [file, dependencies];
  }));
}

function cycles(graph) {
  let index = 0;
  const indexes = new Map();
  const lows = new Map();
  const stack = [];
  const active = new Set();
  const found = [];
  function visit(node) {
    indexes.set(node, index);
    lows.set(node, index++);
    stack.push(node);
    active.add(node);
    for (const dependency of graph.get(node) || []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        lows.set(node, Math.min(lows.get(node), lows.get(dependency)));
      } else if (active.has(dependency)) {
        lows.set(node, Math.min(lows.get(node), indexes.get(dependency)));
      }
    }
    if (lows.get(node) !== indexes.get(node)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      active.delete(current);
      component.push(relative(root, current));
    } while (current !== node);
    if (component.length > 1) found.push(component.sort());
  }
  for (const node of graph.keys()) if (!indexes.has(node)) visit(node);
  return found.sort((left, right) => left[0].localeCompare(right[0]));
}
