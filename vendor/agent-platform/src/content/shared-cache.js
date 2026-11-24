/** Bounded, instance-scoped cache. Concurrent identical work shares one promise.
 * Failures are evicted; callers receive independent copies of successful results.
 */
export function createSharedCache({maxEntries=128,ttlMs=30*60*1000,now=Date.now}={}) {
  const entries=new Map(),pending=new Map();
  async function run(key,load){
    const cached=entries.get(key);
    if(cached&&cached.expires>now())return structuredClone(cached.value);
    entries.delete(key);
    if(!pending.has(key)){
      const promise=Promise.resolve().then(load).then(value=>{
        const copy=structuredClone(value);
        entries.set(key,{value:copy,expires:now()+ttlMs});
        while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
        return copy;
      }).finally(()=>pending.delete(key));
      pending.set(key,promise);
    }
    return structuredClone(await pending.get(key));
  }
  return {run};
}
