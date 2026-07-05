import h from './dom.js';
import SSEClient from './SSEClient.js';
import StreamRenderer from './StreamRenderer.js';
import ToolDisplay from './ToolDisplay.js';
import ChatView from './ChatView.js';
import SessionManager from './SessionManager.js';
import { toast } from '../common/toast.js';
import { humanizeMessage } from '../common/messages.js';

let chatView;
let streamRenderer;
let toolDisplay;
let sessionManager;
let sseClient;
let currentAppId = '';
let currentSessionId = '';
let currentPageId = '';
let assistantOpen = false;
let currentContext = '';
let currentMode = 'create';
let currentAppName = '';

export function init() {
  chatView = new ChatView({
    onSend: handleSend
  });

  streamRenderer = new StreamRenderer(chatView.getMessageContainer());

  toolDisplay = new ToolDisplay(async (confirmId, confirmed, data = null) => {
    try {
      await fetch('/api/ai/chat/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmId, confirmed })
      });
      if (!confirmed && ['create_rule', 'update_rule'].includes(data?.name)) chatView.setInput(data.arguments?.intent || '');
    } catch { /* ignore */ }
  });

  sessionManager = new SessionManager({
    onSwitch: async (sessionId) => {
      try {
        const res = await fetch(`/api/ai/sessions/${sessionId}`);
        if (!res.ok) {
          console.error('[ai-assistant] 会话加载失败:', res.status);
          toast('会话加载失败');
          return;
        }
        const body = await res.json();
        if (!body.session) {
          console.error('[ai-assistant] 会话不存在:', sessionId);
          toast('会话记录不存在');
          return;
        }
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
      } catch (error) {
        console.error('[ai-assistant] 切换会话出错:', error);
        toast('会话加载失败');
      }
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
    // 如果日志已有自己的 input，不消费 pendingInputs 队列中的 input
    // 避免多个同 toolName 的 running 日志与 completed 日志之间的 input 匹配错误
    const hasOwnInput = log.input != null;
    const queue = pendingInputs.get(log.toolName) || [];
    const input = hasOwnInput ? log.input : (queue.shift() || null);
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

export function setAssistantDraft(text) {
  if (!chatView) init();
  chatView.setInput(String(text || ''));
}

export function setAssistantMode({ mode = 'create', appId = '', appName = '', context = '', pageId = '' } = {}) {
  const nextMode = mode === 'modify' && appId ? 'modify' : 'create';
  const nextAppId = nextMode === 'modify' ? appId : '';
  const scopeChanged = nextMode !== currentMode || nextAppId !== currentAppId;
  currentMode = nextMode;
  currentAppId = nextAppId;
  currentAppName = nextMode === 'modify' ? appName : '';
  currentContext = nextMode === 'modify' ? context : '';
  currentPageId = nextMode === 'modify' ? pageId : '';
  if (scopeChanged && chatView) {
    currentSessionId = '';
    chatView.clear();
    sessionManager.setCurrent('');
    sessionManager.load(currentAppId).then(() => {
      // modify 模式自动切换到最新会话，create 模式保持空会话
      if (nextMode === 'modify' && sessionManager.sessions.length) {
        sessionManager.onSwitch(sessionManager.sessions[0].id);
      }
    });
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
      context: currentContext,
      pageId: currentPageId || undefined
    });
  } catch (error) {
    streamRenderer.finishMessage(humanizeMessage(error.message, '暂时无法连接 AI 助理，请稍后重试。'));
    chatView.setStreaming(false);
  }
}

export function renderAssistantDrawer(onClose) {
  if (!chatView) init();

  const existingDrawer = document.querySelector('.assistant.drawer');
  if (existingDrawer) {
    document.body.classList.add('assistant-open');
    updateAssistantModeLabels();
    // 确保会话列表刷新——当 loadApps() 触发重绘时 load() 可能还在进行中
    sessionManager.load(currentAppId);
    return existingDrawer;
  }

  const chatEl = chatView.render();
  streamRenderer.container = chatView.getMessageContainer();
  const headActions = sessionManager.render();

  const close = () => {
    sseClient.disconnect();
    drawer.remove();
    document.body.classList.remove('assistant-open');
    if (onClose) onClose();
  };

  const drawer = h('div', { class: 'assistant drawer' }, [
    h('div', { class: 'assistant-head' }, [
      h('div', { class: 'assistant-head-copy' }, [
        h('h3', { class: 'assistant-mode-title' }),
        h('span', { class: 'assistant-head-tip assistant-mode-tip' })
      ]),
      h('button', {
        class: 'assistant-close',
        type: 'button',
        text: '×',
        title: '关闭 AI 助理',
        'aria-label': '关闭 AI 助理',
        onclick: () => close()
      })
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
