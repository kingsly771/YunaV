/* ═══════════════════════════════════════════════════════════
   YUNAV-HBDCHAT — Frontend App
═══════════════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────────────────
const State = {
  currentUser: null,
  currentConvId: null,
  currentOtherUser: null,
  conversations: [],
  messages: [],
  socket: null,
  typingTimer: null,
  isTyping: false,
  pendingPhone: null,
  otpTimer: null,
  isMobile: window.innerWidth <= 680
};

// ── Utilities ────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatLastSeen(ts, isOnline) {
  if (isOnline) return 'Online';
  if (!ts) return 'Offline';
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `Today at ${formatTime(ts)}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showLoading(btn) {
  btn.classList.add('loading');
  btn.disabled = true;
  if (!btn.querySelector('.loading-spinner')) {
    const sp = document.createElement('div');
    sp.className = 'loading-spinner';
    btn.prepend(sp);
  }
}
function hideLoading(btn) {
  btn.classList.remove('loading');
  btn.disabled = false;
}

function setAvatar(container, user) {
  const img = container.querySelector('img');
  const initials = container.querySelector('span:not(.online-dot)');
  if (user?.avatar) {
    if (img) { img.src = user.avatar; img.style.display = 'block'; }
    if (initials) initials.style.display = 'none';
  } else {
    if (img) img.style.display = 'none';
    if (initials) { initials.style.display = 'block'; initials.textContent = getInitials(user?.name); }
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'include',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Confetti ─────────────────────────────────────────────────
function spawnConfetti() {
  const container = $('#confetti');
  const colors = ['#C084FC','#F472B6','#FACC15','#34D399','#60A5FA','#F87171'];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = `
      left: ${Math.random() * 100}%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      width: ${6 + Math.random() * 8}px;
      height: ${6 + Math.random() * 8}px;
      animation-duration: ${3 + Math.random() * 4}s;
      animation-delay: ${Math.random() * 4}s;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
    `;
    container.appendChild(el);
  }
}

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════
function initAuth() {
  spawnConfetti();
  setupOtpInputs();
  setupPhoneStep();
  setupOtpStep();
  setupProfileStep();
}

function showAuthStep(name) {
  $$('.auth-step').forEach(s => s.classList.remove('active'));
  $(`#step-${name}`).classList.add('active');
}

function setAuthError(msg) {
  $('#auth-error').textContent = msg;
  if (msg) setTimeout(() => { $('#auth-error').textContent = ''; }, 5000);
}

// ── Phone step ───────────────────────────────────────────────
function setupPhoneStep() {
  const btn = $('#btn-send-otp');
  const phoneInput = $('#phone-input');

  btn.addEventListener('click', async () => {
    const cc = $('#country-code').value;
    const num = phoneInput.value.replace(/\D/g, '');
    if (!num || num.length < 6) { setAuthError('Please enter a valid phone number'); return; }

    const fullPhone = cc + num;
    State.pendingPhone = fullPhone;
    showLoading(btn);
    setAuthError('');

    try {
      await api('/api/auth/send-otp', { method: 'POST', body: { phone: fullPhone } });
      $('#otp-phone-display').textContent = fullPhone;
      showAuthStep('otp');
      startOtpTimer();
      // Focus first OTP digit
      $$('.otp-digit')[0].focus();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      hideLoading(btn);
    }
  });

  phoneInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btn.click();
  });
}

// ── OTP inputs ───────────────────────────────────────────────
function setupOtpInputs() {
  const digits = $$('.otp-digit');
  digits.forEach((input, i) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.toString().slice(-1);
      e.target.value = val;
      input.classList.toggle('filled', val !== '');
      if (val && i < digits.length - 1) digits[i + 1].focus();
      if (getOTP().length === 6) $('#btn-verify-otp').click();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && i > 0) {
        digits[i - 1].focus();
        digits[i - 1].value = '';
        digits[i - 1].classList.remove('filled');
      }
    });
    input.addEventListener('paste', (e) => {
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
      if (pasted.length === 6) {
        digits.forEach((d, j) => { d.value = pasted[j] || ''; d.classList.toggle('filled', !!pasted[j]); });
        digits[5].focus();
        setTimeout(() => $('#btn-verify-otp').click(), 100);
      }
      e.preventDefault();
    });
  });
}

function getOTP() {
  return $$('.otp-digit').map(d => d.value).join('');
}

function startOtpTimer() {
  let secs = 600;
  clearInterval(State.otpTimer);
  State.otpTimer = setInterval(() => {
    secs--;
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    const el = $('#timer-count');
    if (el) el.textContent = `${m}:${s}`;
    if (secs <= 0) { clearInterval(State.otpTimer); if (el) el.textContent = 'Expired'; }
  }, 1000);
}

// ── OTP verify step ──────────────────────────────────────────
function setupOtpStep() {
  const btn = $('#btn-verify-otp');

  btn.addEventListener('click', async () => {
    const otp = getOTP();
    if (otp.length !== 6) { setAuthError('Enter the 6-digit code'); return; }

    showLoading(btn);
    setAuthError('');

    try {
      const data = await api('/api/auth/verify-otp', {
        method: 'POST',
        body: { phone: State.pendingPhone, otp }
      });

      clearInterval(State.otpTimer);
      State.currentUser = data.user;

      if (data.user.isNewUser || !data.user.name) {
        showAuthStep('profile');
        $('#profile-name-input').focus();
      } else {
        enterApp();
      }
    } catch (err) {
      setAuthError(err.message);
      $$('.otp-digit').forEach(d => { d.value = ''; d.classList.remove('filled'); });
      $$('.otp-digit')[0].focus();
    } finally {
      hideLoading(btn);
    }
  });

  $('#btn-change-phone').addEventListener('click', () => {
    clearInterval(State.otpTimer);
    $$('.otp-digit').forEach(d => { d.value = ''; d.classList.remove('filled'); });
    showAuthStep('phone');
  });
}

// ── Profile setup step ───────────────────────────────────────
function setupProfileStep() {
  // Avatar preview
  $('#avatar-upload-input').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = $('#avatar-img-preview');
      img.src = e.target.result;
      img.style.display = 'block';
      $('#avatar-initials').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  $('#btn-save-profile').addEventListener('click', async () => {
    const name = $('#profile-name-input').value.trim();
    const status = $('#profile-status-input').value.trim();

    if (!name) { setAuthError('Please enter your name'); return; }

    const btn = $('#btn-save-profile');
    showLoading(btn);
    setAuthError('');

    try {
      // Update profile
      const data = await api('/api/profile', {
        method: 'PATCH',
        body: { name, status }
      });
      State.currentUser = data.user;

      // Upload avatar if selected
      const avatarFile = $('#avatar-upload-input').files[0];
      if (avatarFile) {
        const fd = new FormData();
        fd.append('avatar', avatarFile);
        const res = await fetch('/api/profile/avatar', {
          method: 'POST',
          body: fd,
          credentials: 'include'
        });
        const avatarData = await res.json();
        if (avatarData.avatar) State.currentUser.avatar = avatarData.avatar;
      }

      enterApp();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      hideLoading(btn);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════
function enterApp() {
  $('#auth-screen').classList.remove('active');
  $('#app-screen').classList.add('active');
  renderMyProfile();
  connectSocket();
  loadConversations();
  initAppListeners();
}

function renderMyProfile() {
  const u = State.currentUser;
  if (!u) return;
  setAvatar($('#sidebar-avatar'), u);
  setAvatar($('#footer-avatar'), u);
  $('#sidebar-initials').textContent = getInitials(u.name);
  $('#footer-initials').textContent = getInitials(u.name);
  if (u.avatar) {
    $('#sidebar-avatar-img').src = u.avatar;
    $('#sidebar-avatar-img').style.display = 'block';
    $('#footer-avatar-img').src = u.avatar;
    $('#footer-avatar-img').style.display = 'block';
  }
  $('#footer-name').textContent = u.name || u.phone;
  $('#footer-status').textContent = u.status || '';
}

// ── Socket.io ────────────────────────────────────────────────
function connectSocket() {
  State.socket = io({ withCredentials: true });

  State.socket.on('connect', () => console.log('🔌 Socket connected'));

  State.socket.on('message:new', (msg) => {
    if (msg.conv_id === State.currentConvId) {
      appendMessage(msg);
      scrollToBottom();
      // Send read receipt
      State.socket.emit('messages:read', { convId: msg.conv_id });
    }
    updateConvLastMessage(msg.conv_id, msg.content, msg.created_at);
    // Bump to top
    loadConversations();
  });

  State.socket.on('conversation:update', (data) => {
    loadConversations();
  });

  State.socket.on('typing:start', ({ userId, convId }) => {
    if (convId === State.currentConvId && userId !== State.currentUser?.id) {
      const name = State.currentOtherUser?.name || 'User';
      $('#typing-name').textContent = name;
      $('#typing-indicator').style.display = 'flex';
      scrollToBottom();
    }
  });

  State.socket.on('typing:stop', ({ userId, convId }) => {
    if (convId === State.currentConvId && userId !== State.currentUser?.id) {
      $('#typing-indicator').style.display = 'none';
    }
  });

  State.socket.on('messages:read', ({ convId, readBy }) => {
    if (convId === State.currentConvId && readBy !== State.currentUser?.id) {
      // Update all outgoing read checkmarks
      $$('.read-check').forEach(el => el.classList.add('read'));
    }
  });

  State.socket.on('user:status', ({ userId, isOnline, lastSeen }) => {
    if (State.currentOtherUser?.id === userId) {
      State.currentOtherUser.is_online = isOnline ? 1 : 0;
      State.currentOtherUser.last_seen = lastSeen;
      updateChatHeaderStatus();
    }
    // Update conversation list indicator
    const convItem = $(`.conv-item[data-user="${userId}"]`);
    if (convItem) {
      const dot = convItem.querySelector('.online-dot');
      if (dot) dot.classList.toggle('visible', isOnline);
    }
  });
}

// ── Conversations ────────────────────────────────────────────
async function loadConversations() {
  try {
    const data = await api('/api/conversations');
    State.conversations = data.conversations;
    renderConvList();
  } catch (err) {
    console.error('loadConversations:', err);
  }
}

function renderConvList() {
  const list = $('#conv-list');
  const empty = $('#conv-list-empty');

  if (!State.conversations.length) {
    empty.style.display = 'flex';
    list.innerHTML = '';
    list.appendChild(empty);
    return;
  }
  empty.style.display = 'none';

  // Keep current items, just update
  const existing = new Set($$('.conv-item', list).map(el => el.dataset.convId));

  State.conversations.forEach(conv => {
    let el = $(`.conv-item[data-conv-id="${conv.id}"]`, list);
    if (!el) {
      el = document.createElement('div');
      el.className = 'conv-item';
      el.dataset.convId = conv.id;
      el.dataset.user = conv.other_id;
      el.addEventListener('click', () => openConversation(conv));
      list.appendChild(el);
    } else {
      existing.delete(conv.id);
    }

    if (conv.id === State.currentConvId) el.classList.add('active');
    else el.classList.remove('active');

    const unreadBadge = conv.unread_count > 0
      ? `<span class="conv-unread-badge">${conv.unread_count}</span>` : '';

    const avatarHtml = conv.other_avatar
      ? `<img src="${conv.other_avatar}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />`
      : `<span>${getInitials(conv.other_name)}</span>`;

    el.innerHTML = `
      <div class="user-avatar md" style="position:relative">
        ${avatarHtml}
        <span class="online-dot ${conv.other_online ? 'visible' : ''}"></span>
      </div>
      <div class="conv-item-info">
        <div class="conv-item-top">
          <span class="conv-item-name">${escapeHtml(conv.other_name || 'Unknown')}</span>
          <span class="conv-item-time">${conv.last_message_at ? formatTime(conv.last_message_at) : ''}</span>
        </div>
        <div class="conv-item-bottom">
          <span class="conv-item-last">${escapeHtml(conv.last_message || 'Start chatting…')}</span>
          ${unreadBadge}
        </div>
      </div>
    `;
  });

  // Remove stale items
  existing.forEach(id => {
    const el = $(`.conv-item[data-conv-id="${id}"]`, list);
    if (el) el.remove();
  });
}

// ── Open a conversation ──────────────────────────────────────
async function openConversation(conv) {
  // Leave old room
  if (State.currentConvId) {
    State.socket?.emit('conversation:leave', State.currentConvId);
  }

  State.currentConvId = conv.id;

  // Get other user
  try {
    const data = await api(`/api/users/${conv.other_id}`);
    State.currentOtherUser = data.user;
  } catch {
    State.currentOtherUser = { id: conv.other_id, name: conv.other_name, avatar: conv.other_avatar };
  }

  // Show chat window
  $('#chat-empty').style.display = 'none';
  const chatWindow = $('#chat-window');
  chatWindow.style.display = 'flex';

  // Mobile: hide sidebar
  if (State.isMobile) {
    $('#sidebar').classList.add('hidden');
  }

  // Update header
  const u = State.currentOtherUser;
  setAvatar($('#chat-header-avatar'), u);
  $('#chat-header-initials').textContent = getInitials(u.name);
  if (u.avatar) {
    $('#chat-header-avatar-img').src = u.avatar;
    $('#chat-header-avatar-img').style.display = 'block';
  }
  $('#chat-header-name').textContent = u.name || u.phone;
  updateChatHeaderStatus();

  // Active state in sidebar
  $$('.conv-item').forEach(el => el.classList.toggle('active', el.dataset.convId === conv.id));

  // Join socket room
  State.socket?.emit('conversation:join', conv.id);

  // Load messages
  await loadMessages(conv.id);
  scrollToBottom(true);

  // Focus input
  setTimeout(() => $('#message-input').focus(), 100);
}

function updateChatHeaderStatus() {
  const u = State.currentOtherUser;
  if (!u) return;
  const sub = $('#chat-header-sub');
  const dot = $('#chat-header-online-dot');
  if (u.is_online) {
    sub.textContent = 'Online';
    sub.className = 'chat-header-sub';
    dot.classList.add('visible');
  } else {
    sub.textContent = formatLastSeen(u.last_seen, false);
    sub.className = 'chat-header-sub offline';
    dot.classList.remove('visible');
  }
}

// ── Messages ─────────────────────────────────────────────────
async function loadMessages(convId) {
  const container = $('#messages-container');
  container.innerHTML = '<div class="messages-loading">Loading…</div>';
  State.messages = [];

  try {
    const data = await api(`/api/conversations/${convId}/messages`);
    State.messages = data.messages;

    container.innerHTML = '';

    let lastDate = null;
    data.messages.forEach(msg => {
      const msgDate = formatDate(msg.created_at);
      if (msgDate !== lastDate) {
        container.appendChild(createDateDivider(msgDate));
        lastDate = msgDate;
      }
      container.appendChild(createMessageEl(msg));
    });

    if (!data.messages.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;color:var(--text-muted);font-size:13px;padding:40px 20px';
      empty.innerHTML = '🎉 Start the celebration!<br><small>Say hello and make some birthday memories!</small>';
      container.appendChild(empty);
    }
  } catch (err) {
    container.innerHTML = `<div class="messages-loading">Failed to load messages</div>`;
  }
}

function createDateDivider(text) {
  const el = document.createElement('div');
  el.className = 'date-divider';
  el.innerHTML = `<span>${text}</span>`;
  return el;
}

function createMessageEl(msg) {
  const isOut = msg.sender_id === State.currentUser?.id;
  const row = document.createElement('div');
  row.className = `msg-row ${isOut ? 'out' : 'in'}`;
  row.dataset.msgId = msg.id;

  const readIcon = isOut
    ? `<span class="read-check ${msg.read_at ? 'read' : ''}">✓✓</span>` : '';

  const avatarHtml = !isOut ? `
    <div class="user-avatar sm" style="position:relative">
      ${msg.sender_avatar ? `<img src="${msg.sender_avatar}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />` : `<span>${getInitials(msg.sender_name)}</span>`}
    </div>` : '';

  row.innerHTML = `
    ${avatarHtml}
    <div class="msg-bubble">
      ${escapeHtml(msg.content).replace(/\n/g, '<br>')}
      <div class="msg-meta">
        <span>${formatTime(msg.created_at)}</span>
        ${readIcon}
      </div>
    </div>
  `;

  return row;
}

function appendMessage(msg) {
  const container = $('#messages-container');
  // Remove empty state if present
  const emptyEl = container.querySelector('div[style*="text-align:center"]');
  if (emptyEl) emptyEl.remove();

  // Add date divider if needed
  const lastMsg = State.messages[State.messages.length - 1];
  if (!lastMsg || formatDate(lastMsg.created_at) !== formatDate(msg.created_at)) {
    container.appendChild(createDateDivider(formatDate(msg.created_at)));
  }

  State.messages.push(msg);
  const el = createMessageEl(msg);
  container.appendChild(el);
}

function updateConvLastMessage(convId, content, ts) {
  const conv = State.conversations.find(c => c.id === convId);
  if (conv) {
    conv.last_message = content;
    conv.last_message_at = ts;
  }
}

function scrollToBottom(instant = false) {
  const container = $('#messages-container');
  if (instant) {
    container.scrollTop = container.scrollHeight;
  } else {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }
}

// ── Sending messages ─────────────────────────────────────────
function sendMessage() {
  const input = $('#message-input');
  const content = input.value.trim();
  if (!content || !State.currentConvId) return;

  input.value = '';
  input.style.height = 'auto';
  stopTyping();

  State.socket?.emit('message:send', {
    convId: State.currentConvId,
    content,
    type: 'text'
  }, (res) => {
    if (res?.error) toast('Failed to send: ' + res.error, 'error');
  });
}

// ── Typing indicators ────────────────────────────────────────
function startTyping() {
  if (!State.isTyping) {
    State.isTyping = true;
    State.socket?.emit('typing:start', { convId: State.currentConvId });
  }
  clearTimeout(State.typingTimer);
  State.typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
  if (State.isTyping) {
    State.isTyping = false;
    State.socket?.emit('typing:stop', { convId: State.currentConvId });
  }
  clearTimeout(State.typingTimer);
}

// ── User search ───────────────────────────────────────────────
let searchDebounce;
function setupSearch() {
  const input = $('#user-search-input');
  const results = $('#search-results');

  input.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = input.value.trim();
    if (!q || q.length < 3) { results.innerHTML = ''; return; }

    searchDebounce = setTimeout(async () => {
      try {
        const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        results.innerHTML = '';
        if (!data.users.length) {
          results.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:13px;text-align:center">No users found</div>';
          return;
        }
        data.users.forEach(u => {
          const el = document.createElement('div');
          el.className = 'search-result-item';
          el.innerHTML = `
            <div class="user-avatar sm">
              ${u.avatar ? `<img src="${u.avatar}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>` : `<span>${getInitials(u.name)}</span>`}
            </div>
            <div class="search-result-info">
              <strong>${escapeHtml(u.name || 'Unknown')}</strong>
              <small>${u.phone}</small>
            </div>
          `;
          el.addEventListener('click', async () => {
            try {
              const data = await api('/api/conversations/start', {
                method: 'POST',
                body: { targetUserId: u.id }
              });
              // Close search
              $('#search-panel').style.display = 'none';
              input.value = '';
              results.innerHTML = '';
              // Reload convs and open
              await loadConversations();
              const conv = State.conversations.find(c => c.id === data.conversationId);
              if (conv) openConversation(conv);
              else {
                // New conv not in list yet — build minimal conv object
                openConversation({
                  id: data.conversationId,
                  other_id: u.id,
                  other_name: u.name,
                  other_avatar: u.avatar,
                  other_online: u.is_online,
                  other_last_seen: u.last_seen
                });
              }
            } catch (err) {
              toast(err.message, 'error');
            }
          });
          results.appendChild(el);
        });
      } catch (err) { console.error(err); }
    }, 300);
  });
}

// ── Profile modal ─────────────────────────────────────────────
function openProfileModal() {
  const u = State.currentUser;
  if (!u) return;

  const modal = $('#profile-modal');
  setAvatar($('#modal-avatar-preview'), u);
  $('#modal-avatar-initials').textContent = getInitials(u.name);
  if (u.avatar) {
    $('#modal-avatar-img').src = u.avatar;
    $('#modal-avatar-img').style.display = 'block';
  } else {
    $('#modal-avatar-img').style.display = 'none';
  }
  $('#modal-name-input').value = u.name || '';
  $('#modal-status-input').value = u.status || '';
  modal.style.display = 'flex';
}

// ── App-level listeners ───────────────────────────────────────
function initAppListeners() {
  // New chat search toggle
  $('#btn-search-users').addEventListener('click', () => {
    const panel = $('#search-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display !== 'none') {
      $('#user-search-input').focus();
      setupSearch();
    }
  });

  // Theme toggle
  $('#btn-theme-toggle').addEventListener('click', () => {
    const html = document.documentElement;
    const isDark = html.dataset.theme !== 'light';
    html.dataset.theme = isDark ? 'light' : 'dark';
    $('#btn-theme-toggle').textContent = isDark ? '🌞' : '🌙';
  });

  // Back button (mobile)
  $('#btn-back-to-list').addEventListener('click', () => {
    if (State.currentConvId) {
      State.socket?.emit('conversation:leave', State.currentConvId);
    }
    State.currentConvId = null;
    State.currentOtherUser = null;
    $('#chat-window').style.display = 'none';
    $('#chat-empty').style.display = 'flex';
    $('#sidebar').classList.remove('hidden');
    $$('.conv-item').forEach(el => el.classList.remove('active'));
  });

  // Send message
  const input = $('#message-input');
  const sendBtn = $('#btn-send-message');

  sendBtn.addEventListener('click', sendMessage);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  input.addEventListener('input', () => {
    // Auto-resize
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    // Typing indicator
    if (State.currentConvId) startTyping();
  });

  // Emoji picker
  const picker = $('#emoji-picker');
  const pickerWrap = $('#emoji-picker-wrap');

  $('#btn-emoji-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    pickerWrap.style.display = pickerWrap.style.display === 'none' ? 'block' : 'none';
  });

  picker.addEventListener('emoji-click', (e) => {
    const emoji = e.detail.unicode;
    const pos = input.selectionStart;
    const val = input.value;
    input.value = val.slice(0, pos) + emoji + val.slice(pos);
    input.selectionStart = input.selectionEnd = pos + emoji.length;
    input.focus();
    pickerWrap.style.display = 'none';
  });

  document.addEventListener('click', (e) => {
    if (!pickerWrap.contains(e.target) && e.target.id !== 'btn-emoji-toggle') {
      pickerWrap.style.display = 'none';
    }
  });

  // Edit profile
  $('#btn-edit-profile').addEventListener('click', openProfileModal);
  $('#sidebar-avatar-btn').addEventListener('click', openProfileModal);

  $('#btn-close-profile-modal').addEventListener('click', () => {
    $('#profile-modal').style.display = 'none';
  });

  // Avatar change in modal
  $('#modal-avatar-input').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = $('#modal-avatar-img');
      img.src = e.target.result;
      img.style.display = 'block';
      $('#modal-avatar-initials').style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  $('#btn-save-profile-modal').addEventListener('click', async () => {
    const name = $('#modal-name-input').value.trim();
    const status = $('#modal-status-input').value.trim();
    if (!name) { toast('Name required', 'error'); return; }

    const btn = $('#btn-save-profile-modal');
    showLoading(btn);

    try {
      const data = await api('/api/profile', { method: 'PATCH', body: { name, status } });
      State.currentUser = { ...State.currentUser, ...data.user };

      const avatarFile = $('#modal-avatar-input').files[0];
      if (avatarFile) {
        const fd = new FormData();
        fd.append('avatar', avatarFile);
        const res = await fetch('/api/profile/avatar', { method: 'POST', body: fd, credentials: 'include' });
        const avData = await res.json();
        if (avData.avatar) State.currentUser.avatar = avData.avatar;
      }

      renderMyProfile();
      $('#profile-modal').style.display = 'none';
      toast('Profile updated! 🎉', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      hideLoading(btn);
    }
  });

  // Close modal on overlay click
  $('#profile-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });

  // Logout
  $('#btn-logout').addEventListener('click', async () => {
    if (!confirm('Log out?')) return;
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  });

  // Responsive resize
  window.addEventListener('resize', () => {
    State.isMobile = window.innerWidth <= 680;
    if (!State.isMobile) $('#sidebar').classList.remove('hidden');
  });
}

// ── Escape HTML ───────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
async function init() {
  // Check if already logged in
  try {
    const data = await api('/api/auth/me');
    State.currentUser = data.user;
    enterApp();
  } catch {
    // Not logged in — show auth screen
    initAuth();
  }
}

init();
