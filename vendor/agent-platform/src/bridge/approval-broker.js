/** Correlates product UI approvals with tool calls and run cancellation. */
export class ApprovalBroker {
  #pending=new Map();
  constructor(emit){this.emit=emit;}
  request({callId,label,signal}){
    if(signal?.aborted)return Promise.resolve(false);
    return new Promise(resolve=>{
      const finish=allowed=>{signal?.removeEventListener('abort',abort);this.#pending.delete(callId);resolve(allowed===true);};
      const abort=()=>finish(false);
      this.#pending.set(callId,finish);signal?.addEventListener('abort',abort,{once:true});
      this.emit({callId,label});
    });
  }
  receive(callId,allowed){this.#pending.get(callId)?.(allowed);}
  cancel(){for(const finish of [...this.#pending.values()])finish(false);}
  get size(){return this.#pending.size;}
}
