// ============================================================
// APP.JS — Sistema Lavanderia Hygicare
// ============================================================

// ---------- HELPERS ----------
// URL efetiva para chamadas API — usa proxy same-origin para evitar CORS
function gasApiUrl() {
  if (window.location.protocol !== 'file:' && window.location.hostname !== 'localhost') {
    return '/api/proxy';
  }
  return CONFIG.GAS_URL; // fallback local (sem service worker)
}

function fmtDate(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('pt-BR');
}

// ---------- TOAST SYSTEM ----------
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ---------- API COUNTER ----------
const API_KEY       = 'hygicare_api_count';        // escrita
const API_KEY_READ  = 'hygicare_api_count_read';   // leitura
const API_MONTH_KEY = 'hygicare_api_month_v2';     // v2 = formato YYYY-MM

function getApiCount(type = 'write') {
  const month = new Date().toISOString().slice(0, 7); // ex: '2026-05'
  const stored = localStorage.getItem(API_MONTH_KEY);
  // Só zera se realmente mudou o mês (formato YYYY-MM)
  if (stored !== month) {
    localStorage.setItem(API_MONTH_KEY, month);
    // Migração: se tinha dados válidos no mês atual com chave antiga, preserva
    const oldMonth = localStorage.getItem('hygicare_api_month');
    const isOldFormat = oldMonth && (oldMonth.length <= 2); // formato antigo era número
    if (!isOldFormat && stored && stored.slice(0, 7) === month) {
      // mesmo mês em outro formato — não zera
    } else {
      localStorage.setItem(API_KEY,      '0');
      localStorage.setItem(API_KEY_READ, '0');
    }
  }
  return parseInt(localStorage.getItem(type === 'read' ? API_KEY_READ : API_KEY) || '0');
}

function addApiCount(n = 1, type = 'write') {
  const key   = type === 'read' ? API_KEY_READ : API_KEY;
  // Lê diretamente do localStorage para não acionar o reset do getApiCount
  const current = parseInt(localStorage.getItem(key) || '0');
  const count = current + n;
  localStorage.setItem(key, String(count));
  if (type === 'write') updateApiDisplay(count);
  return count;
}

function updateApiDisplay(count) {
  const el = document.getElementById('api-count');
  const badge = document.getElementById('api-badge');
  if (!el || !badge) return;
  el.textContent = count;
  badge.classList.remove('api-warn', 'api-alert');
  if (count >= 450) badge.classList.add('api-alert');
  else if (count >= 350) badge.classList.add('api-warn');
}

// ---------- ESTADO ----------
let currentUser = null;
const savedSession = localStorage.getItem('lavanderia_session');
if (savedSession) {
  try { currentUser = JSON.parse(savedSession); } catch (e) { localStorage.removeItem('lavanderia_session'); }
}

// Migração: garante que a chave de mês v2 existe no formato correto
// para evitar reset indevido dos contadores
(function migrateApiMonth() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (!localStorage.getItem('hygicare_api_month_v2')) {
    localStorage.setItem('hygicare_api_month_v2', currentMonth);
  }
})();

// ---------- MAIN ----------
document.addEventListener('DOMContentLoaded', async () => {

  // Service Worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    } catch (e) { console.warn('SW falhou:', e); }
  }

  // Offline indicator
  function updateOnlineStatus() {
    const banner = document.getElementById('offline-banner');
    if (banner) {
      if (!navigator.onLine) banner.classList.remove('hidden');
      else banner.classList.add('hidden');
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // DOM refs — login
  const loginScreen = document.getElementById('login-screen');
  const appMain = document.getElementById('app-main');
  const formLogin = document.getElementById('form-login');
  const loginError = document.getElementById('login-error');
  const btnLogout = document.getElementById('btn-logout');
  const userNameSpan = document.getElementById('user-name');

  // ---------- LOGIN ----------
  formLogin.addEventListener('submit', async e => {
    e.preventDefault();
    const username = formLogin.username.value.trim();
    const password = formLogin.password.value;
    const btn = document.getElementById('btn-login');

    loginError.classList.add('hidden');
    btn.textContent = '⏳ Verificando...';
    btn.disabled = true;

    let users = [...(window.USERS || [])];

    if (CONFIG.GAS_URL && !CONFIG.GAS_URL.includes('YOUR_GAS_URL')) {
      try {
        const r = await fetch(`${gasApiUrl()}?sheet=${SHEETS.USERS}`);
        if (r.ok) {
          const res = await r.json();
          const data = res.data || [];
          const sheetUsers = data.map(u => ({
            username: u.username, password: u.password,
            role: u.role || 'vendedor', name: u.name, sellerName: u.sellerName || u.name,
            active: String(u.active || '').toUpperCase() !== 'FALSE'
          })).filter(u => u.active !== false);
          sheetUsers.forEach(su => {
            const idx = users.findIndex(u => u.username === su.username);
            if (idx >= 0) users[idx] = su; else users.push(su);
          });
        }
      } catch (e) { console.warn('Fallback para usuários locais'); }
    }

    // Também consulta usuários criados pela tela (IndexedDB)
    try {
      const dbUsers = await _originalGetAll('users');
      dbUsers.forEach(du => {
        if (du.username && du.password) {
          const idx = users.findIndex(u => u.username === du.username);
          const mapped = { username: du.username, password: du.password,
            role: du.role || 'vendedor', name: du.name, sellerName: du.name, id: du.id };
          if (idx >= 0) users[idx] = mapped; else users.push(mapped);
        }
      });
    } catch(e) { console.warn('IndexedDB users fallback', e); }

    const user = users.find(u => u.username === username && u.password === password);
    btn.textContent = 'Entrar';
    btn.disabled = false;

    if (user) {
      currentUser = { username: user.username, role: user.role, name: user.name, sellerName: user.sellerName };
      localStorage.setItem('lavanderia_session', JSON.stringify(currentUser));
      // Salvar lista de usuários para o select de vendedor
      localStorage.setItem('hygicare_users', JSON.stringify(users));
      showApp();
    } else {
      loginError.textContent = '❌ Usuário ou senha incorretos';
      loginError.classList.remove('hidden');
    }
  });

  // ---------- LOGOUT ----------
  btnLogout.addEventListener('click', () => {
    if (confirm('Deseja sair do sistema?')) {
      currentUser = null;
      localStorage.removeItem('lavanderia_session');
      location.reload();
    }
  });

  function showApp() {
    loginScreen.classList.add('hidden');
    appMain.classList.remove('hidden');
    userNameSpan.textContent = `👤 ${currentUser.name}`;
    document.getElementById('header-subtitle').textContent =
      currentUser.role === 'admin' ? 'Administrador' : 'Vendedor';
    updateApiDisplay(getApiCount());
    updateSyncStatus();
    initApp();
  }

  if (currentUser) showApp();

  // ---------- SYNC STATUS ----------
  async function updateSyncStatus() {
    const lastSync = localStorage.getItem('lastSyncTime');
    const el2 = document.getElementById('last-sync-time');
    if (el2 && lastSync) {
      el2.textContent = `Última sincronização: ${new Date(lastSync).toLocaleString('pt-BR')}`;
    }
  }

  // ============================================================
  // INIT APP
  // ============================================================
  async function initApp() {

    // Aplicar configuracoes salvas no localStorage
    const savedGasUrl = localStorage.getItem('hygicare_cfg_gas_url');
    const savedSync   = localStorage.getItem('hygicare_cfg_sync_interval');
    if (savedGasUrl) CONFIG.GAS_URL = savedGasUrl;
    if (savedSync)   CONFIG.SYNC_INTERVAL_HOURS = parseInt(savedSync);

    // Carregar usuários do IndexedDB para window.USERS (login offline)
    try {
      const dbUsers = await _originalGetAll('users');
      dbUsers.forEach(du => {
        if (!du.username || !du.password) return;
        const idx = window.USERS.findIndex(u => u.username === du.username);
        const mapped = { username: du.username, password: du.password,
          role: du.role || 'vendedor', name: du.name, sellerName: du.name };
        if (idx >= 0) window.USERS[idx] = mapped; else window.USERS.push(mapped);
      });
    } catch(e) {}

    // --- NAV ---
    const screens = document.querySelectorAll('.screen');
    const navBtns = document.querySelectorAll('.nav-btn');

    function show(id) {
      screens.forEach(s => s.classList.add('hidden'));
      document.getElementById(id).classList.remove('hidden');
      navBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.screen === id || b.id === 'nav-' + id.replace('screen-', ''));
      });
    }

    // =====================================================
    // FILTRO DE DADOS POR USUÁRIO (vendedor)
    // =====================================================
    const _originalGetAll = window.getAll;

    async function dbGetAll_raw(store) {
      return await _originalGetAll(store);
    }
    window.dbGetAll_raw = dbGetAll_raw;

    if (!window._getAll_wrapped) {
      window._getAll_wrapped = true;
      window.getAll = async (store) => {
        const data = await _originalGetAll(store);
        if (!currentUser || currentUser.role === 'admin') return data;
        if (store !== 'clients') return data;
        return data.filter(c => (c.seller || '').toLowerCase() === (currentUser.sellerName || '').toLowerCase());
      };
    }

    // Mapear nav buttons
    const navMap = {
      'nav-clients':   'screen-clients',
      'nav-machines':  'screen-machines',
      'nav-processes': 'screen-processes',
      'nav-charts':    'screen-charts',
      'nav-form':      'screen-form',
      'nav-reports':   'screen-reports',
      'nav-users':     'screen-users',
      'nav-admin':     'screen-admin',
    };
    Object.entries(navMap).forEach(([btnId, screenId]) => {
      document.getElementById(btnId).addEventListener('click', async () => {
        show(screenId);
        if (screenId === 'screen-clients')   { await renderClientsList(); await refreshSellerSelect(); }
        if (screenId === 'screen-machines')  await renderMachinesList();
        if (screenId === 'screen-processes') await renderProcessesList();
        if (screenId === 'screen-charts')    { await refreshChartsFilters(); await renderCharts(); }
        if (screenId === 'screen-reports') { await refreshReportClientFilter(); await renderRecordsList(); }
        if (screenId === 'screen-users')     await renderUsersList();
        if (screenId === 'screen-admin')     { refreshAdminPanel(); testApis(); }
      });
    });

    // Mostrar botoes admin-only apenas para administradores
    if (currentUser?.role === 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }

    function refreshAdminPanel() {
      const cfgGasUrl = localStorage.getItem('hygicare_cfg_gas_url') || CONFIG.GAS_URL || '';
      const cfgSync   = localStorage.getItem('hygicare_cfg_sync_interval') || CONFIG.SYNC_INTERVAL_HOURS;
      const cfgSheets = localStorage.getItem('hygicare_cfg_sheets_url') || 'https://docs.google.com/spreadsheets/d/1t_Oo7CWfCqjGjGvSwNqFNS1M2YaCPOMt5aLiabOzMGU/edit';
      const cfgEmail  = localStorage.getItem('hygicare_cfg_notify_email') || '';
      const apiUsedWrite = parseInt(localStorage.getItem('hygicare_api_count') || '0');

      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('cfg-gas-url',      cfgGasUrl);
      set('cfg-sync-interval', cfgSync);
      set('cfg-sheets-url',   cfgSheets);
      set('cfg-notify-email', cfgEmail);

      // ID do script no card de sistema
      const gasIdEl = document.getElementById('admin-gas-id');
      if (gasIdEl) {
        const match = cfgGasUrl.match(/\/s\/([^/]+)\/exec/);
        gasIdEl.textContent = match ? match[1].slice(0, 20) + '…' : '—';
      }

      updateApiDisplay(apiUsedWrite);
    }

    // Testar conexão com o Google Apps Script
    async function testApis() {
      const dot    = document.getElementById('admin-status-dot');
      const txt    = document.getElementById('admin-status-text');
      const detail = document.getElementById('admin-status-detail');
      const btn    = document.getElementById('btn-test-apis');

      if (dot)    dot.style.background = '#f59e0b';
      if (txt)    txt.textContent      = 'Testando conexão...';
      if (detail) detail.textContent   = '';
      if (btn)    btn.disabled = true;

      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) {
        if (dot)    dot.style.background = '#dc2626';
        if (txt)    txt.textContent      = '❌ URL do Apps Script não configurada';
        if (detail) detail.textContent   = 'Cole a URL no campo abaixo e salve.';
        if (btn)    btn.disabled = false;
        return;
      }

      const t0 = Date.now();
      try {
        const r  = await fetch(`${gasApiUrl()}?sheet=${SHEETS.CLIENTS}`);
        const ms = Date.now() - t0;
        if (r.ok) {
          const res = await r.json();
          const ok  = res.status === 'ok';
          if (dot)    dot.style.background = ok ? '#16a34a' : '#f59e0b';
          if (txt)    txt.textContent      = ok ? '✅ Google Apps Script funcionando normalmente' : '⚠️ Resposta inesperada do servidor';
          if (detail) detail.textContent   = `Latência: ${ms}ms`;
        } else {
          if (dot)    dot.style.background = '#dc2626';
          if (txt)    txt.textContent      = `❌ Erro HTTP ${r.status}`;
          if (detail) detail.textContent   = `Latência: ${Date.now() - t0}ms`;
        }
      } catch (e) {
        if (dot)    dot.style.background = '#dc2626';
        if (txt)    txt.textContent      = '❌ Sem conexão com o servidor';
        if (detail) detail.textContent   = e.message;
      }

      if (btn) btn.disabled = false;
    }

    document.getElementById('btn-test-apis')?.addEventListener('click', testApis);

    document.getElementById('btn-test-email')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-test-email');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando...'; }
      try {
        const r   = await fetch(`${gasApiUrl()}?action=test-email`);
        const res = await r.json();
        toast(res.status === 'ok' ? '✅ E-mail de teste enviado!' : `❌ ${res.error || 'Erro ao enviar'}`, res.status === 'ok' ? 'success' : 'error');
      } catch (e) {
        toast('❌ Falha ao contatar o servidor', 'error');
      }
      if (btn) { btn.disabled = false; btn.textContent = '📨 Testar E-mail'; }
    });

    // Salvar configuracoes
    document.getElementById('btn-save-config').addEventListener('click', () => {
      const gasUrl      = document.getElementById('cfg-gas-url')?.value.trim()      || '';
      const sync        = document.getElementById('cfg-sync-interval')?.value.trim() || '';
      const sheets      = document.getElementById('cfg-sheets-url')?.value.trim()    || '';
      const notifyEmail = document.getElementById('cfg-notify-email')?.value.trim()  || '';

      if (gasUrl) { localStorage.setItem('hygicare_cfg_gas_url', gasUrl); CONFIG.GAS_URL = gasUrl; }
      if (sync)   { localStorage.setItem('hygicare_cfg_sync_interval', sync); CONFIG.SYNC_INTERVAL_HOURS = parseInt(sync); }
      if (sheets) localStorage.setItem('hygicare_cfg_sheets_url',    sheets);
      localStorage.setItem('hygicare_cfg_notify_email', notifyEmail);

      // Persiste e-mail de notificação na aba Config do GAS para que "Testar E-mail" funcione
      if (notifyEmail) callGAS('upsert', 'Config', { chave: 'notification_email', valor: notifyEmail });

      const msg = document.getElementById('config-saved-msg');
      if (msg) { msg.textContent = '✅ Configuracoes salvas!'; setTimeout(() => msg.textContent = '', 3000); }
      refreshAdminPanel();
      testApis();
      toast('Configuracoes salvas!', 'success');
    });

    // ---- Share modal ----
    const closeShareModal = () => {
      document.getElementById('modal-share').classList.add('hidden');
      window._shareCtx = null;
    };

    document.getElementById('share-close')?.addEventListener('click', closeShareModal);
    document.getElementById('modal-share')?.addEventListener('click', e => {
      if (e.target === document.getElementById('modal-share')) closeShareModal();
    });

    async function sendReportEmail(to) {
      if (!to) return toast('Informe o e-mail de destino', 'error');
      const ctx = window._shareCtx;
      if (!ctx) return;
      const { g } = ctx;
      const statusEl = document.getElementById('share-status');
      statusEl.textContent = '⏳ Enviando e-mail...';
      try {
        const payload = {
          action: 'sendReportEmail',
          to,
          clientName: g.clientName,
          period: g.period,
          totalKg: g.totalKg,
          totalRows: g.rows.length,
          rows: g.rows,
          senderName: 'Hygicare Lavanderia'
        };
        const r = await fetch(gasApiUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ payload: JSON.stringify(payload) })
        });
        const res = await r.json();
        if (res.status === 'ok') {
          statusEl.textContent = `✅ E-mail enviado para ${to}`;
          toast('E-mail enviado!', 'success');
        } else {
          statusEl.textContent = `❌ Erro: ${res.error || 'falha no servidor'}`;
          toast('Falha ao enviar e-mail', 'error');
        }
      } catch(e) {
        statusEl.textContent = '❌ Falha de conexão';
        toast('Falha de conexão ao enviar e-mail', 'error');
      }
    }

    document.getElementById('share-btn-client')?.addEventListener('click', () => {
      const email = document.getElementById('share-email-client').value.trim();
      sendReportEmail(email);
    });

    document.getElementById('share-btn-seller')?.addEventListener('click', () => {
      const email = document.getElementById('share-email-seller').value.trim();
      sendReportEmail(email);
    });

    document.getElementById('share-btn-wap')?.addEventListener('click', () => {
      const ctx = window._shareCtx;
      if (!ctx) return;
      const { g } = ctx;
      const msg = `Relatório Hygicare Lavanderia\nCliente: ${g.clientName}\nPeríodo: ${g.period}\nTotal: ${g.totalKg.toFixed(2)} kg · ${g.rows.length} itens`;
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
    });

    document.getElementById('share-btn-download')?.addEventListener('click', () => {
      if (window._shareCtx) window._pdfGroup(window._shareCtx.safeKey);
    });

    document.getElementById('share-btn-print')?.addEventListener('click', () => {
      if (window._shareCtx) window._printGroup(window._shareCtx.safeKey);
    });

    // Setar active inicial
    document.getElementById('nav-clients').classList.add('active');

    // --- ELEMENTOS FORM ---
    const formClientCard   = document.getElementById('form-client-card');
    const formMachineCard  = document.getElementById('form-machine-card');
    const formProcessCard  = document.getElementById('form-process-card');
    const formClient   = document.getElementById('form-client');
    const formMachine  = document.getElementById('form-machine');
    const formProcess  = document.getElementById('form-process');
    const machineClientSelect  = document.getElementById('machine-client-select');
    const processMachineSelect = document.getElementById('process-machine-select');
    const prodClientSelect     = document.getElementById('prod-client-select');
    const reportClientSelect   = document.getElementById('filter-client-records');
    const editClientIdField   = document.getElementById('edit-client-id');
    const editMachineIdField  = document.getElementById('edit-machine-id');
    const editProcessIdField  = document.getElementById('edit-process-id');

    // Abrir formulários
    document.getElementById('btn-new-client').onclick = () => {
      editClientIdField.value = '';
      document.getElementById('form-client-title').textContent = 'Novo Cliente';
      formClient.reset();
      formClientCard.classList.remove('hidden');
    };
    document.getElementById('btn-new-machine').onclick = () => {
      editMachineIdField.value = '';
      document.getElementById('form-machine-title').textContent = 'Nova Máquina';
      formMachine.reset();
      formMachineCard.classList.remove('hidden');
    };
    document.getElementById('btn-new-process').onclick = () => {
      editProcessIdField.value = '';
      document.getElementById('form-process-title').textContent = 'Novo Processo';
      formProcess.reset();
      formProcessCard.classList.remove('hidden');
    };

    // Fechar formulários
    const closePanel = (panel, form) => { panel.classList.add('hidden'); form.reset(); };
    document.getElementById('btn-close-client').onclick  = () => closePanel(formClientCard, formClient);
    document.getElementById('btn-close-machine').onclick = () => closePanel(formMachineCard, formMachine);
    document.getElementById('btn-close-process').onclick = () => closePanel(formProcessCard, formProcess);
    document.querySelectorAll('.btn-cancel-client').forEach(b => b.onclick = () => closePanel(formClientCard, formClient));
    document.querySelectorAll('.btn-cancel-machine').forEach(b => b.onclick = () => closePanel(formMachineCard, formMachine));
    document.querySelectorAll('.btn-cancel-process').forEach(b => b.onclick = () => closePanel(formProcessCard, formProcess));

    // --- SELECTS ---
    await refreshClientsSelects();

    // Sync silencioso na inicialização — preenche IndexedDB a partir do GAS
    // sem exibir diálogos de confirmação, para que dados apareçam automaticamente.
    (async () => {
      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) return;
      if (!navigator.onLine) return;
      try {
        const existingRecords = await _originalGetAll('records');
        const existingClients = await _originalGetAll('clients');
        // Só sincroniza se o IndexedDB parecer vazio (nova sessão ou cache limpo)
        if (existingRecords.length > 0 && existingClients.length > 0) return;

        const results = await Promise.allSettled(
          Object.values(SHEET_MAP).map(s =>
            fetch(`${gasApiUrl()}?sheet=${s.sheet}`)
              .then(r => r.ok ? r.json() : Promise.reject())
              .then(res => ({ store: s.store, items: res.data || [] }))
          )
        );

        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const { store, items } = r.value;
          if (store === 'users' || items.length > 0) {
            await saveToStore(store, items);
          }
        }

        localStorage.setItem('lastSyncTime', new Date().toISOString());
        await refreshClientsSelects();
        await renderClientsList();
        await renderMachinesList();
        await renderProcessesList();
        await refreshReportClientFilter();
        await renderRecordsList();
        await updateSyncStatus();
        toast('✅ Dados sincronizados automaticamente!', 'success', 3000);
        const dbUsers = await _originalGetAll('users');
        dbUsers.forEach(du => {
          if (!du.username) return;
          const idx = window.USERS.findIndex(u => u.username === du.username);
          const mapped = { username: du.username, password: du.password,
            role: du.role || 'vendedor', name: du.name, sellerName: du.sellerName || du.name };
          if (idx >= 0) window.USERS[idx] = mapped; else window.USERS.push(mapped);
        });
        localStorage.setItem('hygicare_users', JSON.stringify(dbUsers));
      } catch(e) { /* falha silenciosa — usuário pode sincronizar manualmente */ }
    })();

    // =====================================================
    // BOTÃO 🔄 ATUALIZAR — economia de API
    // =====================================================

    // Mapa de sheets individuais
    const SHEET_MAP = {
      clients:   { sheet: SHEETS.CLIENTS,   store: 'clients',   label: 'clientes'  },
      machines:  { sheet: SHEETS.MACHINES,  store: 'machines',  label: 'máquinas'  },
      processes: { sheet: SHEETS.PROCESSES, store: 'processes', label: 'processos' },
      records:   { sheet: SHEETS.RECORDS,   store: 'records',   label: 'registros' },
      users:     { sheet: SHEETS.USERS,     store: 'users',     label: 'usuários'  },
    };

    async function doRefresh(target = 'all') {
      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) {
        return toast('Configure a URL do Google Apps Script no Painel Admin!', 'warning');
      }

      const isAll = target === 'all';
      const labelTarget = isAll ? 'Todos os dados' : (SHEET_MAP[target]?.label || target);

      if (isAll && !confirm('🔄 Buscar dados atualizados do Google Sheets?')) return;

      const btn = document.getElementById('btn-refresh-data');
      btn.disabled = true;
      btn.textContent = '⏳ Buscando...';

      try {
        let sheetsToFetch = isAll ? Object.values(SHEET_MAP) : [SHEET_MAP[target]];
        const results = await Promise.allSettled(
          sheetsToFetch.map(s =>
            fetch(`${gasApiUrl()}?sheet=${s.sheet}`)
              .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
              .then(res => res.data || [])
          )
        );

        let imported = 0;
        for (let i = 0; i < sheetsToFetch.length; i++) {
          const { store, label } = sheetsToFetch[i];
          const result = results[i];
          if (result.status === 'fulfilled') {
            const items = Array.isArray(result.value) ? result.value : [];
            console.log(`📥 ${label} (${items.length} itens):`, items);
            // Para users sempre chama saveToStore para garantir remoção de excluídos
            if (store === 'users' || items.length > 0) {
              const saved = await saveToStore(store, items);
              imported += saved;
              console.log(`✅ ${saved} ${label} importados`);
            }
          } else {
            console.warn(`⚠️ Falha ao buscar ${label}:`, result.reason);
            toast(`Erro ao buscar ${label}`, 'error');
          }
        }

        localStorage.setItem('lastSyncTime', new Date().toISOString());

        // Re-renderizar telas conforme o que foi atualizado
        const updated = isAll ? Object.keys(SHEET_MAP) : [target];
        if (updated.includes('clients') || updated.includes('machines') || updated.includes('processes') || isAll) {
          await refreshClientsSelects();
          await renderClientsList();
          await renderMachinesList();
          await renderProcessesList();
          await refreshReportClientFilter();
        }
        if (updated.includes('records') || isAll) {
          await renderRecordsList();
        }
        if (updated.includes('users') || isAll) {
          const allDbUsers = await dbGetAll_raw('users');
          localStorage.setItem('hygicare_users', JSON.stringify(allDbUsers));
          // Reconstruir window.USERS do zero para refletir remoções
          window.USERS = window.USERS.filter(u => allDbUsers.some(du => du.username === u.username));
          allDbUsers.forEach(du => {
            if (!du.username) return;
            const idx = window.USERS.findIndex(u => u.username === du.username);
            const mapped = { username: du.username, password: du.password,
              role: du.role || 'vendedor', name: du.name, sellerName: du.sellerName || du.name };
            if (idx >= 0) window.USERS[idx] = mapped; else window.USERS.push(mapped);
          });
          refreshSellerSelect();
          await renderUsersList();
        }
        await updateSyncStatus();

        toast(`✅ "${labelTarget}" atualizado(s)! (${imported} registro(s))`, 'success');

      } catch (err) {
        console.error('❌ Erro no Atualizar:', err);
        const msg = err instanceof TypeError ? '❌ Sem conexão com a internet.' : `❌ Erro: ${err.message || err}`;
        toast(msg, 'error', 6000);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔄 Atualizar';
      }
    }

    // Botão principal — atualiza tudo
    document.getElementById('btn-refresh-data').addEventListener('click', () => doRefresh('all'));

    // Seta — abre/fecha dropdown
    const refreshDropdown = document.getElementById('refresh-dropdown');
    document.getElementById('btn-refresh-arrow').addEventListener('click', e => {
      e.stopPropagation();
      refreshDropdown.classList.toggle('hidden');
    });
    // Fechar ao clicar fora
    document.addEventListener('click', () => refreshDropdown.classList.add('hidden'));

    // Opções individuais
    document.querySelectorAll('.refresh-opt').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        refreshDropdown.classList.add('hidden');
        doRefresh(btn.dataset.sheet);
      });
    });

    // =====================================================
    // HELPERS DE NORMALIZAÇÃO E PERSISTÊNCIA
    // =====================================================
    function normalizeItem(item) {
      const n = { ...item };
      ['id', 'client_id', 'machine_id', 'process_id'].forEach(f => {
        if (n[f] !== undefined && n[f] !== null && n[f] !== '') {
          const num = Number(n[f]);
          if (!isNaN(num)) n[f] = num;
        }
      });
      if (typeof n.send_client === 'string') n.send_client = n.send_client === 'TRUE' || n.send_client === 'true';
      if (typeof n.send_seller === 'string') n.send_seller = n.send_seller === 'TRUE' || n.send_seller === 'true';
      if (n.capacity !== undefined && n.capacity !== '') n.capacity = parseFloat(n.capacity) || 0;
      if (n.executed !== undefined && n.executed !== '')  n.executed = parseFloat(n.executed) || 0;
      if (n.canceled !== undefined && n.canceled !== '')  n.canceled = parseFloat(n.canceled) || 0;
      if (n.total    !== undefined && n.total    !== '')  n.total    = parseFloat(n.total)    || 0;
      return n;
    }

    async function saveToStore(storeName, items) {
      // Para users: sincronização completa com a planilha
      // — atualiza existentes, adiciona novos e REMOVE os que não estão mais na planilha
      if (storeName === 'users') {
        let saved = 0;
        const existing = await _originalGetAll('users');
        const sheetUsernames = items.map(i => (i.username || '').toLowerCase()).filter(Boolean);

        // Remover locais que não estão mais na planilha
        for (const local of existing) {
          if (local.username && !sheetUsernames.includes(local.username.toLowerCase())) {
            await dbDelete('users', local.id);
            console.log(`🗑️ Usuário "${local.username}" removido (não está mais na planilha)`);
          }
        }

        // Upsert dos que vieram da planilha
        for (const item of items) {
          const n = normalizeItem(item);
          const local = existing.find(u => (u.username || '').toLowerCase() === (n.username || '').toLowerCase());
          try {
            if (local) { await dbPut('users', { ...local, ...n, id: local.id }); }
            else        { await dbAdd('users', n); }
            saved++;
          } catch (err) { console.warn('⚠️ Erro ao salvar user:', err, n); }
        }
        return saved;
      }
      await clearStore(storeName);
      let saved = 0;
      for (const item of items) {
        try { await dbPut(storeName, normalizeItem(item)); saved++; }
        catch (err) { console.warn(`⚠️ Erro ao salvar em ${storeName}:`, err, item); }
      }
      return saved;
    }

    async function callGAS(action, sheetName, data, id) {
      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) return false;
      if (!navigator.onLine) return false;
      try {
        const payload = { action, sheet: sheetName };
        if (data !== undefined && data !== null) payload.data = data;
        if (id  !== undefined) payload.id = id;
        const r = await fetch(gasApiUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ payload: JSON.stringify(payload) })
        });
        if (!r.ok) { console.warn(`GAS ${action} falhou [${r.status}]`); return false; }
        const res = await r.json();
        if (res.status !== 'ok') { console.warn('GAS error:', res.error); return false; }
        addApiCount(1, 'write');
        return res.data || true;
      } catch (e) { console.warn('callGAS error:', e); return false; }
    }

    const postToSheetDB  = (sheet, data)     => callGAS('insert', sheet, data);
    const patchSheetDB   = (sheet, id, data) => callGAS('update', sheet, data, id);
    const deleteSheetDB  = (sheet, id)       => callGAS('delete', sheet, null, id);


    // =====================================================
    formClient.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(formClient).entries());
      data.send_client = !!data.send_client;
      data.send_seller = !!data.send_seller;

      const editId = editClientIdField.value ? Number(editClientIdField.value) : null;

      try {
        let id;
        if (editId) {
          // EDITAR — preserva created_at original
          const existing = (await dbGetAll_raw('clients')).find(c => Number(c.id) === editId);
          data.id = editId;
          data.created_at = existing?.created_at || new Date().toISOString();
          await dbPut('clients', data);
          const ok = await patchSheetDB(SHEETS.CLIENTS, editId, data);
          toast(ok ? 'Cliente atualizado e sincronizado!' : 'Cliente atualizado localmente (sync pendente)', ok ? 'success' : 'warning');
          id = editId;
        } else {
          // NOVO
          data.created_at = new Date().toISOString();
          id = await dbAdd('clients', data);
          data.id = id;
          const ok = await postToSheetDB(SHEETS.CLIENTS, data);
          toast(ok ? 'Cliente salvo e sincronizado!' : 'Cliente salvo localmente (sync pendente)', ok ? 'success' : 'warning');
        }

        await refreshClientsSelects();
        await renderClientsList();
        await updateSyncStatus();
        closePanel(formClientCard, formClient);

      } catch (err) {
        console.error(err);
        toast('Erro ao salvar cliente: ' + err.message, 'error');
      }
    });

    // =====================================================
    // FORMULÁRIO — MÁQUINAS
    // =====================================================
    formMachine.addEventListener('submit', async e => {
      e.preventDefault();
      const clientId = Number(machineClientSelect.value);
      if (!clientId) return toast('Selecione um cliente', 'warning');

      const data = Object.fromEntries(new FormData(formMachine).entries());
      data.client_id   = clientId;
      data.capacity    = parseFloat(data.capacity) || 0;

      const editId = editMachineIdField.value ? Number(editMachineIdField.value) : null;

      try {
        if (editId) {
          const existing = (await dbGetAll_raw('machines')).find(m => Number(m.id) === editId);
          data.id = editId;
          data.created_at = existing?.created_at || new Date().toISOString();
          await dbPut('machines', data);
          const ok = await patchSheetDB(SHEETS.MACHINES, editId, data);
          toast(ok ? 'Máquina atualizada e sincronizada!' : 'Máquina atualizada localmente', ok ? 'success' : 'warning');
        } else {
          data.created_at = new Date().toISOString();
          const id = await dbAdd('machines', data);
          data.id = id;
          const ok = await postToSheetDB(SHEETS.MACHINES, data);
          toast(ok ? 'Máquina salva e sincronizada!' : 'Máquina salva localmente', ok ? 'success' : 'warning');
          const allClients = await dbGetAll_raw('clients');
          const c = allClients.find(c => Number(c.id) === Number(clientId));
          notifyEmail('nova_maquina', { name: data.name, clientName: c?.name || '' });
        }

        await refreshMachinesForProcessSelect();
        await renderMachinesList();
        await updateSyncStatus();
        closePanel(formMachineCard, formMachine);

      } catch (err) {
        toast('Erro ao salvar máquina: ' + err.message, 'error');
      }
    });

    // =====================================================
    // FORMULÁRIO — PROCESSOS
    // =====================================================
    formProcess.addEventListener('submit', async e => {
      e.preventDefault();
      const machineId = Number(processMachineSelect.value);
      if (!machineId) return toast('Selecione uma máquina', 'warning');

      const data = Object.fromEntries(new FormData(formProcess).entries());
      data.machine_id  = machineId;
      data.capacity    = data.capacity ? parseFloat(data.capacity) : null;

      const editId = editProcessIdField.value ? Number(editProcessIdField.value) : null;

      try {
        if (editId) {
          const existing = (await dbGetAll_raw('processes')).find(p => Number(p.id) === editId);
          data.id = editId;
          data.created_at = existing?.created_at || new Date().toISOString();
          await dbPut('processes', data);
          const ok = await patchSheetDB(SHEETS.PROCESSES, editId, data);
          toast(ok ? 'Processo atualizado e sincronizado!' : 'Processo atualizado localmente', ok ? 'success' : 'warning');
        } else {
          data.created_at = new Date().toISOString();
          const id = await dbAdd('processes', data);
          data.id = id;
          const ok = await postToSheetDB(SHEETS.PROCESSES, data);
          toast(ok ? 'Processo salvo e sincronizado!' : 'Processo salvo localmente', ok ? 'success' : 'warning');
          const allMachines = await dbGetAll_raw('machines');
          const m = allMachines.find(m => Number(m.id) === Number(machineId));
          notifyEmail('novo_processo', { name: data.name, machineName: m?.name || '' });
        }

        await renderProcessesList();
        await updateSyncStatus();
        closePanel(formProcessCard, formProcess);

      } catch (err) {
        toast('Erro ao salvar processo: ' + err.message, 'error');
      }
    });

    // =====================================================
    // EDITAR / EXCLUIR
    // =====================================================
    async function editClient(id) {
      const clients = await dbGetAll_raw('clients');
      const c = clients.find(x => x.id === id);
      if (!c) return;
      editClientIdField.value = id;
      document.getElementById('form-client-title').textContent = '✏️ Editar Cliente';
      formClient.name.value        = c.name || '';
      formClient.city.value        = c.city || '';
      formClient.seller.value      = c.seller || '';
      formClient.email_client.value = c.email_client || '';
      formClient.email_seller.value = c.email_seller || '';
      formClient.send_client.checked = !!c.send_client;
      formClient.send_seller.checked = !!c.send_seller;
      formClientCard.classList.remove('hidden');
      formClientCard.scrollIntoView({ behavior: 'smooth' });
    }

    async function deleteClient(id) {
      if (!confirm('Excluir este cliente? Todas as máquinas e processos vinculados também serão removidos.')) return;

      // Tentar GAS primeiro; se falhar, perguntar se exclui só localmente
      const gasOk = await deleteSheetDB(SHEETS.CLIENTS, id);
      if (!gasOk && navigator.onLine) {
        const forceLocal = confirm('Não foi possível excluir no Google Sheets (o registro pode não estar sincronizado).\n\nExcluir apenas localmente?');
        if (!forceLocal) return;
      }

      // Excluir localmente em cascata
      const machines = (await dbGetAll_raw('machines')).filter(m => m.client_id === id);
      for (const m of machines) {
        const processes = (await dbGetAll_raw('processes')).filter(p => p.machine_id === m.id);
        for (const p of processes) {
          await dbDelete('processes', p.id);
          if (gasOk) await deleteSheetDB(SHEETS.PROCESSES, p.id);
        }
        await dbDelete('machines', m.id);
        if (gasOk) await deleteSheetDB(SHEETS.MACHINES, m.id);
      }
      await dbDelete('clients', id);
      toast(gasOk ? 'Cliente excluído!' : 'Cliente excluído localmente (não estava no Google Sheets)', gasOk ? 'success' : 'warning');
      await refreshClientsSelects();
      await renderClientsList();
    }

    async function editMachine(id) {
      const machines = await dbGetAll_raw('machines');
      const m = machines.find(x => x.id === id);
      if (!m) return;
      editMachineIdField.value = id;
      document.getElementById('form-machine-title').textContent = '✏️ Editar Máquina';
      machineClientSelect.value    = m.client_id;
      formMachine.name.value       = m.name || '';
      formMachine.capacity.value   = m.capacity || '';
      formMachineCard.classList.remove('hidden');
      formMachineCard.scrollIntoView({ behavior: 'smooth' });
    }

    async function deleteMachine(id) {
      if (!confirm('Excluir esta máquina? Os processos vinculados também serão removidos.')) return;
      const gasOk = await deleteSheetDB(SHEETS.MACHINES, id);
      if (!gasOk && navigator.onLine) {
        const forceLocal = confirm('Não foi possível excluir no Google Sheets.\nExcluir apenas localmente?');
        if (!forceLocal) return;
      }
      const processes = (await dbGetAll_raw('processes')).filter(p => p.machine_id === id);
      for (const p of processes) {
        await dbDelete('processes', p.id);
        if (gasOk) await deleteSheetDB(SHEETS.PROCESSES, p.id);
      }
      await dbDelete('machines', id);
      toast(gasOk ? 'Máquina excluída!' : 'Máquina excluída localmente (não estava no Google Sheets)', gasOk ? 'success' : 'warning');
      await refreshMachinesForProcessSelect();
      await renderMachinesList();
    }

    async function editProcess(id) {
      const processes = await dbGetAll_raw('processes');
      const p = processes.find(x => x.id === id);
      if (!p) return;
      editProcessIdField.value = id;
      document.getElementById('form-process-title').textContent = '✏️ Editar Processo';
      processMachineSelect.value   = p.machine_id;
      formProcess.name.value       = p.name || '';
      formProcess.capacity.value   = p.capacity || '';
      formProcessCard.classList.remove('hidden');
      formProcessCard.scrollIntoView({ behavior: 'smooth' });
    }

    async function deleteProcess(id) {
      if (!confirm('Excluir este processo?')) return;
      const gasOk = await deleteSheetDB(SHEETS.PROCESSES, id);
      if (!gasOk && navigator.onLine) {
        const forceLocal = confirm('Não foi possível excluir no Google Sheets.\nExcluir apenas localmente?');
        if (!forceLocal) return;
      }
      await dbDelete('processes', id);
      toast(gasOk ? 'Processo excluído!' : 'Processo excluído localmente (não estava no Google Sheets)', gasOk ? 'success' : 'warning');
      await renderProcessesList();
    }

    // Expor para uso nos botões inline
    window._editClient   = editClient;
    window._deleteClient = deleteClient;
    window._editMachine  = editMachine;
    window._deleteMachine = deleteMachine;
    window._editProcess  = editProcess;
    window._deleteProcess = deleteProcess;

    // =====================================================
    // RENDER — CLIENTES
    // =====================================================
    async function renderClientsList(filter = '') {
      let clients = await getAll('clients');
      const countEl = document.getElementById('clients-count');
      if (countEl) countEl.textContent = clients.length;

      if (filter) {
        const f = filter.toLowerCase();
        clients = clients.filter(c =>
          (c.name || '').toLowerCase().includes(f) ||
          (c.city || '').toLowerCase().includes(f) ||
          (c.seller || '').toLowerCase().includes(f)
        );
      }

      const list = document.getElementById('clients-list');
      if (!clients.length) {
        list.innerHTML = `<div class="empty-state">📭 Nenhum cliente encontrado.<p>Clique em "+ Novo Cliente" para cadastrar ou use 🔄 Atualizar para importar do Google Sheets.</p></div>`;
        return;
      }

      list.innerHTML = clients.map(c => `
        <div class="list-item">
          <div class="list-item-content">
            <div class="list-item-name">
              👤 ${c.name}
              <span class="badge">${c.city || 'Sem cidade'}</span>
            </div>
            <div class="list-item-details">
              ${c.seller ? `<span class="detail-chip">👨‍💼 ${c.seller}</span>` : ''}
              ${c.email_client ? `<span class="detail-chip">📧 ${c.email_client}</span>` : ''}
              ${c.send_client ? `<span class="badge badge-green">✉️ Envia cliente</span>` : ''}
              ${c.send_seller ? `<span class="badge badge-green">✉️ Envia vendedor</span>` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            <button class="btn-edit" onclick="window._editClient(${c.id})">✏️ Editar</button>
            <button class="btn-danger" onclick="window._deleteClient(${c.id})">🗑️</button>
          </div>
        </div>
      `).join('');
    }

    // Busca em tempo real
    document.getElementById('search-clients').addEventListener('input', e => renderClientsList(e.target.value));

    // =====================================================
    // RENDER — MÁQUINAS
    // =====================================================
    async function renderMachinesList(filter = '', clientFilter = 0) {
      let machines = await getAll('machines');
      const clients  = await getAll('clients');
      const countEl  = document.getElementById('machines-count');
      if (countEl) countEl.textContent = machines.length;

      // Popular dropdown de clientes
      const clientSel = document.getElementById('filter-machine-client');
      if (clientSel) {
        const prev = clientSel.value;
        clientSel.innerHTML = '<option value="">Todos os clientes</option>' +
          clients.sort((a,b) => (a.name||'').localeCompare(b.name||'')).map(c =>
            `<option value="${c.id}">${c.name}</option>`).join('');
        if (prev) clientSel.value = prev;
        if (clientFilter) clientSel.value = clientFilter;
      }

      const activeClient = clientFilter || Number(clientSel?.value || 0);
      if (activeClient) {
        machines = machines.filter(m => Number(m.client_id) === activeClient);
      }

      if (filter) {
        const f = filter.toLowerCase();
        machines = machines.filter(m => {
          const client = clients.find(c => Number(c.id) === Number(m.client_id));
          return (m.name || '').toLowerCase().includes(f) ||
                 (client?.name || '').toLowerCase().includes(f);
        });
      }

      const list = document.getElementById('machines-list-cad');
      if (!machines.length) {
        list.innerHTML = `<div class="empty-state">📭 Nenhuma máquina encontrada.<p>Cadastre clientes primeiro, depois adicione máquinas.</p></div>`;
        return;
      }

      // Agrupar por cliente
      const byClient = {};
      for (const m of machines) {
        const client = clients.find(c => Number(c.id) === Number(m.client_id));
        const clientName = client?.name || 'Cliente não encontrado';
        if (!byClient[clientName]) byClient[clientName] = { client, items: [] };
        byClient[clientName].items.push(m);
      }

      list.innerHTML = Object.entries(byClient).sort((a,b) => a[0].localeCompare(b[0])).map(([clientName, { client, items }]) => `
        <div class="client-group-separator">
          <span>👤 ${clientName}</span>
          <span class="badge">${items.length} máquina(s)</span>
        </div>
        ${items.map(m => `
          <div class="list-item">
            <div class="list-item-content">
              <div class="list-item-name">
                ⚙️ ${m.name}
                <span class="badge badge-yellow">${m.capacity} kg</span>
              </div>
            </div>
            <div class="list-item-actions">
              <button class="btn-edit" onclick="window._editMachine(${m.id})">✏️ Editar</button>
              <button class="btn-danger" onclick="window._deleteMachine(${m.id})">🗑️</button>
            </div>
          </div>
        `).join('')}
      `).join('');
    }

    document.getElementById('search-machines').addEventListener('input', e => renderMachinesList(e.target.value));
    document.getElementById('filter-machine-client').addEventListener('change', e => renderMachinesList(document.getElementById('search-machines').value, Number(e.target.value)));

    // =====================================================
    // RENDER — PROCESSOS
    // =====================================================
    async function renderProcessesList(filter = '', machineFilter = 0) {
      let processes = await getAll('processes');
      const machines = await getAll('machines');
      const clients  = await getAll('clients');
      const countEl  = document.getElementById('processes-count');
      if (countEl) countEl.textContent = processes.length;

      // Popular dropdown de máquinas (agrupado por cliente)
      const machineSel = document.getElementById('filter-process-machine');
      if (machineSel) {
        const prev = machineSel.value;
        const byClientOpts = {};
        machines.sort((a,b) => (a.name||'').localeCompare(b.name||'')).forEach(m => {
          const c = clients.find(c => Number(c.id) === Number(m.client_id));
          const g = c?.name || 'Sem cliente';
          if (!byClientOpts[g]) byClientOpts[g] = [];
          byClientOpts[g].push(m);
        });
        machineSel.innerHTML = '<option value="">Todas as máquinas</option>' +
          Object.entries(byClientOpts).sort((a,b) => a[0].localeCompare(b[0])).map(([grp, ms]) =>
            `<optgroup label="${grp}">${ms.map(m => `<option value="${m.id}">⚙️ ${m.name}</option>`).join('')}</optgroup>`
          ).join('');
        if (prev) machineSel.value = prev;
        if (machineFilter) machineSel.value = machineFilter;
      }

      const activeMachine = machineFilter || Number(machineSel?.value || 0);
      if (activeMachine) {
        processes = processes.filter(p => Number(p.machine_id) === activeMachine);
      }

      if (filter) {
        const f = filter.toLowerCase();
        processes = processes.filter(p => {
          const machine = machines.find(m => Number(m.id) === Number(p.machine_id));
          return (p.name || '').toLowerCase().includes(f) ||
                 (machine?.name || '').toLowerCase().includes(f);
        });
      }

      const list = document.getElementById('processes-list-cad');
      if (!processes.length) {
        list.innerHTML = `<div class="empty-state">📭 Nenhum processo encontrado.<p>Cadastre máquinas primeiro, depois adicione processos.</p></div>`;
        return;
      }

      // Agrupar por cliente
      const byClient = {};
      for (const p of processes) {
        const machine = machines.find(m => Number(m.id) === Number(p.machine_id));
        const client  = clients.find(c => Number(c.id) === Number(machine?.client_id));
        const clientName = client?.name || 'Cliente não encontrado';
        if (!byClient[clientName]) byClient[clientName] = { items: [] };
        byClient[clientName].items.push({ p, machine });
      }

      list.innerHTML = Object.entries(byClient).sort((a,b) => a[0].localeCompare(b[0])).map(([clientName, { items }]) => `
        <div class="client-group-separator">
          <span>👤 ${clientName}</span>
          <span class="badge">${items.length} processo(s)</span>
        </div>
        ${items.map(({ p, machine }) => {
          const capStr = p.capacity ? `${p.capacity} kg` : `${machine?.capacity || 0} kg (da máquina)`;
          return `
            <div class="list-item">
              <div class="list-item-content">
                <div class="list-item-name">
                  🔄 ${p.name}
                  <span class="badge badge-yellow">${capStr}</span>
                </div>
                <div class="list-item-details">
                  <span class="detail-chip">⚙️ ${machine?.name || 'Máquina não encontrada'}</span>
                  ${p.capacity ? '' : '<span class="badge badge-gray">Cap. herdada</span>'}
                </div>
              </div>
              <div class="list-item-actions">
                <button class="btn-edit" onclick="window._editProcess(${p.id})">✏️ Editar</button>
                <button class="btn-danger" onclick="window._deleteProcess(${p.id})">🗑️</button>
              </div>
            </div>
          `;
        }).join('')}
      `).join('');
    }

    document.getElementById('search-processes').addEventListener('input', e => renderProcessesList(e.target.value));
    document.getElementById('filter-process-machine').addEventListener('change', e => renderProcessesList(document.getElementById('search-processes').value, Number(e.target.value)));

    // =====================================================
    // PRODUÇÃO
    // =====================================================
    prodClientSelect.addEventListener('change', async e => {
      await renderMachinesAndProcesses(Number(e.target.value));
    });

    async function renderMachinesAndProcesses(clientId) {
      const allMachines  = await getAll('machines');
      const machines     = allMachines.filter(m => Number(m.client_id) === Number(clientId));
      const processes    = await getAll('processes');
      const container    = document.getElementById('machines-list');
      container.innerHTML = '';

      if (!machines.length) {
        container.innerHTML = `<div class="empty-state">⚙️ Este cliente não possui máquinas cadastradas.</div>`;
        return;
      }

      for (const m of machines) {
        const procs = processes.filter(p => Number(p.machine_id) === Number(m.id));
        const block = document.createElement('div');
        block.className = 'machine-block';
        block.dataset.machineId = m.id;

        let tableRows = '';
        for (const p of procs) {
          const cap = (p.capacity && p.capacity > 0) ? p.capacity : m.capacity;
          tableRows += `
            <tr class="process-row" data-process-id="${p.id}">
              <td><strong>${p.name}</strong></td>
              <td><input name="executed" type="number" min="0" step="1" value="0" /></td>
              <td><input name="canceled" type="number" min="0" step="1" value="0" /></td>
              <td><input name="capacity" type="number" step="0.01" value="${cap}" /></td>
              <td><input name="total" type="number" step="0.01" readonly value="0" /></td>
            </tr>
          `;
        }

        if (!procs.length) {
          tableRows = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:1rem">Nenhum processo cadastrado para esta máquina</td></tr>`;
        }

        block.innerHTML = `
          <div class="machine-block-header">
            <span>⚙️</span>
            <h4>${m.name} — ${m.capacity} kg</h4>
          </div>
          <div class="machine-block-body">
            <table class="proc-table">
              <thead>
                <tr>
                  <th>Processo</th>
                  <th>Executados</th>
                  <th>Cancelados</th>
                  <th>Cap. (kg)</th>
                  <th>Total (kg)</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        `;

        container.appendChild(block);

        // Auto-calcular total
        block.querySelectorAll('.process-row').forEach(row => {
          ['executed', 'canceled', 'capacity'].forEach(name => {
            row.querySelector(`[name="${name}"]`).addEventListener('input', () => {
              const ex = parseFloat(row.querySelector('[name="executed"]').value || 0);
              const ca = parseFloat(row.querySelector('[name="canceled"]').value || 0);
              const cp = parseFloat(row.querySelector('[name="capacity"]').value || 0);
              row.querySelector('[name="total"]').value = ((ex + ca) * cp).toFixed(2);
            });
          });
        });
      }
    }

    document.getElementById('save-production').addEventListener('click', async () => {
      const clientId = Number(prodClientSelect.value);
      if (!clientId) return toast('Selecione um cliente', 'warning');
      const dateStart = document.getElementById('prod-date-start').value;
      const dateEnd   = document.getElementById('prod-date-end').value;
      if (!dateStart || !dateEnd) return toast('Preencha as datas do período', 'warning');

      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) {
        return toast('Configure a URL do Google Apps Script no Painel Admin!', 'warning');
      }

      const rows = [];
      document.querySelectorAll('.machine-block').forEach(block => {
        const machineId = Number(block.dataset.machineId);
        block.querySelectorAll('.process-row').forEach(row => {
          const procId   = Number(row.dataset.processId);
          const executed = parseFloat(row.querySelector('[name="executed"]').value || 0);
          const canceled = parseFloat(row.querySelector('[name="canceled"]').value || 0);
          const capacity = parseFloat(row.querySelector('[name="capacity"]').value || 0);
          const total    = parseFloat(row.querySelector('[name="total"]').value || 0);
          if (executed > 0 || canceled > 0) {
            rows.push({ client_id: clientId, machine_id: machineId, process_id: procId, executed, canceled, capacity, total, date_start: dateStart, date_end: dateEnd, created_at: new Date().toISOString(), synced_at: new Date().toISOString() });
          }
        });
      });

      if (!rows.length) return toast('Nenhum dado preenchido para salvar', 'warning');

      const btn = document.getElementById('save-production');
      btn.disabled = true;
      btn.textContent = '⏳ Enviando...';

      try {
        let synced = 0;
        for (const r of rows) {
          const newId   = await dbAdd('records', r);
          const rWithId = { ...r, id: newId };
          await dbPut('records', rWithId);

          const ok = await callGAS('insert', SHEETS.RECORDS, rWithId);
          if (ok) {
            synced++;
          } else {
            await dbDelete('records', newId);
            toast(`Erro ao enviar registro ${synced + 1}. Verifique a conexão e tente novamente.`, 'error', 7000);
            return;
          }
        }

        localStorage.setItem('lastSyncTime', new Date().toISOString());
        await updateSyncStatus();
        await renderRecordsList();

        const allClients = await dbGetAll_raw('clients');
        const c = allClients.find(c => Number(c.id) === clientId);
        notifyEmail('novo_relatorio', { clientName: c?.name || `#${clientId}`, period: `${dateStart} → ${dateEnd}` });

        toast(`✅ ${synced} registro(s) enviados para o Google Sheets com sucesso!`, 'success', 5000);

        document.getElementById('prod-client-select').value = '';
        document.getElementById('prod-date-start').value = '';
        document.getElementById('prod-date-end').value = '';
        document.getElementById('machines-list').innerHTML = '';

      } catch (err) {
        console.error('❌ Erro ao salvar produção:', err);
        toast('❌ Sem conexão com a internet. Estabeleça conexão e tente novamente.', 'error', 7000);
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Salvar';
      }
    });

    // =====================================================
    // SELECTS
    // =====================================================
    async function refreshClientsSelects() {
      const clients = await getAll('clients');
      [machineClientSelect, prodClientSelect].forEach(sel => {
        const val = sel.value;
        sel.innerHTML = '<option value="">-- Selecione um cliente --</option>';
        clients.forEach(c => {
          const o = document.createElement('option');
          o.value = c.id;
          o.textContent = `${c.name} (${c.city || ''})`;
          sel.appendChild(o);
        });
        if (val) sel.value = val;
      });
      await refreshSellerSelect();
      await refreshMachinesForProcessSelect();
    }

    // Popula o select de vendedor com usuários do tipo vendedor
    async function refreshSellerSelect() {
      // Lê do IndexedDB (fonte de verdade após Atualizar)
      let users = await _originalGetAll('users');
      // Fallback: localStorage
      if (!users.length) users = JSON.parse(localStorage.getItem('hygicare_users') || '[]');

      // Atualiza o select de vendedor no form de clientes
      const sel = document.getElementById('client-seller-select');
      if (sel) {
        const val = sel.value;
        sel.innerHTML = '<option value="">-- Selecione --</option>';
        users.forEach(u => {
          const name = u.name || u.username;
          const o = document.createElement('option');
          o.value = name;
          o.textContent = `${name} (${u.role || 'vendedor'})`;
          sel.appendChild(o);
        });
        if (val) sel.value = val;
      }

      // Atualiza também o select de vendedor nos filtros de gráficos
      const selChart = document.getElementById('chart-filter-seller');
      if (selChart) {
        const val = selChart.value;
        selChart.innerHTML = '<option value="">Todos os vendedores</option>';
        users.forEach(u => {
          const name = u.name || u.username;
          const o = document.createElement('option');
          o.value = name;
          o.textContent = name;
          selChart.appendChild(o);
        });
        if (val) selChart.value = val;
      }
    }

    async function refreshMachinesForProcessSelect() {
      const machines = await getAll('machines');
      const clients  = await getAll('clients');
      const val = processMachineSelect.value;
      processMachineSelect.innerHTML = '<option value="">-- Selecione uma máquina --</option>';
      machines.forEach(m => {
        const client = clients.find(c => Number(c.id) === Number(m.client_id));
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = `${m.name} [${m.capacity} kg] — ${client?.name || 'Cliente'}`;
        processMachineSelect.appendChild(o);
      });
      if (val) processMachineSelect.value = val;
    }

    // =====================================================
    // DELETE helper (não estava no db.js, vamos usar dbPut/IndexedDB direto)
    // =====================================================
    async function dbDelete(store, id) {
      const db = await openDB();
      return new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        const s  = tx.objectStore(store);
        const r  = s.delete(id);
        r.onsuccess = () => res();
        r.onerror   = e => rej(e.target.error);
      });
    }
    window.dbDelete = dbDelete;

    // =====================================================
    // RELATÓRIO — FILTROS
    // =====================================================
    function getReportFilters() {
      return {
        text:      (document.getElementById('search-records')?.value      || '').toLowerCase(),
        clientId:  Number(document.getElementById('filter-client-records')?.value || 0),
        dateStart: document.getElementById('filter-date-start')?.value || '',
        dateEnd:   document.getElementById('filter-date-end')?.value   || '',
      };
    }

    function applyFilters() { renderRecordsList(getReportFilters()); }

    document.getElementById('search-records')     .addEventListener('input',  applyFilters);
    document.getElementById('filter-client-records').addEventListener('change', applyFilters);
    document.getElementById('filter-date-start')  .addEventListener('change', applyFilters);
    document.getElementById('filter-date-end')    .addEventListener('change', applyFilters);
    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      document.getElementById('search-records').value = '';
      document.getElementById('filter-client-records').value = '';
      document.getElementById('filter-date-start').value = '';
      document.getElementById('filter-date-end').value = '';
      renderRecordsList({});
    });

    // Popular select de clientes nos filtros
    async function refreshReportClientFilter() {
      const clients = await dbGetAll_raw('clients');
      const sel = document.getElementById('filter-client-records');
      const val = sel.value;
      sel.innerHTML = '<option value="">Todos os clientes</option>';
      clients.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = `${c.name} (${c.city || ''})`;
        sel.appendChild(o);
      });
      if (val) sel.value = val;
    }

    // =====================================================
    // RENDER — HISTÓRICO DE REGISTROS
    // =====================================================
    async function renderRecordsList(filters = {}) {
      const { text = '', clientId = 0, dateStart = '', dateEnd = '' } =
        typeof filters === 'string' ? { text: filters } : filters;

      const records   = await dbGetAll_raw('records');
      const clients   = await dbGetAll_raw('clients');
      const machines  = await dbGetAll_raw('machines');
      const processes = await dbGetAll_raw('processes');

      const countEl = document.getElementById('records-count');
      if (countEl) countEl.textContent = records.length;

      const list = document.getElementById('records-list');
      if (!list) return;

      if (!records.length) {
        list.innerHTML = `<div class="empty-state">📭 Nenhum registro encontrado.<p>Clique em <strong>🔄 Atualizar</strong> para buscar dados do Google Sheets, ou salve produções pelo formulário.</p></div>`;
        return;
      }

      // Agrupar por cliente + período
      const grouped = {};
      for (const r of records) {
        const client  = clients.find(c  => Number(c.id)  === Number(r.client_id));
        const machine = machines.find(m => Number(m.id)  === Number(r.machine_id));
        const process = processes.find(p => Number(p.id) === Number(r.process_id));

        const clientName  = client?.name  || `Cliente #${r.client_id}`;
        const machineName = machine?.name || `Máquina #${r.machine_id}`;
        const procName    = process?.name || `Processo #${r.process_id}`;
        const period      = `${fmtDate(r.date_start)} → ${fmtDate(r.date_end)}`;

        // Data de criação: usa synced_at, created_at ou date_start como fallback
        const rawDate = r.synced_at || r.created_at || r.date_start || '';
        let createdMonth = 'Sem data';
        if (rawDate) {
          const d = new Date(rawDate);
          if (!isNaN(d)) {
            createdMonth = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            // Capitalizar
            createdMonth = createdMonth.charAt(0).toUpperCase() + createdMonth.slice(1);
          }
        }
        // Chave de ordenação para o mês
        const monthSortKey = rawDate ? rawDate.slice(0, 7) : '0000-00';

        const key = `${clientName}|||${period}`;
        if (!grouped[key]) grouped[key] = { clientName, clientId: Number(r.client_id), period, createdMonth, monthSortKey, rows: [], totalKg: 0 };
        grouped[key].rows.push({ machineName, procName, executed: r.executed || 0, canceled: r.canceled || 0, capacity: r.capacity || 0, total: r.total || 0 });
        grouped[key].totalKg += parseFloat(r.total || 0);
      }

      // Filtrar
      let entries = Object.entries(grouped);
      if (text) {
        entries = entries.filter(([key, g]) =>
          g.clientName.toLowerCase().includes(text) ||
          g.rows.some(row => row.machineName.toLowerCase().includes(text) || row.procName.toLowerCase().includes(text))
        );
      }
      if (clientId) {
        entries = entries.filter(([key, g]) => {
          const client = clients.find(c => Number(c.id) === clientId);
          return client && g.clientName === client.name;
        });
      }
      if (dateStart || dateEnd) {
        entries = entries.filter(([key, g]) => {
          const [ds] = g.period.split(' → ');
          if (dateStart && ds < dateStart) return false;
          if (dateEnd   && ds > dateEnd)   return false;
          return true;
        });
      }

      if (!entries.length) {
        list.innerHTML = `<div class="empty-state">🔍 Nenhum registro encontrado para este filtro.</div>`;
        return;
      }

      // Ordenar do mais recente para o mais antigo
      entries.sort((a, b) => b[1].monthSortKey.localeCompare(a[1].monthSortKey) || b[1].period.localeCompare(a[1].period));

      // Guardar dados para uso nos botões PDF/Imprimir
      window._recordGroups = {};

      // Agrupar entradas por mês de criação
      const byMonth = {};
      for (const entry of entries) {
        const m = entry[1].createdMonth || 'Sem data';
        if (!byMonth[m]) byMonth[m] = { sortKey: entry[1].monthSortKey, items: [] };
        byMonth[m].items.push(entry);
      }

      // Ordenar meses do mais recente para o mais antigo
      const monthEntries = Object.entries(byMonth).sort((a, b) => b[1].sortKey.localeCompare(a[1].sortKey));

      list.innerHTML = monthEntries.map(([month, { items }]) => {
        const groupsHtml = items.map(([key, g]) => {
          const safeKey = btoa(unescape(encodeURIComponent(key))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
          window._recordGroups[safeKey] = g;

        const rowsHtml = g.rows.map(row => `
          <tr>
            <td>${row.machineName}</td>
            <td>${row.procName}</td>
            <td style="text-align:center">${row.executed}</td>
            <td style="text-align:center">${row.canceled}</td>
            <td style="text-align:center">${row.capacity} kg</td>
            <td class="total-cell" style="text-align:right">${parseFloat(row.total).toFixed(2)} kg</td>
          </tr>
        `).join('');

        return `
          <div class="records-group">
            <div class="records-group-header" onclick="event.target.closest('.btn-record-action') || this.nextElementSibling.classList.toggle('open')">
              <div class="records-group-title">
                👤 ${g.clientName}
                <span class="badge" style="font-size:0.72rem">${g.period}</span>
              </div>
              <div class="records-group-meta">
                <span class="badge badge-green">Total: ${g.totalKg.toFixed(2)} kg</span>
                <span class="badge badge-gray">${g.rows.length} linha(s)</span>
                <button class="btn-record-action" style="background:#16a34a;color:#fff" onclick="window._shareGroup('${safeKey}')" title="Compartilhar / Enviar relatório">📤 Enviar</button>
                <button class="btn-record-action" style="background:var(--warning);color:#fff" onclick="window._editRecord('${safeKey}')" title="Editar registro">✏️ Editar</button>
                ${currentUser?.role === 'admin' ? `<button class="btn-record-action" style="background:var(--danger);color:#fff" onclick="window._deleteRecord('${safeKey}')" title="Excluir registro">🗑️ Excluir</button>` : ''}
                <span style="font-size:0.8rem;color:var(--muted)">▼</span>
              </div>
            </div>
            <div class="records-group-body">
              <table class="records-table">
                <thead>
                  <tr>
                    <th>Máquina</th>
                    <th>Processo</th>
                    <th style="text-align:center">Exec.</th>
                    <th style="text-align:center">Cancel.</th>
                    <th style="text-align:center">Cap.</th>
                    <th style="text-align:right">Total</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            </div>
          </div>
        `;
        }).join('');

        return `
          <div class="month-separator">
            <span>📅 ${month}</span>
          </div>
          ${groupsHtml}
        `;
      }).join('');

      // ---- Imprimir um grupo ----
      window._printGroup = function(safeKey) {
        const g = window._recordGroups[safeKey];
        if (!g) return;
        const html = buildGroupHtml(g);
        const win = window.open('', '_blank', 'width=900,height=700');
        if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
        win.document.write(`
          <!DOCTYPE html><html lang="pt-BR"><head>
          <meta charset="utf-8"/>
          <title>Relatório — ${g.clientName}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 2rem; color: #0f172a; }
            h1 { color: #1e40af; font-size: 1.4rem; margin-bottom: 0.3rem; }
            .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 1.5rem; }
            table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
            th { background: #eff6ff; padding: 0.5rem 0.8rem; text-align: left; font-size: 0.78rem; text-transform: uppercase; border-bottom: 2px solid #bfdbfe; }
            td { padding: 0.5rem 0.8rem; border-bottom: 1px solid #f1f5f9; font-size: 0.88rem; }
            .total-row td { font-weight: 700; background: #f0fdf4; color: #065f46; border-top: 2px solid #a7f3d0; }
            .right { text-align: right; }
            .center { text-align: center; }
            @media print { body { padding: 0; } }
          </style></head><body>
          ${html}
          <script>window.onload=()=>{window.print();}<\/script>
          </body></html>
        `);
        win.document.close();
      };

      // ---- Gerar PDF de um grupo ----
      window._pdfGroup = function(safeKey) {
        const g = window._recordGroups[safeKey];
        if (!g) return;
        try {
          const doc = new jspdf.jsPDF('p', 'mm', 'a4');
          const W = 210, margin = 15;

          // Header
          doc.setFillColor(37, 99, 235);
          doc.rect(0, 0, W, 20, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFontSize(13); doc.setFont(undefined, 'bold');
          doc.text('HYGICARE LAVANDERIA', margin, 13);
          doc.setFontSize(9); doc.setFont(undefined, 'normal');
          doc.text('Relatório de Produção', W - margin, 13, { align: 'right' });

          let y = 30;
          doc.setTextColor(15, 23, 42);
          doc.setFontSize(12); doc.setFont(undefined, 'bold');
          doc.text(`Cliente: ${g.clientName}`, margin, y); y += 7;
          doc.setFontSize(9); doc.setFont(undefined, 'normal');
          doc.setTextColor(71, 85, 105);
          doc.text(`Período: ${g.period}`, margin, y); y += 7;
          doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, margin, y); y += 10;

          // Cabeçalho tabela
          doc.setFillColor(239, 246, 255);
          doc.rect(margin, y - 5, W - margin * 2, 8, 'F');
          doc.setTextColor(30, 64, 175);
          doc.setFontSize(8); doc.setFont(undefined, 'bold');
          const cols = [margin, 60, 100, 125, 150, 172];
          const headers = ['Máquina', 'Processo', 'Exec.', 'Cancel.', 'Cap.(kg)', 'Total(kg)'];
          headers.forEach((h, i) => doc.text(h, cols[i], y));
          y += 7;

          doc.setFont(undefined, 'normal');
          doc.setTextColor(15, 23, 42);
          let totalGeral = 0;
          g.rows.forEach(row => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.setDrawColor(241, 245, 249);
            doc.line(margin, y + 2, W - margin, y + 2);
            doc.text(String(row.machineName).substring(0, 22), cols[0], y);
            doc.text(String(row.procName).substring(0, 20), cols[1], y);
            doc.text(String(row.executed), cols[2], y);
            doc.text(String(row.canceled), cols[3], y);
            doc.text(String(row.capacity), cols[4], y);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(5, 150, 105);
            doc.text(parseFloat(row.total).toFixed(2), cols[5], y);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(15, 23, 42);
            totalGeral += parseFloat(row.total);
            y += 7;
          });

          // Total geral
          y += 3;
          doc.setFillColor(240, 253, 244);
          doc.rect(margin, y - 4, W - margin * 2, 9, 'F');
          doc.setFont(undefined, 'bold');
          doc.setFontSize(10);
          doc.setTextColor(5, 150, 105);
          doc.text(`TOTAL GERAL: ${totalGeral.toFixed(2)} kg`, W - margin, y + 1, { align: 'right' });

          const fileName = `relatorio_${g.clientName.replace(/\s+/g, '_')}_${g.period.replace(/[→\s]/g, '-').replace(/-+/g, '-')}.pdf`;
          doc.save(fileName);
          toast('PDF baixado com sucesso!', 'success');
        } catch(e) {
          console.error(e);
          toast('Erro ao gerar PDF: ' + e.message, 'error');
        }
      };

      // ---- Compartilhar relatório ----
      window._shareGroup = async function(safeKey) {
        const g = window._recordGroups?.[safeKey];
        if (!g) return toast('Relatório não encontrado', 'error');

        window._shareCtx = { g, safeKey };

        // Preenche emails do cliente (busca por id direto para tolerar nome gerado como "Cliente #22")
        const clients = await dbGetAll_raw('clients');
        const client  = clients.find(c => Number(c.id) === Number(g.clientId)) ||
                        clients.find(c => c.name === g.clientName);
        document.getElementById('share-meta').textContent =
          `${g.clientName} · ${g.period} · ${g.totalKg.toFixed(2)} kg`;
        document.getElementById('share-email-client').value = client?.email_client || '';
        document.getElementById('share-email-seller').value = client?.email_seller || '';
        document.getElementById('share-status').textContent = '';
        document.getElementById('modal-share').classList.remove('hidden');
      };

      function buildGroupHtml(g) {
        const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const rows = g.rows.map(r => `
          <tr>
            <td>${esc(r.machineName)}</td>
            <td>${esc(r.procName)}</td>
            <td class="center">${esc(r.executed)}</td>
            <td class="center">${esc(r.canceled)}</td>
            <td class="center">${esc(r.capacity)} kg</td>
            <td class="right"><strong>${parseFloat(r.total).toFixed(2)} kg</strong></td>
          </tr>
        `).join('');
        return `
          <h1>🧺 Hygicare Lavanderia — Relatório de Produção</h1>
          <div class="meta">
            <strong>Cliente:</strong> ${esc(g.clientName)} &nbsp;|&nbsp;
            <strong>Período:</strong> ${esc(g.period)} &nbsp;|&nbsp;
            <strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR')}
          </div>
          <table>
            <thead>
              <tr><th>Máquina</th><th>Processo</th><th class="center">Exec.</th><th class="center">Cancel.</th><th class="center">Cap.</th><th class="right">Total</th></tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr class="total-row">
                <td colspan="5"><strong>TOTAL GERAL</strong></td>
                <td class="right"><strong>${g.totalKg.toFixed(2)} kg</strong></td>
              </tr>
            </tfoot>
          </table>
        `;
      }
    }


    async function generatePdf(clientId, start, end) {
      const clients   = await dbGetAll_raw('clients');
      const machines  = await dbGetAll_raw('machines');
      const processes = await dbGetAll_raw('processes');
      let   records   = await dbGetAll_raw('records');

      const client = clients.find(c => c.id === clientId);
      if (!client) return toast('Cliente não encontrado', 'error');

      // Filtrar por período
      if (start) records = records.filter(r => !r.date_start || r.date_start >= start);
      if (end)   records = records.filter(r => !r.date_end   || r.date_end   <= end);
      records = records.filter(r => r.client_id === clientId);

      const clientMachines = machines.filter(m => Number(m.client_id) === Number(clientId));
      if (!clientMachines.length) return toast('Este cliente não possui máquinas cadastradas', 'warning');

      const doc = new jspdf.jsPDF('p', 'mm', 'a4');
      const W = 210, margin = 15;
      let firstPage = true;

      for (const machine of clientMachines) {
        if (!firstPage) doc.addPage();
        firstPage = false;

        const procs = processes.filter(p => Number(p.machine_id) === Number(machine.id));
        const recs  = records.filter(r => Number(r.machine_id) === Number(machine.id));
        const rows  = procs.map(p => {
          const recs2    = records.filter(r => Number(r.process_id) === Number(p.id));
          const executed = recs2.reduce((s, x) => s + (x.executed || 0), 0);
          const canceled = recs2.reduce((s, x) => s + (x.canceled || 0), 0);
          const capacity = (p.capacity && p.capacity > 0) ? p.capacity : machine.capacity;
          const total    = recs2.reduce((s, x) => s + (x.total || 0), 0);
          return { name: p.name, executed, canceled, capacity, total };
        });

        // Header PDF
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, W, 20, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(14); doc.setFont(undefined, 'bold');
        doc.text('HYGICARE LAVANDERIA', margin, 13);
        doc.setFontSize(9); doc.setFont(undefined, 'normal');
        doc.text('Sistema de Gestão de Produção', W - margin, 13, { align: 'right' });

        doc.setTextColor(15, 23, 42);
        let y = 30;
        doc.setFontSize(11); doc.setFont(undefined, 'bold');
        doc.text(`Cliente: ${client.name}`, margin, y); y += 7;
        doc.setFontSize(9); doc.setFont(undefined, 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(`Cidade: ${client.city || '-'}  |  Vendedor: ${client.seller || '-'}`, margin, y); y += 5;
        doc.text(`Período: ${start || 'Todos'} a ${end || 'Todos'}`, margin, y); y += 5;
        doc.text(`Máquina: ${machine.name} — Capacidade: ${machine.capacity} kg`, margin, y); y += 8;

        // Tabela
        doc.setTextColor(15, 23, 42);
        const cols = [margin, 80, 105, 130, 160];
        doc.setFillColor(241, 245, 249);
        doc.rect(margin, y - 4, W - margin * 2, 8, 'F');
        doc.setFontSize(8); doc.setFont(undefined, 'bold');
        ['Processo', 'Exec.', 'Cancel.', 'Cap.(kg)', 'Total(kg)'].forEach((h, i) => doc.text(h, cols[i], y));
        y += 6;
        doc.setFont(undefined, 'normal');

        let totalGeral = 0;
        rows.forEach(r => {
          if (y > 270) { doc.addPage(); y = 20; }
          doc.text(String(r.name).substring(0, 30), cols[0], y);
          doc.text(String(r.executed), cols[1], y);
          doc.text(String(r.canceled), cols[2], y);
          doc.text(String(r.capacity), cols[3], y);
          doc.text(r.total.toFixed(2), cols[4], y);
          totalGeral += r.total;
          y += 6;
        });

        y += 2;
        doc.setFont(undefined, 'bold');
        doc.text(`TOTAL GERAL: ${totalGeral.toFixed(2)} kg`, W - margin, y, { align: 'right' });

        // Gráfico pizza
        if (rows.some(r => r.total > 0)) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 300; canvas.height = 300;
            const ctx = canvas.getContext('2d');
            const colors = ['#2563eb','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'];
            new Chart(ctx, {
              type: 'pie',
              data: {
                labels: rows.map(r => r.name),
                datasets: [{ data: rows.map(r => r.total || 0), backgroundColor: colors }]
              },
              options: { animation: false, plugins: { legend: { position: 'bottom' } } }
            });
            await new Promise(r => setTimeout(r, 600));
            const img = canvas.toDataURL('image/png');
            doc.addImage(img, 'PNG', W / 2, y + 5, 80, 60);
          } catch (e) { console.warn('Chart error:', e); }
        }
      }

      doc.save(`relatorio_${client.name.replace(/\s+/g,'_')}_${start || 'geral'}.pdf`);
      toast('PDF gerado com sucesso!', 'success');
    }

    // =====================================================
    // RENDER INICIAL
    // =====================================================
    await renderClientsList();
    await renderRecordsList();

    // =====================================================
    // GRAFICOS
    // =====================================================
    let _charts = {};

    async function refreshChartsFilters() {
      const clients = await dbGetAll_raw('clients');

      // Populate client filter
      const sel = document.getElementById('chart-filter-client');
      if (sel) {
        sel.innerHTML = '<option value="">Todos os clientes</option>';
        clients.sort((a,b) => (a.name||'').localeCompare(b.name||'')).forEach(c => {
          sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
        });
      }

      // Populate seller filter: combina usuários cadastrados + vendedores já usados nos clientes
      const selSeller = document.getElementById('chart-filter-seller');
      if (selSeller) {
        const users = await _originalGetAll('users');
        const fromUsers  = users.map(u => u.name || u.username).filter(Boolean);
        const fromClients = clients.map(c => c.seller).filter(Boolean);
        const allSellers = [...new Set([...fromUsers, ...fromClients])].sort();
        selSeller.innerHTML = '<option value="">Todos os vendedores</option>';
        allSellers.forEach(s => selSeller.innerHTML += `<option value="${s}">${s}</option>`);
      }
    }

    async function renderCharts() {
      let records   = await dbGetAll_raw('records');
      const clients   = await dbGetAll_raw('clients');
      const machines  = await dbGetAll_raw('machines');

      // Ler filtros
      const filterStart  = document.getElementById('chart-filter-start')?.value  || '';
      const filterEnd    = document.getElementById('chart-filter-end')?.value    || '';
      const filterClient = document.getElementById('chart-filter-client')?.value || '';
      const filterSeller = document.getElementById('chart-filter-seller')?.value || '';

      // Aplicar filtros
      if (filterClient) records = records.filter(r => Number(r.client_id) === Number(filterClient));
      if (filterSeller) records = records.filter(r => {
        const c = clients.find(c => Number(c.id) === Number(r.client_id));
        return c?.seller === filterSeller;
      });
      if (filterStart || filterEnd) {
        records = records.filter(r => {
          const raw = r.synced_at || r.created_at || r.date_start || '';
          const m = raw.slice(0,7);
          if (filterStart && m < filterStart) return false;
          if (filterEnd   && m > filterEnd)   return false;
          return true;
        });
      }

      // Destruir gráficos anteriores e RECRIAR os canvas
      // (evita bug do Chart.js ao reutilizar canvas após destroy)
      Object.values(_charts).forEach(c => c.destroy());
      _charts = {};
      ['chart-kg-cliente','chart-por-mes','chart-kg-maquina','chart-por-vendedor'].forEach(id => {
        const old = document.getElementById(id);
        if (old) {
          const newCanvas = document.createElement('canvas');
          newCanvas.id = id;
          newCanvas.height = 220;
          old.replaceWith(newCanvas);
        }
      });

      const colors = ['#2563eb','#16a34a','#dc2626','#f59e0b','#7c3aed','#0891b2','#be185d','#ea580c'];

      if (!records.length) {
        ['chart-kg-cliente','chart-por-mes','chart-kg-maquina','chart-por-vendedor'].forEach(id => {
          const ctx = document.getElementById(id);
          if (ctx) ctx.insertAdjacentHTML('afterend',
            `<p id="no-data-${id}" style="text-align:center;color:#94a3b8;padding:2rem 0;margin:0">📭 Sem dados para os filtros selecionados</p>`);
        });
        return;
      }

      // 1. kg por cliente
      const kgCliente = {};
      for (const r of records) {
        const c = clients.find(c => Number(c.id) === Number(r.client_id));
        const name = c?.name || `#${r.client_id}`;
        kgCliente[name] = (kgCliente[name] || 0) + parseFloat(r.total || 0);
      }
      const sortedClientes = Object.entries(kgCliente).sort((a,b) => b[1]-a[1]).slice(0,10);
      const ctxC = document.getElementById('chart-kg-cliente');
      if (ctxC) _charts.kgCliente = new Chart(ctxC, {
        type: 'bar',
        data: { labels: sortedClientes.map(e=>e[0]), datasets: [{ label: 'Total kg', data: sortedClientes.map(e=>+e[1].toFixed(2)), backgroundColor: colors }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });

      // 2. Registros por mês
      const porMes = {};
      for (const r of records) {
        const d = new Date(r.synced_at || r.created_at || r.date_start || '');
        if (!isNaN(d)) {
          const key = d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
          const sortKey = d.toISOString().slice(0,7);
          if (!porMes[key]) porMes[key] = { sort: sortKey, count: 0, kg: 0 };
          porMes[key].count++;
          porMes[key].kg += parseFloat(r.total || 0);
        }
      }
      const mesSorted = Object.entries(porMes).sort((a,b) => a[1].sort.localeCompare(b[1].sort));
      const ctxM = document.getElementById('chart-por-mes');
      if (ctxM) _charts.porMes = new Chart(ctxM, {
        type: 'line',
        data: {
          labels: mesSorted.map(e=>e[0]),
          datasets: [
            { label: 'Registros', data: mesSorted.map(e=>e[1].count), borderColor: '#2563eb', backgroundColor: '#dbeafe', fill: true, tension: 0.3 },
            { label: 'Total kg',  data: mesSorted.map(e=>+e[1].kg.toFixed(2)), borderColor: '#16a34a', backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y2' }
          ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true }, y2: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } }
      });

      // 3. kg por máquina top 8
      const kgMaquina = {};
      for (const r of records) {
        const m = machines.find(m => Number(m.id) === Number(r.machine_id));
        const name = m?.name || `#${r.machine_id}`;
        kgMaquina[name] = (kgMaquina[name] || 0) + parseFloat(r.total || 0);
      }
      const sortedMaq = Object.entries(kgMaquina).sort((a,b) => b[1]-a[1]).slice(0,8);
      const ctxMaq = document.getElementById('chart-kg-maquina');
      if (ctxMaq) _charts.kgMaquina = new Chart(ctxMaq, {
        type: 'doughnut',
        data: { labels: sortedMaq.map(e=>e[0]), datasets: [{ data: sortedMaq.map(e=>+e[1].toFixed(2)), backgroundColor: colors }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });

      // 4. Registros por vendedor
      const porVendedor = {};
      for (const r of records) {
        const c = clients.find(c => Number(c.id) === Number(r.client_id));
        const seller = c?.seller || 'Sem vendedor';
        porVendedor[seller] = (porVendedor[seller] || 0) + 1;
      }
      const ctxV = document.getElementById('chart-por-vendedor');
      if (ctxV) _charts.porVendedor = new Chart(ctxV, {
        type: 'pie',
        data: { labels: Object.keys(porVendedor), datasets: [{ data: Object.values(porVendedor), backgroundColor: colors }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });
    }

    // Botões de filtro dos gráficos
    document.getElementById('btn-apply-charts')?.addEventListener('click', () => renderCharts());
    document.getElementById('btn-clear-charts')?.addEventListener('click', () => {
      ['chart-filter-start','chart-filter-end','chart-filter-client','chart-filter-seller']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      renderCharts();
    });

    // =====================================================
    // GERENCIAR USUARIOS (admin)
    // =====================================================
    async function renderUsersList(filter = '') {
      const users = await dbGetAll_raw('users');
      const countEl = document.getElementById('users-count');
      if (countEl) countEl.textContent = users.length;
      const list = document.getElementById('users-list');
      if (!list) return;

      const q = filter.toLowerCase();
      const filtered = q ? users.filter(u =>
        (u.name||'').toLowerCase().includes(q) ||
        (u.username||'').toLowerCase().includes(q) ||
        (u.role||'').toLowerCase().includes(q)
      ) : users;

      if (!filtered.length) {
        list.innerHTML = '<div class="empty-state">👤 Nenhum usuário encontrado.</div>';
        return;
      }
      list.innerHTML = filtered.map(u => `
        <div class="list-item">
          <div class="list-item-info">
            <div class="list-item-name">
              ${u.name || u.username}
              <span class="user-chip-role ${u.role === 'admin' ? 'role-admin' : 'role-vendedor'}">${u.role || 'vendedor'}</span>
            </div>
            <div class="list-item-meta">
              👤 ${u.username}${u.email ? ` · 📧 ${u.email}` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            <button class="btn-edit" onclick="window._editUser(${u.id})">✏️ Editar</button>
            ${u.username !== currentUser?.username
              ? `<button class="btn-delete" onclick="window._deleteUser(${u.id}, '${u.username}')">🗑️</button>`
              : '<span style="font-size:0.75rem;color:#94a3b8">(você)</span>'}
          </div>
        </div>
      `).join('');
    }

    document.getElementById('search-users')?.addEventListener('input', e =>
      renderUsersList(e.target.value));

    // Abrir modal novo usuário
    document.getElementById('btn-new-user')?.addEventListener('click', () => {
      document.getElementById('edit-user-id').value = '';
      document.getElementById('modal-user-title').textContent = '👤 Novo Usuário';
      document.getElementById('form-user').reset();
      document.getElementById('user-password').required = true;
      document.getElementById('modal-user').classList.remove('hidden');
    });
    document.getElementById('modal-user-close')?.addEventListener('click', () =>
      document.getElementById('modal-user').classList.add('hidden'));
    document.getElementById('modal-user-cancel')?.addEventListener('click', () =>
      document.getElementById('modal-user').classList.add('hidden'));

    // Editar usuário
    window._editUser = async function(id) {
      const users = await dbGetAll_raw('users');
      const u = users.find(u => Number(u.id) === Number(id));
      if (!u) return;
      document.getElementById('edit-user-id').value = u.id;
      document.getElementById('modal-user-title').textContent = '✏️ Editar Usuário';
      document.getElementById('user-name').value     = u.name || '';
      document.getElementById('user-username').value = u.username || '';
      document.getElementById('user-role').value     = u.role || 'vendedor';
      document.getElementById('user-email').value    = u.email || '';
      document.getElementById('user-password').value = '';
      document.getElementById('user-password').required = false;
      document.getElementById('modal-user').classList.remove('hidden');
    };

    // Excluir usuário
    window._deleteUser = async function(id, username) {
      if (!confirm(`Excluir o usuário "${username}"? Esta ação não pode ser desfeita.`)) return;
      await dbDelete('users', id);
      const ok = await deleteSheetDB(SHEETS.USERS, id);
      toast(ok ? 'Usuário excluído!' : 'Usuário excluído localmente', ok ? 'success' : 'warning');
      await renderUsersList();
      refreshSellerSelect();
    };

    // Salvar usuário (criar/editar)
    document.getElementById('form-user')?.addEventListener('submit', async e => {
      e.preventDefault();
      const editId = document.getElementById('edit-user-id').value;
      const name     = document.getElementById('user-name').value.trim();
      const username = document.getElementById('user-username').value.trim().toLowerCase();
      const role     = document.getElementById('user-role').value;
      const email    = document.getElementById('user-email').value.trim();
      const password = document.getElementById('user-password').value;

      if (!name || !username) return toast('Preencha nome e usuário', 'warning');

      // Verificar duplicata de username
      const allUsers = await dbGetAll_raw('users');
      const dup = allUsers.find(u => u.username === username && Number(u.id) !== Number(editId));
      if (dup) return toast(`Usuário "${username}" já existe`, 'error');

      if (editId) {
        const existing = allUsers.find(u => Number(u.id) === Number(editId));
        const updated = { ...existing, name, username, role, email, sellerName: name };
        if (password) updated.password = password;
        await dbPut('users', updated);
        // PATCH no SheetDB (atualiza a linha pelo id)
        const ok = await patchSheetDB(SHEETS.USERS, updated.id, updated);
        toast(ok ? 'Usuário atualizado e sincronizado!' : 'Usuário atualizado localmente', ok ? 'success' : 'warning');
      } else {
        if (!password) return toast('Informe uma senha', 'warning');
        const data = { name, username, password, role, email, active: 'TRUE', sellerName: name, created_at: new Date().toISOString() };
        const id = await dbAdd('users', data);
        data.id = id;
        await postToSheetDB(SHEETS.USERS, data);
        toast('Usuário criado!', 'success');
      }

      document.getElementById('modal-user').classList.add('hidden');
      await renderUsersList();
      refreshSellerSelect();
      // Atualiza cache local de usuários
      const updatedList = await dbGetAll_raw('users');
      localStorage.setItem('hygicare_users', JSON.stringify(updatedList));
      // Sincroniza window.USERS para login offline imediato
      updatedList.forEach(du => {
        if (!du.username) return;
        const idx = window.USERS.findIndex(u => u.username === du.username);
        const mapped = { username: du.username, password: du.password,
          role: du.role || 'vendedor', name: du.name, sellerName: du.name };
        if (idx >= 0) window.USERS[idx] = mapped; else window.USERS.push(mapped);
      });
    });

    // =====================================================
    // EDITAR / EXCLUIR REGISTROS
    // =====================================================
    window._editRecord = async function(safeKey) {
      const g = window._recordGroups?.[safeKey];
      if (!g) return toast('Registro não encontrado', 'error');
      document.getElementById('edit-record-key').value = safeKey;
      const [ds, de] = (g.period || '').split(' → ');
      document.getElementById('edit-record-date-start').value = ds?.trim() || '';
      document.getElementById('edit-record-date-end').value   = de?.trim() || '';
      // Montar linhas editáveis
      document.getElementById('edit-record-rows').innerHTML = g.rows.map((row, i) => `
        <div class="form-row" style="background:#f8fafc;border-radius:8px;padding:0.6rem;margin-bottom:0.4rem">
          <div class="form-field" style="flex:2"><label>Máquina/Processo</label>
            <input readonly value="${row.machineName} / ${row.procName}" style="background:#e2e8f0" /></div>
          <div class="form-field"><label>Executados</label><input type="number" id="edit-row-exec-${i}" value="${row.executed}" /></div>
          <div class="form-field"><label>Cancelados</label><input type="number" id="edit-row-canc-${i}" value="${row.canceled}" /></div>
        </div>
      `).join('');
      document.getElementById('modal-edit-record').classList.remove('hidden');
    };

    window._deleteRecord = async function(safeKey) {
      if (currentUser?.role !== 'admin') return toast('Apenas administradores podem excluir registros', 'warning');
      if (!confirm('Excluir este grupo de registros? Esta ação não pode ser desfeita.')) return;
      const g = window._recordGroups?.[safeKey];
      if (!g) return;
      const all = await dbGetAll_raw('records');
      const [ds, de] = (g.period || '').split(' → ');

      const toDelete = all.filter(r =>
        Number(r.client_id) === Number(g.clientId) &&
        fmtDate(r.date_start) === ds &&
        fmtDate(r.date_end)   === de
      );

      if (!toDelete.length) return toast('Nenhum registro encontrado para excluir', 'warning');

      let sheetOk = 0;
      for (const r of toDelete) {
        await dbDelete('records', r.id);
        const ok = await deleteSheetDB(SHEETS.RECORDS, r.id);
        if (ok) sheetOk++;
      }
      const syncMsg = sheetOk === toDelete.length ? '✅ excluídos localmente e na planilha' : `⚠️ ${sheetOk}/${toDelete.length} removidos da planilha (restantes só local)`;
      toast(`${toDelete.length} registro(s) ${syncMsg}`, sheetOk === toDelete.length ? 'success' : 'warning', 5000);
      await renderRecordsList();
    };

    // Fechar modal
    document.getElementById('modal-edit-record-close').addEventListener('click', () =>
      document.getElementById('modal-edit-record').classList.add('hidden'));
    document.getElementById('modal-edit-record-cancel').addEventListener('click', () =>
      document.getElementById('modal-edit-record').classList.add('hidden'));

    // Salvar edição
    document.getElementById('form-edit-record').addEventListener('submit', async e => {
      e.preventDefault();
      const safeKey = document.getElementById('edit-record-key').value;
      const g = window._recordGroups?.[safeKey];
      if (!g) return;
      const newDs = document.getElementById('edit-record-date-start').value;
      const newDe = document.getElementById('edit-record-date-end').value;
      const all = await dbGetAll_raw('records');
      const [ds, de] = (g.period || '').split(' → ');

      const btn = document.getElementById('form-edit-record').querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }

      let i = 0;
      let patchOk = 0;
      const toEdit = all.filter(r =>
        Number(r.client_id) === Number(g.clientId) &&
        fmtDate(r.date_start) === ds &&
        fmtDate(r.date_end)   === de
      );

      for (const r of toEdit) {
        const exec  = parseFloat(document.getElementById(`edit-row-exec-${i}`)?.value ?? r.executed);
        const canc  = parseFloat(document.getElementById(`edit-row-canc-${i}`)?.value ?? r.canceled);
        const cap   = parseFloat(r.capacity || 0);
        const total = (exec + canc) * cap;   // mesma fórmula do save-production
        const updated = { ...r, date_start: newDs, date_end: newDe, executed: exec, canceled: canc, total };
        await dbPut('records', updated);
        const ok = await patchSheetDB(SHEETS.RECORDS, r.id, updated);
        if (ok) patchOk++;
        i++;
      }

      if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar Edição'; }

      const syncMsg = patchOk === toEdit.length
        ? '✅ Registro atualizado e sincronizado!'
        : `⚠️ Atualizado localmente (${patchOk}/${toEdit.length} sincronizados na planilha)`;
      document.getElementById('modal-edit-record').classList.add('hidden');
      toast(syncMsg, patchOk === toEdit.length ? 'success' : 'warning', 5000);
      await renderRecordsList();
      notifyEmail('edicao_registro', { clientName: g.clientName, period: `${newDs} → ${newDe}` });
    });

    // =====================================================
    // NOTIFICAÇÃO POR E-MAIL (mailto)
    // =====================================================
    function notifyEmail(tipo, dados = {}) {
      const adminEmail = localStorage.getItem('hygicare_cfg_notify_email') || '';
      if (!adminEmail) return; // sem e-mail configurado, não exibe nada
      let subject = '', body = '';
      if (tipo === 'edicao_registro') {
        subject = `[Hygicare] Registro editado — ${dados.clientName}`;
        body = `Olá,\n\nUm registro foi editado no sistema.\n\nCliente: ${dados.clientName}\nPeríodo: ${dados.period}\nUsuário: ${currentUser?.name}\nData: ${new Date().toLocaleString('pt-BR')}\n\nAcesse o sistema para mais detalhes.`;
      } else if (tipo === 'novo_relatorio') {
        subject = `[Hygicare] Novo relatório gerado — ${dados.clientName}`;
        body = `Olá,\n\nUm novo relatório foi gerado.\n\nCliente: ${dados.clientName}\nPeríodo: ${dados.period}\nUsuário: ${currentUser?.name}\nData: ${new Date().toLocaleString('pt-BR')}`;
      } else if (tipo === 'nova_maquina') {
        subject = `[Hygicare] Nova máquina cadastrada — ${dados.name}`;
        body = `Olá,\n\nUma nova máquina foi cadastrada.\n\nMáquina: ${dados.name}\nCliente: ${dados.clientName}\nUsuário: ${currentUser?.name}\nData: ${new Date().toLocaleString('pt-BR')}`;
      } else if (tipo === 'novo_processo') {
        subject = `[Hygicare] Novo processo cadastrado — ${dados.name}`;
        body = `Olá,\n\nUm novo processo foi cadastrado.\n\nProcesso: ${dados.name}\nMáquina: ${dados.machineName}\nUsuário: ${currentUser?.name}\nData: ${new Date().toLocaleString('pt-BR')}`;
      }
      if (!subject) return;
      // Mostrar toast com link mailto
      const mailto = `mailto:${adminEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      const id = 'email-toast-' + Date.now();
      const container = document.getElementById('toast-container');
      const el = document.createElement('div');
      el.className = 'toast toast-info';
      el.id = id;
      el.innerHTML = `📧 <strong>Notificar por e-mail?</strong> <a href="${mailto}" style="color:#fff;text-decoration:underline;margin-left:8px" target="_blank">Abrir e-mail</a> <button onclick="document.getElementById('${id}').remove()" style="margin-left:8px;background:none;border:none;color:#fff;cursor:pointer;font-size:1rem">✕</button>`;
      container.appendChild(el);
      setTimeout(() => el.remove(), 12000);
    }
    window.notifyEmail = notifyEmail;

  } // fim initApp()

}); // fim DOMContentLoaded
