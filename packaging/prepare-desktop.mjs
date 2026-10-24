import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = resolve(root, '../ai-agent-platform');
const stage = join(root, '.desktop-runtime');
function run(command, args, cwd) {
  const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const result = spawnSync(executable, args, { cwd, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
run('npm', ['run', 'runtime:prepare'], platform);
// Only this generated staging directory is replaced. Runtime data never enters it.
await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, 'vendor', 'source'), { recursive: true });
const source = join(stage, 'vendor', 'source');
// Desktop receives only the dependency-checked local distribution from shared sources.
await cp(join(platform, 'release/local-runtime'), source, { recursive: true });
const runtimePackage = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
run('npm', ['pack', '--ignore-scripts', '--pack-destination', '..'], source);
const archive = `${runtimePackage.name.replace('@', '').replace('/', '-')}-${runtimePackage.version}.tgz`;
const tarball = join(stage, 'vendor', archive);
const runtimeSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
await rm(source, { recursive: true, force: true });
for (const directory of ['src', 'public', 'agents', 'desktop']) {
  await cp(join(root, directory), join(stage, directory), { recursive: true });
}
await cp(join(root, 'LICENSE'), join(stage, 'LICENSE'));
const product = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
product.dependencies = { '@xiaoya/agent-platform': `file:vendor/${archive}` };
delete product.devDependencies;
delete product.scripts;
product.build.electronDist = join(root, 'node_modules/electron/dist');
product.build.electronVersion = '43.0.0';
product.build.npmRebuild = false;
product.build.directories = { output: join(root, 'release/runtime'), buildResources: join(root, 'build') };
product.build.files.push('runtime-manifest.json');
await writeFile(join(stage, 'package.json'), JSON.stringify(product, null, 2));
await writeFile(join(stage, 'runtime-manifest.json'), JSON.stringify({
  product: 'luban', productVersion: product.version, runtimePackage: runtimePackage.name,
  runtimeVersion: runtimePackage.version, runtimeSha256, edition: 'local', consoleMode: null,
  capabilities: ['owned-instance', 'application-assistant', 'sdk-runs', 'scoped-product-tools', 'skills', 'frontend-settings'],
  excluded: ['instance-data', 'credentials', 'wechat-native-helpers', 'workbench-product-pages', 'management-ui', 'knowledge-engine', 'embedding-models', 'enterprise-host']
}, null, 2));
run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
console.log(`Prepared standalone product: ${stage}`);
