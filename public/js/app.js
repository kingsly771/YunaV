/* ═══════════════════════════════════════════════════════════
   YUNAV-HBDCHAT — Frontend App
   Firebase Google Auth + Full Moderation System
═══════════════════════════════════════════════════════════ */
'use strict';

const State = {
  currentUser:   null,
  currentConvId: null,
  currentOther:  null,
  conversations: [],
  messages:      [],
  socket:        null,
  typingTimer:   null,
  isTyping:      false,
  isMobile:      window.innerWidth <= 680,
  firebaseAuth:  null,
  // admin
  adminTarget:   null,
};

// ── Utils ─────────────────────────────────────────────────────
const $  = (s,c=document) => c.querySelector(s);
const $$ = (s,c=document) => [...c.querySelectorAll(s)];
const getInitials = n => n ? n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) : '?';
const formatTime  = ts => ts ? new Date(ts*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
const escHtml     = s  => s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

function formatDate(ts) {
  if (!ts) return '';
  const d=new Date(ts*1000), now=new Date(), diff=Math.floor((now-d)/86400000);
  if(diff===0) return 'Today'; if(diff===1) return 'Yesterday';
  if(diff<7) return d.toLocaleDateString([],{weekday:'long'});
  return d.toLocaleDateString([],{month:'short',day:'numeric'});
}
function formatLastSeen(ts,online) {
  if(online) return 'Online'; if(!ts) return 'Offline';
  const diff=Date.now()-ts*1000;
  if(diff<60000) return 'Just now'; if(diff<3600000) return `${Math.floor(diff/60000)}m ago`;
  if(diff<86400000) return `Today at ${formatTime(ts)}`;
  return new Date(ts*1000).toLocaleDateString([],{month:'short',day:'numeric'});
}
function formatBanExpiry(ts) {
  if(!ts) return 'Never (permanent)';
  const d=new Date(ts*1000);
  return d.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}

function toast(msg,type='info') {
  const el=document.createElement('div');
  el.className=`toast ${type}`; el.textContent=msg;
  $('#toast-container').appendChild(el);
  setTimeout(()=>el.style.opacity='0',3200);
  setTimeout(()=>el.remove(),3700);
}
function setBtnLoading(btn,on) { on?(btn.classList.add('loading'),btn.disabled=true):(btn.classList.remove('loading'),btn.disabled=false); }
function setAvatar(container,user) {
  if(!container||!user) return;
  const img=container.querySelector('img'), ini=container.querySelector('span:not(.online-dot)');
  if(user.avatar) { if(img){img.src=user.avatar;img.style.display='block';} if(ini) ini.style.display='none'; }
  else { if(img) img.style.display='none'; if(ini){ini.style.display='block';ini.textContent=getInitials(user.name);} }
}
async function api(url,opts={}) {
  const res=await fetch(url,{headers:{'Content-Type':'application/json',...opts.headers},credentials:'include',...opts,body:opts.body?JSON.stringify(opts.body):undefined});
  const data=await res.json();
  if(!res.ok) throw Object.assign(new Error(data.error||'Request failed'),{status:res.status,data});
  return data;
}

// ── Confetti ──────────────────────────────────────────────────
function spawnConfetti() {
  const c=$('#confetti'); if(!c) return;
  const cols=['#C084FC','#F472B6','#FACC15','#34D399','#60A5FA','#F87171'];
  for(let i=0;i<45;i++){
    const el=document.createElement('div'); el.className='confetti-piece';
    el.style.cssText=`left:${Math.random()*100}%;background:${cols[Math.floor(Math.random()*cols.length)]};width:${6+Math.random()*8}px;height:${6+Math.random()*8}px;animation-duration:${3+Math.random()*4}s;animation-delay:${Math.random()*4}s;border-radius:${Math.random()>.5?'50%':'2px'}`;
    c.appendChild(el);
  }
}

// ══════════════════════════════════════════════════════════════
// SCREENS
// ══════════════════════════════════════════════════════════════
function showScreen(id) {
  $$('.screen').forEach(s=>s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
}

function showBannedScreen(ban) {
  const typeLabels = { temporary:'⏱️ Temporary Suspension', permanent:'🚫 Permanent Ban', shadow:'👻 Shadow Ban' };
  $('#banned-title').textContent  = typeLabels[ban.type] || 'Account Suspended';
  $('#banned-sub').textContent    = 'Your account has been suspended for violating our community guidelines.';
  $('#ban-type-val').textContent  = ban.type.charAt(0).toUpperCase()+ban.type.slice(1);
  $('#ban-reason-val').textContent = ban.reason || 'Community guidelines violation';
  if (ban.expiresAt) {
    $('#ban-expires-row').style.display = 'flex';
    $('#ban-expires-val').textContent   = formatBanExpiry(ban.expiresAt);
  } else {
    $('#ban-expires-row').style.display = 'none';
  }
  showScreen('banned-screen');
}

// ══════════════════════════════════════════════════════════════
// FIREBASE AUTH
// ══════════════════════════════════════════════════════════════
function initFirebase() {
  const cfg=window.__FIREBASE_CONFIG__;
  if(!cfg||cfg.apiKey==='YOUR_API_KEY') {
    $('#firebase-config-notice').style.display='block';
    $('#btn-google-signin').disabled=true; $('#btn-google-signin').style.opacity='.4';
    return false;
  }
  try { firebase.initializeApp(cfg); State.firebaseAuth=firebase.auth(); return true; }
  catch(err) { $('#auth-error').textContent='Firebase init error: '+err.message; return false; }
}

function initAuth() {
  spawnConfetti();
  if(!initFirebase()) return;

  $('#btn-google-signin').addEventListener('click', async () => {
    const btn=$('#btn-google-signin');
    setBtnLoading(btn,true); setAuthError('');
    try {
      const provider=new firebase.auth.GoogleAuthProvider();
      provider.addScope('profile'); provider.addScope('email');
      const result=await State.firebaseAuth.signInWithPopup(provider);
      const idToken=await result.user.getIdToken();

      let data;
      try { data = await api('/api/auth/firebase',{method:'POST',body:{idToken}}); }
      catch(err) {
        if(err.data?.banned) { showBannedScreen(err.data.ban); return; }
        throw err;
      }

      State.currentUser=data.user;

      // Show pending warnings
      if(data.warnings?.length) {
        pendingWarnings = data.warnings;
      }

      if(data.isNewUser) {
        showAuthStep('profile'); populateProfileStep(data.user);
      } else {
        enterApp();
      }
    } catch(err) {
      console.error('Google sign-in error:',err);
      const msg = err.code==='auth/popup-closed-by-user' ? 'Sign-in cancelled.'
                : err.code==='auth/popup-blocked'        ? 'Popup blocked — please allow popups for this site.'
                : err.message||'Sign-in failed. Please try again.';
      setAuthError(msg);
    } finally { setBtnLoading(btn,false); }
  });

  $('#avatar-upload-input').addEventListener('change',function(){
    const file=this.files[0]; if(!file) return;
    const r=new FileReader(); r.onload=e=>{
      $('#avatar-img-preview').src=e.target.result; $('#avatar-img-preview').style.display='block';
      $('#avatar-initials').style.display='none';
    }; r.readAsDataURL(file);
  });

  $('#btn-save-profile').addEventListener('click', async()=>{
    const name=$('#profile-name-input').value.trim();
    const status=$('#profile-status-input').value.trim();
    if(!name){setAuthError('Please enter your name');return;}
    const btn=$('#btn-save-profile'); setBtnLoading(btn,true); setAuthError('');
    try {
      const data=await api('/api/profile',{method:'PATCH',body:{name,status}});
      State.currentUser={...State.currentUser,...data.user};
      const file=$('#avatar-upload-input').files[0];
      if(file){const fd=new FormData();fd.append('avatar',file);const r=await fetch('/api/profile/avatar',{method:'POST',body:fd,credentials:'include'});const av=await r.json();if(av.avatar)State.currentUser.avatar=av.avatar;}
      enterApp();
    } catch(err){setAuthError(err.message);}
    finally{setBtnLoading(btn,false);}
  });
}

let pendingWarnings = [];

function showAuthStep(n){$$('.auth-step').forEach(s=>s.classList.remove('active'));$(`#step-${n}`).classList.add('active');}
function setAuthError(m){$('#auth-error').textContent=m;if(m)setTimeout(()=>{if($('#auth-error'))$('#auth-error').textContent='';},6000);}
function populateProfileStep(u){
  $('#profile-name-input').value=u.name||'';
  if(u.avatar){$('#avatar-img-preview').src=u.avatar;$('#avatar-img-preview').style.display='block';$('#avatar-initials').style.display='none';}
  else{$('#avatar-initials').textContent=getInitials(u.name);}
  setTimeout(()=>$('#profile-name-input').select(),100);
}

// ══════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════
function enterApp() {
  showScreen('app-screen');
  renderMyProfile();
  connectSocket();
  loadConversations();
  initAppListeners();
  initReportListeners();

  // Show warning banner if pending
  if(pendingWarnings.length) showWarningBanner(pendingWarnings[0]);

  // Show admin button if admin
  if(State.currentUser?.role==='admin') {
    $('#btn-open-admin').style.display='flex';
    initAdminPanel();
  }
}

function renderMyProfile() {
  const u=State.currentUser; if(!u) return;
  [$('#sidebar-avatar'), $('#footer-avatar')].forEach(el=>setAvatar(el,u));
  $('#sidebar-initials').textContent=$('#footer-initials').textContent=getInitials(u.name);
  if(u.avatar){
    $('#sidebar-avatar-img').src=u.avatar;$('#sidebar-avatar-img').style.display='block';
    $('#footer-avatar-img').src=u.avatar;$('#footer-avatar-img').style.display='block';
  }
  $('#footer-name').textContent=u.name||u.email||'';
  $('#footer-status').textContent=u.status||'';
}

// ── Warning banner ────────────────────────────────────────────
function showWarningBanner(warning) {
  const banner=$('#warning-banner');
  $('#warning-banner-text').textContent=`Reason: ${warning.reason||'Community guidelines violation'}${warning.details?' — '+warning.details:''}`;
  banner.style.display='flex';
}

$('#btn-ack-warning').addEventListener('click', async()=>{
  try {
    await api('/api/auth/ack-warning',{method:'POST'});
    $('#warning-banner').style.display='none';
    pendingWarnings=[];
  } catch(e){}
});

// ── Socket.io ─────────────────────────────────────────────────
function connectSocket() {
  State.socket=io({withCredentials:true});
  State.socket.on('connect',()=>console.log('🔌 Socket connected'));

  State.socket.on('message:new',msg=>{
    if(msg.conv_id===State.currentConvId){appendMessage(msg);scrollToBottom();State.socket.emit('messages:read',{convId:msg.conv_id});}
    loadConversations();
  });
  State.socket.on('conversation:update',()=>loadConversations());
  State.socket.on('typing:start',({userId,convId})=>{
    if(convId===State.currentConvId&&userId!==State.currentUser?.id){
      $('#typing-name').textContent=State.currentOther?.name||'Someone';
      $('#typing-indicator').style.display='flex'; scrollToBottom();
    }
  });
  State.socket.on('typing:stop',({userId,convId})=>{
    if(convId===State.currentConvId&&userId!==State.currentUser?.id)
      $('#typing-indicator').style.display='none';
  });
  State.socket.on('messages:read',({convId,readBy})=>{
    if(convId===State.currentConvId&&readBy!==State.currentUser?.id)
      $$('.read-check').forEach(el=>el.classList.add('read'));
  });
  State.socket.on('user:status',({userId,isOnline,lastSeen})=>{
    if(State.currentOther?.id===userId){State.currentOther.is_online=isOnline?1:0;State.currentOther.last_seen=lastSeen;updateChatHeaderStatus();}
    const dot=$(`.conv-item[data-user="${userId}"] .online-dot`);
    if(dot) dot.classList.toggle('visible',!!isOnline);
  });
  // Force logout (banned mid-session)
  State.socket.on('force:logout',({reason})=>{
    toast('Your account has been suspended.','error');
    setTimeout(()=>location.reload(),2000);
  });
}

// ── Conversations ─────────────────────────────────────────────
async function loadConversations() {
  try {
    const data=await api('/api/conversations');
    State.conversations=data.conversations;
    renderConvList();
  } catch(e){console.error('loadConvs:',e);}
}

function renderConvList() {
  const list=$('#conv-list'), empty=$('#conv-list-empty');
  if(!State.conversations.length){list.innerHTML='';list.appendChild(empty);empty.style.display='flex';return;}
  empty.style.display='none';
  const seen=new Set();
  State.conversations.forEach(conv=>{
    seen.add(conv.id);
    let el=$(`.conv-item[data-conv-id="${conv.id}"]`,list);
    if(!el){
      el=document.createElement('div'); el.className='conv-item';
      el.dataset.convId=conv.id; el.dataset.user=conv.other_id;
      el.addEventListener('click',()=>openConversation(conv));
      list.appendChild(el);
    }
    el.classList.toggle('active',conv.id===State.currentConvId);
    const av=conv.other_avatar?`<img src="${escHtml(conv.other_avatar)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>`:`<span>${getInitials(conv.other_name)}</span>`;
    el.innerHTML=`
      <div class="user-avatar md" style="position:relative">${av}<span class="online-dot ${conv.other_online?'visible':''}"></span></div>
      <div class="conv-item-info">
        <div class="conv-item-top">
          <span class="conv-item-name">${escHtml(conv.other_name||conv.other_email||'Unknown')}</span>
          <span class="conv-item-time">${conv.last_message_at?formatTime(conv.last_message_at):''}</span>
        </div>
        <div class="conv-item-bottom">
          <span class="conv-item-last">${escHtml(conv.last_message||'Start chatting…')}</span>
          ${conv.unread_count>0?`<span class="conv-unread-badge">${conv.unread_count}</span>`:''}
        </div>
      </div>`;
  });
  $$('.conv-item',list).forEach(el=>{if(!seen.has(el.dataset.convId))el.remove();});
}

// ── Open conversation ─────────────────────────────────────────
async function openConversation(conv) {
  if(State.currentConvId) State.socket?.emit('conversation:leave',State.currentConvId);
  State.currentConvId=conv.id;
  try{const d=await api(`/api/users/${conv.other_id}`);State.currentOther=d.user;}
  catch{State.currentOther={id:conv.other_id,name:conv.other_name,avatar:conv.other_avatar,email:conv.other_email};}

  $('#chat-empty').style.display='none'; $('#chat-window').style.display='flex';
  if(State.isMobile) $('#sidebar').classList.add('hidden');

  const u=State.currentOther;
  setAvatar($('#chat-header-avatar'),u);
  $('#chat-header-initials').textContent=getInitials(u.name);
  if(u.avatar){$('#chat-header-avatar-img').src=u.avatar;$('#chat-header-avatar-img').style.display='block';}
  else{$('#chat-header-avatar-img').style.display='none';}
  $('#chat-header-name').textContent=u.name||u.email||'Unknown';
  updateChatHeaderStatus();
  $$('.conv-item').forEach(el=>el.classList.toggle('active',el.dataset.convId===conv.id));

  State.socket?.emit('conversation:join',conv.id);
  await loadMessages(conv.id);
  scrollToBottom(true);
  setTimeout(()=>$('#message-input')?.focus(),100);
}

function updateChatHeaderStatus(){
  const u=State.currentOther; if(!u) return;
  const sub=$('#chat-header-sub'),dot=$('#chat-header-online-dot');
  if(u.is_online){sub.textContent='Online';sub.className='chat-header-sub';dot.classList.add('visible');}
  else{sub.textContent=formatLastSeen(u.last_seen,false);sub.className='chat-header-sub offline';dot.classList.remove('visible');}
}

// ── Messages ──────────────────────────────────────────────────
async function loadMessages(convId) {
  const c=$('#messages-container');
  c.innerHTML='<div class="messages-loading">Loading messages…</div>';
  State.messages=[];
  try {
    const d=await api(`/api/conversations/${convId}/messages`);
    State.messages=d.messages; c.innerHTML='';
    if(!d.messages.length){
      const e=document.createElement('div');
      e.style.cssText='text-align:center;color:var(--text-muted);font-size:13px;padding:50px 20px;line-height:2';
      e.innerHTML='🎉<br><strong>Say hello!</strong><br><small>Start the celebration!</small>';
      c.appendChild(e); return;
    }
    let lastDate=null;
    d.messages.forEach(msg=>{
      const dt=formatDate(msg.created_at);
      if(dt!==lastDate){c.appendChild(createDateDivider(dt));lastDate=dt;}
      c.appendChild(createMessageEl(msg));
    });
  } catch(e){c.innerHTML='<div class="messages-loading">Failed to load messages</div>';}
}

function createDateDivider(text) {
  const el=document.createElement('div'); el.className='date-divider';
  el.innerHTML=`<span>${text}</span>`; return el;
}
function createMessageEl(msg) {
  const isOut=msg.sender_id===State.currentUser?.id;
  const row=document.createElement('div'); row.className=`msg-row ${isOut?'out':'in'}`; row.dataset.msgId=msg.id;
  const av=!isOut?`<div class="user-avatar sm" style="position:relative;flex-shrink:0">${msg.sender_avatar?`<img src="${escHtml(msg.sender_avatar)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>`:`<span>${getInitials(msg.sender_name)}</span>`}</div>`:'';
  row.innerHTML=`${av}<div class="msg-bubble">${escHtml(msg.content).replace(/\n/g,'<br>')}<div class="msg-meta"><span>${formatTime(msg.created_at)}</span>${isOut?`<span class="read-check ${msg.read_at?'read':''}">✓✓</span>`:''}</div></div>`;
  return row;
}
function appendMessage(msg) {
  const c=$('#messages-container');
  const ph=c.querySelector('div[style*="text-align:center"]'); if(ph) ph.remove();
  const last=State.messages[State.messages.length-1];
  if(!last||formatDate(last.created_at)!==formatDate(msg.created_at)) c.appendChild(createDateDivider(formatDate(msg.created_at)));
  State.messages.push(msg); c.appendChild(createMessageEl(msg));
}
function scrollToBottom(instant=false){
  const c=$('#messages-container'); if(!c) return;
  instant?c.scrollTop=c.scrollHeight:c.scrollTo({top:c.scrollHeight,behavior:'smooth'});
}

// ── Send message ──────────────────────────────────────────────
function sendMessage(){
  const input=$('#message-input'), content=input.value.trim();
  if(!content||!State.currentConvId) return;
  input.value=''; input.style.height='auto'; stopTyping();
  State.socket?.emit('message:send',{convId:State.currentConvId,content,type:'text'},res=>{
    if(res?.error==='banned') toast('You cannot send messages — account suspended.','error');
    else if(res?.error) toast('Send failed: '+res.error,'error');
  });
}

function startTyping(){
  if(!State.isTyping){State.isTyping=true;State.socket?.emit('typing:start',{convId:State.currentConvId});}
  clearTimeout(State.typingTimer); State.typingTimer=setTimeout(stopTyping,2000);
}
function stopTyping(){
  if(State.isTyping){State.isTyping=false;State.socket?.emit('typing:stop',{convId:State.currentConvId});}
  clearTimeout(State.typingTimer);
}

// ── User search ───────────────────────────────────────────────
let searchDebounce;
function setupSearch(){
  const input=$('#user-search-input'), results=$('#search-results');
  input.addEventListener('input',()=>{
    clearTimeout(searchDebounce); const q=input.value.trim();
    if(!q||q.length<2){results.innerHTML='';return;}
    searchDebounce=setTimeout(async()=>{
      try{
        const d=await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        results.innerHTML='';
        if(!d.users.length){results.innerHTML='<div style="padding:12px;color:var(--text-muted);font-size:13px;text-align:center">No users found</div>';return;}
        d.users.forEach(u=>{
          const el=document.createElement('div'); el.className='search-result-item';
          el.innerHTML=`<div class="user-avatar sm" style="position:relative;flex-shrink:0">${u.avatar?`<img src="${escHtml(u.avatar)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>`:`<span>${getInitials(u.name)}</span>`}</div><div class="search-result-info"><strong>${escHtml(u.name||'Unknown')}</strong><small>${escHtml(u.email||'')}</small></div>`;
          el.addEventListener('click',async()=>{
            try{
              const r=await api('/api/conversations/start',{method:'POST',body:{targetUserId:u.id}});
              $('#search-panel').style.display='none'; input.value=''; results.innerHTML='';
              await loadConversations();
              const conv=State.conversations.find(c=>c.id===r.conversationId)||{id:r.conversationId,other_id:u.id,other_name:u.name,other_avatar:u.avatar,other_email:u.email,other_online:u.is_online};
              openConversation(conv);
            }catch(err){toast(err.message,'error');}
          });
          results.appendChild(el);
        });
      }catch(e){console.error(e);}
    },280);
  });
}

// ══════════════════════════════════════════════════════════════
// REPORT SYSTEM
// ══════════════════════════════════════════════════════════════
function initReportListeners() {
  $('#btn-report-user').addEventListener('click',()=>{
    if(!State.currentOther) return;
    State.adminTarget=State.currentOther;
    $('#report-target-name').textContent=State.currentOther.name||State.currentOther.email||'Unknown';
    // Reset form
    $$('.report-reason-btn').forEach(b=>b.classList.remove('selected'));
    $('#report-details').value='';
    $('#btn-submit-report').disabled=true;
    $('#report-modal').style.display='flex';
  });

  $$('.report-reason-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('.report-reason-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      $('#btn-submit-report').disabled=false;
    });
  });

  $('#btn-close-report-modal').addEventListener('click',()=>$('#report-modal').style.display='none');
  $('#report-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});

  $('#btn-submit-report').addEventListener('click',async()=>{
    const reason=$('.report-reason-btn.selected')?.dataset?.reason;
    if(!reason){toast('Please select a reason','error');return;}
    const details=$('#report-details').value.trim();
    const btn=$('#btn-submit-report'); setBtnLoading(btn,true);
    try{
      await api('/api/reports',{method:'POST',body:{reportedId:State.adminTarget.id,reason,details}});
      $('#report-modal').style.display='none';
      toast('Report submitted. Our team will review it. 🛡️','success');
    }catch(err){toast(err.message,'error');}
    finally{setBtnLoading(btn,false);}
  });
}

// ══════════════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════════════
function initAdminPanel() {
  $('#btn-open-admin').addEventListener('click',()=>{
    // Populate admin header
    setAvatar($('#admin-header-avatar'),State.currentUser);
    $('#admin-header-initials').textContent=getInitials(State.currentUser.name);
    if(State.currentUser.avatar){$('#admin-header-avatar-img').src=State.currentUser.avatar;$('#admin-header-avatar-img').style.display='block';}
    $('#admin-header-name').textContent=State.currentUser.name||'Admin';
    showScreen('admin-screen');
    adminLoadStats();
    adminLoadReports();
  });
  $('#btn-admin-back').addEventListener('click',()=>showScreen('app-screen'));

  // Nav tabs
  $$('.admin-nav-item').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('.admin-nav-item').forEach(b=>b.classList.remove('active'));
      $$('.admin-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      $(`#panel-${btn.dataset.panel}`).classList.add('active');
      if(btn.dataset.panel==='reports') adminLoadReports();
      if(btn.dataset.panel==='users')   adminLoadUsers();
      if(btn.dataset.panel==='bans')    adminLoadBans();
    });
  });

  // User search in admin
  $('#admin-search-btn').addEventListener('click',adminLoadUsers);
  $('#admin-user-search').addEventListener('keypress',e=>{if(e.key==='Enter') adminLoadUsers();});

  // Ban modal
  $$('.ban-type-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      $$('.ban-type-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      $('#ban-duration-group').style.display=btn.dataset.type==='temporary'?'block':'none';
    });
  });
  $('#btn-close-ban-modal').addEventListener('click',()=>$('#ban-modal').style.display='none');
  $('#ban-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});

  $('#btn-confirm-ban').addEventListener('click',async()=>{
    const type=$('.ban-type-btn.selected')?.dataset?.type||'temporary';
    const reason=$('#ban-reason-select').value;
    const notes=$('#ban-details-input').value.trim();
    const hours=$('#ban-duration-select').value;
    if(!reason){toast('Please select a reason','error');return;}
    const btn=$('#btn-confirm-ban'); setBtnLoading(btn,true);
    try{
      await api(`/api/admin/ban/${State.adminTarget.id}`,{method:'POST',body:{type,reason,notes,hours:parseInt(hours)}});
      State.socket?.emit('admin:kick',{targetUserId:State.adminTarget.id});
      $('#ban-modal').style.display='none';
      toast(`🚫 ${State.adminTarget.name} has been banned.`,'warn');
      adminLoadUsers(); adminLoadStats(); adminLoadBans();
    }catch(err){toast(err.message,'error');}
    finally{setBtnLoading(btn,false);}
  });

  // Warn modal
  $('#btn-close-warn-modal').addEventListener('click',()=>$('#warn-modal').style.display='none');
  $('#warn-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});

  $('#btn-confirm-warn').addEventListener('click',async()=>{
    const reason=$('#warn-reason-select').value;
    const details=$('#warn-details-input').value.trim();
    if(!reason){toast('Please select a reason','error');return;}
    const btn=$('#btn-confirm-warn'); setBtnLoading(btn,true);
    try{
      const data=await api(`/api/admin/warn/${State.adminTarget.id}`,{method:'POST',body:{reason,details}});
      $('#warn-modal').style.display='none';
      let msg=`⚠️ Warning issued to ${State.adminTarget.name}.`;
      if(data.autoBan) msg+=` Auto-escalated to ${data.autoBan.type} ban.`;
      toast(msg,'warn');
      adminLoadUsers(); adminLoadStats();
    }catch(err){toast(err.message,'error');}
    finally{setBtnLoading(btn,false);}
  });
}

async function adminLoadStats(){
  try{
    const d=await api('/api/admin/stats');
    $('#stat-reports').textContent=d.pendingReports;
    $('#stat-bans').textContent=d.activeBans;
    $('#stat-warnings').textContent=d.totalWarnings;
    $('#stat-users').textContent=d.totalUsers;
    $('#stat-messages').textContent=d.totalMessages;
    $('#stats-refresh-time').textContent=new Date().toLocaleTimeString();
    if(d.pendingReports>0){$('#reports-badge').textContent=d.pendingReports;$('#reports-badge').style.display='flex';}
    else $('#reports-badge').style.display='none';
  }catch(e){console.error('adminStats:',e);}
}

window.adminLoadReports=async function(){
  const body=$('#reports-table-body'); body.innerHTML='<div class="admin-table-empty">Loading…</div>';
  try{
    const d=await api('/api/admin/reports');
    if(!d.reports.length){body.innerHTML='<div class="admin-table-empty">✅ No pending reports</div>';return;}
    body.innerHTML=`<table class="admin-table"><thead><tr><th>Reporter</th><th>Reported</th><th>Reason</th><th>Time</th><th>Actions</th></tr></thead><tbody>
      ${d.reports.map(r=>`
        <tr>
          <td><div class="user-cell">${avatarCell(r.reporter_name,r.reporter_avatar)}<div class="user-cell-info"><strong>${escHtml(r.reporter_name||'?')}</strong></div></div></td>
          <td><div class="user-cell">${avatarCell(r.reported_name,r.reported_avatar)}<div class="user-cell-info"><strong>${escHtml(r.reported_name||'?')}</strong><small>${escHtml(r.reported_email||'')}</small></div></div></td>
          <td>${escHtml(r.reason)}</td>
          <td>${formatTime(r.created_at)}</td>
          <td><div class="action-row">
            <button class="btn-action warn" onclick="adminOpenWarn('${r.reported_id}','${escHtml(r.reported_name||'')}')">⚠️ Warn</button>
            <button class="btn-action ban" onclick="adminOpenBan('${r.reported_id}','${escHtml(r.reported_name||'')}')">🚫 Ban</button>
            <button class="btn-action dismiss" onclick="adminDismissReport('${r.id}')">Dismiss</button>
          </div></td>
        </tr>`).join('')}
    </tbody></table>`;
  }catch(e){body.innerHTML='<div class="admin-table-empty">Failed to load</div>';}
};

async function adminLoadUsers(){
  const body=$('#users-table-body'); body.innerHTML='<div class="admin-table-empty">Loading…</div>';
  const q=$('#admin-user-search').value.trim();
  try{
    const d=await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
    if(!d.users.length){body.innerHTML='<div class="admin-table-empty">No users found</div>';return;}
    body.innerHTML=`<table class="admin-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Warns</th><th>Actions</th></tr></thead><tbody>
      ${d.users.map(u=>`
        <tr>
          <td><div class="user-cell">${avatarCell(u.name,u.avatar)}<div class="user-cell-info"><strong>${escHtml(u.name||'?')}</strong><small>${escHtml(u.email||'')}</small></div></div></td>
          <td><span class="badge ${u.role==='admin'?'admin-r':'clean'}">${u.role}</span></td>
          <td>${u.active_bans>0?'<span class="badge banned">Banned</span>':'<span class="badge clean">Active</span>'}</td>
          <td>${u.warning_count>0?`<span class="badge warned">${u.warning_count}</span>`:'<span style="color:var(--text-muted)">0</span>'}</td>
          <td><div class="action-row">
            ${u.id!==State.currentUser.id&&u.role!=='admin'?`
              <button class="btn-action warn" onclick="adminOpenWarn('${u.id}','${escHtml(u.name||'')}')">⚠️ Warn</button>
              ${u.active_bans>0
                ?`<button class="btn-action lift" onclick="adminUnban('${u.id}')">✅ Unban</button>`
                :`<button class="btn-action ban" onclick="adminOpenBan('${u.id}','${escHtml(u.name||'')}')">🚫 Ban</button>`}
            `:'<span style="color:var(--text-muted);font-size:13px">—</span>'}
          </div></td>
        </tr>`).join('')}
    </tbody></table>`;
  }catch(e){body.innerHTML='<div class="admin-table-empty">Failed to load</div>';}
}

window.adminLoadBans=async function(){
  const body=$('#bans-table-body'); body.innerHTML='<div class="admin-table-empty">Loading…</div>';
  try{
    const d=await api('/api/admin/bans');
    if(!d.bans.length){body.innerHTML='<div class="admin-table-empty">✅ No active bans</div>';return;}
    body.innerHTML=`<table class="admin-table"><thead><tr><th>User</th><th>Type</th><th>Reason</th><th>Expires</th><th>Actions</th></tr></thead><tbody>
      ${d.bans.map(b=>`
        <tr>
          <td><div class="user-cell">${avatarCell(b.user_name,b.user_avatar)}<div class="user-cell-info"><strong>${escHtml(b.user_name||'?')}</strong><small>${escHtml(b.user_email||'')}</small></div></div></td>
          <td><span class="badge ${b.type==='shadow'?'shadow':'banned'}">${b.type==='shadow'?'👻 Shadow':b.type==='permanent'?'🚫 Permanent':'⏱️ Temporary'}</span></td>
          <td>${escHtml(b.reason||'—')}</td>
          <td>${b.expires_at?formatBanExpiry(b.expires_at):'Never'}</td>
          <td><button class="btn-action lift" onclick="adminUnban('${b.user_id}')">✅ Lift Ban</button></td>
        </tr>`).join('')}
    </tbody></table>`;
  }catch(e){body.innerHTML='<div class="admin-table-empty">Failed to load</div>';}
};

function avatarCell(name,avatar){
  return `<div class="user-avatar sm" style="position:relative;flex-shrink:0">${avatar?`<img src="${escHtml(avatar)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/>`:`<span>${getInitials(name)}</span>`}</div>`;
}

window.adminOpenBan=function(userId,userName){
  State.adminTarget={id:userId,name:userName};
  $('#ban-target-name').textContent=userName||userId;
  $$('.ban-type-btn').forEach(b=>b.classList.toggle('selected',b.dataset.type==='temporary'));
  $('#ban-duration-group').style.display='block';
  $('#ban-reason-select').value=''; $('#ban-details-input').value='';
  $('#ban-modal').style.display='flex';
};
window.adminOpenWarn=function(userId,userName){
  State.adminTarget={id:userId,name:userName};
  $('#warn-target-name').textContent=userName||userId;
  $('#warn-reason-select').value=''; $('#warn-details-input').value='';
  $('#warn-modal').style.display='flex';
};
window.adminUnban=async function(userId){
  try{
    await api(`/api/admin/unban/${userId}`,{method:'POST'});
    toast('✅ Ban lifted','success'); adminLoadBans(); adminLoadUsers(); adminLoadStats();
  }catch(err){toast(err.message,'error');}
};
window.adminDismissReport=async function(reportId){
  try{
    await api(`/api/admin/reports/${reportId}/resolve`,{method:'POST',body:{resolution:'dismissed'}});
    toast('Report dismissed','success'); adminLoadReports(); adminLoadStats();
  }catch(err){toast(err.message,'error');}
};

// ══════════════════════════════════════════════════════════════
// APP LISTENERS
// ══════════════════════════════════════════════════════════════
function initAppListeners(){
  $('#btn-search-users').addEventListener('click',()=>{
    const panel=$('#search-panel'), showing=panel.style.display!=='none';
    panel.style.display=showing?'none':'block';
    if(!showing){setupSearch();$('#user-search-input').focus();}
  });
  $('#btn-theme-toggle').addEventListener('click',()=>{
    const isDark=document.documentElement.dataset.theme!=='light';
    document.documentElement.dataset.theme=isDark?'light':'dark';
    $('#btn-theme-toggle').textContent=isDark?'🌞':'🌙';
  });
  $('#btn-back-to-list').addEventListener('click',()=>{
    if(State.currentConvId) State.socket?.emit('conversation:leave',State.currentConvId);
    State.currentConvId=null; State.currentOther=null;
    $('#chat-window').style.display='none'; $('#chat-empty').style.display='flex';
    $('#sidebar').classList.remove('hidden');
    $$('.conv-item').forEach(el=>el.classList.remove('active'));
  });
  const input=$('#message-input');
  $('#btn-send-message').addEventListener('click',sendMessage);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
  input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,120)+'px';if(State.currentConvId)startTyping();});

  const pickerWrap=$('#emoji-picker-wrap');
  $('#btn-emoji-toggle').addEventListener('click',e=>{e.stopPropagation();pickerWrap.style.display=pickerWrap.style.display==='none'?'block':'none';});
  $('#emoji-picker').addEventListener('emoji-click',e=>{
    const emoji=e.detail.unicode,pos=input.selectionStart,val=input.value;
    input.value=val.slice(0,pos)+emoji+val.slice(pos);
    input.selectionStart=input.selectionEnd=pos+emoji.length;
    input.focus(); pickerWrap.style.display='none';
  });
  document.addEventListener('click',e=>{if(!pickerWrap.contains(e.target)&&e.target.id!=='btn-emoji-toggle')pickerWrap.style.display='none';});

  $('#btn-edit-profile').addEventListener('click',openProfileModal);
  $('#sidebar-avatar-btn').addEventListener('click',openProfileModal);
  $('#btn-close-profile-modal').addEventListener('click',()=>$('#profile-modal').style.display='none');
  $('#profile-modal').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});
  $('#modal-avatar-input').addEventListener('change',function(){
    const file=this.files[0]; if(!file) return;
    const r=new FileReader(); r.onload=e=>{
      const img=$('#modal-avatar-img');img.src=e.target.result;img.style.display='block';
      $('#modal-avatar-initials').style.display='none';
    }; r.readAsDataURL(file);
  });
  $('#btn-save-profile-modal').addEventListener('click',async()=>{
    const name=$('#modal-name-input').value.trim(), status=$('#modal-status-input').value.trim();
    if(!name){toast('Name required','error');return;}
    const btn=$('#btn-save-profile-modal'); setBtnLoading(btn,true);
    try{
      const d=await api('/api/profile',{method:'PATCH',body:{name,status}});
      State.currentUser={...State.currentUser,...d.user};
      const file=$('#modal-avatar-input').files[0];
      if(file){const fd=new FormData();fd.append('avatar',file);const r=await fetch('/api/profile/avatar',{method:'POST',body:fd,credentials:'include'});const av=await r.json();if(av.avatar)State.currentUser.avatar=av.avatar;}
      renderMyProfile(); $('#profile-modal').style.display='none'; toast('Profile updated! 🎉','success');
    }catch(err){toast(err.message,'error');}
    finally{setBtnLoading(btn,false);}
  });
  $('#btn-logout').addEventListener('click',async()=>{
    if(!confirm('Sign out?')) return;
    try{if(State.firebaseAuth)await State.firebaseAuth.signOut();await api('/api/auth/logout',{method:'POST'});}
    finally{location.reload();}
  });
  window.addEventListener('resize',()=>{State.isMobile=window.innerWidth<=680;if(!State.isMobile)$('#sidebar').classList.remove('hidden');});
}

function openProfileModal(){
  const u=State.currentUser; if(!u) return;
  setAvatar($('#modal-avatar-preview'),u);
  $('#modal-avatar-initials').textContent=getInitials(u.name);
  if(u.avatar){$('#modal-avatar-img').src=u.avatar;$('#modal-avatar-img').style.display='block';}
  else{$('#modal-avatar-img').style.display='none';}
  $('#modal-name-input').value=u.name||'';
  $('#modal-status-input').value=u.status||'';
  $('#profile-modal').style.display='flex';
}

// ══════════════════════════════════════════════════════════════
// BOOT
// ══════════════════════════════════════════════════════════════
async function init(){
  try{
    const data=await api('/api/auth/me');
    State.currentUser=data.user;
    if(data.warnings?.length) pendingWarnings=data.warnings;
    initFirebase();
    enterApp();
  }catch(err){
    if(err.data?.banned){ showBannedScreen(err.data.ban); return; }
    initAuth();
  }
}

init();
