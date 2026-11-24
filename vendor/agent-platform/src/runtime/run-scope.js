/** Owns cancellation, timeout, and cleanup for one product run. */
export class RunScope {
  #abortables=new Set();
  #cleanups=[];
  #timer;
  #timedOut=false;
  constructor({timeoutMs,onCancel,timeoutReason=new Error('Run timed out')}={}) {
    this.controller=new AbortController();
    this.onCancel=onCancel;
    if(timeoutMs) this.#timer=setTimeout(()=>{this.#timedOut=true;this.cancel(timeoutReason);},timeoutMs);
  }
  get signal(){return this.controller.signal;}
  get cancelled(){return this.signal.aborted;}
  get timedOut(){return this.#timedOut;}
  track(abortable){if(abortable)this.#abortables.add(abortable);return abortable;}
  cleanup(action){if(typeof action==='function')this.#cleanups.push(action);return action;}
  cancel(reason=new Error('Run cancelled')){
    if(this.cancelled)return;
    this.controller.abort(reason);
    for(const value of this.#abortables){try{value.abort?.();}catch{}}
    this.onCancel?.(reason);
  }
  async close(){
    clearTimeout(this.#timer);
    for(const action of this.#cleanups.reverse()){try{await action();}catch{}}
    this.#cleanups=[];this.#abortables.clear();
  }
}
