import { createHash } from 'node:crypto';
import { createEvent, errorPayload } from '../protocol/index.js';
import { composeSystemPrompt } from './extensions.js';
import { resolveImageRefs } from '../media/image-content.js';

function requiredString(value, field) {
  if (typeof value !== 'string' || !value) throw new TypeError(`${field} is required`);
  return value;
}

function parseArguments(call) {
  try {
    const value = JSON.parse(call.arguments || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('tool arguments must be an object');
    }
    return value;
  } catch (error) {
    throw new Error(`Invalid arguments for ${call.name}: ${error.message}`);
  }
}

// Some OpenAI-compatible DeepSeek endpoints emit their native DSML tool syntax
// as assistant text instead of OpenAI tool_calls. Normalize that syntax at the
// Runtime boundary so it is executed as a real tool call and never shown to the
// user as model output.
// The marker is matched incrementally while streaming so markup is withheld from
// live observers without buffering the whole turn.
const DSML_MARKER = '<｜｜DSML';
function parseDsmlCalls(text, capabilities, turn) {
  if (!text.includes('DSML') || !text.includes('invoke')) return { text, calls: [] };
  const calls = [];
  const blockPattern = /<｜｜DSML｜｜\s*invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/｜｜DSML｜｜\s*invoke\s*>/g;
  let match;
  while ((match = blockPattern.exec(text))) {
    const rawName = match[1];
    const definition = capabilities.find(tool => tool.name === rawName || tool.legacyName === rawName || tool.name.replaceAll('.', '_') === rawName);
    if (!definition) continue;
    const input = {};
    const parameterPattern = /<｜｜DSML｜｜\s*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜\s*parameter\s*>/g;
    let parameter;
    while ((parameter = parameterPattern.exec(match[2]))) input[parameter[1]] = parameter[2];
    calls.push({ id: `dsml-${turn}-${calls.length + 1}`, name: definition.name, arguments: JSON.stringify(input) });
  }
  if (!calls.length) return { text, calls: [] };
  const cleaned = text.replace(/<｜｜DSML｜｜\s*calls\s*>[\s\S]*?<\/｜｜DSML｜｜\s*calls\s*>/g, '').trim();
  return { text: cleaned, calls };
}

export class AgentLoop {
  constructor({ provider, tools, onEvent = () => {}, now = () => new Date().toISOString() }) {
    if (!provider || typeof provider.stream !== 'function') throw new TypeError('provider.stream is required');
    if (!tools || typeof tools.execute !== 'function') throw new TypeError('tools.execute is required');
    this.provider = provider;
    this.tools = tools;
    this.onEvent = onEvent;
    this.now = now;
  }

  async run(request) {
    requiredString(request.requestId, 'requestId');
    requiredString(request.runId, 'runId');
    requiredString(request.model, 'model');
    const maxTurns = request.maxTurns ?? 12;
    if (!Number.isSafeInteger(maxTurns) || maxTurns <= 0) throw new TypeError('maxTurns must be positive');
    const messages = structuredClone(request.messages ?? []);
    let allowedTools=[...(request.allowedTools||[])];
    const toolBudget=request.maxToolCalls??Math.min(24,maxTurns*2);
    if(!Number.isSafeInteger(toolBudget)||toolBudget<1||toolBudget>128)throw TypeError('Invalid tool call budget');
    let callsUsed=request.executionState?.callsUsed||0,consecutiveFailures=0,stalledRounds=0,finalReason=allowedTools.length?'':'当前任务无需工具';
    const attempts=new Map(),seenResults=new Set();
    let evidenceEpoch=0;
    const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
    const digest=value=>createHash('sha256').update(JSON.stringify(stable(value))??'null').digest('hex');
    // 决策 D1：image_ref 仅在调模型前在内存里解析回 base64，不进事件日志。
    // 一次性解析避免后续每个 turn 都重读图片文件。
    let sequence = 1;
    let terminal = false;
    const emit = (type, payload = {}) => this.onEvent(createEvent({
      protocol_version: '1.0',
      requestId: request.requestId,
      runId: request.runId,
      sequence: sequence++,
      timestamp: this.now(),
      type,
      payload
    }));
    let deliveryRepairs=0,emptyAnswerRepairs=0,repairRoundsUsed=request.executionState?.repairRoundsUsed||0,failurePending=request.executionState?.failurePending===true;
    const repairLimit=request.maxRepairRounds??Infinity;
    const checkpoint = async (phase, turn = 0) => request.onCheckpoint?.({ messages: structuredClone(messages), phase, turn,executionState:{callsUsed,repairRoundsUsed,failurePending},...(request.delivery?{delivery:request.delivery.snapshot()}: {}) });
    emit('run_started', { agent_id: request.agentId });

    try {
      await checkpoint('ready');
      for (const message of messages) {
        if (Array.isArray(message.content)) message.content = await resolveImageRefs(message.content);
      }
      for (let turn = 0; turn <= maxTurns; turn += 1) {
        if (request.signal?.aborted) throw request.signal.reason ?? new Error('Run cancelled');
        if(request.deadline&&request.deadline-Date.now()<2*(request.answerReserveMs??15000))finalReason ||= '预留剩余时间用于最终回答';
        if(turn===maxTurns&&!finalReason)finalReason='达到执行轮数上限';
        if(failurePending){if(repairRoundsUsed>=repairLimit)finalReason ||= '已达到本轮局部修复预算，交付已有可用结果';else repairRoundsUsed++;failurePending=false;}
        const answering=Boolean(finalReason);
        if(answering)emit('tool_policy',{phase:'answer',reason:finalReason,callsUsed,toolBudget});
        let text = '';
        let streamed = 0;
        let suspended = false;
        const calls = new Map();
        let finishReason = null;
        const emitVisible = to => {
          if (to <= streamed) return;
          emit('text_delta', { delta: text.slice(streamed, to) });
          streamed = to;
        };
        // Forward the turn live, but never surface text that could be DSML markup:
        // hold back a partial marker suffix, and suspend streaming from the first
        // marker until the turn text has been parsed and cleaned.
        const streamVisible = () => {
          if (suspended) return;
          const pending = text.slice(streamed);
          const marker = pending.indexOf(DSML_MARKER);
          if (marker >= 0) { suspended = true; emitVisible(streamed + marker); return; }
          let hold = 0;
          for (let size = Math.min(DSML_MARKER.length - 1, pending.length); size > 0; size -= 1) {
            if (pending.endsWith(DSML_MARKER.slice(0, size))) { hold = size; break; }
          }
          emitVisible(text.length - hold);
        };
        for await (const event of this.provider.stream({
          model: request.model,
          system: composeSystemPrompt(request.system, request.extensions)+(request.delivery?'\n本轮用户要求与可信产物的交付状态（参考数据，不更改工具权限）：'+JSON.stringify(request.delivery.assess()):'')+(answering?`\n本轮必须给出最终答复，工具已经关闭。原因：${finalReason}。仅根据已有证据回答；明确未完成、失败或未知部分，不得声称未经确认的操作已成功，不再请求调用工具。`:''),
          messages,
          tools: answering?[]:this.tools.listCapabilities().filter(tool => allowedTools.includes(tool.name)),
          signal: request.signal,
          maxTokens: request.maxTokens,
          temperature: request.params?.temperature,
          topP: request.params?.topP,
          stop: request.params?.stop,
          responseFormat: request.responseFormat
        })) {
          if (event.type === 'text_delta') {
            text += event.delta;
            streamVisible();
          } else if (event.type === 'tool_call_delta') {
            const key = event.index ?? event.id;
            const current = calls.get(key) ?? { id: '', name: '', arguments: '' };
            if (event.id) current.id = event.id;
            if (event.name) current.name = event.name;
            current.arguments += event.arguments_delta ?? '';
            calls.set(key, current);
          } else if (event.type === 'usage') {
            emit('model_event', { kind: 'usage', usage: event.usage });
          } else if (event.type === 'finish') {
            finishReason = event.reason;
          }
        }

        if (request.signal?.aborted) throw request.signal.reason ?? new Error('Run cancelled');

        let toolCalls = [...calls.values()];
        if (!toolCalls.length) {
          const parsed = parseDsmlCalls(text, this.tools.listCapabilities(), turn);
          text = parsed.text;
          toolCalls = parsed.calls;
        }
        // Anything the stream held back (a partial marker, or text after a DSML
        // block) is safe to forward once the turn text has been cleaned.
        emitVisible(text.length);
        if (request.prepareToolCalls) {
          toolCalls = request.prepareToolCalls(toolCalls);
        }
        if(answering&&toolCalls.length){
          text='本轮已停止继续调用工具。已有结果已保留，但模型在最终回答阶段仍请求工具，未能完成有效答复；未确认的操作不能视为成功。';
          emit('text_delta',{delta:text});
          emit('run_completed',{output:text,finish_reason:'tool_policy_stop',incomplete:true});
          terminal=true;return {output:text,messages,turns:turn+1,incomplete:true,stopReason:finalReason};
        }
        if (!toolCalls.length && !text.trim()) {
          const hasToolResults = messages.some(message => message.role === 'tool');
          const repairLimit = request.maxEmptyAnswerRepairs ?? 1;
          if (hasToolResults && emptyAnswerRepairs < repairLimit && turn < maxTurns) {
            emptyAnswerRepairs += 1;
            messages.push({ role: 'user', content: '上一轮在工具返回结果后没有生成文本答复。请从当前任务继续，结合已有工具结果完成用户请求；不要重复已经成功完成的操作，确实需要后续操作时再使用工具。' });
            continue;
          }
        }
        messages.push({ role: 'assistant', content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
        await checkpoint(toolCalls.length ? 'tools_pending' : 'answer_ready', turn);
        if (!toolCalls.length) {
          if(!text.trim()){
            text='模型在工具返回结果后仍未生成有效答复。已有工具结果已保留，未确认的任务不能视为完成。';
            emit('text_delta',{delta:text});
            emit('run_completed',{output:text,incomplete:true,finish_reason:'empty_answer'});
            terminal=true;return {output:text,messages,turns:turn+1,incomplete:true,stopReason:'模型返回空答复'};
          }
          request.signal?.throwIfAborted();
          if(request.prepareFinalAnswer)await request.prepareFinalAnswer({text,messages,signal:request.signal});
          if(request.delivery){
            const delivery=request.delivery.assess();emit('delivery_assessed',delivery);
            if(!delivery.complete){
              if(delivery.disposition==='running'&&!answering&&deliveryRepairs<(request.maxDeliveryRepairs??1)&&repairRoundsUsed<repairLimit&&turn<maxTurns){deliveryRepairs++;repairRoundsUsed++;messages.push({role:'user',content:'实际交付仍缺少：'+delivery.missing.map(r=>r.request).join('、')+'。请使用可用工具补齐；确实缺少业务信息时向用户提出具体问题，不得声称已全部完成。'});continue;}
              const notice='交付尚未完成：'+delivery.missing.map(r=>r.request).join('、')+'。已有产物保留，不能视为全部完成。';
              text=text+'\n\n'+notice;
              emit('text_delta',{delta:'\n\n'+notice});
              emit('run_completed',{finish_reason:'delivery_incomplete',output:text,incomplete:true,delivery});terminal=true;return {output:text,messages,turns:turn+1,incomplete:true,delivery};
            }
          }
          emit('run_completed', { finish_reason: finishReason, output: text });
          terminal = true;
          return { output: text, messages, turns: turn + 1, stopReason:finalReason||undefined, toolCallsUsed:callsUsed };
        }

        let freshResults=0;
        for (const call of toolCalls) {
          request.signal?.throwIfAborted();
          requiredString(call.id, 'tool_call.id');
          requiredString(call.name, 'tool_call.name');
          let input;
          try{input=parseArguments(call);}catch(error){
            finalReason='工具参数格式无效，停止执行并回答';
            messages.push({role:'tool',tool_call_id:call.id,name:call.name,content:JSON.stringify({error:error.message,notExecuted:true}),is_error:true});
            emit('tool_blocked',{call_id:call.id,name:call.name,reason:finalReason});continue;
          }
          const definition=this.tools.listCapabilities().find(tool=>tool.name===call.name);
          const fingerprint=digest({name:call.name,input,...(definition?.risk!=='write'?{evidenceEpoch}:{})});
          const repeated=attempts.get(fingerprint)||0;
          if(request.deadline&&request.deadline-Date.now()<(request.answerReserveMs??15000)+(definition?.timeoutMs??30000))finalReason ||= '预留剩余时间用于最终回答';
          if(finalReason||callsUsed>=toolBudget||!allowedTools.includes(call.name)||repeated>=2){
            finalReason ||= callsUsed>=toolBudget?'达到工具调用预算':repeated>=2?'相同工具和参数重复调用无进展':'模型请求了本轮任务范围之外的工具';
            const error=`工具未执行：${finalReason}`;
            messages.push({role:'tool',tool_call_id:call.id,name:call.name,content:JSON.stringify({error,notExecuted:true}),is_error:true});
            emit('tool_blocked',{call_id:call.id,name:call.name,reason:finalReason});
            continue;
          }
          callsUsed++;attempts.set(fingerprint,repeated+1);
          emit('tool_started', { call_id: call.id, name: call.name, input });
          try {
            const output = await this.tools.execute({
              callId: call.id,
              name: call.name,
              input,
              allowedTools: request.allowedTools,
              userText: [...messages].reverse().find(message => message.role === 'user')?.content,
              signal: request.signal,waitForCleanup:request.waitForCleanup===true
            });
            const failed=output?.isError===true||output?.is_error===true;
            const resultKey=digest({fingerprint,output});
            if(!failed&&!seenResults.has(resultKey)){
              freshResults++;
              if(definition?.risk==='write')evidenceEpoch++;
            }
            seenResults.add(resultKey);
            consecutiveFailures=failed?consecutiveFailures+1:0;
            if(failed)failurePending=true;
            else if(freshResults)failurePending=false;
            if(consecutiveFailures>=3)finalReason='工具连续失败，停止无效重试';
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.name,
              content: JSON.stringify(output)
            });
            emit('tool_completed', { call_id: call.id, name: call.name, output });
            await checkpoint('tool_completed', turn);
            request.signal?.throwIfAborted();
          } catch (error) {
            failurePending=true;
            consecutiveFailures++;
            if(consecutiveFailures>=3)finalReason='工具连续失败，停止无效重试';
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.name,
              content: JSON.stringify({ error: error.message,code:error.code||error.error_code||'tool_execution_failed',retryable:error.retryable===true,...(error.details?{details:error.details}:{}),...(error.outcome?{outcome:error.outcome}:{}),...(error.completedOutput!==undefined?{completedOutput:error.completedOutput}:{}) }),
              is_error: true
            });
            emit('tool_completed', { call_id: call.id, name: call.name, error: error.message,...(error.completedOutput!==undefined?{output:error.completedOutput}:{}), ...(error.outcome ? { outcome: error.outcome } : {}) });
            await checkpoint('tool_error', turn);
            request.signal?.throwIfAborted();
            if (error.recoveryBlocked) throw error;
          }
        }
        if(callsUsed>=toolBudget)finalReason ||= '达到工具调用预算';
        if(request.deadline&&request.deadline-Date.now()<2*(request.answerReserveMs??15000))finalReason ||= '预留剩余时间用于最终回答';
        if(!finalReason&&request.toolPolicy){
          const review=await request.toolPolicy.review({messages});
          const outstanding=request.delivery?.assess();
          if(review.done&&review.progress&&outstanding&&!outstanding.complete&&outstanding.disposition==='running'){
            // A model's "done" vote cannot close still-needed, already granted
            // tools when trusted artifact accounting proves delivery is missing.
            review.done=false;review.toolNames=[...allowedTools];
            emit('tool_policy',{phase:'delivery_guard',reason:'实际产物尚未覆盖用户要求，保留已授权工具用于补齐',missing:outstanding.missing});
          }
          stalledRounds=review.progress&&freshResults?0:stalledRounds+1;
          allowedTools=allowedTools.filter(name=>review.toolNames.includes(name));
          if(review.done)finalReason=review.reason||'已有证据足够回答';
          else if(!allowedTools.length)finalReason='剩余步骤不在本轮工具范围内';
        }else stalledRounds=freshResults?0:stalledRounds+1;
        if(stalledRounds>=2)finalReason ||= '连续两轮没有获得与任务相关的新证据';
        await checkpoint(finalReason?'answer_required':'tools_reviewed',turn);
      }
      throw new Error(`Agent exceeded max turns: ${maxTurns}`);
    } catch (error) {
      const cancelled = request.signal?.aborted;
      emit(cancelled ? 'run_cancelled' : 'run_failed', {
        ...errorPayload(error, {cancelled}),
        message: error.message
      });
      terminal = true;
      throw error;
    } finally {
      if (!terminal) emit('run_failed', { code: 'runtime_internal', message: 'Run ended without terminal event' });
    }
  }
}
