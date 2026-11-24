import {spawn} from 'node:child_process';
import {access,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';
export const EXEC_PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
export const executionEnvironment=()=>({PATH:EXEC_PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8'});
export async function resolveExecutable(name) {
  if(typeof name!=='string' || !name || /[\0\r\n]/.test(name))throw new Error('程序名称无效');
  if(name.includes('/') && !isAbsolute(name))throw new Error('程序路径必须为绝对路径');
  for(const path of isAbsolute(name)?[name]:EXEC_PATH.split(':').map(dir=>join(dir,name))) {
    try {await access(path,constants.X_OK);if((await stat(path)).isFile())return path;}catch{}
  }
  throw new Error('缺少本机程序：'+name);
}
/** Generic foreground execution. cwd is a working directory, not a filesystem sandbox. */
export async function execute(executable,args=[],{env,input='',signal,timeout=45000,cwd,maxBytes=1000000}={}) {
  if(signal?.aborted)throw new Error('Operation cancelled');
  if(!Array.isArray(args) || args.some(a=>typeof a!=='string' || a.includes('\0')))throw new Error('程序参数无效');
  if(!Number.isFinite(timeout) || timeout<1 || timeout>120000)throw new Error('执行超时必须在 1–120000 毫秒之间');
  const program=await resolveExecutable(executable);
  if(signal?.aborted)throw new Error('Operation cancelled');
  return new Promise((resolve,reject)=>{
    const child=spawn(program,args,{cwd,env:env??executionEnvironment(),stdio:['pipe','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
    let out=[],err=[],size=0,failure,settled=false,killTimer;
    const kill=sig=>{try {if(child.pid)process.kill(process.platform==='win32'?child.pid:-child.pid,sig);}catch{}};
    const stop=message=>{if(failure)return;failure=new Error(message+'；若涉及写入，请先核对结果，不要盲目重试。');kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),500);};
    const abort=()=>stop('Operation cancelled');
    const timer=setTimeout(()=>stop('本机执行超时'),timeout);
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
    const capture=chunks=>data=>{size+=data.length;if(size>maxBytes){stop('本机输出超出限制');return;}chunks.push(data);};
    child.stdout.on('data',capture(out));child.stderr.on('data',capture(err));
    child.on('error',error=>{finish();reject(error);});
    child.on('close',(exitCode,exitSignal)=>{finish();const result={exitCode,signal:exitSignal,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')};failure?reject(failure):resolve(result);});
    child.stdin.on('error',()=>{});child.stdin.end(input);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
export async function subprocess(executable,args,options) {
  const result=await execute(executable,args,options);
  if(result.exitCode!==0)throw new Error('本机程序执行失败：'+result.stderr.slice(-1000));
  return result.stdout;
}
