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
let currentContext = '';
let currentMode = 'create';
let currentAppName = '';

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
          const history = sessionHistoryEntries(body.session.messages || [], body.session.logs || []);
          for (const entry of history) {
            if (entry.kind === 'tool') {
              const toolCard = toolDisplay.showHistoryLog(entry.item);
              if (toolCard) chatView.addElement(toolCard);
              continue;
            }
            const msg = entry.item;
            if (msg.role === 'user') chatView.addMessage('user', msg.content);
            else if (msg.role === 'assistant' && msg.content) {
              const bubble = h('div', { class: 'assistant-bubble' });
              bubble.innerHTML = streamRenderer.renderMarkdown(msg.content);
              const card = h('div', { class: 'assistant-msg ai' }, [
                h('div', { class: 'assistant-avatar ai', text: 'AI' }),
                bubble
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
  registerSSEHandlers();
}

export function sessionHistoryEntries(messages, logs) {
  const orderedMessages = [...messages].sort(compareCreatedAt);
  const terminalLogs = completedToolLogs(logs);
  const history = [];
  let logIndex = 0;
  for (const message of orderedMessages) {
    while (logIndex < terminalLogs.length && compareCreatedAt(terminalLogs[logIndex], message) < 0) {
      history.push({ kind: 'tool', item: terminalLogs[logIndex] });
      logIndex += 1;
    }
    history.push({ kind: 'message', item: message });
  }
  while (logIndex < terminalLogs.length) {
    history.push({ kind: 'tool', item: terminalLogs[logIndex] });
    logIndex += 1;
  }
  return history;
}

export function completedToolLogs(logs) {
  const pendingInputs = new Map();
  const completed = [];
  for (const log of [...logs].sort(compareCreatedAt)) {
    if (!log.toolName) continue;
    if (log.status === 'running') {
      const queue = pendingInputs.get(log.toolName) || [];
      queue.push(log.input || null);
      pendingInputs.set(log.toolName, queue);
      continue;
    }
    const queue = pendingInputs.get(log.toolName) || [];
    const input = log.input || queue.shift() || null;
    pendingInputs.set(log.toolName, queue);
    completed.push({ ...log, input });
  }
  return completed;
}

function compareCreatedAt(first, second) {
  return String(first?.createdAt || '').localeCompare(String(second?.createdAt || ''));
}

function registerSSEHandlers() {
  sseClient
    .on('session_id', (data) => {
      currentSessionId = data.sessionId;
      sessionManager.setCurrent(data.sessionId);
    })
    .on('content_delta', (data) => {
      streamRenderer.appendToken(data.content);
    })
    .on('tool_use', (data) => {
      streamRenderer.finishMessage();
      const card = toolDisplay.showToolUse(data);
      if (card) chatView.addElement(card);
    })
    .on('tool_result', (data) => {
      const card = toolDisplay.showToolResult(data);
      if (card && !card.isConnected) chatView.addElement(card);
    })
    .on('tool_confirm', (data) => {
      const card = toolDisplay.showConfirmModal(data);
      if (card) chatView.addElement(card);
    })
    .on('message_end', (data = {}) => {
      if (data.appId) {
        if (currentMode === 'create') currentMode = 'modify';
        currentAppId = data.appId;
      }
      streamRenderer.finishMessage();
      chatView.setStreaming(false);
      sessionManager.load(currentAppId);
      document.body.dispatchEvent(new CustomEvent('ai-message-end', { detail: { appId: data.appId || currentAppId } }));
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
}

function startNewSession() {
  currentSessionId = '';
  sessionManager.setCurrent('');
  chatView.clear();
}

export function setAppContext(context) {
  currentContext = context || '';
}

export function setAssistantMode({ mode = 'create', appId = '', appName = '', context = '' } = {}) {
  const nextMode = mode === 'modify' && appId ? 'modify' : 'create';
  const nextAppId = nextMode === 'modify' ? appId : '';
  const scopeChanged = nextMode !== currentMode || nextAppId !== currentAppId;
  currentMode = nextMode;
  currentAppId = nextAppId;
  currentAppName = nextMode === 'modify' ? appName : '';
  currentContext = nextMode === 'modify' ? context : '';
  if (scopeChanged && chatView) {
    currentSessionId = '';
    chatView.clear();
    sessionManager.setCurrent('');
    sessionManager.load(currentAppId);
  }
  updateAssistantModeLabels();
}

async function handleSend(text) {
  if (!text.trim()) return;
  chatView.setStreaming(true);
  chatView.addMessage('user', text);

  try {
    streamRenderer.startNewMessage();
    await sseClient.connect('/api/ai/chat', {
      appId: currentAppId,
      sessionId: currentSessionId || undefined,
      message: text,
      context: currentContext
    });
  } catch (error) {
    streamRenderer.finishMessage(`连接失败: ${error.message}`);
    chatView.setStreaming(false);
  }
}

export function renderAssistantDrawer(onClose) {
  if (!chatView) init();

  const existingDrawer = document.querySelector('.assistant.drawer');
  if (existingDrawer) {
    document.body.classList.add('assistant-open');
    updateAssistantModeLabels();
    return existingDrawer;
  }

  const chatEl = chatView.render();
  streamRenderer.container = chatView.getMessageContainer();
  const headActions = sessionManager.render();
  const sessionBar = h('div', { class: 'assistant-history-bar', text: '帮助你快速创建表，添加字段，修改字段，分析数据' });

  const close = () => {
    sseClient.disconnect();
    drawer.remove();
    document.body.classList.remove('assistant-open');
    if (onClose) onClose();
  };

  const drawer = h('div', { class: 'assistant drawer' }, [
    h('div', { class: 'assistant-head' }, [
      h('h3', { class: 'assistant-mode-title' }),
      h('span', { class: 'assistant-head-tip assistant-mode-tip' }),
      h('button', { class: 'ghost', text: '×', onclick: () => close() })
    ]),
    headActions,
    chatEl
  ]);

  sessionManager.load(currentAppId);

  document.body.append(drawer);
  document.body.classList.add('assistant-open');
  updateAssistantModeLabels();
  return drawer;
}

export function removeAssistantDrawer() {
  document.querySelector('.assistant.drawer')?.remove();
  document.body.classList.remove('assistant-open');
}

function updateAssistantModeLabels() {
  const title = currentMode === 'modify' ? '软件修改助理' : '应用创建助理';
  const tip = currentMode === 'modify'
    ? `正在修改${currentAppName ? `：${currentAppName}` : '当前软件'}`
    : '描述你的需求，创建新的业务软件';
  const titleElement = document.querySelector('.assistant-mode-title');
  const tipElement = document.querySelector('.assistant-mode-tip');
  if (titleElement) titleElement.textContent = title;
  if (tipElement) tipElement.textContent = tip;
}

export function setAppId(appId) {
  currentAppId = appId;
}
