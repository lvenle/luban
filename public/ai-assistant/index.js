import h from './dom.js';
import SSEClient from './SSEClient.js';
import StreamRenderer from './StreamRenderer.js';
import ToolDisplay from './ToolDisplay.js';
import ChatView from './ChatView.js';
import SessionManager from './SessionManager.js';

let chatView;
let streamRenderer;
let toolDisplay;
let sessionManager;
let sseClient;
let currentAppId = '';
let currentSessionId = '';
let assistantOpen = false;

export function init() {
  chatView = new ChatView({
    onSend: handleSend
  });

  streamRenderer = new StreamRenderer(chatView.getMessageContainer());

  toolDisplay = new ToolDisplay(async (confirmId, confirmed) => {
    try {
      await fetch('/api/ai/chat/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmId, confirmed })
      });
    } catch { /* ignore */ }
  });

  sessionManager = new SessionManager({
    onSwitch: async (sessionId) => {
      try {
        const res = await fetch(`/api/ai/sessions/${sessionId}`);
        const body = await res.json();
        if (body.session) {
          currentSessionId = sessionId;
          sessionManager.setCurrent(sessionId);
          chatView.clear();
          for (const msg of body.session.messages || []) {
            if (msg.role === 'user') chatView.addMessage('user', msg.content);
            else if (msg.role === 'assistant' && msg.structuredContent?.type === 'plan') {
              const card = h('div', { class: 'assistant-msg ai' }, [
                h('div', { class: 'assistant-avatar ai', text: 'AI' }),
                h('div', { class: 'assistant-bubble', text: msg.content })
              ]);
              chatView.addElement(card);
            }
          }
        }
      } catch { /* ignore */ }
    },
    onNew: startNewSession
  });

  sseClient = new SSEClient();
}

function startNewSession() {
  currentSessionId = '';
  sessionManager.setCurrent('');
  chatView.clear();
}

async function handleSend(text) {
  if (!text.trim()) return;
  chatView.setStreaming(true);
  chatView.addMessage('user', text);

  streamRenderer.startNewMessage();
  try {
    await sseClient.connect('/api/ai/chat', {
      appId: currentAppId,
      sessionId: currentSessionId || undefined,
      message: text
    });
  } catch (error) {
    streamRenderer.finishMessage(`连接失败: ${error.message}`);
    chatView.setStreaming(false);
  }
}

export function renderAssistantDrawer() {
  if (!chatView) init();

  const chatEl = chatView.render();
  const headActions = sessionManager.render();
  const sessionBar = h('div', { class: 'assistant-history-bar' });

  const close = () => {
    sseClient.disconnect();
    backdrop.remove();
    drawer.remove();
  };

  const backdrop = h('div', {
    class: 'drawer-backdrop',
    onclick: () => close()
  });

  const drawer = h('div', { class: 'assistant drawer' }, [
    h('div', { class: 'assistant-head' }, [
      h('h3', { text: 'AI 助理' }),
      headActions,
      h('button', { class: 'ghost', text: '×', onclick: () => close() })
    ]),
    sessionBar,
    chatEl
  ]);

  sseClient
    .on('session_id', (data) => {
      currentSessionId = data.sessionId;
      sessionManager.setCurrent(data.sessionId);
    })
    .on('content_delta', (data) => {
      streamRenderer.appendToken(data.content);
    })
    .on('tool_use', (data) => {
      const card = toolDisplay.showToolUse(data);
      if (card) chatView.addElement(card);
    })
    .on('tool_client', (data) => {
      const card = toolDisplay.showToolClient(data);
      if (card) chatView.addElement(card);
      executeClientTool(data);
    })
    .on('tool_result', (data) => {
      const card = toolDisplay.showToolResult(data);
      if (card) chatView.addElement(card);
    })
    .on('tool_confirm', (data) => {
      toolDisplay.showConfirmModal(data);
    })
    .on('message_end', () => {
      streamRenderer.finishMessage();
      chatView.setStreaming(false);
      sessionManager.load(currentAppId);
    })
    .on('error', (data) => {
      streamRenderer.finishMessage(`错误: ${data.message}`);
      chatView.setStreaming(false);
    })
    .on('stream_end', () => {
      if (chatView.streaming) {
        streamRenderer.finishMessage();
        chatView.setStreaming(false);
      }
    });

  sessionManager.load(currentAppId);

  document.body.append(backdrop, drawer);
  return null;
}

async function executeClientTool(data) {
  const args = data.arguments;
  switch (data.name) {
    case 'design_form': {
      const key = `software-garden:${currentAppId}:${args.entityId}:form-layout:${args.entityId}`;
      const storageKey = `software-garden:${currentAppId}:${args.entityId}:form-layout`;
      const existing = JSON.parse(localStorage.getItem(storageKey) || 'null');
      const layout = { columns: args.columns || 2, order: args.fieldOrder };
      localStorage.setItem(storageKey, JSON.stringify(layout));
      await sendClientResult(data.id, { ok: true, layout });
      break;
    }
    case 'create_view': {
      const storageKey = `software-garden:${currentAppId}:${args.entityId}:views`;
      const views = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const view = {
        id: `view_${Date.now()}`,
        name: args.name,
        visibleFields: args.visibleFields || [],
        fieldOrder: args.visibleFields || [],
        searchFields: [],
        sorts: args.sorts || [],
        filters: [],
        columnWidths: {},
        group: null
      };
      views.push(view);
      localStorage.setItem(storageKey, JSON.stringify(views));
      await sendClientResult(data.id, { ok: true, viewId: view.id });
      break;
    }
    default:
      await sendClientResult(data.id, { error: `Unknown client tool: ${data.name}` });
  }
}

async function sendClientResult(toolCallId, result) {
  try {
    await fetch('/api/ai/chat/tool-result', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId, result })
    });
  } catch { /* ignore */ }
}

export function setAppId(appId) {
  currentAppId = appId;
}
