/** Read on each invocation: never use the model's training date or task folder timestamp. */
export {ApprovalBroker} from './approval-broker.js';

export function currentTime(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return {
    source:'system_clock', utc:now.toISOString(), unixMilliseconds:now.getTime(), timeZone,
    localDateTime:new Intl.DateTimeFormat('zh-CN',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).format(now),
    weekday:new Intl.DateTimeFormat('zh-CN',{timeZone,weekday:'long'}).format(now)
  };
}

/** Correlated native calls keep platform APIs out of the pi/browser layers. */
export class NativeCalls {
  pending = new Map();
  constructor(emit) { this.emit = emit; }
  request(name, callId, signal, args = {}) {
    if (signal?.aborted) return Promise.reject(new Error('任务已停止。'));
    return new Promise((resolve,reject)=> {
      const finish=(error,result)=> {
        clearTimeout(timer); signal?.removeEventListener('abort',abort); this.pending.delete(callId);
        error ? reject(error) : resolve(result);
      };
      const abort=()=>finish(new Error('任务已停止。'));
      const timer=setTimeout(()=>finish(new Error('原生工具响应超时，请重试。')),40000);
      this.pending.set(callId,finish);
      signal?.addEventListener('abort',abort,{once:true});
      this.emit('native_call',{name,callId,args});
    });
  }
  receive(record) { this.pending.get(record.callId)?.(record.error ? new Error(record.error) : null,record.result); }
  cancel() { for (const finish of [...this.pending.values()]) finish(new Error('任务已停止。')); }
}
