import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

export function createMacosMediaRuntime({helperPath, workspaceRoot}) {
  async function call(operation, input, timeoutMs = 95_000) {
    if (!helperPath || !existsSync(helperPath)) throw Error('macOS 媒体运行时未安装，请重新构建 SunnyPet/Agent Platform。');
    return new Promise((resolve, reject) => {
      const child = spawn(helperPath, [], {stdio: ['pipe', 'pipe', 'ignore']}); let output = ''; let settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => finish(Error('媒体解析超时。')), timeoutMs);
      child.stdout.on('data', chunk => { output += chunk.toString(); const rows = output.split('\n'); output = rows.pop() || ''; for (const row of rows) { try { const value = JSON.parse(row); value.ok === false ? finish(Error(value.error || '媒体解析失败。')) : finish(null, value); } catch {} } });
      child.once('error', error => finish(error)); child.once('exit', code => { if (!settled && code !== 0) finish(Error(`媒体运行时退出：${code}`)); });
      child.stdin.end(JSON.stringify({...input, operation, root: workspaceRoot}) + '\n');
    });
  }
  return {analyzeImage: input => call('image', input, 60_000), transcribeAudio: input => call('audio', input), inspectVideo: input => call('video', input)};
}
