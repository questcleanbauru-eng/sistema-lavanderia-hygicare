// ============================================================
// APP.JS — Sistema Lavanderia Hygicare
// ============================================================

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

// ---------- STATUS DA API (GAS — sem limite de requisições) ----------
function updateApiDisplay() {
  const gasUrl = localStorage.getItem('hygicare_cfg_gas_url') || CONFIG.GAS_URL || '';
  const badge  = document.getElementById('api-badge');
  if (!badge) return;
  const configured = gasUrl && !gasUrl.includes('YOUR_GAS_URL');
  badge.textContent = configured ? '🟢 GAS Conectado' : '🔴 GAS não configurado';
  badge.classList.remove('api-warn', 'api-alert');
  if (!configured) badge.classList.add('api-alert');
}
// Stubs de compatibilidade (não fazem nada — GAS é gratuito/ilimitado)
function getApiCount()    { return 0; }
function addApiCount()    { return 0; }

// ---------- ESTADO ----------
let currentUser = null;
const savedSession = localStorage.getItem('lavanderia_session');
if (savedSession) {
  try { currentUser = JSON.parse(savedSession); } catch (e) { localStorage.removeItem('lavanderia_session'); }
}

// ---------- MAIN ----------
document.addEventListener('DOMContentLoaded', async () => {

  // Mostrar/ocultar senha no login
  document.getElementById('btn-toggle-pw')?.addEventListener('click', () => {
    const inp = document.getElementById('login-password');
    const btn = document.getElementById('btn-toggle-pw');
    if (inp.type === 'password') { inp.type = 'text';     btn.textContent = '🙈'; }
    else                         { inp.type = 'password'; btn.textContent = '👁️'; }
  });

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

    // Buscar usuários do Google Apps Script (GAS)
    const gasUrl = localStorage.getItem('hygicare_cfg_gas_url') || CONFIG.GAS_URL || '';
    if (gasUrl && !gasUrl.includes('YOUR_GAS_URL')) {
      try {
        const r = await fetch(`${gasUrl}?sheet=${SHEETS.USERS}`);
        if (r.ok) {
          const resp = await r.json();
          const data = Array.isArray(resp) ? resp : (resp.data || []);
          const sheetUsers = data.map(u => ({
            username: u.username, password: u.password,
            role: u.role || 'vendedor', name: u.name, sellerName: u.sellerName || u.name,
            // active vazio ou ausente = ativo; só bloqueia se explicitamente 'FALSE'
            active: String(u.active || '').toUpperCase() !== 'FALSE'
          })).filter(u => u.active !== false);
          // Mesclar: GAS sobrescreve locais pelo username
          sheetUsers.forEach(su => {
            const idx = users.findIndex(u => u.username === su.username);
            if (idx >= 0) users[idx] = su; else users.push(su);
          });
        }
      } catch (e) { console.warn('Fallback para usuários locais (GAS offline)'); }
    }

    // Também consulta usuários criados pela tela (IndexedDB)
    try {
      const dbUsers = await window.getAll('users');
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
    updateApiDisplay();
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
    const savedGas = localStorage.getItem('hygicare_cfg_gas_url');
    const savedSync = localStorage.getItem('hygicare_cfg_sync_interval');
    if (savedGas)  CONFIG.GAS_URL = savedGas;
    if (savedSync) CONFIG.SYNC_INTERVAL_HOURS = parseInt(savedSync);

    // Atualiza badge no header
    updateApiDisplay();

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
      const cfgGas    = localStorage.getItem('hygicare_cfg_gas_url')      || CONFIG.GAS_URL || '';
      const cfgSync   = localStorage.getItem('hygicare_cfg_sync_interval') || CONFIG.SYNC_INTERVAL_HOURS;
      const cfgSheets = localStorage.getItem('hygicare_cfg_sheets_url')    || 'https://docs.google.com/spreadsheets/d/1t_Oo7CWfCqjGjGvSwNqFNS1M2YaCPOMt5aLiabOzMGU/edit';
      const cfgEmail  = localStorage.getItem('hygicare_cfg_notify_email')  || '';

      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      set('cfg-gas-url',     cfgGas);
      set('cfg-sync-interval', cfgSync);
      set('cfg-sheets-url',  cfgSheets);
      set('cfg-notify-email', cfgEmail);

      // Mostra domínio do GAS no card de sistema
      const gasIdEl = document.getElementById('admin-gas-id');
      if (gasIdEl) {
        try { gasIdEl.textContent = cfgGas ? new URL(cfgGas).pathname.split('/')[4] || '—' : '—'; }
        catch { gasIdEl.textContent = cfgGas ? cfgGas.slice(-20) : '—'; }
      }

      updateApiDisplay();

      // Link da planilha
      const sheetsBtn = document.getElementById('admin-sheets-link');
      if (sheetsBtn) {
        sheetsBtn.onclick = () => {
          const url = localStorage.getItem('hygicare_cfg_sheets_url') || 'https://docs.google.com/spreadsheets/d/1t_Oo7CWfCqjGjGvSwNqFNS1M2YaCPOMt5aLiabOzMGU/edit';
          const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        };
      }
    }

    // Testar Google Apps Script e exibir status
    async function testApis() {
      const dot    = document.getElementById('admin-status-dot');
      const txt    = document.getElementById('admin-status-text');
      const detail = document.getElementById('admin-status-detail');
      const btn    = document.getElementById('btn-test-apis');

      if (dot)  dot.style.background = '#f59e0b';
      if (txt)  txt.textContent      = 'Testando Apps Script...';
      if (detail) detail.textContent = '';
      if (btn)  btn.disabled = true;

      const gasUrl = localStorage.getItem('hygicare_cfg_gas_url') || CONFIG.GAS_URL || '';
      if (!gasUrl || gasUrl.includes('YOUR_GAS_URL')) {
        if (dot) dot.style.background = '#dc2626';
        if (txt) txt.textContent = '❌ URL do Apps Script não configurada';
        if (btn) btn.disabled = false;
        return;
      }

      const t0 = Date.now();
      try {
        const r = await fetch(`${gasUrl}?sheet=${SHEETS.CLIENTS}`);
        const ms = Date.now() - t0;
        if (r.ok) {
          if (dot) dot.style.background = '#16a34a';
          if (txt) txt.textContent = `✅ Apps Script funcionando normalmente`;
          if (detail) detail.textContent = `Resposta em ${ms}ms · Sem limites de requisições`;
        } else {
          if (dot) dot.style.background = '#dc2626';
          if (txt) txt.textContent = `❌ Erro HTTP ${r.status}`;
          if (detail) detail.textContent = `Verifique se a URL está correta e o script está implantado`;
        }
      } catch (e) {
        if (dot) dot.style.background = '#dc2626';
        if (txt) txt.textContent = '❌ Sem conexão com o Apps Script';
        if (detail) detail.textContent = String(e);
      }
      updateApiDisplay();
      if (btn) btn.disabled = false;
    }

    document.getElementById('btn-test-apis')?.addEventListener('click', testApis);

    // Salvar configuracoes
    document.getElementById('btn-save-config').addEventListener('click', () => {
      const gas    = document.getElementById('cfg-gas-url')?.value.trim() || '';
      const sync   = document.getElementById('cfg-sync-interval').value.trim();
      const sheets = document.getElementById('cfg-sheets-url').value.trim();
      const notifyEmail = document.getElementById('cfg-notify-email')?.value.trim() || '';
      const priceKg = document.getElementById('cfg-price-kg')?.value.trim() || '';

      if (gas)    { localStorage.setItem('hygicare_cfg_gas_url', gas); CONFIG.GAS_URL = gas; }
      if (sync)   { localStorage.setItem('hygicare_cfg_sync_interval', sync); CONFIG.SYNC_INTERVAL_HOURS = parseInt(sync); }
      if (sheets)   localStorage.setItem('hygicare_cfg_sheets_url', sheets);
      localStorage.setItem('hygicare_cfg_notify_email', notifyEmail);
      if (priceKg !== '') localStorage.setItem('hygicare_cfg_price_kg', priceKg);

      const msg = document.getElementById('config-saved-msg');
      if (msg) { msg.textContent = '✅ Configuracoes salvas!'; setTimeout(() => msg.textContent = '', 3000); }
      refreshAdminPanel();
      testApis();
      toast('Configuracoes salvas!', 'success');
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
      const gasUrl = localStorage.getItem('hygicare_cfg_gas_url') || CONFIG.GAS_URL || '';
      if (!gasUrl || gasUrl.includes('YOUR_GAS_URL')) {
        return toast('Configure a URL do Google Apps Script no Painel Admin primeiro!', 'warning');
      }

      const isAll = target === 'all';
      const labelTarget = isAll ? 'todas as abas' : SHEET_MAP[target]?.label || target;

      const btn = document.getElementById('btn-refresh-data');
      btn.disabled = true;
      btn.textContent = '⏳ Buscando...';
      if (!isAll) toast(`🔄 Buscando "${labelTarget}"...`, 'info', 1500);

      try {
        let imported = 0;

        if (isAll) {
          // 1 única chamada busca TUDO — muito mais rápido que SheetDB (que fazia 5 chamadas)
          const r = await fetch(`${gasUrl}?sheet=all`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const resp = await r.json();
          const allData = resp.data || resp;

          for (const { sheet, store, label } of Object.values(SHEET_MAP)) {
            const items = Array.isArray(allData[sheet]) ? allData[sheet] : [];
            console.log(`📥 ${label} (${items.length} itens)`);
            if (store === 'users' || items.length > 0) {
              const saved = await saveToStore(store, items);
              imported += saved;
            }
          }
        } else {
          // Aba individual
          const { sheet, store, label } = SHEET_MAP[target];
          const r = await fetch(`${gasUrl}?sheet=${sheet}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const resp = await r.json();
          const items = Array.isArray(resp) ? resp : (resp.data || []);
          console.log(`📥 ${label} (${items.length} itens)`);
          const saved = await saveToStore(store, items);
          imported += saved;
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
        updateApiDisplay();

        toast(`✅ "${labelTarget}" atualizado(s)! (${imported} registro(s))`, 'success');

      } catch (err) {
        console.error('❌ Erro no Atualizar:', err);
        toast('❌ Sem conexão ou erro no Apps Script. Verifique e tente novamente.', 'error', 6000);
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
      if (n.price_kg !== undefined && n.price_kg !== '')  n.price_kg = parseFloat(n.price_kg) || 0;
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

    // ── Helpers de comunicação com o Google Apps Script ──────────────
    function _gasUrl() {
      return localStorage.getItem('hygicare_cfg_gas_url') || CONFIG.GAS_URL || '';
    }
    function _gasOk() {
      const u = _gasUrl();
      return u && !u.includes('YOUR_GAS_URL');
    }
    async function _gasPost(body) {
      const r = await fetch(_gasUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (r.ok) { updateApiDisplay(); return true; }
      console.warn(`⚠️ GAS falhou [${r.status}]:`, await r.text());
      return false;
    }

    // Inserir nova linha na planilha
    async function postToSheetDB(sheetName, data) {
      if (!_gasOk() || !navigator.onLine) return false;
      try { return await _gasPost({ action: 'insert', sheet: sheetName, data }); }
      catch (e) { console.warn('postToSheetDB error:', e); return false; }
    }

    // Atualizar linha existente na planilha
    async function patchSheetDB(sheetName, id, data) {
      if (!_gasOk() || !navigator.onLine) return false;
      try { return await _gasPost({ action: 'update', sheet: sheetName, id, data }); }
      catch (e) { console.warn('patchSheetDB error:', e); return false; }
    }

    // Excluir linha da planilha
    async function deleteSheetDB(sheetName, id) {
      if (!_gasOk() || !navigator.onLine) return false;
      try { return await _gasPost({ action: 'delete', sheet: sheetName, id }); }
      catch (e) { console.warn('deleteSheetDB error:', e); return false; }
    }


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
      formClient.price_kg.value     = c.price_kg != null && c.price_kg !== '' ? c.price_kg : '';
      formClient.send_client.checked = !!c.send_client;
      formClient.send_seller.checked = !!c.send_seller;
      formClientCard.classList.remove('hidden');
      formClientCard.scrollIntoView({ behavior: 'smooth' });
    }

    async function deleteClient(id) {
      if (!confirm('Excluir este cliente? Todas as máquinas e processos vinculados também serão removidos.')) return;
      const machines = (await dbGetAll_raw('machines')).filter(m => m.client_id === id);
      for (const m of machines) {
        const processes = (await dbGetAll_raw('processes')).filter(p => p.machine_id === m.id);
        for (const p of processes) {
          await dbDelete('processes', p.id);
          await deleteSheetDB(SHEETS.PROCESSES, p.id);
        }
        await dbDelete('machines', m.id);
        await deleteSheetDB(SHEETS.MACHINES, m.id);
      }
      await dbDelete('clients', id);
      const ok = await deleteSheetDB(SHEETS.CLIENTS, id);
      toast(ok ? 'Cliente excluído!' : 'Cliente excluído localmente (verifique o Google Sheets)', ok ? 'success' : 'warning');
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
      const processes = (await dbGetAll_raw('processes')).filter(p => p.machine_id === id);
      for (const p of processes) {
        await dbDelete('processes', p.id);
        await deleteSheetDB(SHEETS.PROCESSES, p.id);
      }
      await dbDelete('machines', id);
      const ok = await deleteSheetDB(SHEETS.MACHINES, id);
      toast(ok ? 'Máquina excluída!' : 'Máquina excluída localmente', ok ? 'success' : 'warning');
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
      await dbDelete('processes', id);
      const ok = await deleteSheetDB(SHEETS.PROCESSES, id);
      toast(ok ? 'Processo excluído!' : 'Processo excluído localmente', ok ? 'success' : 'warning');
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
              ${c.price_kg > 0 ? `<span class="badge badge-yellow">💰 R$ ${parseFloat(c.price_kg).toFixed(2)}/kg</span>` : ''}
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

      if (!_gasOk()) {
        return toast('Configure a URL do Apps Script no Painel Admin primeiro!', 'warning');
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

      const usedWrite = parseInt(localStorage.getItem(API_KEY) || '0');
      const cfgLimitW = parseInt(localStorage.getItem('hygicare_cfg_api_limit') || '500');
      const remaining = cfgLimitW - usedWrite;
      if (remaining < rows.length) {
        return toast(`Limite da API de escrita insuficiente. Disponível: ${remaining}, necessário: ${rows.length}`, 'error');
      }

      const btn = document.getElementById('save-production');
      btn.disabled = true;
      btn.textContent = '⏳ Enviando...';

      try {
        let synced = 0;
        for (const r of rows) {
          // Primeiro salva local para obter o id gerado
          const newId = await dbAdd('records', r);
          const rWithId = { ...r, id: newId };
          // Atualiza local com id
          await dbPut('records', rWithId);

          const res = await fetch(_gasUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'insert', sheet: SHEETS.RECORDS, data: rWithId })
          });
          if (res.ok) {
            synced++;
          } else {
            // Falhou no GAS — remove o registro local para não duplicar
            await dbDelete('records', newId);
            const errText = await res.text();
            console.error(`❌ GAS POST falhou [${res.status}]:`, errText);
            toast(`Erro ao enviar registro ${synced + 1}: ${res.status}. Verifique a conexão e tente novamente.`, 'error', 7000);
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

        // Limpar formulário
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
        list.innerHTML = `<div class="empty-state">📭 Nenhum registro sincronizado ainda.<p>Salve e sincronize produções para vê-las aqui.</p></div>`;
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
        const period      = `${r.date_start || '?'} → ${r.date_end || '?'}`;

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
        if (!grouped[key]) grouped[key] = { clientName, period, createdMonth, monthSortKey, priceKg: parseFloat(client?.price_kg || 0), rows: [], totalKg: 0 };
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
                <button class="btn-record-action btn-print" onclick="window._printGroup('${safeKey}')" title="Imprimir relatório">🖨️ Imprimir</button>
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

    }

    // ---- Função compartilhada: gera HTML do relatório ----
    async function _buildReportHtml(g, mode) {
        // mode: 'print' (auto-abre dialog) | 'pdf' (mostra botão salvar)

        // Agrupa linhas por máquina
        const byMachine = {};
        g.rows.forEach(row => {
          if (!byMachine[row.machineName]) byMachine[row.machineName] = [];
          byMachine[row.machineName].push(row);
        });

        const COLORS = ['#2563eb','#ef4444','#10b981','#f59e0b','#8b5cf6','#06b6d4','#f97316','#e11d48'];

        // Gera canvas de gráfico donut para cada máquina
        async function makeChartImg(labels, data, colors) {
          return new Promise(resolve => {
            const canvas = document.createElement('canvas');
            canvas.width = 320; canvas.height = 240;
            canvas.style.position = 'fixed';
            canvas.style.left = '-9999px';
            document.body.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            const total = data.reduce((s, v) => s + v, 0);
            const percentPlugin = {
              id: 'percentLabels',
              afterDraw(chart) {
                const { ctx: c2 } = chart;
                chart.data.datasets.forEach((dataset, di) => {
                  chart.getDatasetMeta(di).data.forEach((arc, index) => {
                    const value = dataset.data[index];
                    const pct = total > 0 ? ((value / total) * 100) : 0;
                    if (pct < 4) return;
                    const { x, y } = arc.tooltipPosition();
                    c2.save();
                    c2.fillStyle = '#fff';
                    c2.font = 'bold 10px Arial';
                    c2.textAlign = 'center';
                    c2.textBaseline = 'middle';
                    c2.shadowColor = 'rgba(0,0,0,0.5)';
                    c2.shadowBlur = 3;
                    c2.fillText(pct.toFixed(0) + '%', x, y);
                    c2.restore();
                  });
                });
              }
            };
            const chart = new Chart(ctx, {
              type: 'doughnut',
              data: { labels, datasets: [{ data, backgroundColor: colors }] },
              plugins: [percentPlugin],
              options: {
                responsive: false,
                animation: {
                  duration: 400,
                  onComplete: () => {
                    const img = canvas.toDataURL('image/png');
                    chart.destroy();
                    document.body.removeChild(canvas);
                    resolve(img);
                  }
                },
                plugins: {
                  legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 14 } },
                  tooltip: { enabled: false }
                },
                cutout: '50%'
              }
            });
          });
        }

        // Monta seções de cada máquina
        const machineNames = Object.keys(byMachine);
        const machineSections = [];
        for (let i = 0; i < machineNames.length; i++) {
          const mName = machineNames[i];
          const rows  = byMachine[mName];
          const totalKgMaq = rows.reduce((s, r) => s + parseFloat(r.total||0), 0);
          const labels = rows.map(r => r.procName);
          const data   = rows.map(r => parseFloat(r.total||0));
          const colors = COLORS.slice(0, rows.length);
          const chartImg = await makeChartImg(labels, data, colors);

          const rowsHtml = rows.map(r => `
            <tr>
              <td>${r.procName}</td>
              <td class="c">${r.executed}</td>
              <td class="c">${r.canceled}</td>
              <td class="r">${parseFloat(r.total).toFixed(0)} kg</td>
            </tr>`).join('');

          machineSections.push(`
            <div class="section">
              <div class="section-title">${i+1}ª MÁQUINA — ${mName.toUpperCase()}</div>
              <div class="section-body">
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>Total de processos</th><th class="c">Exec.</th><th class="c">Cancelados</th><th class="r">Total</th></tr></thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot><tr class="foot"><td colspan="3"><strong>Total em KG</strong></td><td class="r"><strong>${totalKgMaq.toFixed(0)} kg</strong></td></tr></tfoot>
                  </table>
                </div>
                <div class="chart-wrap">
                  <img src="${chartImg}" style="width:100%;max-width:280px" />
                </div>
              </div>
            </div>
          `);
        }

        // Total geral
        const totalData     = machineNames.map(m => byMachine[m].reduce((s,r) => s + parseFloat(r.total||0), 0));
        const totalChartImg = await makeChartImg(machineNames, totalData, COLORS.slice(0, machineNames.length));
        const grandTotal    = totalData.reduce((s,v) => s+v, 0);

        const allProcTotals = {};
        g.rows.forEach(r => { allProcTotals[r.procName] = (allProcTotals[r.procName]||0) + parseFloat(r.total||0); });
        const totalRowsHtml = Object.entries(allProcTotals).map(([proc, tot]) => `
          <tr><td>${proc}</td><td class="r">${tot.toFixed(0)} kg</td></tr>`).join('');

        const priceKg = parseFloat(g.priceKg || localStorage.getItem('hygicare_price_kg') || '0');
        const priceHtml = priceKg > 0
          ? `<div class="price-row">Preço/kg: R$ ${priceKg.toFixed(2)} &nbsp;|&nbsp; <strong>Total: R$ ${(grandTotal * priceKg).toFixed(2)}</strong></div>`
          : '';

        // Botão PDF flutuante (só no mode=pdf)
        const pdfBarHtml = mode === 'pdf' ? `
          <div class="pdf-bar no-print">
            <span>📄 Para salvar como PDF: clique em <strong>Imprimir</strong> → selecione <strong>"Salvar como PDF"</strong></span>
            <button onclick="window.print()" class="pdf-btn">🖨️ Salvar como PDF</button>
          </div>` : '';

        const scriptHtml = mode === 'print'
          ? `<script>window.onload=()=>{ setTimeout(()=>window.print(), 300); }<\/script>`
          : '';

        const now = new Date();
        const dateStr = now.toLocaleDateString('pt-BR');
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        return `<!DOCTYPE html><html lang="pt-BR"><head>
          <meta charset="utf-8"/>
          <title>Relatório — ${g.clientName}</title>
          <style>
            * { box-sizing:border-box; margin:0; padding:0; }
            body { font-family:Arial,sans-serif; background:#fff; color:#1e293b; }
            /* ── Barra de impressão (só na tela) ── */
            .pdf-bar { display:flex; align-items:center; justify-content:space-between; gap:12px;
              background:#1e40af; color:#fff; padding:10px 20px; font-size:0.85rem; }
            .pdf-btn { background:#fff; color:#1e40af; border:none; border-radius:6px;
              padding:7px 18px; font-size:0.85rem; font-weight:700; cursor:pointer; white-space:nowrap; }
            .pdf-btn:hover { background:#dbeafe; }
            @media print { .no-print { display:none !important; } body { padding:0; } }
            /* ── Cabeçalho do documento ── */
            .page-meta { display:flex; justify-content:space-between; align-items:center;
              padding:6px 20px; border-bottom:1px solid #e2e8f0; font-size:0.72rem; color:#64748b; }
            .report-body { padding:16px 20px; }
            .report-header { text-align:center; border:2px solid #334155; border-radius:6px;
              padding:12px 16px; margin-bottom:14px; }
            .report-header h1 { font-size:1.4rem; font-weight:900; letter-spacing:.05em; color:#0f172a; }
            .report-header .sub { display:flex; justify-content:space-between; align-items:center; margin-top:8px; }
            .report-header .period { background:#f1f5f9; border:1px solid #cbd5e1;
              padding:4px 16px; font-size:0.85rem; border-radius:4px; letter-spacing:.03em; }
            /* ── Seções por máquina ── */
            .section { border:1px solid #cbd5e1; border-radius:6px; margin-bottom:14px; overflow:hidden; page-break-inside:avoid; }
            .section-title { background:#334155; color:#fff; font-size:0.82rem; font-weight:700; padding:6px 14px; letter-spacing:.04em; }
            .section-body { display:flex; }
            .table-wrap { flex:1; padding:10px; }
            .chart-wrap { width:270px; display:flex; align-items:center; justify-content:center;
              padding:8px 12px; border-left:1px solid #e2e8f0; background:#fafafa; }
            table { width:100%; border-collapse:collapse; font-size:0.8rem; }
            thead th { background:#dbeafe; color:#1e40af; padding:5px 8px; text-align:left;
              font-size:0.75rem; border:1px solid #bfdbfe; font-weight:700; }
            tbody tr:nth-child(even) td { background:#f8fafc; }
            tbody td { padding:5px 8px; border:1px solid #e2e8f0; }
            tfoot .foot td { padding:6px 8px; background:#dcfce7; font-size:0.82rem;
              border:1px solid #86efac; color:#15803d; font-weight:700; }
            .c { text-align:center; }
            .r { text-align:right; font-weight:600; color:#15803d; }
            /* ── Seção total geral ── */
            .total-section { border:2px solid #1e40af; border-radius:6px; margin-bottom:14px; overflow:hidden; page-break-inside:avoid; }
            .total-title { background:#1e40af; color:#fff; font-size:0.9rem; font-weight:700;
              padding:8px 14px; letter-spacing:.04em; text-align:center; }
            .price-row { text-align:center; font-size:0.85rem; padding:8px 10px; margin-top:8px;
              background:#fefce8; border:1px solid #fde68a; border-radius:4px; color:#92400e; }
          </style></head><body>
          ${pdfBarHtml}
          <div class="page-meta">
            <span>${dateStr}, ${timeStr}</span>
            <span>Relatório — ${g.clientName}</span>
            <span></span>
          </div>
          <div class="report-body">
            <div class="report-header">
              <h1>${g.clientName.toUpperCase()}</h1>
              <div class="sub">
                <span style="font-size:0.78rem;color:#64748b">Hygicare Lavanderia</span>
                <span class="period">${g.period}</span>
                <span style="font-size:0.78rem;color:#64748b">Gerado: ${dateStr}</span>
              </div>
            </div>
            ${machineSections.join('')}
            <div class="total-section">
              <div class="total-title">TOTAL GERAL</div>
              <div class="section-body">
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>Processo</th><th class="r">Total (kg)</th></tr></thead>
                    <tbody>${totalRowsHtml}</tbody>
                    <tfoot><tr class="foot"><td><strong>Total em KG</strong></td><td class="r"><strong>${grandTotal.toFixed(0)} kg</strong></td></tr></tfoot>
                  </table>
                  ${priceHtml}
                </div>
                <div class="chart-wrap">
                  <img src="${totalChartImg}" style="width:100%;max-width:270px" />
                </div>
              </div>
            </div>
          </div>
          ${scriptHtml}
          </body></html>`;
      }

      window._printGroup = async function(safeKey) {
        const g = window._recordGroups[safeKey];
        if (!g) return;

        // Abre a janela ANTES dos awaits (necessário para não ser bloqueado como popup)
        const win = window.open('', '_blank', 'width=960,height=800');
        if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }

        win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
          <meta charset="utf-8"/>
          <title>Relatório — ${g.clientName}</title>
          <style>
            * { box-sizing:border-box; margin:0; padding:0; }
            body { font-family:Arial,sans-serif; background:#fff; color:#1e293b; padding:20px; }
            .loading { text-align:center; padding:40px; font-size:1.1rem; color:#64748b; }
          </style></head><body>
          <div class="loading">⏳ Gerando relatório com gráficos...</div>
        </body></html>`);
        win.document.close();

        const html = await _buildReportHtml(g, 'print');
        win.document.open();
        win.document.write(html);
        win.document.close();
      };

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
    // Auto-aplicar filtros ao mudar qualquer select/input de gráfico
    ['chart-filter-start','chart-filter-end','chart-filter-client','chart-filter-seller'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => renderCharts());
    });
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
          <div class="list-item-content">
            <div class="list-item-name">
              ${u.name || u.username}
              <span class="user-chip-role ${u.role === 'admin' ? 'role-admin' : 'role-vendedor'}">${u.role || 'vendedor'}</span>
            </div>
            <div class="list-item-details">
              <span class="detail-chip">👤 ${u.username}</span>
              ${u.email ? `<span class="detail-chip">📧 ${u.email}</span>` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            <button class="btn-edit" onclick="window._editUser(${u.id})">✏️ Editar</button>
            ${u.username !== currentUser?.username
              ? `<button class="btn-danger" onclick="window._deleteUser(${u.id}, '${u.username}')">🗑️</button>`
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
      const all     = await dbGetAll_raw('records');
      const clients = await dbGetAll_raw('clients');
      const [ds, de] = (g.period || '').split(' → ');
      const client   = clients.find(c => c.name === g.clientName);
      if (!client) return toast('Cliente não encontrado para exclusão', 'error');

      const toDelete = all.filter(r =>
        Number(r.client_id) === Number(client.id) &&
        (r.date_start || '').trim() === (ds || '').trim() &&
        (r.date_end   || '').trim() === (de || '').trim()
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
      const all     = await dbGetAll_raw('records');
      const clients = await dbGetAll_raw('clients');
      const [ds, de] = (g.period || '').split(' → ');
      const client   = clients.find(c => c.name === g.clientName);
      if (!client) return toast('Cliente não encontrado', 'error');

      const btn = document.getElementById('form-edit-record').querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }

      let i = 0;
      let patchOk = 0;
      const toEdit = all.filter(r =>
        client && Number(r.client_id) === Number(client.id) &&
        (r.date_start||'').trim() === (ds||'').trim() &&
        (r.date_end  ||'').trim() === (de||'').trim()
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
