import {subprocess} from '../system/execution.js';
export {subprocess} from '../system/execution.js';
import { spawn } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export function publicURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) throw new Error('Only public HTTP(S) URLs are allowed');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Custom network ports are not available');
  const host = url.hostname.toLowerCase();
  if (host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal') || host.includes(':')) throw new Error('Private address blocked');
  if (isIP(host) && !publicAddress(host)) throw new Error('Private address blocked');
  return url.href;
}
function publicAddress(ip) {
  if (isIP(ip) === 6) return !/^(::|f[cd]|fe[89ab])/i.test(ip);
  const [a,b] = ip.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
}
export async function validateURL(url) {
  const normalized = publicURL(url);
  const addresses = await lookup(new URL(normalized).hostname, {all:true});
  if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw new Error('Private network destination blocked');
  return normalized;
}
export class BrowserAdapter {
  constructor(config) { this.config = config; this.chrome = null; this.opened = false; }
  async ensure(signal) {
    if (this.chrome && this.chrome.exitCode === null) return;
    await mkdir(this.config.stateDirectory, {recursive:true, mode:0o700});
    this.directory = await mkdtemp(join(this.config.stateDirectory, 'browser-'));
    this.ipcDirectory = await mkdtemp(join(dirname(dirname(this.config.stateDirectory)), '.ipc-'));
    const profile = join(this.directory, 'profile');
    this.chrome = spawn(this.config.chrome, ['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-sync','--disable-background-networking','about:blank'], {stdio:'ignore'});
    let failure; this.chrome.on('error', e => { failure = e; });
    for (let i=0; i<100; i++) {
      if (signal?.aborted) throw new Error('Operation cancelled');
      if (failure || this.chrome.exitCode !== null) throw failure ?? new Error('Chrome exited during startup');
      try { const port = (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; if (/^\d+$/.test(port)) { this.endpoint = `http://127.0.0.1:${port}`; return; } } catch {}
      await delay(100);
    }
    throw new Error('Chrome startup timed out');
  }
  async execute(action, params, signal) {
    const allowed = ['search','open','read','click','type','scroll'];
    if (!allowed.includes(action)) throw new Error('Unknown browser action');
    if (action === 'open') params = {...params, url: await validateURL(params.url)};
    if (action === 'search') params = {url:'https://www.bing.com/search?q='+encodeURIComponent(params.query), waitForSearch:true};
    await this.ensure(signal);
    const env = {PATH:process.env.PATH, HOME:process.env.HOME, LANG:'en_US.UTF-8',
      BH_HOME:join(this.directory,'harness'), BH_RUNTIME_DIR:this.ipcDirectory,
      BROWSER_USE_SETUP_LOGGING:'false', BROWSER_USE_CLOUD_SYNC:'false', BROWSER_USE_VERSION_CHECK:'false',
      BROWSER_USE_CONFIG_DIR:join(this.directory,'config'), XDG_CACHE_HOME:join(this.directory,'cache'),
       BU_CDP_URL:this.endpoint, BH_RECORD:'0', BH_TELEMETRY:'0', BH_TAB_MARKER:'0', BH_DOMAIN_SKILLS:'0',
      ANONYMIZED_TELEMETRY:'false',
      [this.config.actionsEnvironmentKey ?? 'AGENT_BROWSER_ACTIONS']:this.config.actions,
      [this.config.requestEnvironmentKey ?? 'AGENT_BROWSER_REQUEST']:JSON.stringify({action:action === 'search' ? 'open' : action, params, first:!this.opened})};
    this.environment = env;
    const output = await subprocess(this.config.browserCLI, [], {env, signal,
      input:`import os, runpy\nrunpy.run_path(os.environ[${JSON.stringify(this.config.actionsEnvironmentKey ?? 'AGENT_BROWSER_ACTIONS')}], run_name="__main__")\n`});
    const resultPrefix=this.config.resultPrefix ?? 'AGENT_BROWSER_RESULT:';
    const line = output.split('\n').findLast(x => x.startsWith(resultPrefix));
    if (!line) throw new Error('Browser returned no structured result');
    const result = JSON.parse(line.slice(resultPrefix.length));
    if (result.error) throw new Error(result.error);
    if (result.url) await validateURL(result.url);
    this.opened = true; this.lastResult = result;
    return result;
  }
  async close() {
    if (this.environment) {
      await subprocess(this.config.python, ['-c', 'from browser_harness.admin import restart_daemon; restart_daemon()'], {env:this.environment,timeout:8000}).catch(()=>{});
      this.environment = null;
    }
    if (this.chrome?.exitCode === null) { this.chrome.kill('SIGTERM'); await delay(300); if (this.chrome.exitCode === null) this.chrome.kill('SIGKILL'); }
    this.chrome = null; this.opened = false;
    if (this.ipcDirectory) {await rm(this.ipcDirectory,{recursive:true,force:true}).catch(()=>{}); this.ipcDirectory=null;}
    if (this.directory) { await rm(this.directory, {recursive:true,force:true}).catch(()=>{}); this.directory = null; }
  }
}
