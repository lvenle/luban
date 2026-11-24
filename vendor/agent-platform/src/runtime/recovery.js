import {createHash} from 'node:crypto';
export const stableJson = value => Array.isArray(value) ? `[${value.map(stableJson).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stableJson(value[key])).join(',')}}` : JSON.stringify(value);
export const operationFingerprint = (tool,input) => createHash('sha256').update(tool+'\n'+stableJson(input??null)).digest('hex');
export function recoveryError(message){return Object.assign(Error(message),{code:'recovery_blocked',recoveryBlocked:true})}
export function settlePendingMessages(messages,operations=[]){
 const result=structuredClone(messages);
 for(let i=0;i<result.length;i++)if(result[i].role==='assistant'&&result[i].tool_calls?.length){
  const replies=new Set();let end=i+1;while(end<result.length&&result[end].role==='tool'){replies.add(result[end].tool_call_id);end++}
  const missing=result[i].tool_calls.filter(call=>!replies.has(call.id)).map(call=>({role:'tool',tool_call_id:call.id,name:call.name,content:JSON.stringify((()=>{let input;try{input=JSON.parse(call.arguments||'{}')}catch{}const done=operations.find(item=>item.tool===call.name&&item.fingerprint===operationFingerprint(call.name,input)&&item.outcome==='confirmed');return done?done.output:{outcome:'unknown',message:'上次运行在此步骤中断；这不是执行成功或未执行的证明。不得自动重复写入或发送。'}})())}));
  result.splice(end,0,...missing);
 }
 return result;
}
export function operationOutcome({risk,error,output,began}){
 if(!began)return 'not_executed';
 if(error?.completedOutput!==undefined)output=error.completedOutput;
 if(risk==='read')return error?'unverified':'confirmed';
 if(output?.ack===false||output?.ack==='unknown'||output?.isError||output?.is_error)return 'unknown';
 return (!error||error.completedOutput!==undefined)?'confirmed':'unknown';
}
