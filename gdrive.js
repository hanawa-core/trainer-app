// Google Drive 同期モジュール
// drive.appdata スコープを使用してアプリ専用の隠しフォルダにJSON保存

const GDRIVE = {
  CLIENT_ID_KEY: 'pt_gdrive_client_id',
  TOKEN_KEY: 'pt_gdrive_token',
  TOKEN_EXP_KEY: 'pt_gdrive_token_exp',
  FILE_ID_KEY: 'pt_gdrive_file_id',
  LAST_SYNC_KEY: 'pt_gdrive_last_sync',
  FILE_NAME: 'pt-data.json',
  SCOPE: 'https://www.googleapis.com/auth/drive.appdata',

  tokenClient: null,
  accessToken: null,

  isConfigured() {
    return !!localStorage.getItem(this.CLIENT_ID_KEY);
  },

  isLoggedIn() {
    const token = localStorage.getItem(this.TOKEN_KEY);
    const exp = parseInt(localStorage.getItem(this.TOKEN_EXP_KEY) || '0');
    return token && Date.now() < exp;
  },

  getClientId() {
    return localStorage.getItem(this.CLIENT_ID_KEY) || '';
  },

  setClientId(id) {
    localStorage.setItem(this.CLIENT_ID_KEY, id.trim());
  },

  async loadGoogleLib() {
    if (window.google && google.accounts) return;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  async login() {
    const clientId = this.getClientId();
    if (!clientId) { alert('先にGoogle OAuth Client IDを設定してください'); return false; }

    await this.loadGoogleLib();

    return new Promise((resolve) => {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: this.SCOPE,
        callback: (resp) => {
          if (resp.error) {
            alert('ログイン失敗: ' + resp.error);
            resolve(false);
            return;
          }
          this.accessToken = resp.access_token;
          localStorage.setItem(this.TOKEN_KEY, resp.access_token);
          localStorage.setItem(this.TOKEN_EXP_KEY, String(Date.now() + (resp.expires_in - 60) * 1000));
          resolve(true);
        },
      });
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  },

  logout() {
    if (this.accessToken && window.google) {
      try { google.accounts.oauth2.revoke(this.accessToken, () => {}); } catch (e) {}
    }
    this.accessToken = null;
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.TOKEN_EXP_KEY);
    localStorage.removeItem(this.FILE_ID_KEY);
  },

  getToken() {
    return this.accessToken || localStorage.getItem(this.TOKEN_KEY);
  },

  async _api(url, opts = {}) {
    const token = this.getToken();
    if (!token) throw new Error('未ログイン');
    const res = await fetch(url, {
      ...opts,
      headers: { 'Authorization': 'Bearer ' + token, ...(opts.headers || {}) }
    });
    if (res.status === 401) {
      this.logout();
      throw new Error('認証期限切れ。再ログインしてください');
    }
    return res;
  },

  async findFile() {
    const cached = localStorage.getItem(this.FILE_ID_KEY);
    if (cached) return cached;
    const res = await this._api(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${this.FILE_NAME}'&fields=files(id,name)`
    );
    const data = await res.json();
    const file = data.files && data.files[0];
    if (file) localStorage.setItem(this.FILE_ID_KEY, file.id);
    return file ? file.id : null;
  },

  async download() {
    const fileId = await this.findFile();
    if (!fileId) return null;
    const res = await this._api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (!res.ok) return null;
    return await res.json();
  },

  async upload(payload) {
    const fileId = await this.findFile();
    const body = JSON.stringify(payload);

    if (fileId) {
      // 既存ファイル更新
      await this._api(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body }
      );
    } else {
      // 新規作成（multipart）
      const boundary = '-------pt' + Date.now();
      const meta = { name: this.FILE_NAME, parents: ['appDataFolder'] };
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      const res = await this._api(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart }
      );
      const data = await res.json();
      if (data.id) localStorage.setItem(this.FILE_ID_KEY, data.id);
    }
    localStorage.setItem(this.LAST_SYNC_KEY, String(Date.now()));
  },

  // ローカルとリモートをマージ（updatedAt が新しい方を採用）
  mergeData(remote) {
    if (!remote) return;
    const localClients = DB.getClients();
    const localSessions = DB.getSessions();

    // クライアント：IDで突合、リモートにあるが手元にないものを追加
    const clientMap = new Map(localClients.map(c => [c.id, c]));
    (remote.clients || []).forEach(rc => {
      if (!clientMap.has(rc.id)) clientMap.set(rc.id, rc);
    });

    // セッション：IDで突合、updatedAtが新しい方を採用
    const sessionMap = new Map(localSessions.map(s => [s.id, s]));
    (remote.sessions || []).forEach(rs => {
      const local = sessionMap.get(rs.id);
      if (!local || (rs.updatedAt || rs.createdAt || 0) > (local.updatedAt || local.createdAt || 0)) {
        sessionMap.set(rs.id, rs);
      }
    });

    DB.saveClients([...clientMap.values()]);
    DB.saveSessions([...sessionMap.values()]);
  },

  async syncNow() {
    if (!this.isLoggedIn()) {
      const ok = await this.login();
      if (!ok) return false;
    }
    try {
      const remote = await this.download();
      this.mergeData(remote);
      const payload = {
        clients: DB.getClients(),
        sessions: DB.getSessions(),
        syncedAt: Date.now(),
      };
      await this.upload(payload);
      updateSyncStatus();
      return true;
    } catch (e) {
      console.error('同期エラー:', e);
      alert('同期エラー: ' + e.message);
      return false;
    }
  },

  // 自動アップロード（ログイン中のみ、デバウンス）
  _uploadTimer: null,
  scheduleUpload() {
    if (!this.isLoggedIn()) return;
    clearTimeout(this._uploadTimer);
    this._uploadTimer = setTimeout(async () => {
      try {
        await this.upload({ clients: DB.getClients(), sessions: DB.getSessions(), syncedAt: Date.now() });
        updateSyncStatus();
      } catch (e) { console.warn('自動同期失敗:', e); }
    }, 2000);
  },

  getLastSyncText() {
    const t = parseInt(localStorage.getItem(this.LAST_SYNC_KEY) || '0');
    if (!t) return '未同期';
    const d = new Date(t);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `今日 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
};

// ===== UI =====
function openSettings() {
  document.getElementById('settings-client-id').value = GDRIVE.getClientId();
  updateSyncStatus();
  document.getElementById('modal-settings').classList.add('open');
}

function closeSettings(e) {
  if (e && e.target !== document.getElementById('modal-settings')) return;
  document.getElementById('modal-settings').classList.remove('open');
}

function saveSettings() {
  const id = document.getElementById('settings-client-id').value.trim();
  GDRIVE.setClientId(id);
  alert('保存しました');
  updateSyncStatus();
}

async function loginGDrive() {
  const ok = await GDRIVE.login();
  if (ok) {
    updateSyncStatus();
    // ログイン直後に同期
    await GDRIVE.syncNow();
    if (typeof renderClients === 'function') renderClients();
  }
}

function logoutGDrive() {
  if (!confirm('Googleアカウントからログアウトしますか？')) return;
  GDRIVE.logout();
  updateSyncStatus();
}

async function syncNowBtn() {
  const btn = document.getElementById('btn-sync-now');
  if (btn) { btn.disabled = true; btn.textContent = '同期中...'; }
  await GDRIVE.syncNow();
  if (btn) { btn.disabled = false; btn.textContent = '今すぐ同期'; }
  if (typeof renderClients === 'function') renderClients();
}

function updateSyncStatus() {
  const indicator = document.getElementById('sync-indicator');
  const statusEl = document.getElementById('settings-sync-status');
  const loggedIn = GDRIVE.isLoggedIn();
  const configured = GDRIVE.isConfigured();
  const lastSync = GDRIVE.getLastSyncText();

  if (indicator) {
    if (!configured) indicator.textContent = '⚙ 未設定';
    else if (!loggedIn) indicator.textContent = '🔒 未ログイン';
    else indicator.textContent = `☁ ${lastSync}`;
    indicator.className = 'sync-indicator' + (loggedIn ? ' synced' : '');
  }

  if (statusEl) {
    statusEl.innerHTML = `
      <div class="sync-row"><span>設定状態</span><span>${configured ? '✓ 設定済み' : '⚠ Client ID未設定'}</span></div>
      <div class="sync-row"><span>ログイン</span><span>${loggedIn ? '✓ ログイン中' : '✗ 未ログイン'}</span></div>
      <div class="sync-row"><span>最終同期</span><span>${lastSync}</span></div>
    `;
    document.getElementById('btn-login').style.display = loggedIn ? 'none' : 'inline-block';
    document.getElementById('btn-logout').style.display = loggedIn ? 'inline-block' : 'none';
    document.getElementById('btn-sync-now').style.display = loggedIn ? 'inline-block' : 'none';
  }
}

// 初回ロード時：ログイン中なら自動同期
window.addEventListener('DOMContentLoaded', async () => {
  updateSyncStatus();
  if (GDRIVE.isLoggedIn()) {
    try {
      const remote = await GDRIVE.download();
      GDRIVE.mergeData(remote);
      if (typeof renderClients === 'function') renderClients();
      updateSyncStatus();
    } catch (e) { console.warn('初回同期スキップ:', e); }
  }
});
