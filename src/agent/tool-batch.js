import { mergeBatchableToolCalls } from '../services/ai/tool-display.js';
import { LUBAN_TOOL_NAMES } from './runtime-adapter.js';

const platformToLegacy = Object.fromEntries(
  Object.entries(LUBAN_TOOL_NAMES).map(([legacy, platform]) => [platform, legacy])
);

/** Merge same-entity add_field batches for namespaced platform tool calls. */
export function prepareLubanToolCalls(calls) {
  const openAi = calls.map((call) => ({
    id: call.id,
    function: {
      name: platformToLegacy[call.name] || call.name,
      arguments: call.arguments || '{}'
    }
  }));
  return mergeBatchableToolCalls(openAi).map((call) => ({
    id: call.id,
    name: LUBAN_TOOL_NAMES[call.function.name] || call.function.name,
    arguments: call.function.arguments
  }));
}
