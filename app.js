// ===== データ管理 =====
const DB = {
  getClients: () => JSON.parse(localStorage.getItem('pt_clients') || '[]'),
  saveClients: (data) => localStorage.setItem('pt_clients', JSON.stringify(data)),
  getSessions: () => JSON.parse(localStorage.getItem('pt_sessions') || '[]'),
  saveSessions: (data) => localStorage.setItem('pt_sessions', JSON.stringify(data)),
  getClientSessions: (clientId) =>
    JSON.parse(localStorage.getItem('pt_sessions') || '[]')
      .filter(s => s.clientId === clientId)
      .sort((a, b) => b.date.localeCompare(a.date)),
  getLastSession: (clientId, excludeId) => {
    const list = DB.getClientSessions(clientId).filter(s => s.id !== excludeId);
    return list[0] || null;
  },
};

// ===== ページ切り替え =====
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`.nav-btn[onclick="showPage('${name}')"]`).classList.add('active');

  if (name === 'clients') renderClients();
  if (name === 'session') initSessionPage();
  if (name === 'history') initHistoryPage();
}

// ===== クライアント管理 =====
let editingClientId = null;

function renderClients() {
  const clients = DB.getClients();
  const el = document.getElementById('client-list');
  if (clients.length === 0) {
    el.innerHTML = '<div class="empty-state"><div style="font-size:48px">👤</div><p>クライアントを追加してください</p></div>';
    return;
  }
  el.innerHTML = clients.map(c => {
    const last = DB.getLastSession(c.id);
    const lastInfo = last ? `前回：${formatDate(last.date)}` : '記録なし';
    return `
    <div class="client-card">
      <div class="client-card-info" onclick="quickStart('${c.id}')">
        <h3>${esc(c.name)}</h3>
        <p>${esc(c.goal || '')}${c.note ? ' / ' + esc(c.note) : ''}</p>
        <p class="client-last">${lastInfo}</p>
      </div>
      <div class="client-card-actions">
        <button class="btn-icon" onclick="event.stopPropagation();openClientModal('${c.id}')">✏️</button>
        <button class="btn-icon" onclick="event.stopPropagation();deleteClient('${c.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

// クライアントカードをタップ → 即記録ページ＆クライアント選択＆前回読み込み案内
function quickStart(clientId) {
  showPage('session');
  document.getElementById('session-client').value = clientId;
  onClientChange();
}

function openClientModal(id) {
  editingClientId = id || null;
  const modal = document.getElementById('modal-client');
  if (id) {
    const c = DB.getClients().find(x => x.id === id);
    document.getElementById('client-name').value = c.name;
    document.getElementById('client-goal').value = c.goal || '';
    document.getElementById('client-note').value = c.note || '';
    document.getElementById('modal-client-title').textContent = 'クライアント編集';
  } else {
    document.getElementById('client-name').value = '';
    document.getElementById('client-goal').value = '';
    document.getElementById('client-note').value = '';
    document.getElementById('modal-client-title').textContent = 'クライアント追加';
  }
  modal.classList.add('open');
}

function closeClientModal(e) {
  if (e && e.target !== document.getElementById('modal-client')) return;
  document.getElementById('modal-client').classList.remove('open');
}

function saveClient() {
  const name = document.getElementById('client-name').value.trim();
  if (!name) { alert('名前を入力してください'); return; }
  const clients = DB.getClients();
  if (editingClientId) {
    const idx = clients.findIndex(c => c.id === editingClientId);
    clients[idx] = { ...clients[idx], name, goal: document.getElementById('client-goal').value.trim(), note: document.getElementById('client-note').value.trim() };
  } else {
    clients.push({ id: uid(), name, goal: document.getElementById('client-goal').value.trim(), note: document.getElementById('client-note').value.trim() });
  }
  DB.saveClients(clients);
  if (window.GDRIVE) GDRIVE.scheduleUpload();
  document.getElementById('modal-client').classList.remove('open');
  renderClients();
}

function deleteClient(id) {
  if (!confirm('このクライアントを削除しますか？')) return;
  DB.saveClients(DB.getClients().filter(c => c.id !== id));
  if (window.GDRIVE) GDRIVE.scheduleUpload();
  renderClients();
}

// ===== セッション記録ページ =====
function initSessionPage() {
  const sel = document.getElementById('session-client');
  const clients = DB.getClients();
  sel.innerHTML = clients.length
    ? clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    : '<option value="">（クライアントを追加してください）</option>';

  document.getElementById('session-date').value = today();
  resetSessionForm();
  onClientChange();
}

function resetSessionForm() {
  document.getElementById('session-weight').value = '';
  document.getElementById('session-fat').value = '';
  document.getElementById('session-memo').value = '';
  document.getElementById('exercise-list').innerHTML = '';
  addExercise();
}

// クライアント変更時：前回カルテ情報を表示
function onClientChange() {
  const clientId = document.getElementById('session-client').value;
  const info = document.getElementById('prev-session-info');
  if (!clientId) { info.style.display = 'none'; return; }

  const last = DB.getLastSession(clientId);
  if (!last) {
    info.style.display = 'none';
    return;
  }
  info.style.display = 'flex';
  document.getElementById('prev-session-date').textContent = formatDate(last.date);
  const exNames = last.exercises.map(e => e.name).join('、');
  document.getElementById('prev-session-summary').textContent = exNames;
}

// 前回カルテ確認（モーダル表示）
function viewPrevSession() {
  const clientId = document.getElementById('session-client').value;
  const last = DB.getLastSession(clientId);
  if (!last) return;
  openSessionDetail(last.id);
}

// 前回カルテを読み込む
function loadPrevSession() {
  const clientId = document.getElementById('session-client').value;
  const last = DB.getLastSession(clientId);
  if (!last) return;
  if (!confirm('前回のカルテを読み込みます。\n（種目構成がコピーされ、回数・重量は前回の値が初期入力されます）')) return;

  document.getElementById('session-weight').value = last.weight || '';
  document.getElementById('session-fat').value = last.fat || '';
  document.getElementById('session-memo').value = '';
  document.getElementById('exercise-list').innerHTML = '';

  last.exercises.forEach(ex => {
    const exId = createExerciseCard(ex.name);
    // 前回のセット数だけセットを追加
    const setList = document.getElementById('sets-' + exId);
    setList.innerHTML = '';
    ex.sets.forEach(s => addSet(exId, s.reps, s.weight, ''));
  });
}

function addExercise() {
  createExerciseCard('');
}

function createExerciseCard(name) {
  const id = 'ex-' + uid();
  const div = document.createElement('div');
  div.className = 'exercise-card';
  div.id = id;
  div.innerHTML = `
    <div class="exercise-card-header">
      <input type="text" class="input-field exercise-name-input hw-target" placeholder="種目名（タップして手書き）" id="name-${id}" value="${esc(name)}" data-hw-hint="テキスト">
      <button class="btn-remove" onclick="removeExercise('${id}')">✕</button>
    </div>
    <div class="set-labels">
      <span class="set-label"></span>
      <span class="set-label">回数</span>
      <span class="set-label">重量(kg)</span>
      <span class="set-label">メモ</span>
    </div>
    <div class="set-list" id="sets-${id}"></div>
    <button class="btn-add-set" onclick="addSet('${id}')">＋ セット追加</button>
  `;
  document.getElementById('exercise-list').appendChild(div);
  if (!name) { addSet(id); addSet(id); addSet(id); }
  return id;
}

function addSet(exId, reps = '', weight = '', memo = '') {
  const setList = document.getElementById('sets-' + exId);
  const setNum = setList.children.length + 1;
  const sid = uid();
  const row = document.createElement('div');
  row.className = 'set-row';
  row.id = 'set-' + sid;
  row.innerHTML = `
    <span class="set-num">${setNum}</span>
    <input type="text" class="set-input hw-target" placeholder="回" id="reps-${sid}" value="${esc(reps)}" data-hw-hint="数字">
    <input type="text" class="set-input hw-target" placeholder="kg" id="weight-${sid}" value="${esc(weight)}" data-hw-hint="数字">
    <input type="text" class="set-input hw-target" placeholder="メモ" id="memo-${sid}" value="${esc(memo)}" data-hw-hint="テキスト">
  `;
  setList.appendChild(row);
}

function removeExercise(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function saveSession() {
  const clientId = document.getElementById('session-client').value;
  if (!clientId) { alert('クライアントを選択してください'); return; }

  const exercises = [];
  document.querySelectorAll('.exercise-card').forEach(card => {
    const nameInput = card.querySelector('.exercise-name-input');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) return;

    const sets = [];
    card.querySelectorAll('.set-row').forEach(row => {
      const repsEl = row.querySelector('[id^="reps-"]');
      const weightEl = row.querySelector('[id^="weight-"]');
      const memoEl = row.querySelector('[id^="memo-"]');
      const reps = repsEl ? repsEl.value.trim() : '';
      const weight = weightEl ? weightEl.value.trim() : '';
      const memo = memoEl ? memoEl.value.trim() : '';
      if (reps || weight) sets.push({ reps, weight, memo });
    });

    exercises.push({ name, sets });
  });

  if (exercises.length === 0) { alert('種目を1つ以上入力してください'); return; }

  const date = document.getElementById('session-date').value;
  const sessions = DB.getSessions();

  // 同一クライアント・同一日付のカルテは上書き
  const existingIdx = sessions.findIndex(s => s.clientId === clientId && s.date === date);
  const session = {
    id: existingIdx >= 0 ? sessions[existingIdx].id : uid(),
    clientId,
    date,
    weight: document.getElementById('session-weight').value.trim(),
    fat: document.getElementById('session-fat').value.trim(),
    memo: document.getElementById('session-memo').value.trim(),
    exercises,
    createdAt: existingIdx >= 0 ? sessions[existingIdx].createdAt : Date.now(),
    updatedAt: Date.now()
  };

  if (existingIdx >= 0) {
    if (!confirm(`${formatDate(date)} のカルテが既にあります。上書きしますか？`)) return;
    sessions[existingIdx] = session;
  } else {
    sessions.push(session);
  }
  DB.saveSessions(sessions);
  if (window.GDRIVE) GDRIVE.scheduleUpload();

  alert('保存しました！');
  onClientChange(); // 前回情報を更新
}

// ===== 履歴ページ =====
function initHistoryPage() {
  const sel = document.getElementById('history-client');
  const clients = DB.getClients();
  sel.innerHTML = clients.length
    ? clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    : '<option value="">（クライアントがいません）</option>';
  loadHistory();
}

function loadHistory() {
  const clientId = document.getElementById('history-client').value;
  if (!clientId) { document.getElementById('history-list').innerHTML = ''; return; }
  const sessions = DB.getClientSessions(clientId);
  const el = document.getElementById('history-list');

  if (sessions.length === 0) {
    el.innerHTML = '<div class="empty-state"><div style="font-size:48px">📋</div><p>記録がありません</p></div>';
    return;
  }

  el.innerHTML = sessions.map(s => {
    const exNames = s.exercises.map(e => e.name).join('、');
    const totalSets = s.exercises.reduce((n, e) => n + e.sets.length, 0);
    return `
      <div class="history-card" onclick="openSessionDetail('${s.id}')">
        <div class="history-card-header">
          <span class="history-date">${formatDate(s.date)}</span>
          <span class="history-badge">${totalSets}セット</span>
        </div>
        <div class="history-body">
          ${exNames}
          ${s.weight ? ` ／ 体重 ${s.weight}kg` : ''}
          ${s.fat ? ` 体脂肪 ${s.fat}%` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ===== セッション詳細 =====
let currentSessionId = null;

function openSessionDetail(id) {
  currentSessionId = id;
  const session = DB.getSessions().find(s => s.id === id);
  const client = DB.getClients().find(c => c.id === session.clientId);

  document.getElementById('detail-title').textContent = `${client ? client.name : '?'} - ${formatDate(session.date)}`;

  let html = '';
  if (session.weight || session.fat) {
    html += '<div class="detail-row"><span class="detail-label">体重</span><span>' + (session.weight || '-') + ' kg</span></div>';
    html += '<div class="detail-row"><span class="detail-label">体脂肪</span><span>' + (session.fat || '-') + ' %</span></div>';
  }

  session.exercises.forEach(ex => {
    html += `<div class="detail-exercise">
      <h4>${esc(ex.name)}</h4>
      <table class="detail-set-table">
        <thead><tr><th>セット</th><th>回数</th><th>重量(kg)</th><th>メモ</th></tr></thead>
        <tbody>
          ${ex.sets.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.reps)}</td><td>${esc(s.weight)}</td><td>${esc(s.memo)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  });

  if (session.memo) {
    html += `<div class="detail-row" style="margin-top:12px"><span class="detail-label">メモ</span><span>${esc(session.memo)}</span></div>`;
  }

  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('modal-session-detail').classList.add('open');
}

function closeSessionDetail(e) {
  if (e && e.target !== document.getElementById('modal-session-detail')) return;
  document.getElementById('modal-session-detail').classList.remove('open');
}

// ===== PDF出力 =====
function printSession() {
  const session = DB.getSessions().find(s => s.id === currentSessionId);
  const client = DB.getClients().find(c => c.id === session.clientId);

  let html = `
    <div class="print-header">
      <h2>トレーニング記録</h2>
      <p>${client ? client.name : ''} 様　${formatDate(session.date)}</p>
    </div>
    <div class="print-meta">
      ${session.weight ? `<span>体重：${session.weight} kg</span>` : ''}
      ${session.fat ? `<span>体脂肪：${session.fat} %</span>` : ''}
    </div>
  `;

  session.exercises.forEach(ex => {
    html += `<div class="print-exercise">
      <h3>${esc(ex.name)}</h3>
      <table class="print-table">
        <thead><tr><th>セット</th><th>回数</th><th>重量(kg)</th><th>メモ</th></tr></thead>
        <tbody>
          ${ex.sets.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.reps)}</td><td>${esc(s.weight)}</td><td>${esc(s.memo)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  });

  if (session.memo) {
    html += `<div class="print-memo"><strong>メモ：</strong>${esc(session.memo)}</div>`;
  }

  document.getElementById('print-area').innerHTML = html;
  window.print();
}

// ===== ユーティリティ =====
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function today() { return new Date().toISOString().slice(0, 10); }
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.addEventListener('DOMContentLoaded', () => {
  showPage('clients');
  const od = document.getElementById('origin-display');
  if (od) od.textContent = window.location.origin;
});
