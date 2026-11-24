import {execFileSync} from 'node:child_process';

/** PID plus kernel process start time distinguishes an executor from a reused PID. */
export function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') return null;
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}).trim() || null;
  } catch { return null; }
}

export function executorIsAlive(pid, identity) {
  try {process.kill(pid, 0);} catch(error) {if(error.code === 'ESRCH') return false; if(error.code !== 'EPERM') throw error;}
  if (!identity) return true; // legacy rows have only PID; do not interrupt a possible live executor
  const actual = processIdentity(pid);
  return actual === null || actual === identity; // probe failure is not proof of executor death
}
