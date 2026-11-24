import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import { MODEL_UNAVAILABLE } from '../model/errors.js';
export const PROTOCOL_VERSION = '1.0';
export { JsonLinesDecoder, encodeJsonLine } from './jsonl.js';
export const COMMAND_TYPES = Object.freeze(["start_run", "cancel_run", "approval_response", "native_result", "get_run", "health_check", "shutdown"]);
export const EVENT_TYPES = Object.freeze(["ready", "run_started", "run_stopping", "text_delta", "progress", "model_event", "application_event", "skill_loaded", "knowledge_sources", "tool_started", "tool_completed", "tool_confirmation_required", "tool_policy", "tool_blocked", "native_call", "output_validation", "delivery_assessed", "plan_changed", "question_prepared", "clarification_required", "run_completed", "run_failed", "run_cancelled", "sunnypet.workspace", "sunnypet.wechat_sent"]);
export const TERMINAL_TYPES = Object.freeze(['run_completed', 'run_failed', 'run_cancelled']);
export const ERROR_CODES = Object.freeze(['invalid_request','unsupported_protocol','configuration_conflict','agent_not_found','credential_unavailable','permission_denied','tool_failed',MODEL_UNAVAILABLE,'timeout','cancelled','storage_unavailable','runtime_internal']);
export const commandSchema = JSON.parse(readFileSync(new URL('./schemas/command.json', import.meta.url), 'utf8'));
export const eventSchema = JSON.parse(readFileSync(new URL('./schemas/event.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const checkCommand = ajv.compile(commandSchema), checkEvent = ajv.compile(eventSchema);
export function assertCompatibleVersion(version) {
  if (typeof version !== 'string' || !/^1\.\d+$/.test(version)) {
    throw Object.assign(new Error(`Unsupported protocol version: ${version}`), {code:'unsupported_protocol'});
  }
}
function validate(value, check) {
  assertCompatibleVersion(value?.protocol_version);
  if (!check(value)) throw Object.assign(new TypeError(ajv.errorsText(check.errors)), {code:'invalid_request'});
  return value;
}
export function validateCommand(value) { return validate(value, checkCommand); }
export function validateEvent(value, {allowUnknown = true} = {}) {
  validate(value, checkEvent);
  if (!allowUnknown && !EVENT_TYPES.includes(value.type)) throw new Error(`Unsupported event type: ${value.type}`);
  return value;
}
export function createEvent({type,requestId,runId,sequence,payload={},timestamp=new Date().toISOString()}) {
  return validateEvent({protocol_version:PROTOCOL_VERSION,request_id:requestId,...(runId?{run_id:runId}:{}),sequence,timestamp,type,payload}, {allowUnknown:false});
}
/** Receivers may skip optional future events, but never accept a second terminal. */
export class RunEventCursor {
  constructor(runId) { this.runId=runId; this.requestId=null; this.sequence=0; this.terminal=false; }
  accept(event) {
    validateEvent(event);
    if(event.run_id!==this.runId) throw new Error('Run ID mismatch');
    if(this.requestId && event.request_id!==this.requestId) throw new Error('Request ID mismatch');
    if(event.sequence<=this.sequence) return false;
    if(this.terminal) throw new Error('Event after terminal');
    this.requestId ??= event.request_id;
    this.sequence=event.sequence;
    if(TERMINAL_TYPES.includes(event.type)) this.terminal=true;
    return true;
  }
}

export function errorPayload(error, {cancelled = false} = {}) {
  const raw=String(error?.code || '');
  const candidate=cancelled ? 'cancelled' : (raw===MODEL_UNAVAILABLE ? MODEL_UNAVAILABLE : raw.toLowerCase());
  return {code:ERROR_CODES.includes(candidate)?candidate:'runtime_internal',message:String(error?.message || 'Runtime failed')};
}
