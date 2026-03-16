'use strict';

const STORAGE_KEY = 'skalo_coach_history';
const MAX_HISTORY = 20;

// ── State ────────────────────────────────────────────────────────
let history = [];

// ── DOM refs ─────────────────────────────────────────────────────
const chatMessages    = document.getElementById('chatMessages');
const chatInput       = document.getElementById('chatInput');
const sendBtn         = document.getElementById('sendBtn');
const clearBtn        = document.getElementById('clearBtn');
const typingIndicator = document.getElementById('typingIndicator');

// ── Markdown renderer (minimal, no external deps) ────────────────
function renderMarkdown(text) {
  return text
    // Code blocks
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="lang-${lang || 'text'}">${escHtml(code.trim())}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`)
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Headers
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    // Bullet lists
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Line breaks (double newline → paragraph)
    .replace(/\n\n/g, '</p><p>')
    // Single newline → <br>
    .replace(/\n/g, '<br>');
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── History persistence ───────────────────────────────────────────
function loadHistory() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    history = stored ? JSON.parse(stored) : [];
  } catch {
    history = [];
  }
}

function saveHistory() {
  try {
    const trimmed = history.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    history = trimmed;
  } catch {}
}

// ── Render a message bubble ───────────────────────────────────────
function appendMessage(role, content, animate = true) {
  const div = document.createElement('div');
  div.className = `chat-message ${role}${animate ? ' entering' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (role === 'assistant') {
    bubble.innerHTML = '<p>' + renderMarkdown(content) + '</p>';
  } else {
    const p = document.createElement('p');
    p.textContent = content;
    bubble.appendChild(p);
  }

  div.appendChild(avatar);
  div.appendChild(bubble);
  chatMessages.appendChild(div);

  // Scroll to bottom
  requestAnimationFrame(() => {
    div.scrollIntoView({ behavior: 'smooth', block: 'end' });
    if (animate) setTimeout(() => div.classList.remove('entering'), 300);
  });

  return div;
}

// ── Restore history on load ───────────────────────────────────────
function restoreHistory() {
  loadHistory();
  history.forEach(msg => appendMessage(msg.role, msg.content, false));
}

// ── Send message ──────────────────────────────────────────────────
async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  // Clear input
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Show user message
  appendMessage('user', message);
  history.push({ role: 'user', content: message });

  // Show typing indicator
  typingIndicator.style.display = 'flex';
  typingIndicator.scrollIntoView({ behavior: 'smooth', block: 'end' });

  try {
    const res = await fetch('/coach/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, history: history.slice(0, -1) }),
    });

    typingIndicator.style.display = 'none';

    const data = await res.json();
    if (!res.ok || data.error) {
      appendMessage('assistant', '⚠️ ' + (data.error || 'Something went wrong. Please try again.'));
    } else {
      appendMessage('assistant', data.reply);
      history.push({ role: 'assistant', content: data.reply });
      saveHistory();
    }
  } catch (err) {
    typingIndicator.style.display = 'none';
    appendMessage('assistant', '⚠️ Network error — please check your connection.');
  } finally {
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

// ── Event listeners ───────────────────────────────────────────────
sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
});

clearBtn.addEventListener('click', () => {
  if (!confirm('Clear chat history?')) return;
  history = [];
  localStorage.removeItem(STORAGE_KEY);
  // Remove all messages except the welcome one
  const msgs = chatMessages.querySelectorAll('.chat-message');
  msgs.forEach((m, i) => { if (i > 0) m.remove(); });
});

// ── Init ──────────────────────────────────────────────────────────
restoreHistory();
