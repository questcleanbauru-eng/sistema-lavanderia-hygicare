// ============================================================
// APP.JS — Sistema Lavanderia Hygicare
// ============================================================

// ---------- LAZY LOAD CHART.JS ----------
// Carregado sob demanda ao entrar na tela de gráficos — não bloqueia o carregamento inicial
const CHARTJS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
let _chartJsPromise = null;
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHARTJS_URL;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar Chart.js'));
    document.head.appendChild(s);
  });
  return _chartJsPromise;
}

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
  // Parse YYYY-MM-DD as local date (avoids UTC midnight → dia anterior no UTC-3)
  const parts = String(iso).split('T')[0].split('-');
  if (parts.length === 3) {
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!isNaN(d)) return d.toLocaleDateString('pt-BR');
  }
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('pt-BR');
}

function findClientById(id, clients) {
  return clients.find(c => Number(c.id) === Number(id));
}

function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Retorna HTML do logo para PDFs. onDark=true → texto branco (para fundo escuro)
function getPdfLogoHtml(onDark = true) {
  const b64 = localStorage.getItem('hygicare_logo_b64');
  if (b64) return `<img src="${b64}" style="height:38px;max-width:130px;object-fit:contain;display:block">`;
  const name = localStorage.getItem('pdf_company_name') || 'HYGICARE';
  const sub  = localStorage.getItem('pdf_company_subtitle') || 'Lavanderia Industrial';
  const clr  = onDark ? '#fff' : getPdfColor();
  const subClr = onDark ? 'rgba(255,255,255,0.65)' : '#6b7280';
  return `<div style="font-weight:900;font-size:16px;color:${clr};letter-spacing:.04em;line-height:1.1">${escHtml(name)}<div style="font-size:8px;color:${subClr};text-transform:uppercase;letter-spacing:.07em;font-weight:400;margin-top:1px">${escHtml(sub)}</div></div>`;
}

// Cor principal dos PDFs — lida do localStorage (sinc. via aba Config do GAS)
function getPdfColor() { return localStorage.getItem('pdf_color') || '#1a3f5c'; }

// Rodapé padrão dos PDFs — usa nome/subtítulo configurados + texto extra opcional
function getPdfFooterHtml(reportType) {
  const name   = localStorage.getItem('pdf_company_name')    || 'HYGICARE';
  const sub    = localStorage.getItem('pdf_company_subtitle') || 'Lavanderia Industrial';
  const extra  = localStorage.getItem('pdf_footer_text')     || '';
  const type   = reportType ? ` · ${reportType}` : '';
  const date   = new Date().toLocaleDateString('pt-BR');
  return `${escHtml(name)} ${escHtml(sub)}${type} · Gerado em ${date}${extra ? '<br>' + escHtml(extra) : ''}`;
}

// ---------- SORT ORDER — Máquinas e Processos ----------
function _getMachOrder()  { try { return JSON.parse(localStorage.getItem('hygicare_machine_order') || '{}'); } catch { return {}; } }
function _getProcOrder()  { try { return JSON.parse(localStorage.getItem('hygicare_process_order') || '{}'); } catch { return {}; } }
function _saveMachOrder(o){ localStorage.setItem('hygicare_machine_order', JSON.stringify(o)); }
function _saveProcOrder(o){ localStorage.setItem('hygicare_process_order', JSON.stringify(o)); }
function _applyOrder(items, orderObj, groupKey, idKey) {
  const key = String(groupKey);
  const arr  = orderObj[key] || [];
  if (!arr.length) return items;
  return [...items].sort((a, b) => {
    const ia = arr.indexOf(Number(a[idKey]));
    const ib = arr.indexOf(Number(b[idKey]));
    const pa = ia < 0 ? 9999 : ia;
    const pb = ib < 0 ? 9999 : ib;
    return pa - pb;
  });
}
function _swapOrder(arr, idA, idB) {
  const ia = arr.indexOf(idA), ib = arr.indexOf(idB);
  if (ia < 0 || ib < 0) return arr;
  const copy = [...arr];
  [copy[ia], copy[ib]] = [copy[ib], copy[ia]];
  return copy;
}

// ---------- TOAST SYSTEM ----------
function toast(msg, type = 'info', duration = 3500, action = null) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>${action ? `<button class="toast-action-btn">${action.label}</button>` : ''}`;
  if (action) el.querySelector('.toast-action-btn').addEventListener('click', () => { action.fn(); el.remove(); });
  document.getElementById('toast-container').appendChild(el);
  const timer = setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
  if (action) el.querySelector('.toast-action-btn').addEventListener('click', () => clearTimeout(timer));
  return el;
}

// ---------- DIALOG DE CONFIRMAÇÃO ----------
function confirmAction(msg, confirmLabel = 'Confirmar', danger = true) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.25rem';
    const btnColor = danger ? '#ef4444' : '#2563eb';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:1.5rem 1.25rem;max-width:320px;width:100%;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.25)">
        <p style="font-size:1rem;line-height:1.5;margin-bottom:1.3rem;color:#111827">${msg}</p>
        <div style="display:flex;gap:0.75rem;justify-content:center">
          <button id="_cd-cancel" style="flex:1;padding:0.75rem;border:1.5px solid #e5e7eb;border-radius:10px;background:#f9fafb;cursor:pointer;font-size:0.95rem;font-weight:600">Cancelar</button>
          <button id="_cd-ok" style="flex:1;padding:0.75rem;border:none;border-radius:10px;background:${btnColor};color:#fff;cursor:pointer;font-size:0.95rem;font-weight:700">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = v => { overlay.remove(); resolve(v); };
    overlay.querySelector('#_cd-ok').onclick     = () => close(true);
    overlay.querySelector('#_cd-cancel').onclick = () => close(false);
    overlay.onclick = e => { if (e.target === overlay) close(false); };
  });
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
  try {
    const parsed = JSON.parse(savedSession);
    // Sessão expira em 8 horas
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      localStorage.removeItem('lavanderia_session');
    } else {
      currentUser = parsed;
    }
  } catch (e) { localStorage.removeItem('lavanderia_session'); }
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
      const swReg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      // Força o waiting SW a ativar imediatamente quando detectado
      swReg.addEventListener('updatefound', () => {
        const newSW = swReg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            newSW.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      // Quando o novo SW assumir o controle:
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Se ainda não está logado, recarrega silenciosamente para garantir código novo
        const session = localStorage.getItem('lavanderia_session');
        if (!session) {
          window.location.reload();
          return;
        }
        toast('Nova versão disponível!', 'info', 12000, {
          label: 'Atualizar',
          fn: () => window.location.reload()
        });
      });
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
  document.getElementById('btn-toggle-pw')?.addEventListener('click', () => {
    const pwInput = document.getElementById('login-password');
    const btn     = document.getElementById('btn-toggle-pw');
    if (pwInput.type === 'password') {
      pwInput.type = 'text';
      btn.textContent = '🙈';
    } else {
      pwInput.type = 'password';
      btn.textContent = '👁️';
    }
  });

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
            manager: u.manager || '',
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
      const dbUsers = await getAll('users');
      dbUsers.forEach(du => {
        if (du.username && du.password) {
          const idx = users.findIndex(u => u.username === du.username);
          const mapped = { username: du.username, password: du.password,
            role: du.role || 'vendedor', name: du.name, sellerName: du.name, id: du.id, manager: du.manager || '' };
          if (idx >= 0) users[idx] = mapped; else users.push(mapped);
        }
      });
    } catch(e) { console.warn('IndexedDB users fallback', e); }

    const user = users.find(u => u.username === username && String(u.password) === String(password));
    btn.textContent = 'Entrar';
    btn.disabled = false;

    if (user) {
      currentUser = { username: user.username, role: user.role, name: user.name,
        sellerName: user.sellerName, manager: user.manager || '',
        permissions: user.permissions || '', sellers_access: user.sellers_access || '',
        expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
      localStorage.setItem('lavanderia_session', JSON.stringify(currentUser));
      // Salvar lista de usuários para o select de vendedor
      localStorage.setItem('hygicare_users', JSON.stringify(users));
      localStorage.setItem('_autoSync', '1');
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

  function _hideAppLoading() {
    const el = document.getElementById('app-loading');
    if (el) el.style.display = 'none';
    _applyCustomLogo();
    loginScreen.style.display = '';
  }

  function _applyCustomLogo() {
    const b64 = localStorage.getItem('hygicare_logo_b64');
    if (!b64) return;
    ['login-logo-img','loading-logo-img','header-logo-img'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.src = b64;
    });
  }

  function showApp() {
    const loadEl = document.getElementById('app-loading');
    if (loadEl) loadEl.style.display = 'none';
    loginScreen.classList.add('hidden');
    loginScreen.style.display = 'none';
    appMain.classList.remove('hidden');
    _applyCustomLogo();
    userNameSpan.textContent = `👤 ${currentUser.name}`;
    const _roleLabel = { admin: 'Admin', gerente: 'Gerente', vendedor: 'Vendedor', consultor: 'Consultor', diretor: 'Diretor' }[currentUser.role] || 'Vendedor';
    const _subtitle  = document.getElementById('header-subtitle');
    if (_subtitle) {
      _subtitle.textContent = `${currentUser.name} · ${_roleLabel}`;
      if ('caches' in window) {
        caches.keys().then(keys => {
          const k = keys.find(k => k.startsWith('lavanderia-cache-'));
          const ver = k ? k.replace('lavanderia-cache-', '') : '';
          if (ver && _subtitle) _subtitle.textContent = `${currentUser.name} · ${_roleLabel} · ${ver}`;
        });
      }
    }
    updateApiDisplay(getApiCount());
    updateSyncStatus();
    initApp();
  }

  if (currentUser) {
    showApp();
  } else {
    _hideAppLoading(); // mostra tela de login
  }

  // ---------- SYNC STATUS ----------
  function updateSyncStatus() {
    const lastSync  = localStorage.getItem('lastSyncTime');
    const online    = navigator.onLine;
    const dot       = document.getElementById('sync-dot');
    const label     = document.getElementById('sync-label');
    const syncEl    = document.getElementById('header-sync-status');
    const adminEl   = document.getElementById('last-sync-time');

    function relTime(iso) {
      const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
      if (diff < 60)  return 'agora mesmo';
      if (diff < 3600) return `há ${Math.floor(diff/60)} min`;
      if (diff < 86400) return `há ${Math.floor(diff/3600)}h`;
      return new Date(iso).toLocaleDateString('pt-BR');
    }

    const syncText = lastSync ? `Sync ${relTime(lastSync)}` : 'Nunca sincronizado';
    const stale    = !lastSync || (Date.now() - new Date(lastSync)) > 4 * 60 * 60 * 1000;

    if (dot) { dot.className = 'sync-dot' + (!online ? ' offline' : stale ? ' stale' : ''); }
    if (label) label.textContent = !online ? 'Offline' : syncText;
    if (syncEl) syncEl.className = 'header-sync' + (!online ? ' offline' : '');
    if (adminEl && lastSync) adminEl.textContent = `Última sincronização: ${new Date(lastSync).toLocaleString('pt-BR')}`;
  }

  // Atualiza o sync status a cada minuto automaticamente
  setInterval(updateSyncStatus, 60000);
  window.addEventListener('online',  updateSyncStatus);
  window.addEventListener('offline', updateSyncStatus);

  // ============================================================
  // REPORT HTML BUILDER  (A4 landscape, 90% zoom, Chart.js)
  // ============================================================
  function buildReportHtml(g, autoPrint = false) {
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    // Paleta padrão por processo (pode ser sobrescrita pelo Admin)
    const PROC_COLORS_DEFAULT = {
      'PESADO':'#1565c0','LEVE':'#42a5f5','PANO DE CHÃO':'#66bb6a',
      'COMPRESSAS':'#ef5350','DESENGOMA':'#ab47bc','COBERTORES':'#ff7043',
      'RETORNO':'#26c6da','AXILAS':'#d4e157','COMPRESSAS 30KG':'#ec407a',
      'PULVERIZAÇÃO':'#8d6e63','LEVE 70KG':'#29b6f6','PESADO 70KG':'#0d47a1'
    };
    const savedProcColors = JSON.parse(localStorage.getItem('hygicare_proc_colors') || '{}');
    const PROC_COLORS = { ...PROC_COLORS_DEFAULT, ...savedProcColors };
    const FALLBACK = ['#546e7a','#78909c','#90a4ae','#607d8b','#455a64','#37474f'];
    const savedGroups = (JSON.parse(localStorage.getItem('hygicare_proc_groups') || '{"groups":[]}').groups) || [];
    const getClr = (name, fi) => {
      const upper = (name||'').toUpperCase().trim();
      for (const grp of savedGroups) {
        if ((grp.processes||[]).some(p => p.toUpperCase() === upper)) return grp.color;
      }
      return PROC_COLORS[upper] || FALLBACK[fi % FALLBACK.length];
    };

    // Agrupar linhas por máquina
    const byMachine = {};
    for (const row of g.rows) {
      if (!byMachine[row.machineName]) byMachine[row.machineName] = [];
      byMachine[row.machineName].push(row);
    }
    const machineEntries = Object.entries(byMachine);

    // Dias do período
    const [startStr, endStr] = (g.period || '').split(' → ');
    const parsePt = s => { const [d,m,y] = (s||'').split('/'); return new Date(+y,+m-1,+d); };
    const sd = parsePt(startStr), ed = parsePt(endStr);
    const diffDays = (!isNaN(sd) && !isNaN(ed)) ? Math.round((ed-sd)/86400000)+1 : 0;
    const daysLabel = diffDays > 0 ? `${diffDays} dia${diffDays!==1?'s':''}` : '';
    const today = new Date().toLocaleDateString('pt-BR');

    // --- Seções por máquina ---
    let chartInits = '';
    let sectionsHtml = '';

    machineEntries.forEach(([machineName, rows], idx) => {
      const machineKg   = rows.reduce((s,r) => s + parseFloat(r.total    ||0), 0);
      const machineExec = rows.reduce((s,r) => s + parseFloat(r.executed ||0), 0);
      const machineCanc = rows.reduce((s,r) => s + parseFloat(r.canceled ||0), 0);
      const cid = `ch${idx}`;

      const tRows = rows.map((r, i) => {
        const ex = parseFloat(r.executed||0), ca = parseFloat(r.canceled||0), kg = parseFloat(r.total||0);
        const pct = machineKg > 0 ? (kg/machineKg*100).toFixed(1) : '0.0';
        return `<tr>
          <td class="tc">${i+1}</td><td class="tl">${esc(r.procName)}</td>
          <td class="tc">${ex}</td>
          <td class="tc${ca>0?' t-red':''}">${ca}</td>
          <td class="tc">${ex+ca}</td>
          <td class="tc tb">${kg.toFixed(2)}</td>
          <td class="tc">${pct}%</td>
        </tr>`;
      }).join('');

      const active = rows.filter(r => parseFloat(r.total||0) > 0);
      const clrs   = active.map((r,i) => getClr(r.procName, i));
      const legend = active.map((r,i) =>
        `<div class="li"><div class="ld" style="background:${clrs[i]}"></div><span>${esc(r.procName)}</span></div>`
      ).join('');
      const isEmpty = !active.length;

      chartInits += isEmpty ? '' :
        `new Chart(document.getElementById('${cid}'),{type:'doughnut',data:{labels:${JSON.stringify(active.map(r=>r.procName))},datasets:[{data:${JSON.stringify(active.map(r=>parseFloat(r.total||0)))},backgroundColor:${JSON.stringify(clrs)},borderWidth:1,borderColor:'#fff'}]},options:{responsive:false,animation:false,plugins:{legend:{display:false},tooltip:{enabled:false}},cutout:'58%'}});`;

      const chartBlock = isEmpty
        ? `<p class="maint-txt">EM MANUTENÇÃO</p>`
        : `<canvas id="${cid}" width="130" height="130"></canvas><div class="leg">${legend}</div>`;

      sectionsHtml += `
<div class="sec">
  <div class="sec-hd blue">${esc(machineName.toUpperCase())}</div>
  <div class="sec-body">
    <div class="tbl-area">
      <table>
        <thead><tr><th class="tc w30">Nº</th><th class="tl">Processos</th><th class="tc w80">Executado</th><th class="tc w80">Abortado</th><th class="tc w90">Total Proc</th><th class="tc w90">Total Kg</th><th class="tc w70">%</th></tr></thead>
        <tbody>${tRows}</tbody>
        <tfoot><tr><td colspan="2" class="tr">Total em KG:</td><td class="tc">${machineExec}</td><td class="tc">${machineCanc}</td><td class="tc">${machineExec+machineCanc}</td><td class="tc">${machineKg.toFixed(2)}</td><td></td></tr></tfoot>
      </table>
    </div>
    <div class="chart-area">${chartBlock}</div>
  </div>
</div>`;
    });

    // --- Total Geral ---
    const totByProc = {};
    for (const row of g.rows) {
      const k = row.procName;
      if (!totByProc[k]) totByProc[k] = { ex:0, ca:0, kg:0 };
      totByProc[k].ex += parseFloat(row.executed||0);
      totByProc[k].ca += parseFloat(row.canceled||0);
      totByProc[k].kg += parseFloat(row.total   ||0);
    }
    const totProcs  = Object.entries(totByProc);
    const totExec   = g.rows.reduce((s,r) => s + parseFloat(r.executed||0), 0);
    const totCanc   = g.rows.reduce((s,r) => s + parseFloat(r.canceled||0), 0);
    const totLav    = totExec; // total de lavagens = soma de execuções

    const geralRows = totProcs.map(([proc, d], i) => {
      const pct = g.totalKg > 0 ? (d.kg/g.totalKg*100).toFixed(1) : '0.0';
      return `<tr>
        <td class="tc">${i+1}</td><td class="tl">${esc(proc)}</td>
        <td class="tc">${d.ex}</td>
        <td class="tc${d.ca>0?' t-red':''}">${d.ca}</td>
        <td class="tc">${d.ex+d.ca}</td>
        <td class="tc tb">${d.kg.toFixed(2)}</td>
        <td class="tc">${pct}%</td>
      </tr>`;
    }).join('');

    const geralActive = totProcs.filter(([,d]) => d.kg > 0);
    const geralClrs   = geralActive.map(([p],i) => getClr(p, i));
    const geralLegend = geralActive.map(([p],i) =>
      `<div class="li"><div class="ld" style="background:${geralClrs[i]}"></div><span>${esc(p)}</span></div>`
    ).join('');
    chartInits += geralActive.length
      ? `new Chart(document.getElementById('chtotal'),{type:'doughnut',data:{labels:${JSON.stringify(geralActive.map(([p])=>p))},datasets:[{data:${JSON.stringify(geralActive.map(([,d])=>d.kg))},backgroundColor:${JSON.stringify(geralClrs)},borderWidth:1,borderColor:'#fff'}]},options:{responsive:false,animation:false,plugins:{legend:{display:false},tooltip:{enabled:false}},cutout:'58%'}});`
      : '';

    // --- Seção de preço ---
    const precoKg   = g.precoKg || null;
    let priceSection = '';
    if (precoKg && precoKg > 0) {
      const fatTotal = g.totalKg * precoKg;
      const fmt = v => v.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
      priceSection = `
<div class="sec" style="margin-top:8px">
  <div class="sec-hd blue">FATURAMENTO</div>
  <div style="padding:0">
    <div class="price-row">Preço por Kg<span>R$ ${fmt(precoKg)}</span></div>
    <div class="price-row">Total Kg Lavado<span>${fmt(g.totalKg)} kg</span></div>
    <div class="price-row" style="background:#e8f5e9;color:#1b5e20;font-weight:bold;font-size:11px">
      PREÇO DO KG × TOTAL DE KG LAVADO<span>R$ ${fmt(fatTotal)}</span>
    </div>
  </div>
</div>`;
    }

    const printScript = autoPrint ? `setTimeout(()=>window.print(),800);` : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RELATÓRIO DE LAVANDERIA - ${esc(g.clientName)}${g.period ? ' - ' + esc(g.period.replace(/ → /g, ' a ')) : ''}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10px;color:#212121;background:#fff}
.hdr{display:flex;align-items:center;background:#1a3f5c;color:#fff;min-height:60px;max-height:60px;padding:0 10px;gap:10px;margin-bottom:8px}
.hdr-logo{width:40px;height:40px;background:rgba(255,255,255,.18);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;text-align:center;line-height:1.3;flex-shrink:0;letter-spacing:.5px}
.hdr-c{flex:1;text-align:center;line-height:1.3}
.hdr-c h1{font-size:18px;font-weight:bold;color:#fff;letter-spacing:.3px}
.hdr-info{font-size:10px;color:#c5cae9;margin-top:4px}
.hdr-sub{font-size:9px;color:#9fa8da;margin-top:2px}
.sec{margin-bottom:8px;border:1px solid #ddd;page-break-inside:avoid}
.sec-hd{background:#1a3f5c;color:#fff;text-align:center;padding:4px;font-size:11px;font-weight:bold;letter-spacing:.4px}
.blue{background:#1a3f5c}.gray{background:#37474f}
.sec-body{display:flex;align-items:stretch}
.tbl-area{flex:0 0 75%;width:75%}
.chart-area{flex:0 0 25%;width:25%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 8px;border-left:1px solid #ddd;gap:5px}
table{width:100%;border-collapse:collapse;font-size:9px}
thead th{background:#e3e8f0;font-size:9px;font-weight:bold;padding:4px 6px;border:1px solid #ddd;white-space:nowrap;text-align:center}
th.tl{text-align:left}
tbody tr{height:22px}
tbody tr:nth-child(even) td{background:#f9f9f9}
tbody td{padding:3px 6px;border:1px solid #ddd;vertical-align:middle}
.tc{text-align:center}.tl{text-align:left}.tr{text-align:right}.tb{font-weight:bold}.t-red{color:#e53935;font-weight:bold}
.w30{width:30px}.w80{width:80px}.w90{width:90px}.w70{width:70px}
tfoot td{background:#e3e8f0;font-weight:bold;padding:3px 6px;border:1px solid #ddd;font-size:9px}
.leg{width:100%;font-size:8px;line-height:1.5}
.li{display:flex;align-items:center;gap:4px;margin-bottom:1px;white-space:nowrap;overflow:hidden}
.ld{width:8px;height:8px;border-radius:2px;flex-shrink:0}
.maint-txt{color:#9e9e9e;font-style:italic;font-size:10px;text-align:center;padding:20px 4px}
.price-row{display:flex;justify-content:space-between;align-items:center;padding:5px 14px;border-bottom:1px solid #eee;font-size:10px}
.price-row:last-child{border-bottom:none}
.rpt-footer{margin-top:10px;border-top:2px solid #1a3f5c;padding:7px 0 0;text-align:center;font-size:8px;color:#555;line-height:1.7;page-break-inside:avoid}
.rpt-footer strong{color:#1a3f5c;font-size:8.5px}
@media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4 portrait;margin:10mm}.sec{page-break-inside:avoid}.action-bar{display:none}}
@media screen{
  .action-bar{position:sticky;top:0;z-index:999;background:#1a3f5c;padding:6px 10px;display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
  .action-bar button{padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
  .btn-close-rpt{background:#fff;color:#1a3f5c}
  .btn-print-rpt{background:#4caf50;color:#fff}
  .action-bar-label{color:#c5cae9;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
}
@media screen and (max-width:600px){
  body{font-size:9px}
  .hdr{min-height:48px;max-height:unset;padding:6px 8px}
  .hdr-c h1{font-size:13px}
  .hdr-info,.hdr-sub{font-size:8px}
  .hdr-logo{width:34px;height:34px;font-size:6px}
  .sec-body{flex-direction:column}
  .tbl-area{width:100%;flex:none}
  .chart-area{width:100%;flex:none;border-left:none;border-top:1px solid #ddd;flex-direction:row;justify-content:center;padding:8px;gap:12px}
  .chart-area canvas{width:90px!important;height:90px!important}
  table{font-size:8px}
  thead th,tbody td,tfoot td{padding:2px 3px}
  .w80,.w90{width:auto}
}
</style>
</head>
<body>
<div class="action-bar">
  <button class="btn-close-rpt" onclick="window.close()">✕ Fechar</button>
  <button class="btn-print-rpt" onclick="window.print()">🖨️ Salvar PDF</button>
  <span class="action-bar-label">${esc(g.clientName)} · ${esc(g.period)}</span>
</div>
<div class="hdr">
  <div style="flex-shrink:0">${getPdfLogoHtml(true)}</div>
  <div class="hdr-c">
    <h1>${esc(g.clientName)}</h1>
    <div class="hdr-info">Período: ${esc(g.period)}${daysLabel?'&nbsp;&nbsp;|&nbsp;&nbsp;'+daysLabel:''}</div>
    <div class="hdr-sub">Relatório de Produção &nbsp;·&nbsp; Emitido em ${today} &nbsp;·&nbsp; Hygicare Lavanderia</div>
  </div>
</div>

${sectionsHtml}

<div class="sec">
  <div class="sec-hd blue">TOTAL GERAL</div>
  <div class="sec-body">
    <div class="tbl-area">
      <table>
        <thead><tr><th class="tc w30">Nº</th><th class="tl">Processos</th><th class="tc w80">Executado</th><th class="tc w80">Abortado</th><th class="tc w90">Total Proc</th><th class="tc w90">Total Kg</th><th class="tc w70">%</th></tr></thead>
        <tbody>${geralRows||'<tr><td colspan="7" style="text-align:center;color:#9e9e9e;padding:10px">Sem registros</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="2" class="tr">Total em KG:</td><td class="tc">${totExec}</td><td class="tc">${totCanc}</td><td class="tc">${totExec+totCanc}</td><td class="tc">${g.totalKg.toFixed(2)}</td><td></td></tr>
          <tr><td colspan="5" class="tr">LAVAGENS MAQ:</td><td class="tc">${totLav}</td><td></td></tr>
        </tfoot>
      </table>
    </div>
    <div class="chart-area">
      ${geralActive.length ? `<canvas id="chtotal" width="130" height="130"></canvas><div class="leg">${geralLegend}</div>` : '<p class="maint-txt">Sem dados</p>'}
    </div>
  </div>
</div>

${priceSection}

<div class="rpt-footer">${getPdfFooterHtml('Relatório de Produção')}</div>

<script>
window.addEventListener('load',function(){
${chartInits}
${printScript}
});
<\/script>
</body>
</html>`;
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
      const dbUsers = await getAll('users');
      dbUsers.forEach(du => {
        if (!du.username || !du.password) return;
        const idx = window.USERS.findIndex(u => u.username === du.username);
        const mapped = { username: du.username, password: du.password,
          role: du.role || 'vendedor', name: du.name, sellerName: du.name,
          manager: du.manager || '', permissions: du.permissions || '',
          sellers_access: du.sellers_access || '' };
        if (idx >= 0) window.USERS[idx] = mapped; else window.USERS.push(mapped);
      });
    } catch(e) {}

    // --- NAV ---
    const screens = document.querySelectorAll('.screen');
    const navBtns = document.querySelectorAll('.nav-btn');

    function _clearEditMode() {
      if (!_editingRecord) return;
      _editingRecord = null;
      prodClientSelect.disabled = false;
      const banner = document.getElementById('edit-mode-banner');
      if (banner) banner.style.display = 'none';
      const titleEl = document.getElementById('screen-form-title');
      if (titleEl) titleEl.textContent = '📝 Gerar Relatório';
      const cardTitle = document.getElementById('prod-card-title');
      if (cardTitle) cardTitle.textContent = 'Novo Registro';
      const saveBtn = document.getElementById('save-production');
      if (saveBtn) saveBtn.textContent = '💾 Salvar';
    }

    function show(id) {
      if (id !== 'screen-form') _clearEditMode();
      screens.forEach(s => s.classList.add('hidden'));
      document.getElementById(id).classList.remove('hidden');
      navBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.screen === id || b.id === 'nav-' + id.replace('screen-', ''));
      });
      // Sync bottom nav active state
      document.querySelectorAll('.bnav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.target === id);
      });
      // FAB: oculto na tela de registro, home, ou sem permissão de envio
      const fab = document.getElementById('fab-btn');
      if (fab) fab.classList.toggle('hidden', id === 'screen-form' || id === 'screen-home' || !canDo('send_record'));
      // Close drawer if open
      closeDrawer();
    }
    window.show = show;

    // Chaves de ação — separa de chaves de tela
    const ACTION_KEYS = new Set(['send_record','edit_record','delete_record','pdf_report',
      'create_client','edit_client','delete_client','create_machine','edit_machine','delete_machine','edit_bomba',
      'create_process','edit_process','delete_process','create_recipe','edit_recipe','edit_vazao',
      'create_note','edit_note','delete_note']);

    // Chaves de tela — fonte única para formulário de usuário e applyNavPermissions
    const SCREEN_PERM_KEYS = ['clients','machines','processes','form','reports','charts','users','vazao','recipes','client_notes','pdf_reports'];

    // Mutex: impede dois syncs completos simultâneos (IIFE de startup + _autoSync)
    let _fullSyncRunning = false;

    // Verifica se o usuário tem permissão para realizar uma ação
    function canDo(action) {
      if (!currentUser || currentUser.role === 'admin') return true;
      const permsStr = (currentUser.permissions || '').trim();
      if (!permsStr) return true;
      const perms = new Set(permsStr.split(',').map(s => s.trim()).filter(Boolean));
      // Se nenhuma chave de ação está definida, todas as ações são permitidas (backward compat)
      if (![...perms].some(p => ACTION_KEYS.has(p))) return true;
      return perms.has(action);
    }
    window.canDo = canDo;

    // ===== DRAWER / BOTTOM NAV =====
    const drawerOverlay = document.getElementById('drawer-overlay');
    const drawerEl      = document.getElementById('drawer-more');

    function openDrawer() {
      drawerOverlay?.classList.remove('hidden');
      drawerEl?.classList.remove('hidden');
    }
    function closeDrawer() {
      drawerOverlay?.classList.add('hidden');
      drawerEl?.classList.add('hidden');
    }

    document.getElementById('bnav-more')?.addEventListener('click', openDrawer);
    document.getElementById('btn-header-menu')?.addEventListener('click', openDrawer);
    drawerOverlay?.addEventListener('click', closeDrawer);

    // FAB — atalho para registrar
    document.getElementById('fab-btn')?.addEventListener('click', async () => {
      show('screen-form');
      await _initFormScreen();
    });

    // Bottom nav buttons (screen-targets)
    document.querySelectorAll('.bnav-btn[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const screenId = btn.dataset.target;
        show(screenId);
        if (screenId === 'screen-home')      await initHomeScreen();
        if (screenId === 'screen-clients')   { await renderClientsList(); await refreshSellerSelect(); }
        if (screenId === 'screen-machines')  await renderMachinesList();
        if (screenId === 'screen-processes') await renderProcessesList();
        if (screenId === 'screen-charts')    { await refreshChartsFilters(); await renderCharts(); }
        if (screenId === 'screen-vazao')     await initVazaoScreen();
        if (screenId === 'screen-recipes')   await initRecipesScreen();
        if (screenId === 'screen-form') await _initFormScreen();
        if (screenId === 'screen-reports') { await refreshReportClientFilter(); await refreshMonthYearFilter(); await renderRecordsList(); }
        if (screenId === 'screen-users')   await renderUsersList();
        if (screenId === 'screen-admin')   { refreshAdminPanel(); renderProcColorsAdmin(); testApis(); }
        if (screenId === 'screen-alerts')  await renderAlertsScreen();
      });
    });

    // Drawer menu items
    document.querySelectorAll('.drawer-item[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const screenId = btn.dataset.target;
        closeDrawer();
        show(screenId);
        if (screenId === 'screen-clients')   { await renderClientsList(); await refreshSellerSelect(); }
        if (screenId === 'screen-machines')  await renderMachinesList();
        if (screenId === 'screen-processes') await renderProcessesList();
        if (screenId === 'screen-vazao')        await initVazaoScreen();
        if (screenId === 'screen-recipes')      await initRecipesScreen();
        if (screenId === 'screen-client-notes') await initClientNotesScreen();
        if (screenId === 'screen-users')        await renderUsersList();
        if (screenId === 'screen-admin')        { refreshAdminPanel(); renderProcColorsAdmin(); testApis(); }
        if (screenId === 'screen-alerts')       await renderAlertsScreen();
      });
    });

    // Logout no drawer
    document.getElementById('drawer-logout')?.addEventListener('click', () => {
      document.getElementById('btn-logout')?.click();
    });

    // Estado compartilhado entre funções (sem poluir window)
    let _shareCtx      = null;
    let _recordGroups  = {};
    let _editingRecord = null;
    let _saving        = false;

    function setSaving(active, triggerBtn = null, loadingText = '⏳ Salvando...') {
      _saving = active;
      const allBtns = document.querySelectorAll('button');
      if (active) {
        allBtns.forEach(btn => {
          btn.dataset.wasDis = btn.disabled ? '1' : '0';
          btn.disabled = true;
        });
        if (triggerBtn) {
          triggerBtn.dataset.origTxt = triggerBtn.textContent;
          triggerBtn.textContent = loadingText;
        }
      } else {
        allBtns.forEach(btn => {
          btn.disabled = btn.dataset.wasDis === '1';
          delete btn.dataset.wasDis;
        });
        if (triggerBtn) {
          triggerBtn.textContent = triggerBtn.dataset.origTxt || triggerBtn.textContent;
          delete triggerBtn.dataset.origTxt;
        }
      }
    }

    // =====================================================
    // FILTRO DE DADOS POR USUÁRIO (vendedor / gerente)
    // =====================================================
    function getManagedSellerNames() {
      if (currentUser.role === 'consultor') {
        const allUsers = JSON.parse(localStorage.getItem('hygicare_users') || '[]');
        const myName  = (currentUser.sellerName || currentUser.name || '').toLowerCase();
        const access  = (currentUser.sellers_access || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        // se algum nome no sellers_access for um gerente, expande para incluir os vendedores dele
        const expanded = new Set([myName, ...access]);
        for (const name of access) {
          allUsers
            .filter(u => (u.manager || '').toLowerCase() === name)
            .forEach(u => expanded.add((u.sellerName || u.name || '').toLowerCase()));
        }
        return expanded;
      }
      const allUsers = JSON.parse(localStorage.getItem('hygicare_users') || '[]');
      const myName = (currentUser.sellerName || currentUser.name || '').toLowerCase();
      return new Set([
        myName,
        ...allUsers
          .filter(u => (u.manager || '').toLowerCase() === myName)
          .map(u => (u.sellerName || u.name || '').toLowerCase())
      ]);
    }

    const _originalGetAll = window.getAll;

    async function dbGetAll_raw(store) {
      return await _originalGetAll(store);
    }
    window.dbGetAll_raw = dbGetAll_raw;

    if (!window._getAll_wrapped) {
      window._getAll_wrapped = true;
      window.getAll = async (store) => {
        const data = await _originalGetAll(store);
        if (!currentUser || currentUser.role === 'admin' || currentUser.role === 'diretor') return data;
        if (store !== 'clients') return data;
        if (currentUser.role === 'gerente' || currentUser.role === 'consultor') {
          const managed = getManagedSellerNames();
          return data.filter(c => managed.has((c.seller || '').toLowerCase()));
        }
        const filtered = data.filter(c => (c.seller || '').toLowerCase() === (currentUser.sellerName || '').toLowerCase());
        if (filtered.length === 0 && data.length > 0 && currentUser.sellerName) {
          const sellers = [...new Set(data.map(c => c.seller).filter(Boolean))].slice(0, 5).join(', ');
          console.warn(`[Hygicare] Vendedor "${currentUser.sellerName}" não encontrou clientes. Vendedores na base: ${sellers}`);
          setTimeout(() => toast(`⚠️ Nenhum cliente encontrado para o vendedor "${currentUser.sellerName}". Verifique o campo Seller nas planilhas.`, 'warning', 10000), 2000);
        }
        return filtered;
      };
    }

    // Mapear nav buttons
    const navMap = {
      'nav-home':      'screen-home',
      'nav-clients':   'screen-clients',
      'nav-machines':  'screen-machines',
      'nav-processes': 'screen-processes',
      'nav-charts':    'screen-charts',
      'nav-vazao':     'screen-vazao',
      'nav-recipes':      'screen-recipes',
      'nav-client-notes':  'screen-client-notes',
      'nav-pdf-reports':   'screen-pdf-reports',
      'nav-form':          'screen-form',
      'nav-reports':   'screen-reports',
      'nav-alerts':    'screen-alerts',
      'nav-users':     'screen-users',
      'nav-admin':     'screen-admin',
    };
    Object.entries(navMap).forEach(([btnId, screenId]) => {
      const el = document.getElementById(btnId);
      if (!el) return;
      el.addEventListener('click', async () => {
        show(screenId);
        if (screenId === 'screen-home')      await initHomeScreen();
        if (screenId === 'screen-clients')   { await renderClientsList(); await refreshSellerSelect(); }
        if (screenId === 'screen-machines')  await renderMachinesList();
        if (screenId === 'screen-processes') await renderProcessesList();
        if (screenId === 'screen-charts')    { await refreshChartsFilters(); await renderCharts(); }
        if (screenId === 'screen-vazao')        await initVazaoScreen();
        if (screenId === 'screen-recipes')      await initRecipesScreen();
        if (screenId === 'screen-client-notes') await initClientNotesScreen();
        if (screenId === 'screen-pdf-reports')  await initPdfReportsScreen();
        if (screenId === 'screen-pdf-config')   await initPdfConfigScreen();
        if (screenId === 'screen-form') await _initFormScreen();
        if (screenId === 'screen-reports') { await refreshReportClientFilter(); await refreshMonthYearFilter(); await renderRecordsList(); }
        if (screenId === 'screen-alerts')       await renderAlertsScreen();
        if (screenId === 'screen-users')        await renderUsersList();
        if (screenId === 'screen-admin')     { refreshAdminPanel(); renderProcColorsAdmin(); testApis(); }
      });
    });

    // Mostrar botoes admin-only apenas para administradores
    if (currentUser?.role === 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }

    document.getElementById('btn-pdf-executive')?.addEventListener('click', async () => {
      if (!canDo('pdf_report')) return toast('Sem permissão para gerar PDF.', 'error');
      const win = window.open('', '_blank', 'width=1000,height=750');
      if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }

      const days = Number(document.getElementById('pdf-report-period')?.value || 30);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffISO = cutoff.toISOString().slice(0, 10);
      const prevCutoff = new Date(cutoff);
      prevCutoff.setDate(prevCutoff.getDate() - days);
      const prevCutoffISO = prevCutoff.toISOString().slice(0, 10);

      let [records, clients, recipes] = await Promise.all([
        dbGetAll_raw('records'),
        dbGetAll_raw('clients'),
        dbGetAll_raw('recipes'),
      ]);

      // Filtro por papel — gerente/consultor vê só seus vendedores; vendedor vê só seus clientes
      if (currentUser?.role === 'gerente' || currentUser?.role === 'consultor') {
        const managed = getManagedSellerNames();
        const myIds = new Set(clients.filter(c => managed.has((c.seller||'').toLowerCase())).map(c => Number(c.id)));
        clients = clients.filter(c => myIds.has(Number(c.id)));
        records = records.filter(r => myIds.has(Number(r.client_id)));
      } else if (currentUser?.role === 'vendedor') {
        const sellerName = (currentUser.sellerName || '').toLowerCase();
        const myIds = new Set(clients.filter(c => (c.seller||'').toLowerCase() === sellerName).map(c => Number(c.id)));
        clients = clients.filter(c => myIds.has(Number(c.id)));
        records = records.filter(r => myIds.has(Number(r.client_id)));
      }

      // Formatação pt-BR
      const fmtKg  = n => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' kg';
      const fmtNum = n => Number(n).toLocaleString('pt-BR');
      const fmtPct = n => (n >= 0 ? '+' : '') + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

      const inPeriod = r => (r.date_start || r.created_at || '').slice(0,10) >= cutoffISO;
      const inPrev   = r => { const d = (r.date_start || r.created_at || '').slice(0,10); return d >= prevCutoffISO && d < cutoffISO; };

      const curRecs  = records.filter(inPeriod);
      const prevRecs = records.filter(inPrev);
      const sumKg    = arr => arr.reduce((s, r) => s + (parseFloat(r.total) || 0), 0);
      const curKg    = sumKg(curRecs);
      const prevKg   = sumKg(prevRecs);
      const diffPct  = prevKg > 0 ? ((curKg - prevKg) / prevKg * 100) : null;
      const diffHtml = diffPct === null ? '<span style="color:#94a3b8">—</span>'
        : diffPct >= 0
          ? `<span style="color:#16a34a">▲ ${fmtPct(diffPct)}</span>`
          : `<span style="color:#dc2626">▼ ${fmtPct(Math.abs(diffPct))}</span>`;

      const activeClientSet  = new Set(curRecs.map(r => String(r.client_id)));
      const inactiveCount    = clients.filter(c => !activeClientSet.has(String(c.id))).length;
      const pendingRecipes   = recipes.filter(r => r.status === 'pending');
      const avgKg            = curRecs.length > 0 ? curKg / curRecs.length : 0;
      const totalCanceled    = curRecs.reduce((s, r) => s + (parseFloat(r.canceled) || 0), 0);
      const cancelPct        = curKg > 0 ? (totalCanceled / (curKg + totalCanceled) * 100) : 0;

      // KPI cards — 3 colunas × 2 linhas
      const kpi = (icon, label, value, sub='', color='#1e293b') => `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 14px;text-align:center">
          <div style="font-size:1.4rem;margin-bottom:4px">${icon}</div>
          <div style="font-size:1.25rem;font-weight:800;color:${color};margin-bottom:3px;line-height:1.2">${value}</div>
          <div style="font-size:0.68rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">${label}</div>
          ${sub ? `<div style="font-size:0.72rem;color:#94a3b8">${sub}</div>` : ''}
        </div>`;

      const kpisHtml = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
        ${kpi('⚖️', 'Total kg processado', fmtKg(curKg), 'vs anterior: '+diffHtml, '#1e3a8a')}
        ${kpi('📋', 'Registros no período', fmtNum(curRecs.length), `média ${fmtKg(avgKg)} / registro`)}
        ${kpi('👥', 'Clientes ativos', fmtNum(activeClientSet.size), `${fmtNum(inactiveCount)} inativos de ${fmtNum(clients.length)} total`, activeClientSet.size > 0 ? '#16a34a' : '#64748b')}
        ${kpi('📉', 'Kg cancelados', fmtKg(totalCanceled), `${cancelPct.toLocaleString('pt-BR',{maximumFractionDigits:1})}% do total processado`, totalCanceled > 0 ? '#dc2626' : '#16a34a')}
        ${kpi('📝', 'Receitas ativas', fmtNum(recipes.filter(r=>r.status==='active').length), `${fmtNum(pendingRecipes.length)} pendente${pendingRecipes.length!==1?'s':''} de aprovação`)}
        ${kpi('⏳', 'Maior espera (receita)', pendingRecipes.length ? Math.max(...pendingRecipes.map(r=>r.created_at?Math.floor((Date.now()-new Date(r.created_at))/86400000):0))+' dias' : '—', pendingRecipes.length ? 'receita aguardando aprovação há mais tempo' : 'sem pendências', pendingRecipes.length > 3 ? '#dc2626' : '#64748b')}
      </div>`;

      // Ranking de clientes
      const byClient = {};
      for (const r of curRecs) {
        const cid = String(r.client_id);
        if (!byClient[cid]) byClient[cid] = { kg: 0, count: 0, canceled: 0 };
        byClient[cid].kg       += parseFloat(r.total)    || 0;
        byClient[cid].count    += 1;
        byClient[cid].canceled += parseFloat(r.canceled) || 0;
      }
      const clientRanking = Object.entries(byClient)
        .map(([cid, v]) => ({ client: clients.find(c => String(c.id) === cid), ...v }))
        .sort((a, b) => b.kg - a.kg);

      const rankingRows = clientRanking.map((row, i) => `
        <tr style="${i % 2 === 0 ? 'background:#f8fafc' : ''}">
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;font-weight:700;color:#64748b;text-align:center">${i+1}º</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;font-weight:600">${row.client?.name || '?'}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;color:#64748b">${row.client?.city || '—'}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;color:#64748b">${row.client?.seller || '—'}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:center;color:#64748b">${fmtNum(row.count)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:#16a34a">${fmtKg(row.kg)}</td>
          <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right;color:${row.canceled>0?'#dc2626':'#94a3b8'}">${fmtKg(row.canceled)}</td>
        </tr>`).join('');

      // Clientes inativos no período
      const inactiveClients = clients.filter(c => !activeClientSet.has(String(c.id)));
      const inactiveRows = inactiveClients.length
        ? inactiveClients.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map((c,i) => `
            <tr style="${i%2===0?'background:#f8fafc':''}">
              <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;font-weight:600">${c.name||'?'}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;color:#64748b">${c.city||'—'}</td>
              <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;color:#64748b">${c.seller||'—'}</td>
            </tr>`).join('')
        : `<tr><td colspan="3" style="padding:14px;text-align:center;color:#16a34a;font-weight:600">✅ Todos os clientes têm registros no período</td></tr>`;

      // Resumo por vendedor
      const bySeller = {};
      for (const r of curRecs) {
        const c = clients.find(cl => String(cl.id) === String(r.client_id));
        const sel = c?.seller || '(Sem vendedor)';
        if (!bySeller[sel]) bySeller[sel] = { kg: 0, count: 0, clientSet: new Set() };
        bySeller[sel].kg    += parseFloat(r.total) || 0;
        bySeller[sel].count += 1;
        bySeller[sel].clientSet.add(String(r.client_id));
      }
      const sellerRows = Object.entries(bySeller)
        .sort((a, b) => b[1].kg - a[1].kg)
        .map(([sel, v], i) => `
          <tr style="${i % 2 === 0 ? 'background:#f8fafc' : ''}">
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;font-weight:600">👨‍💼 ${sel}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:center">${fmtNum(v.clientSet.size)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:center">${fmtNum(v.count)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:#16a34a">${fmtKg(v.kg)}</td>
          </tr>`).join('');

      // Resumo por cidade
      const byCity = {};
      for (const r of curRecs) {
        const c = clients.find(cl => String(cl.id) === String(r.client_id));
        const city = c?.city?.trim() || '(Sem cidade)';
        if (!byCity[city]) byCity[city] = { kg: 0, count: 0, clientSet: new Set() };
        byCity[city].kg    += parseFloat(r.total) || 0;
        byCity[city].count += 1;
        byCity[city].clientSet.add(String(r.client_id));
      }
      const totalKgCity = Object.values(byCity).reduce((s, v) => s + v.kg, 0);
      const cityRows = Object.entries(byCity)
        .sort((a, b) => b[1].kg - a[1].kg)
        .map(([city, v], i) => {
          const pct = totalKgCity > 0 ? (v.kg / totalKgCity * 100).toFixed(1) : '0.0';
          const barW = totalKgCity > 0 ? Math.round(v.kg / totalKgCity * 100) : 0;
          return `
          <tr style="${i % 2 === 0 ? 'background:#f8fafc' : ''}">
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;font-weight:600">🏙️ ${city}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:center">${fmtNum(v.clientSet.size)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:center">${fmtNum(v.count)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;color:#16a34a">${fmtKg(v.kg)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;min-width:120px">
              <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden">
                  <div style="width:${barW}%;background:#1a3f5c;height:100%;border-radius:4px"></div>
                </div>
                <span style="font-size:0.72rem;color:#64748b;white-space:nowrap">${pct}%</span>
              </div>
            </td>
          </tr>`;
        }).join('');

      // Receitas pendentes
      const pendingRows = pendingRecipes
        .sort((a,b) => (a.created_at||'') < (b.created_at||'') ? -1 : 1)
        .map(r => {
          const c = clients.find(cl => Number(cl.id) === Number(r.client_id));
          const dias = r.created_at ? Math.floor((Date.now() - new Date(r.created_at)) / 86400000) : 0;
          const diasColor = dias > 7 ? '#dc2626' : dias > 3 ? '#b45309' : '#64748b';
          return `<tr>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;font-weight:600">${c?.name||'?'}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9">${r.name||'—'}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;color:#64748b">${r.created_by||'—'}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:center;font-weight:600;color:${diasColor}">${dias} dias</td>
          </tr>`;
        }).join('') || `<tr><td colspan="4" style="padding:14px;text-align:center;color:#16a34a;font-weight:600">✅ Nenhuma receita pendente</td></tr>`;

      const now = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const periodLabel = days === 365 ? 'Últimos 12 meses' : `Últimos ${days} dias`;

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório Executivo — Hygicare Lavanderia</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:13px;color:#1e293b;padding:20px}
.abar{position:sticky;top:0;z-index:99;background:#1a3f5c;padding:6px 12px;display:flex;align-items:center;gap:8px;margin-bottom:14px;border-radius:6px}
.abar button{padding:5px 14px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer}
.btn-x{background:#fff;color:#1a3f5c}.btn-p{background:#16a34a;color:#fff}
.abar-lbl{color:#d1d5db;font-size:11px;flex:1}
.doc-hdr{background:#1a3f5c;color:#fff;padding:20px 24px;border-radius:10px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
.doc-hdr-logo{font-weight:900;font-size:20px;letter-spacing:.04em}
.doc-hdr-sub{font-size:10px;opacity:.65;letter-spacing:.06em;text-transform:uppercase;margin-top:2px}
.doc-hdr-info{text-align:right;font-size:11px;opacity:.75}
h2{font-size:0.85rem;font-weight:700;color:#1a3f5c;margin:20px 0 10px;border-bottom:2px solid #e5e7eb;padding-bottom:4px;text-transform:uppercase;letter-spacing:.05em}
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px}
thead th{background:#1a3f5c;color:#fff;padding:7px 10px;text-align:left;font-size:0.72rem;font-weight:700}
.footer{margin-top:24px;font-size:0.7rem;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:10px}
@media print{.abar{display:none}body{padding:10px}}
</style></head><body>
<div class="abar">
  <button class="btn-x" onclick="window.close()">✕ Fechar</button>
  <button class="btn-p" onclick="window.print()">🖨️ Salvar PDF</button>
  <span class="abar-lbl">Relatório Executivo — Hygicare Lavanderia — ${periodLabel}</span>
</div>
<div class="doc-hdr">
  <div>${getPdfLogoHtml(true)}</div>
  <div class="doc-hdr-info">📊 Relatório Executivo<br>${periodLabel}<br>${now}</div>
</div>

${kpisHtml}

<h2>🏆 Ranking de Clientes — kg processado</h2>
<table>
  <thead><tr><th style="text-align:center">#</th><th>Cliente</th><th>Cidade</th><th>Vendedor</th><th style="text-align:center">Registros</th><th style="text-align:right">Total kg</th><th style="text-align:right">Cancelado</th></tr></thead>
  <tbody>${rankingRows || '<tr><td colspan="7" style="padding:14px;text-align:center;color:#94a3b8">Nenhum registro no período</td></tr>'}</tbody>
</table>

<h2>😴 Clientes sem atividade no período</h2>
<table>
  <thead><tr><th>Cliente</th><th>Cidade</th><th>Vendedor</th></tr></thead>
  <tbody>${inactiveRows}</tbody>
</table>

<h2>👨‍💼 Performance por Vendedor</h2>
<table>
  <thead><tr><th>Vendedor</th><th style="text-align:center">Clientes ativos</th><th style="text-align:center">Registros</th><th style="text-align:right">Total kg</th></tr></thead>
  <tbody>${sellerRows || '<tr><td colspan="4" style="padding:14px;text-align:center;color:#94a3b8">Nenhum dado no período</td></tr>'}</tbody>
</table>

<h2>🏙️ Performance por Cidade</h2>
<table>
  <thead><tr><th>Cidade</th><th style="text-align:center">Clientes</th><th style="text-align:center">Registros</th><th style="text-align:right">Total kg</th><th>Participação</th></tr></thead>
  <tbody>${cityRows || '<tr><td colspan="5" style="padding:14px;text-align:center;color:#94a3b8">Nenhum dado no período</td></tr>'}</tbody>
</table>

<h2>⏳ Receitas Pendentes de Aprovação</h2>
<table>
  <thead><tr><th>Cliente</th><th>Nome da Receita</th><th>Criado por</th><th style="text-align:center">Aguardando</th></tr></thead>
  <tbody>${pendingRows}</tbody>
</table>

<div class="footer">${getPdfFooterHtml('Relatório Executivo')}</div>
</body></html>`;

      win.document.write(html.replaceAll('#1a3f5c', getPdfColor()));
      win.document.close();
    });

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
      set('cfg-alert-days',   localStorage.getItem('hygicare_cfg_alert_days') || '60');
      const periodoCb = document.getElementById('cfg-periodo-habilitado');
      if (periodoCb) periodoCb.checked = localStorage.getItem('hygicare_periodo_habilitado') === 'true';

      // ID do script no card de sistema
      const gasIdEl = document.getElementById('admin-gas-id');
      if (gasIdEl) {
        const match = cfgGasUrl.match(/\/s\/([^/]+)\/exec/);
        gasIdEl.textContent = match ? match[1].slice(0, 20) + '…' : '—';
      }

      // Versão real do cache do service worker
      const swVerEl = document.getElementById('admin-sw-version');
      if (swVerEl && 'caches' in window) {
        caches.keys().then(keys => {
          const k = keys.find(k => k.startsWith('lavanderia-cache-'));
          swVerEl.textContent = k ? k.replace('lavanderia-cache-', '') : 'desconhecido';
        });
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
      const alertDays   = document.getElementById('cfg-alert-days')?.value.trim()    || '';

      if (gasUrl) { localStorage.setItem('hygicare_cfg_gas_url', gasUrl); CONFIG.GAS_URL = gasUrl; }
      if (sync)   { localStorage.setItem('hygicare_cfg_sync_interval', sync); CONFIG.SYNC_INTERVAL_HOURS = parseInt(sync); callGAS('upsert', 'Config', { chave: 'hygicare_cfg_sync_interval', valor: sync }); }
      if (sheets) localStorage.setItem('hygicare_cfg_sheets_url', sheets);
      if (alertDays && parseInt(alertDays) > 0) { localStorage.setItem('hygicare_cfg_alert_days', alertDays); callGAS('upsert', 'Config', { chave: 'hygicare_cfg_alert_days', valor: alertDays }); }
      localStorage.setItem('hygicare_cfg_notify_email', notifyEmail);

      // Persiste e-mail de notificação na aba Config do GAS para que "Testar E-mail" funcione
      if (notifyEmail) callGAS('upsert', 'Config', { chave: 'notification_email', valor: notifyEmail });

      const msg = document.getElementById('config-saved-msg');
      if (msg) { msg.textContent = '✅ Configuracoes salvas!'; setTimeout(() => msg.textContent = '', 3000); }
      refreshAdminPanel();
      testApis();
      toast('Configuracoes salvas!', 'success');
    });

    // ---- Cores dos Processos (Admin) — grupos com drag-and-drop ----
    let _pcaListenersSet = false;

    window._pcaDragStart = function(event) {
      event.dataTransfer.setData('text/plain', event.currentTarget.dataset.proc || '');
      event.currentTarget.style.opacity = '0.4';
      event.currentTarget.addEventListener('dragend', function() { this.style.opacity = ''; }, { once: true });
    };

    function _pcaSave(d) {
      const json = JSON.stringify(d);
      localStorage.setItem('hygicare_proc_groups', json);
      callGAS('upsert', 'Config', { chave: 'hygicare_proc_groups', valor: json });
    }

    window._pcaAssign = async function(sel) {
      const procName = sel.dataset.proc;
      const gi = sel.value === '' ? null : Number(sel.value);
      if (gi === null) return;
      const d = JSON.parse(localStorage.getItem('hygicare_proc_groups') || '{"groups":[]}');
      d.groups = d.groups || [];
      d.groups.forEach(g => { g.processes = (g.processes||[]).filter(p => p !== procName); });
      if (d.groups[gi]) {
        if (!d.groups[gi].processes) d.groups[gi].processes = [];
        if (!d.groups[gi].processes.includes(procName)) d.groups[gi].processes.push(procName);
      }
      _pcaSave(d);
      await renderProcColorsAdmin();
    };

    window._pcaDrop = async function(event, groupIdx) {
      event.preventDefault();
      event.currentTarget.style.background = '';
      event.currentTarget.style.borderColor = '';
      const procName = event.dataTransfer.getData('text/plain');
      if (!procName) return;
      const d = JSON.parse(localStorage.getItem('hygicare_proc_groups') || '{"groups":[]}');
      d.groups = d.groups || [];
      d.groups.forEach(g => { g.processes = (g.processes || []).filter(p => p !== procName); });
      if (groupIdx !== null && d.groups[groupIdx]) {
        if (!d.groups[groupIdx].processes) d.groups[groupIdx].processes = [];
        if (!d.groups[groupIdx].processes.includes(procName)) d.groups[groupIdx].processes.push(procName);
      }
      _pcaSave(d);
      await renderProcColorsAdmin();
    };

    async function renderProcColorsAdmin() {
      const container = document.getElementById('admin-proc-colors');
      if (!container) return;
      const processes = await dbGetAll_raw('processes');
      const d = JSON.parse(localStorage.getItem('hygicare_proc_groups') || '{"groups":[]}');
      const groups = d.groups || [];
      const assignedSet = new Set(groups.flatMap(g => g.processes || []));
      const allNames = [...new Set(processes.map(p => (p.name || '').toUpperCase().trim()).filter(Boolean))].sort();
      const ungrouped = allNames.filter(n => !assignedSet.has(n));

      const ungroupedHtml = ungrouped.length
        ? ungrouped.map(name => `
          <div class="pca-proc-item" draggable="true" data-proc="${escHtml(name)}"
               ondragstart="window._pcaDragStart(event)"
               style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.6rem;margin-bottom:0.2rem;background:#fff;border:1px solid var(--border);border-radius:6px;cursor:grab;font-size:0.83rem;font-weight:500;color:var(--text);user-select:none">
            <span style="color:var(--muted);font-size:0.65rem;letter-spacing:-1px">⠿</span>
            <span style="flex:1">${escHtml(name)}</span>
            ${groups.length ? `<select class="pca-assign-sel" data-proc="${escHtml(name)}"
                style="font-size:0.72rem;border:1px solid var(--border);border-radius:4px;padding:2px 4px;color:var(--muted);cursor:pointer;max-width:90px;background:#fff"
                onchange="window._pcaAssign(this)">
              <option value="">→ grupo</option>
              ${groups.map((g, gi) => `<option value="${gi}">${escHtml(g.name)}</option>`).join('')}
            </select>` : ''}
          </div>`).join('')
        : '<p style="color:var(--muted);font-size:0.78rem;text-align:center;padding:0.75rem 0;margin:0">✓ Todos os processos estão agrupados</p>';

      const groupsHtml = groups.length
        ? groups.map((g, gi) => `
          <div class="pca-group" id="pca-grp-${gi}" style="border:1px solid var(--border);border-radius:8px;margin-bottom:0.5rem;overflow:hidden">
            <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;background:#f1f5f9;border-bottom:1px solid var(--border)">
              <input type="color" value="${escHtml(g.color || '#607d8b')}" data-gidx="${gi}"
                     class="pca-grp-color"
                     style="width:30px;height:30px;border:1.5px solid var(--border);border-radius:6px;cursor:pointer;padding:1px;flex-shrink:0">
              <span style="font-size:0.88rem;font-weight:700;color:var(--text);flex:1">${escHtml(g.name)}</span>
              <button class="pca-del-grp" data-gidx="${gi}"
                      style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:0.85rem;padding:2px 6px;border-radius:4px"
                      title="Excluir grupo">✕</button>
            </div>
            <div class="pca-drop-zone" data-gidx="${gi}"
                 ondragover="event.preventDefault();event.currentTarget.style.background='#eff6ff'"
                 ondragleave="event.currentTarget.style.background=''"
                 ondrop="window._pcaDrop(event,${gi})"
                 style="min-height:48px;padding:0.35rem 0.5rem;background:#fff">
              ${(g.processes || []).map((pname, pi) => `
                <div style="display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0.5rem;margin-bottom:0.2rem;background:#f8fafc;border:1px solid var(--border);border-radius:5px;font-size:0.82rem">
                  <span class="pca-dot-${gi}" style="width:10px;height:10px;border-radius:50%;background:${escHtml(g.color||'#607d8b')};flex-shrink:0;border:1px solid rgba(0,0,0,0.1)"></span>
                  <span style="flex:1;font-weight:500;color:var(--text)">${escHtml(pname)}</span>
                  <button class="pca-rm-proc" data-gidx="${gi}" data-pidx="${pi}"
                          style="color:var(--muted);background:none;border:none;cursor:pointer;font-size:0.75rem;padding:1px 5px;border-radius:3px"
                          title="Remover do grupo">✕</button>
                </div>`).join('')}
              ${!(g.processes||[]).length ? '<p style="color:var(--muted);font-size:0.75rem;text-align:center;padding:0.4rem 0;margin:0">Arraste processos aqui</p>' : ''}
            </div>
          </div>`).join('')
        : '<p style="color:var(--muted);font-size:0.82rem;text-align:center;padding:0.75rem 0;margin:0">Nenhum grupo criado. Clique em "+ Novo" para começar.</p>';

      container.innerHTML = `
        <div class="pca-grid">
          <div>
            <div style="font-size:0.74rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:0.5rem">
              Sem grupo
            </div>
            <div id="pca-ungrouped"
                 ondragover="event.preventDefault();event.currentTarget.style.borderColor='#2563eb'"
                 ondragleave="event.currentTarget.style.borderColor=''"
                 ondrop="window._pcaDrop(event,null)"
                 style="min-height:80px;max-height:380px;overflow-y:auto;border:2px dashed var(--border);border-radius:8px;padding:0.4rem;background:#f9fafb;transition:border-color 0.15s">
              ${ungroupedHtml}
            </div>
          </div>
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
              <span style="font-size:0.74rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Grupos</span>
              <button class="pca-new-grp" style="font-size:0.78rem;padding:2px 10px;border:1.5px solid var(--primary);border-radius:6px;background:#fff;color:var(--primary);cursor:pointer;font-weight:700">+ Novo</button>
            </div>
            <div id="pca-groups" style="max-height:380px;overflow-y:auto">${groupsHtml}</div>
          </div>
        </div>`;

      if (!_pcaListenersSet) {
        _pcaListenersSet = true;
        container.addEventListener('click', async (e) => {
          if (e.target.closest('.pca-new-grp')) {
            const name = prompt('Nome do grupo (ex: Pesado, Leve):');
            if (!name || !name.trim()) return;
            const d2 = JSON.parse(localStorage.getItem('hygicare_proc_groups') || '{"groups":[]}');
            (d2.groups = d2.groups || []).push({ name: name.trim(), color: '#2563eb', processes: [] });
            _pcaSave(d2);
            await renderProcColorsAdmin();
          }
          const delGrp = e.target.closest('.pca-del-grp');
          if (delGrp) {
            const gi = Number(delGrp.dataset.gidx);
            const d2 = JSON.parse(localStorage.getItem('hygicare_proc_groups') || '{"groups":[]}');
            (d2.groups || []).splice(gi, 1);
            _pcaSave(d2);
            await renderProcColorsAdmin();
          }
          const rmProc = e.target.closest('.pca-rm-proc');
          if (rmProc) {
            const gi = Number(rmProc.dataset.gidx), pi = Number(rmProc.dataset.pidx);
            const d2 = JSON.parse(localStorage.getItem('hygicare_proc_groups') || '{"groups":[]}');
            if (d2.groups?.[gi]?.processes) d2.groups[gi].processes.splice(pi, 1);
            _pcaSave(d2);
            await renderProcColorsAdmin();
          }
        });
        container.addEventListener('change', (e) => {
          if (!e.target.classList.contains('pca-grp-color')) return;
          const gi = Number(e.target.dataset.gidx);
          const d2 = JSON.parse(localStorage.getItem('hygicare_proc_groups') || '{"groups":[]}');
          if (d2.groups?.[gi]) {
            d2.groups[gi].color = e.target.value;
            _pcaSave(d2);
            document.querySelectorAll(`.pca-dot-${gi}`).forEach(s => s.style.background = e.target.value);
          }
        });
      }
    }

    document.getElementById('btn-reset-proc-colors')?.addEventListener('click', () => {
      if (!confirm('Remover todos os grupos e configurações de cor?')) return;
      localStorage.removeItem('hygicare_proc_groups');
      localStorage.removeItem('hygicare_proc_colors');
      callGAS('upsert', 'Config', { chave: 'hygicare_proc_groups', valor: '' });
      renderProcColorsAdmin();
      toast('Configurações de cores removidas', 'info', 2000);
    });

    // Toggle período no formulário de registro
    document.getElementById('cfg-periodo-habilitado')?.addEventListener('change', function() {
      const val = String(this.checked);
      localStorage.setItem('hygicare_periodo_habilitado', val);
      callGAS('upsert', 'Config', { chave: 'hygicare_periodo_habilitado', valor: val });
      const endField = document.getElementById('prod-date-end-field');
      if (endField) endField.style.display = this.checked ? '' : 'none';
      toast(`Período ${this.checked ? 'habilitado — Data Início e Data Fim' : 'desabilitado — apenas Data de Início'}`, 'success', 3000);
    });

    // ---- Share modal ----
    const closeShareModal = () => {
      document.getElementById('modal-share').classList.add('hidden');
      _shareCtx = null;
    };

    document.getElementById('share-close')?.addEventListener('click', closeShareModal);
    document.getElementById('modal-share')?.addEventListener('click', e => {
      if (e.target === document.getElementById('modal-share')) closeShareModal();
    });

    function openNotifyEmail(to) {
      if (!to) return toast('Informe o e-mail do vendedor', 'error');
      const ctx = _shareCtx;
      if (!ctx) return;
      const { g } = ctx;
      const subject = `[Hygicare] Relatório disponível — ${g.clientName}`;
      const body = [
        'Olá,',
        '',
        'Um novo relatório operacional foi elaborado no sistema.',
        '',
        `Cliente: ${g.clientName}`,
        `Período: ${g.period}`,
        `Total lavado: ${g.totalKg || 0} kg`,
        `Gerado por: ${currentUser?.name || 'Sistema'}`,
        `Data: ${new Date().toLocaleString('pt-BR')}`,
        '',
        'Acesse o sistema para visualizar e salvar o PDF.',
        '',
        'Hygicare Lavanderia — Sistema de Gestão',
      ].join('\n');
      const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.open(mailto, '_blank');
      const statusEl = document.getElementById('share-status');
      if (statusEl) statusEl.textContent = `✅ E-mail aberto para ${to} — clique em Enviar no seu aplicativo`;
    }

    function buildShareText(g) {
      return [
        `📋 *Relatório Hygicare*`,
        ``,
        `👥 Cliente: ${g.clientName}`,
        `📅 Período: ${g.period}`,
        `⚖️ Total lavado: ${(g.totalKg || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})} kg`,
        `👤 Gerado por: ${currentUser?.name || 'Sistema'}`,
        `🗓️ Data: ${new Date().toLocaleString('pt-BR')}`,
        ``,
        `Acesse o sistema para visualizar e salvar o PDF.`,
      ].join('\n');
    }

    document.getElementById('share-btn-seller')?.addEventListener('click', () => {
      const email = document.getElementById('share-email-seller').value.trim();
      openNotifyEmail(email);
    });

    document.getElementById('share-btn-whatsapp')?.addEventListener('click', () => {
      const ctx = _shareCtx;
      if (!ctx) return;
      const text = buildShareText(ctx.g);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      const statusEl = document.getElementById('share-status');
      if (statusEl) statusEl.textContent = '💬 WhatsApp aberto — escolha o contato para enviar';
    });

    document.getElementById('share-btn-print')?.addEventListener('click', () => {
      if (_shareCtx) window._printGroup(_shareCtx.safeKey);
    });

    // Aplicar permissões de acesso nos itens de navegação
    // Pode ser chamada múltiplas vezes (ex: após sync atualizar permissões)
    function applyNavPermissions() {
      if (!currentUser || currentUser.role === 'admin') return;

      const map = {
        clients:      'screen-clients',
        machines:     'screen-machines',
        processes:    'screen-processes',
        form:         'screen-form',
        reports:      'screen-reports',
        charts:       'screen-charts',
        vazao:        'screen-vazao',
        recipes:      'screen-recipes',
        client_notes: 'screen-client-notes',
        pdf_reports:  'screen-pdf-reports',
        users:        'screen-users',
      };

      // Primeiro restaura visibilidade de todos os itens do mapa (incluindo nav-admin)
      [...Object.values(map), 'screen-admin'].forEach(screenId => {
        const navId = 'nav-' + screenId.replace('screen-', '');
        document.getElementById(navId)?.style.removeProperty('display');
        document.querySelector(`.bnav-btn[data-target="${screenId}"]`)?.style.removeProperty('display');
        document.querySelector(`.drawer-item[data-target="${screenId}"]`)?.style.removeProperty('display');
      });

      // Consultor/Diretor nunca acessa o admin
      if (currentUser.role === 'consultor' || currentUser.role === 'diretor') {
        document.getElementById('nav-admin')?.style.setProperty('display', 'none');
        document.querySelector('.bnav-btn[data-target="screen-admin"]')?.style.setProperty('display', 'none');
        document.querySelector('.drawer-item[data-target="screen-admin"]')?.style.setProperty('display', 'none');
      }

      const permsStr = (currentUser.permissions || '').trim();
      if (!permsStr) return; // sem restrições = acesso total
      const allowed = new Set(permsStr.split(',').map(s => s.trim()).filter(Boolean));
      // Se permissions tem SOMENTE chaves de ação (sem chaves de tela), não oculta nav
      const screenKeys = new Set(Object.keys(map));
      const hasAnyScreenKey = [...allowed].some(p => screenKeys.has(p));
      if (!hasAnyScreenKey) return;
      Object.entries(map).forEach(([perm, screenId]) => {
        if (allowed.has(perm)) return;
        const navId = 'nav-' + screenId.replace('screen-', '');
        document.getElementById(navId)?.style.setProperty('display', 'none');
        document.querySelector(`.bnav-btn[data-target="${screenId}"]`)?.style.setProperty('display', 'none');
        document.querySelector(`.drawer-item[data-target="${screenId}"]`)?.style.setProperty('display', 'none');
      });
      // Atualiza visibilidade do FAB com permissões atualizadas
      const _fab = document.getElementById('fab-btn');
      if (_fab) {
        const _activeScreen = [...document.querySelectorAll('.screen')].find(s => !s.classList.contains('hidden'))?.id;
        _fab.classList.toggle('hidden',
          _activeScreen === 'screen-form' || _activeScreen === 'screen-home' || !canDo('send_record')
        );
      }
    }
    applyNavPermissions();

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
      if (!canDo('create_client')) return toast('Sem permissão para criar clientes.', 'error');
      editClientIdField.value = '';
      document.getElementById('form-client-title').textContent = 'Novo Cliente';
      formClient.reset();
      formClientCard.classList.remove('hidden');
    };
    function _machineRowHtml(name = '', capacity = '') {
      return `<div class="multi-form-row">
        <div class="form-field" style="flex:2;margin:0"><label>Nome da Máquina *</label><input class="form-input mach-name" placeholder="Ex: Lavadora Industrial 1" value="${name}" required /></div>
        <div class="form-field" style="flex:0 0 110px;margin:0"><label>Cap. (kg) *</label><input class="form-input mach-cap" type="number" step="0.01" placeholder="50" value="${capacity}" required /></div>
        <button type="button" class="btn-rm-row" title="Remover">×</button>
      </div>`;
    }
    function _processRowHtml(name = '', capacity = '') {
      return `<div class="multi-form-row">
        <div class="form-field" style="flex:2;margin:0"><label>Nome do Processo *</label><input class="form-input proc-name" placeholder="Ex: Lavagem Pesada" value="${name}" required /></div>
        <div class="form-field" style="flex:0 0 120px;margin:0"><label>Cap. específica (kg)</label><input class="form-input proc-cap" type="number" step="0.01" placeholder="Opcional" value="${capacity}" /></div>
        <button type="button" class="btn-rm-row" title="Remover">×</button>
      </div>`;
    }

    document.getElementById('btn-new-machine').onclick = () => {
      if (!canDo('create_machine')) return toast('Sem permissão para criar máquinas.', 'error');
      editMachineIdField.value = '';
      document.getElementById('form-machine-title').textContent = 'Nova Máquina';
      machineClientSelect.value = '';
      document.getElementById('machine-rows').innerHTML = _machineRowHtml();
      document.getElementById('machine-add-row-wrap').style.display = '';
      formMachineCard.classList.remove('hidden');
    };
    document.getElementById('btn-new-process').onclick = () => {
      if (!canDo('create_process')) return toast('Sem permissão para criar processos.', 'error');
      editProcessIdField.value = '';
      document.getElementById('form-process-title').textContent = 'Novo Processo';
      processMachineSelect.value = '';
      document.getElementById('process-rows').innerHTML = _processRowHtml();
      document.getElementById('process-add-row-wrap').style.display = '';
      formProcessCard.classList.remove('hidden');
    };

    document.getElementById('btn-add-machine-row')?.addEventListener('click', () => {
      document.getElementById('machine-rows').insertAdjacentHTML('beforeend', _machineRowHtml());
    });
    document.getElementById('btn-add-process-row')?.addEventListener('click', () => {
      document.getElementById('process-rows').insertAdjacentHTML('beforeend', _processRowHtml());
    });
    document.getElementById('machine-rows')?.addEventListener('click', e => {
      if (e.target.classList.contains('btn-rm-row')) {
        const rows = document.querySelectorAll('#machine-rows .multi-form-row');
        if (rows.length > 1) e.target.closest('.multi-form-row').remove();
      }
    });
    document.getElementById('process-rows')?.addEventListener('click', e => {
      if (e.target.classList.contains('btn-rm-row')) {
        const rows = document.querySelectorAll('#process-rows .multi-form-row');
        if (rows.length > 1) e.target.closest('.multi-form-row').remove();
      }
    });

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

    // Mapa de sheets individuais — definido ANTES do sync silencioso para evitar TDZ
    const SHEET_MAP = {
      clients:       { sheet: SHEETS.CLIENTS,       store: 'clients',       label: 'clientes'        },
      machines:      { sheet: SHEETS.MACHINES,      store: 'machines',      label: 'máquinas'        },
      processes:     { sheet: SHEETS.PROCESSES,     store: 'processes',     label: 'processos'       },
      records:       { sheet: SHEETS.RECORDS,       store: 'records',       label: 'registros'       },
      users:         { sheet: SHEETS.USERS,         store: 'users',         label: 'usuários'        },
      vazoes:          { sheet: SHEETS.VAZOES,          store: 'vazoes',          label: 'vazões'           },
      vazao_records:   { sheet: SHEETS.VAZAO_RECORDS,   store: 'vazao_records',   label: 'leituras vazão'   },
      recipes:         { sheet: SHEETS.RECIPES,         store: 'recipes',         label: 'receitas'         },
      recipe_products: { sheet: SHEETS.RECIPE_PRODUCTS, store: 'recipe_products', label: 'produtos receita' },
      client_notes:    { sheet: SHEETS.CLIENT_NOTES,    store: 'client_notes',    label: 'histórico clientes' },
    };

    // Sync silencioso na inicialização — preenche IndexedDB a partir do GAS
    // sem exibir diálogos de confirmação, para que dados apareçam automaticamente.
    (async () => {
      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) return;
      if (!navigator.onLine) return;
      if (_fullSyncRunning) return;
      try {
        // Usa lastFullSyncTime: sync parcial (só usuários) não bloqueia o sync completo
        const lastFullSync = localStorage.getItem('lastFullSyncTime');
        const secsAgo = lastFullSync ? (Date.now() - new Date(lastFullSync).getTime()) / 1000 : Infinity;
        if (secsAgo < 30) return;

        _fullSyncRunning = true;
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
        localStorage.setItem('lastFullSyncTime', new Date().toISOString());
        await syncAdminConfig();

        // Atualiza currentUser com dados frescos do banco (permissões, sellerName, etc.)
        if (currentUser) {
          const _freshUsers = await _originalGetAll('users');
          const _me = _freshUsers.find(u => u.username === currentUser.username);
          if (_me) {
            currentUser.sellers_access = _me.sellers_access || '';
            currentUser.permissions    = _me.permissions    || '';
            currentUser.manager        = _me.manager        || '';
            currentUser.sellerName     = _me.sellerName     || _me.name || '';
            localStorage.setItem('lavanderia_session', JSON.stringify(currentUser));
            applyNavPermissions();
          }
        }

        await refreshClientsSelects();
        await renderClientsList();
        await renderMachinesList();
        await renderProcessesList();
        await refreshReportClientFilter();
        await renderRecordsList();
        if (!document.getElementById('screen-home')?.classList.contains('hidden')) {
          await initHomeScreen();
        }
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
      finally { _fullSyncRunning = false; }
    })();

    async function doRefresh(target = 'all', skipConfirm = false) {
      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) {
        return toast('Configure a URL do Google Apps Script no Painel Admin!', 'warning');
      }

      const isAll = target === 'all';
      const labelTarget = isAll ? 'Todos os dados' : (SHEET_MAP[target]?.label || target);

      if (isAll && _fullSyncRunning) {
        return toast('Sincronização já em andamento...', 'info', 2000);
      }

      if (isAll && !skipConfirm) {
        const ok = await confirmAction('Buscar dados atualizados do Google Sheets?\nIsso consome uma chamada de API.', '🔄 Atualizar', false);
        if (!ok) return;
      }

      if (isAll) _fullSyncRunning = true;

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
            if (store === 'users' || items.length > 0) {
              const saved = await saveToStore(store, items);
              imported += saved;
            }
          } else {
            toast(`Erro ao buscar ${label}`, 'error');
          }
        }

        localStorage.setItem('lastSyncTime', new Date().toISOString());
        if (isAll) localStorage.setItem('lastFullSyncTime', new Date().toISOString());
        if (isAll) await syncAdminConfig();

        // Re-renderizar telas conforme o que foi atualizado
        const updated = isAll ? Object.keys(SHEET_MAP) : [target];

        // Atualizar currentUser ANTES dos re-renders para que canDo() use permissões corretas
        if ((updated.includes('users') || isAll) && currentUser) {
          const _freshUsers = await dbGetAll_raw('users');
          const _me = _freshUsers.find(u => u.username === currentUser.username);
          if (_me) {
            currentUser.sellers_access = _me.sellers_access || '';
            currentUser.permissions    = _me.permissions    || '';
            currentUser.manager        = _me.manager        || '';
            currentUser.sellerName     = _me.sellerName     || _me.name || '';
            localStorage.setItem('lavanderia_session', JSON.stringify(currentUser));
            // Re-aplica restrições de nav com as permissões atualizadas
            applyNavPermissions();
          }
        }

        if (updated.includes('clients') || updated.includes('machines') || updated.includes('processes') || isAll) {
          await refreshClientsSelects();
          await renderClientsList();
          await renderMachinesList();
          await renderProcessesList();
          await refreshReportClientFilter();
        }
        if (updated.includes('records') || isAll) {
          await renderRecordsList();
          // Atualiza KPIs da home se estiver visível
          if (!document.getElementById('screen-home')?.classList.contains('hidden')) {
            await initHomeScreen();
          }
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
          // currentUser já foi atualizado antes dos re-renders acima
          refreshSellerSelect();
          await renderUsersList();
        }
        if (updated.includes('recipes') || updated.includes('recipe_products') || isAll) {
          await renderRecipesList();
          await updateRecipeBadge();
        }
        if ((updated.includes('client_notes') || isAll) && !document.getElementById('screen-client-notes')?.classList.contains('hidden')) {
          await renderClientNotesList();
        }
        await updateSyncStatus();

        toast(`✅ "${labelTarget}" atualizado(s)! (${imported} registro(s))`, 'success');

      } catch (err) {
        console.error('❌ Erro no Atualizar:', err);
        const msg = err instanceof TypeError ? '❌ Sem conexão com a internet.' : `❌ Erro: ${err.message || err}`;
        toast(msg, 'error', 6000);
      } finally {
        if (isAll) _fullSyncRunning = false;
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
        if (btn.id === 'btn-force-sw-update') {
          _forceSwUpdate();
        } else {
          doRefresh(btn.dataset.sheet);
        }
      });
    });

    async function _forceSwUpdate() {
      toast('⏳ Limpando cache e atualizando app…', 'info', 3000);
      try {
        // Limpar todos os caches do SW
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        // Forçar o SW a buscar nova versão
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg) {
            await reg.update();
            // Se houver waiting SW, manda skipWaiting
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        }
      } catch(e) { /* ignora erros de cache */ }
      // Recarrega a página para pegar o novo SW
      window.location.reload(true);
    }

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
      if (storeName === 'recipes') {
        const existing = await dbGetAll_raw('recipes');
        const snapById = new Map(existing.map(r => [Number(r.id), r]));
        const gasIds = new Set(items.map(item => Number(item.id)));
        await clearStore('recipes');
        let saved = 0;
        for (const item of items) {
          try {
            const n = normalizeItem(item);
            const old = snapById.get(Number(n.id));
            // Preservar campos do novo schema que o GAS pode não ter ainda (migração)
            if (old?.replaces_id && !n.replaces_id) n.replaces_id = old.replaces_id;
            if (old?.name        && !n.name)        n.name         = old.name;
            if (old?.version     && !n.version)     n.version      = old.version;
            if (old?.all_machines != null && (n.all_machines == null || n.all_machines === '')) n.all_machines = old.all_machines;
            if (old?.machine_info && !n.machine_info) n.machine_info = old.machine_info;
            await dbPut('recipes', n);
            saved++;
          } catch (err) { console.warn('⚠️ Erro ao salvar recipe:', err, item); }
        }
        // Preservar receitas pendentes locais que ainda não chegaram ao GAS
        for (const local of existing) {
          if (!gasIds.has(Number(local.id)) && local.status === 'pending') {
            try { await dbPut('recipes', local); saved++; } catch (_) {}
          }
        }
        return saved;
      }

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
      // Para records: preservar price_kg local se o GAS não devolver o campo
      // (enquanto a coluna price_kg não existir na planilha)
      if (storeName === 'records') {
        const existingRecs = await _originalGetAll('records');
        const localByIdRec = new Map(existingRecs.map(r => [Number(r.id), r]));
        await clearStore('records');
        let saved = 0;
        for (const item of items) {
          const n = normalizeItem(item);
          const local = localByIdRec.get(Number(n.id));
          if (local?.price_kg && !n.price_kg) n.price_kg = local.price_kg;
          try { await dbPut('records', n); saved++; }
          catch (err) { console.warn('⚠️ Erro ao salvar record:', err, n); }
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

    // Índice sheet → entry de SHEET_MAP (para o post-save sync)
    const SHEET_MAP_BY_SHEET = Object.fromEntries(
      Object.values(SHEET_MAP).map(e => [e.sheet, e])
    );

    // Sync pontual de um único store após write no GAS
    const _postSaveTimers = {};
    async function _syncStoreFromSheet(sheetName) {
      const entry = SHEET_MAP_BY_SHEET[sheetName];
      if (!entry) return;
      if (!navigator.onLine || !CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) return;
      try {
        const r = await fetch(`${gasApiUrl()}?sheet=${sheetName}`);
        if (!r.ok) return;
        const items = (await r.json()).data || [];
        if (items.length > 0) await saveToStore(entry.store, items);
        if (entry.store === 'recipes' && !document.getElementById('screen-recipes')?.classList.contains('hidden')) {
          await renderRecipesList();
          await updateRecipeBadge();
        }
      } catch(e) { /* falha silenciosa */ }
    }
    function _scheduleSyncAfterSave(sheetName) {
      clearTimeout(_postSaveTimers[sheetName]);
      // 2s de delay: dá tempo ao GAS de persistir na planilha antes de re-buscar
      _postSaveTimers[sheetName] = setTimeout(() => _syncStoreFromSheet(sheetName), 2000);
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
        // Após write bem-sucedido, re-sincroniza o store afetado com a planilha
        if (['insert', 'update', 'delete'].includes(action) && sheetName !== 'Config') {
          _scheduleSyncAfterSave(sheetName);
        }
        return res.data || true;
      } catch (e) { console.warn('callGAS error:', e); return false; }
    }

    const postToSheetDB  = (sheet, data)     => callGAS('insert', sheet, data);
    const patchSheetDB   = (sheet, id, data) => callGAS('update', sheet, data, id);
    const deleteSheetDB  = (sheet, id)       => callGAS('delete', sheet, null, id);

    // Busca configurações de admin (grupos de cores, período) da aba Config
    // e aplica no localStorage — propaga para todos os usuários no próximo sync.
    async function syncAdminConfig() {
      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) return;
      if (!navigator.onLine) return;
      try {
        const r = await fetch(`${gasApiUrl()}?sheet=Config`);
        if (!r.ok) return;
        const res = await r.json();
        addApiCount(1, 'read');
        const rows = res.data || [];
        const managed = ['hygicare_proc_groups', 'hygicare_periodo_habilitado', 'hygicare_cfg_sync_interval', 'notification_email', 'hygicare_cfg_alert_days',
          'hygicare_logo_b64', 'pdf_color', 'pdf_company_name', 'pdf_company_subtitle', 'pdf_footer_text',
          'hygicare_machine_order', 'hygicare_process_order'];
        rows.forEach(row => {
          const key = String(row.chave);
          if (managed.includes(key) && row.valor !== undefined && row.valor !== null) {
            if (row.valor === '') {
              localStorage.removeItem(key);
              if (key === 'notification_email') localStorage.removeItem('hygicare_cfg_notify_email');
            } else {
              localStorage.setItem(key, String(row.valor));
              if (key === 'hygicare_cfg_sync_interval') {
                const v = parseInt(row.valor);
                if (!isNaN(v) && v > 0) CONFIG.SYNC_INTERVAL_HOURS = v;
              }
              if (key === 'notification_email') {
                localStorage.setItem('hygicare_cfg_notify_email', String(row.valor));
              }
            }
          }
        });
      } catch(e) { /* silencioso — não bloqueia a experiência */ }
    }


    // =====================================================
    formClient.addEventListener('submit', async e => {
      e.preventDefault();
      if (_saving) return;
      const data = Object.fromEntries(new FormData(formClient).entries());
      data.send_client = !!data.send_client;
      data.send_seller = !!data.send_seller;
      data.vazao_only  = !!data.vazao_only;

      const editId = editClientIdField.value ? Number(editClientIdField.value) : null;
      const submitBtn = formClient.querySelector('button[type="submit"]');
      setSaving(true, submitBtn);
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
      } finally {
        setSaving(false, submitBtn);
      }
    });

    // =====================================================
    // FORMULÁRIO — MÁQUINAS
    // =====================================================
    formMachine.addEventListener('submit', async e => {
      e.preventDefault();
      if (_saving) return;
      const clientId = Number(machineClientSelect.value);
      if (!clientId) return toast('Selecione um cliente', 'warning');

      const editId = editMachineIdField.value ? Number(editMachineIdField.value) : null;
      const submitBtn = formMachine.querySelector('button[type="submit"]');
      setSaving(true, submitBtn);
      try {
        if (editId) {
          // Edição: usa a linha única (input.mach-name / mach-cap)
          const row = document.querySelector('#machine-rows .multi-form-row');
          const data = { id: editId, client_id: clientId,
            name: row.querySelector('.mach-name').value.trim(),
            capacity: parseFloat(row.querySelector('.mach-cap').value) || 0 };
          const existing = (await dbGetAll_raw('machines')).find(m => Number(m.id) === editId);
          data.created_at = existing?.created_at || new Date().toISOString();
          await dbPut('machines', data);
          const ok = await patchSheetDB(SHEETS.MACHINES, editId, data);
          toast(ok ? 'Máquina atualizada e sincronizada!' : 'Máquina atualizada localmente', ok ? 'success' : 'warning');
        } else {
          // Criação: itera todas as linhas
          const rows = [...document.querySelectorAll('#machine-rows .multi-form-row')];
          const allClients = await dbGetAll_raw('clients');
          const c = allClients.find(c => Number(c.id) === Number(clientId));
          let saved = 0;
          for (const row of rows) {
            const name = row.querySelector('.mach-name').value.trim();
            if (!name) continue;
            const data = { client_id: clientId, name,
              capacity: parseFloat(row.querySelector('.mach-cap').value) || 0,
              created_at: new Date().toISOString() };
            const id = await dbAdd('machines', data);
            data.id = id;
            await postToSheetDB(SHEETS.MACHINES, data);
            notifyEmail('nova_maquina', { name, clientName: c?.name || '' });
            saved++;
          }
          toast(saved > 1 ? `${saved} máquinas salvas!` : 'Máquina salva!', 'success');
        }

        await refreshMachinesForProcessSelect();
        await renderMachinesList();
        await updateSyncStatus();
        closePanel(formMachineCard, formMachine);
        document.getElementById('machine-rows').innerHTML = '';

      } catch (err) {
        toast('Erro ao salvar máquina: ' + err.message, 'error');
      } finally {
        setSaving(false, submitBtn);
      }
    });

    // =====================================================
    // FORMULÁRIO — PROCESSOS
    // =====================================================
    formProcess.addEventListener('submit', async e => {
      e.preventDefault();
      if (_saving) return;
      const machineId = Number(processMachineSelect.value);
      if (!machineId) return toast('Selecione uma máquina', 'warning');

      const editId = editProcessIdField.value ? Number(editProcessIdField.value) : null;
      const submitBtn = formProcess.querySelector('button[type="submit"]');
      setSaving(true, submitBtn);
      try {
        if (editId) {
          const row = document.querySelector('#process-rows .multi-form-row');
          const capVal = row.querySelector('.proc-cap').value;
          const data = { id: editId, machine_id: machineId,
            name: row.querySelector('.proc-name').value.trim(),
            capacity: capVal ? parseFloat(capVal) : null };
          const existing = (await dbGetAll_raw('processes')).find(p => Number(p.id) === editId);
          data.created_at = existing?.created_at || new Date().toISOString();
          await dbPut('processes', data);
          const ok = await patchSheetDB(SHEETS.PROCESSES, editId, data);
          toast(ok ? 'Processo atualizado e sincronizado!' : 'Processo atualizado localmente', ok ? 'success' : 'warning');
        } else {
          const rows = [...document.querySelectorAll('#process-rows .multi-form-row')];
          const allMachines = await dbGetAll_raw('machines');
          const m = allMachines.find(m => Number(m.id) === Number(machineId));
          const existing = (await dbGetAll_raw('processes')).filter(p => Number(p.machine_id) === machineId);
          const existingNames = new Set(existing.map(p => (p.name || '').toLowerCase().trim()));
          let saved = 0, skipped = 0;
          for (const row of rows) {
            const name = row.querySelector('.proc-name').value.trim();
            if (!name) continue;
            if (existingNames.has(name.toLowerCase())) { skipped++; continue; }
            const capVal = row.querySelector('.proc-cap').value;
            const data = { machine_id: machineId, name,
              capacity: capVal ? parseFloat(capVal) : null,
              created_at: new Date().toISOString() };
            const id = await dbAdd('processes', data);
            data.id = id;
            await postToSheetDB(SHEETS.PROCESSES, data);
            notifyEmail('novo_processo', { name, machineName: m?.name || '' });
            saved++;
          }
          if (skipped > 0) toast(`⚠️ ${skipped} processo(s) ignorado(s) — já existem nessa máquina`, 'warning', 4000);
          if (saved > 0) toast(saved > 1 ? `${saved} processos salvos!` : 'Processo salvo!', 'success');
          else if (skipped === 0) toast('Nenhum processo para salvar', 'warning');
        }

        await renderProcessesList();
        await updateSyncStatus();
        closePanel(formProcessCard, formProcess);
        document.getElementById('process-rows').innerHTML = '';

      } catch (err) {
        toast('Erro ao salvar processo: ' + err.message, 'error');
      } finally {
        setSaving(false, submitBtn);
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
      formClient.name.value         = c.name || '';
      formClient.city.value         = c.city || '';
      formClient.seller.value       = c.seller || '';
      formClient.email_client.value = c.email_client || '';
      formClient.email_seller.value = c.email_seller || '';
      formClient.price_kg.value     = c.price_kg || '';
      formClient.send_client.checked = !!c.send_client;
      formClient.send_seller.checked = !!c.send_seller;
      formClient.vazao_only.checked  = !!c.vazao_only;
      formClientCard.classList.remove('hidden');
      formClientCard.scrollIntoView({ behavior: 'smooth' });
    }

    async function deleteClient(id, el) {
      const records = await dbGetAll_raw('records');
      const hasRecords = records.some(r => Number(r.client_id) === Number(id));
      const msg = hasRecords
        ? '⚠️ Este cliente possui registros de produção vinculados.\n\nExcluir mesmo assim? Todas as máquinas, processos e registros serão removidos.'
        : 'Excluir este cliente? Todas as máquinas e processos vinculados também serão removidos.';
      if (!await confirmAction(msg, 'Excluir')) return;

      if (el) { el.disabled = true; el.textContent = '⏳'; }
      const gasOk = await deleteSheetDB(SHEETS.CLIENTS, id);
      if (!gasOk && navigator.onLine) {
        if (!await confirmAction('Não foi possível excluir no Google Sheets.\nExcluir apenas localmente?', 'Excluir local')) {
          if (el) { el.disabled = false; el.textContent = '🗑️'; }
          return;
        }
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
      machineClientSelect.value = m.client_id;
      document.getElementById('machine-rows').innerHTML = _machineRowHtml(m.name || '', m.capacity || '');
      document.getElementById('machine-add-row-wrap').style.display = 'none';
      formMachineCard.classList.remove('hidden');
      formMachineCard.scrollIntoView({ behavior: 'smooth' });
    }

    async function deleteMachine(id, el) {
      const records = await dbGetAll_raw('records');
      const hasRecords = records.some(r => Number(r.machine_id) === Number(id));
      const msg = hasRecords
        ? '⚠️ Esta máquina possui registros de produção vinculados.\n\nExcluir mesmo assim? Os processos e registros vinculados serão removidos.'
        : 'Excluir esta máquina? Os processos vinculados também serão removidos.';
      if (!await confirmAction(msg, 'Excluir')) return;
      if (el) { el.disabled = true; el.textContent = '⏳'; }
      const gasOk = await deleteSheetDB(SHEETS.MACHINES, id);
      if (!gasOk && navigator.onLine) {
        if (!await confirmAction('Não foi possível excluir no Google Sheets.\nExcluir apenas localmente?', 'Excluir local')) {
          if (el) { el.disabled = false; el.textContent = '🗑️'; }
          return;
        }
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
      processMachineSelect.value = p.machine_id;
      document.getElementById('process-rows').innerHTML = _processRowHtml(p.name || '', p.capacity || '');
      document.getElementById('process-add-row-wrap').style.display = 'none';
      formProcessCard.classList.remove('hidden');
      formProcessCard.scrollIntoView({ behavior: 'smooth' });
    }

    async function deleteProcess(id, el) {
      if (!await confirmAction('Excluir este processo?', 'Excluir')) return;
      if (el) { el.disabled = true; el.textContent = '⏳'; }
      const gasOk = await deleteSheetDB(SHEETS.PROCESSES, id);
      if (!gasOk && navigator.onLine) {
        if (!await confirmAction('Não foi possível excluir no Google Sheets.\nExcluir apenas localmente?', 'Excluir local')) {
          if (el) { el.disabled = false; el.textContent = '🗑️'; }
          return;
        }
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
    let _clientsGrouped = false;
    function _clientItemHtml(c) {
      const vazaoOnly = !!c.vazao_only;
      return `
        <div class="list-item"${vazaoOnly ? ' style="border-left:3px solid #0ea5e9;opacity:0.92"' : ''}>
          <div class="list-item-content">
            <div class="list-item-name">
              ${vazaoOnly ? '💧' : '👤'} ${c.name}
              <span class="badge">${c.city || 'Sem cidade'}</span>
              ${vazaoOnly ? '<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:0.7em">Apenas Vazão</span>' : ''}
            </div>
            <div class="list-item-details">
              ${c.seller ? `<span class="detail-chip">👨‍💼 ${c.seller}</span>` : ''}
              ${c.price_kg ? `<span class="detail-chip">💰 R$ ${parseFloat(c.price_kg).toFixed(2)}/kg</span>` : ''}
              ${c.email_client ? `<span class="detail-chip">📧 ${c.email_client}</span>` : ''}
              ${c.send_client ? `<span class="badge badge-green">✉️ Envia cliente</span>` : ''}
              ${c.send_seller ? `<span class="badge badge-green">✉️ Envia vendedor</span>` : ''}
            </div>
          </div>
          <div class="list-item-actions">
            ${canDo('edit_client') ? `<button class="btn-edit" onclick="window._editClient(${c.id})">✏️ Editar</button>` : ''}
            ${canDo('delete_client') ? `<button class="btn-danger" onclick="window._deleteClient(${c.id}, this)">🗑️</button>` : ''}
          </div>
        </div>`;
    }

    async function renderClientsList(filter = '') {
      document.getElementById('btn-new-client')?.classList.toggle('hidden', !canDo('create_client'));
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

      if (_clientsGrouped) {
        const bySeller = {};
        for (const c of clients) {
          const s = c.seller || '(Sem vendedor)';
          if (!bySeller[s]) bySeller[s] = [];
          bySeller[s].push(c);
        }
        list.innerHTML = Object.entries(bySeller)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([seller, cs], idx) => {
            const bodyId = `sg-${idx}`;
            return `
            <div class="client-group">
              <div class="client-group-hdr" style="cursor:pointer;user-select:none"
                   onclick="(function(h){const b=document.getElementById('${bodyId}');const open=b.style.display!=='none';b.style.display=open?'none':'block';h.querySelector('.sg-arr').textContent=open?'▶':'▼';})(this)">
                <span class="sg-arr" style="font-size:0.65rem;color:#94a3b8;min-width:12px;margin-right:0.3rem">▼</span>
                👨‍💼 ${seller}<span class="count-badge" style="margin-left:auto">${cs.length}</span>
              </div>
              <div id="${bodyId}">${cs.map(_clientItemHtml).join('')}</div>
            </div>`;
          })
          .join('');
      } else {
        list.innerHTML = clients.map(_clientItemHtml).join('');
      }
    }

    // Busca em tempo real
    document.getElementById('search-clients').addEventListener('input', e => renderClientsList(e.target.value));

    // Toggle lista / agrupado por vendedor
    document.getElementById('clients-view-toggle')?.querySelectorAll('.qf-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.getElementById('clients-view-toggle').querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        _clientsGrouped = this.dataset.cv === 'group';
        renderClientsList(document.getElementById('search-clients')?.value || '');
      });
    });

    // =====================================================
    // RENDER — MÁQUINAS
    // =====================================================
    async function renderMachinesList(filter = '', clientFilter = 0) {
      document.getElementById('btn-new-machine')?.classList.toggle('hidden', !canDo('create_machine'));
      let machines = await getAll('machines');
      const clients  = await getAll('clients');
      // Para não-admin: restringir máquinas aos clientes acessíveis
      if (currentUser && currentUser.role !== 'admin') {
        const cIds = new Set(clients.map(c => Number(c.id)));
        machines = machines.filter(m => cIds.has(Number(m.client_id)));
      }
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

      const machOrder = _getMachOrder();
      const canEdit = canDo('edit_machine');
      list.innerHTML = Object.entries(byClient).sort((a,b) => a[0].localeCompare(b[0])).map(([clientName, { client, items }], idx) => {
        const groupId  = `mach-group-${idx}`;
        const clientId = client?.id;
        const ordered  = _applyOrder(items, machOrder, clientId, 'id');
        return `
        <div class="proc-client-group">
          <div class="client-group-separator" onclick="(function(el){const b=document.getElementById('${groupId}');const open=b.classList.toggle('collapsed');el.querySelector('.cg-chevron').style.transform=open?'rotate(-90deg)':'rotate(0deg)'})(this)" style="cursor:pointer;user-select:none">
            <span>👤 ${clientName}</span>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <span class="badge">${items.length} máquina(s)</span>
              <span class="cg-chevron" style="font-size:0.75rem;transition:transform 0.2s;display:inline-block">▼</span>
            </div>
          </div>
          <div id="${groupId}">
            ${ordered.map((m, i) => `
              <div class="list-item" data-machine-id="${m.id}">
                <div class="list-item-content">
                  <div class="list-item-name">
                    ⚙️ ${m.name}
                    <span class="badge badge-yellow">${m.capacity} kg</span>
                  </div>
                </div>
                <div class="list-item-actions">
                  ${canEdit ? `<div style="display:flex;flex-direction:column;gap:2px;align-self:center">
                    <button style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;width:24px;height:22px;padding:0;font-size:0.6rem;line-height:1;cursor:pointer;color:#475569;min-height:unset;opacity:${i===0?'0.3':'1'}" onclick="window._moveMachine(${m.id},${clientId},'up')" ${i===0?'disabled':''}>▲</button>
                    <button style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;width:24px;height:22px;padding:0;font-size:0.6rem;line-height:1;cursor:pointer;color:#475569;min-height:unset;opacity:${i===ordered.length-1?'0.3':'1'}" onclick="window._moveMachine(${m.id},${clientId},'down')" ${i===ordered.length-1?'disabled':''}>▼</button>
                  </div>` : ''}
                  ${canDo('edit_bomba') ? `<button class="btn-secondary btn-sm" onclick="window._manageVazoes(${m.id},'${m.name.replace(/'/g,"\\'")}')">💧 Vazões</button>` : ''}
                  ${canEdit ? `<button class="btn-edit" onclick="window._editMachine(${m.id})">✏️ Editar</button>` : ''}
                  ${canDo('delete_machine') ? `<button class="btn-danger" onclick="window._deleteMachine(${m.id}, this)">🗑️</button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `}).join('');
    }

    document.getElementById('search-machines').addEventListener('input', e => renderMachinesList(e.target.value));
    document.getElementById('filter-machine-client').addEventListener('change', e => renderMachinesList(document.getElementById('search-machines').value, Number(e.target.value)));

    window._moveMachine = async function(machId, clientId, dir) {
      const machines = await dbGetAll_raw('machines');
      const clientMachs = machines.filter(m => Number(m.client_id) === Number(clientId));
      const order = _getMachOrder();
      const key   = String(clientId);
      let arr = order[key] || clientMachs.map(m => Number(m.id));
      // Garantir que todos os IDs do cliente estejam no array
      clientMachs.forEach(m => { if (!arr.includes(Number(m.id))) arr.push(Number(m.id)); });
      const idx = arr.indexOf(Number(machId));
      if (idx < 0) return;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= arr.length) return;
      arr = _swapOrder(arr, arr[idx], arr[swapIdx]);
      order[key] = arr;
      _saveMachOrder(order);
      callGAS('upsert', 'Config', { chave: 'hygicare_machine_order', valor: JSON.stringify(order) });
      await renderMachinesList(document.getElementById('search-machines')?.value || '', Number(document.getElementById('filter-machine-client')?.value || 0));
    };

    // =====================================================
    // RENDER — PROCESSOS
    // =====================================================
    async function renderProcessesList(filter = '', machineFilter = 0) {
      document.getElementById('btn-new-process')?.classList.toggle('hidden', !canDo('create_process'));
      await refreshMachinesForProcessSelect();
      let processes = await getAll('processes');
      let machines  = await getAll('machines');
      const clients = await getAll('clients');
      // Para não-admin: restringir máquinas/processos aos clientes acessíveis
      if (currentUser && currentUser.role !== 'admin') {
        const cIds = new Set(clients.map(c => Number(c.id)));
        machines  = machines.filter(m => cIds.has(Number(m.client_id)));
        const mIds = new Set(machines.map(m => Number(m.id)));
        processes = processes.filter(p => mIds.has(Number(p.machine_id)));
      }
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

      const procOrder = _getProcOrder();
      const canEditP  = canDo('edit_process');
      list.innerHTML = Object.entries(byClient).sort((a,b) => a[0].localeCompare(b[0])).map(([clientName, { items }], idx) => {
        const groupId = `proc-group-${idx}`;
        // Agrupar itens por máquina para ordenação por máquina
        const byMach = {};
        items.forEach(item => {
          const mid = String(item.machine?.id || '0');
          if (!byMach[mid]) byMach[mid] = { machine: item.machine, procs: [] };
          byMach[mid].procs.push(item.p);
        });
        const orderedItems = [];
        Object.values(byMach).forEach(({ machine, procs }) => {
          const mid     = String(machine?.id || '0');
          const ordered = _applyOrder(procs, procOrder, mid, 'id');
          ordered.forEach(p => orderedItems.push({ p, machine }));
        });
        return `
        <div class="proc-client-group">
          <div class="client-group-separator" onclick="(function(el){const b=document.getElementById('${groupId}');const open=b.classList.toggle('collapsed');el.querySelector('.cg-chevron').style.transform=open?'rotate(-90deg)':'rotate(0deg)'})(this)" style="cursor:pointer;user-select:none">
            <span>👤 ${clientName}</span>
            <div style="display:flex;align-items:center;gap:0.5rem">
              <span class="badge">${items.length} processo(s)</span>
              <span class="cg-chevron" style="font-size:0.75rem;transition:transform 0.2s;display:inline-block">▼</span>
            </div>
          </div>
          <div id="${groupId}">
            ${orderedItems.map(({ p, machine }, i) => {
              const capStr = p.capacity ? `${p.capacity} kg` : `${machine?.capacity || 0} kg (da máquina)`;
              const mid    = machine?.id;
              // índice dentro da mesma máquina (para habilitar/desabilitar botões)
              const machProcs = orderedItems.filter(it => Number(it.machine?.id) === Number(mid));
              const posInMach = machProcs.indexOf(orderedItems[i]);
              const firstInMach = posInMach === 0;
              const lastInMach  = posInMach === machProcs.length - 1;
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
                    ${canEditP ? `<div style="display:flex;flex-direction:column;gap:2px;align-self:center">
                      <button style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;width:24px;height:22px;padding:0;font-size:0.6rem;line-height:1;cursor:pointer;color:#475569;min-height:unset;opacity:${firstInMach?'0.3':'1'}" onclick="window._moveProcess(${p.id},${mid},'up')" ${firstInMach?'disabled':''}>▲</button>
                      <button style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;width:24px;height:22px;padding:0;font-size:0.6rem;line-height:1;cursor:pointer;color:#475569;min-height:unset;opacity:${lastInMach?'0.3':'1'}" onclick="window._moveProcess(${p.id},${mid},'down')" ${lastInMach?'disabled':''}>▼</button>
                    </div>` : ''}
                    ${canEditP ? `<button class="btn-edit" onclick="window._editProcess(${p.id})">✏️ Editar</button>` : ''}
                    ${canDo('delete_process') ? `<button class="btn-danger" onclick="window._deleteProcess(${p.id}, this)">🗑️</button>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `}).join('');
    }

    document.getElementById('search-processes').addEventListener('input', e => renderProcessesList(e.target.value));
    document.getElementById('filter-process-machine').addEventListener('change', e => renderProcessesList(document.getElementById('search-processes').value, Number(e.target.value)));

    window._moveProcess = async function(procId, machId, dir) {
      const allProcs = await dbGetAll_raw('processes');
      const machProcs = allProcs.filter(p => Number(p.machine_id) === Number(machId));
      const order = _getProcOrder();
      const key   = String(machId);
      let arr = order[key] || machProcs.map(p => Number(p.id));
      machProcs.forEach(p => { if (!arr.includes(Number(p.id))) arr.push(Number(p.id)); });
      const idx = arr.indexOf(Number(procId));
      if (idx < 0) return;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= arr.length) return;
      arr = _swapOrder(arr, arr[idx], arr[swapIdx]);
      order[key] = arr;
      _saveProcOrder(order);
      callGAS('upsert', 'Config', { chave: 'hygicare_process_order', valor: JSON.stringify(order) });
      await renderProcessesList(document.getElementById('search-processes')?.value || '', Number(document.getElementById('filter-process-machine')?.value || 0));
    };

    // =====================================================
    // PRODUÇÃO
    // =====================================================
    prodClientSelect.addEventListener('change', async e => {
      const clientId = Number(e.target.value);
      await renderMachinesAndProcesses(clientId);

      // Mostrar último relatório pelo calendário (date_end mais recente)
      const infoEl  = document.getElementById('last-report-info');
      const datesEl = document.getElementById('last-report-dates');
      if (!infoEl || !datesEl) return;
      if (!clientId) { infoEl.style.display = 'none'; return; }
      const records = (await dbGetAll_raw('records')).filter(r => Number(r.client_id) === clientId);
      if (!records.length) { infoEl.style.display = 'none'; return; }
      // Ordenar pelo date_end do calendário (mais recente primeiro)
      records.sort((a, b) => (b.date_end || b.date_start || '').localeCompare(a.date_end || a.date_start || ''));
      const last = records[0];
      const start = fmtDate(last.date_start);
      const end   = fmtDate(last.date_end);
      datesEl.textContent = start === end ? start : `${start} até ${end}`;
      infoEl.style.display = '';
    });

    async function renderMachinesAndProcesses(clientId) {
      const allMachines  = await getAll('machines');
      const rawMachines  = allMachines.filter(m => Number(m.client_id) === Number(clientId));
      const machines     = _applyOrder(rawMachines, _getMachOrder(), clientId, 'id');
      const processes    = await getAll('processes');
      const procOrder    = _getProcOrder();
      const container    = document.getElementById('machines-list');
      container.innerHTML = '';

      if (!machines.length) {
        container.innerHTML = `<div class="empty-state">⚙️ Este cliente não possui máquinas cadastradas.</div>`;
        return;
      }

      for (const m of machines) {
        const rawProcs = processes.filter(p => Number(p.machine_id) === Number(m.id));
        const procs    = _applyOrder(rawProcs, procOrder, m.id, 'id');
        const block = document.createElement('div');
        block.className = 'machine-block';
        block.dataset.machineId = m.id;

        let tableRows = '';
        for (const p of procs) {
          const cap = (p.capacity && p.capacity > 0) ? p.capacity : m.capacity;
          tableRows += `
            <tr class="process-row" data-process-id="${p.id}">
              <td><strong>${p.name}</strong></td>
              <td><input name="executed" type="number" min="0" step="1" /></td>
              <td><input name="canceled" type="number" min="0" step="1" /></td>
              <td><input name="capacity" type="number" step="0.01" value="${cap}" /></td>
              <td><input name="total" type="number" step="0.01" readonly /></td>
            </tr>
          `;
        }

        if (!procs.length) {
          tableRows = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:1rem">Nenhum processo cadastrado para esta máquina</td></tr>`;
        }

        const machTotalId = `mach-total-${m.id}`;
        block.innerHTML = `
          <div class="machine-block-header">
            <span>⚙️</span>
            <h4>${m.name} — ${m.capacity} kg</h4>
            <span class="mach-total-badge" id="${machTotalId}" style="margin-left:auto;font-size:0.8rem;font-weight:700;color:var(--success-dark);background:#d1fae5;border:1px solid #6ee7b7;border-radius:20px;padding:2px 10px;display:none">0,00 kg</span>
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

        // Auto-calcular total da linha e somatório da máquina
        const updateMachTotal = () => {
          let sum = 0;
          block.querySelectorAll('.process-row').forEach(r => {
            sum += parseFloat(r.querySelector('[name="total"]').value || 0);
          });
          const badge = document.getElementById(machTotalId);
          if (badge) {
            if (sum > 0) {
              badge.textContent = `Total: ${sum.toFixed(2).replace('.', ',')} kg`;
              badge.style.display = '';
            } else {
              badge.style.display = 'none';
            }
          }
        };

        block.querySelectorAll('.process-row').forEach(row => {
          ['executed', 'canceled', 'capacity'].forEach(name => {
            row.querySelector(`[name="${name}"]`).addEventListener('input', () => {
              const ex = parseFloat(row.querySelector('[name="executed"]').value || 0);
              const ca = parseFloat(row.querySelector('[name="canceled"]').value || 0);
              const cp = parseFloat(row.querySelector('[name="capacity"]').value || 0);
              const result = (ex + ca) * cp;
              row.querySelector('[name="total"]').value = result > 0 ? result.toFixed(2) : '';
              updateMachTotal();
            });
          });
        });
      }
    }

    async function _initFormScreen() {
      const periodoOn = localStorage.getItem('hygicare_periodo_habilitado') === 'true';
      const endField  = document.getElementById('prod-date-end-field');
      const startEl   = document.getElementById('prod-date-start');
      const endEl     = document.getElementById('prod-date-end');
      const banner    = document.getElementById('edit-mode-banner');
      const saveBtn   = document.getElementById('save-production');
      const titleEl   = document.getElementById('screen-form-title');
      const cardTitle = document.getElementById('prod-card-title');

      if (_editingRecord) {
        // ── MODO EDIÇÃO ─────────────────────────────────────
        if (titleEl)   titleEl.textContent  = '✏️ Editar Relatório';
        if (cardTitle) cardTitle.textContent = 'Editar Registro';
        if (saveBtn)   saveBtn.textContent   = '💾 Salvar Edição';
        if (banner) {
          banner.style.display = '';
          banner.innerHTML = `✏️ Editando: <strong>${escHtml(_editingRecord.clientName)}</strong> &nbsp;·&nbsp; ${escHtml(_editingRecord.period)}&nbsp;&nbsp;<button onclick="window._cancelEdit()" style="font-size:0.8rem;padding:2px 10px;border:1px solid #d97706;border-radius:6px;background:#fff7ed;color:#92400e;cursor:pointer;font-weight:600;margin-left:0.5rem">✕ Cancelar edição</button>`;
        }

        // Pré-selecionar cliente (bloqueado)
        prodClientSelect.value    = String(_editingRecord.clientId);
        prodClientSelect.disabled = true;

        // Datas do registro
        if (startEl) startEl.value = _editingRecord.dateStartRaw || '';
        const hasRange = _editingRecord.dateEndRaw && _editingRecord.dateEndRaw !== _editingRecord.dateStartRaw;
        if (endField) endField.style.display = hasRange ? '' : 'none';
        if (endEl)    endEl.value = hasRange ? (_editingRecord.dateEndRaw || '') : '';

        // Renderiza todas as máquinas + processos
        await renderMachinesAndProcesses(_editingRecord.clientId);

        // Pré-preenche valores existentes
        _editingRecord.rows.forEach(row => {
          const processRow = document.querySelector(`.process-row[data-process-id="${row.procId}"]`);
          if (!processRow) return;
          const execIn = processRow.querySelector('[name="executed"]');
          const cancIn = processRow.querySelector('[name="canceled"]');
          if (execIn) { execIn.value = row.executed; execIn.dispatchEvent(new Event('input')); }
          if (cancIn) { cancIn.value = row.canceled; cancIn.dispatchEvent(new Event('input')); }
        });

      } else {
        // ── MODO NOVO REGISTRO ──────────────────────────────
        if (titleEl)   titleEl.textContent  = '📝 Gerar Relatório';
        if (cardTitle) cardTitle.textContent = 'Novo Registro';
        if (saveBtn)   saveBtn.textContent   = '💾 Salvar';
        if (banner)    banner.style.display  = 'none';
        prodClientSelect.disabled = false;
        if (endField) endField.style.display = periodoOn ? '' : 'none';

        const today = new Date().toISOString().slice(0, 10);
        if (periodoOn) {
          if (startEl && !startEl.value) startEl.value = today.slice(0, 7) + '-01';
          if (endEl   && !endEl.value)   endEl.value   = today;
        } else {
          if (startEl && !startEl.value) startEl.value = today;
          if (endEl) endEl.value = '';
        }

        const clientId = Number(prodClientSelect.value);
        if (clientId) await renderMachinesAndProcesses(clientId);
      }
    }

    window._cancelEdit = function() {
      _clearEditMode();
      show('screen-reports');
      renderRecordsList();
    };

    document.getElementById('save-production').addEventListener('click', async () => {
      if (!canDo('send_record')) return toast('Sem permissão para registrar produção.', 'error');
      const clientId  = Number(prodClientSelect.value);
      if (!clientId) return toast('Selecione um cliente', 'warning');
      const isEditMode = !!_editingRecord;
      const editGroup  = _editingRecord;
      const periodoOn  = localStorage.getItem('hygicare_periodo_habilitado') === 'true';
      let dateStart = document.getElementById('prod-date-start').value;
      let dateEnd   = (periodoOn || isEditMode) ? (document.getElementById('prod-date-end').value || dateStart) : dateStart;
      if (!dateStart) return toast('Preencha a data', 'warning');

      // Auto-corrigir sobreposição apenas em modo criação
      if (!isEditMode) {
        const prev = (await dbGetAll_raw('records'))
          .filter(r => Number(r.client_id) === clientId && r.date_end);
        if (prev.length) {
          const maxEnd = prev.reduce((m, r) => r.date_end > m ? r.date_end : m, '');
          if (maxEnd && maxEnd === dateStart) {
            const d = new Date(dateStart + 'T00:00:00');
            d.setDate(d.getDate() + 1);
            dateStart = d.toISOString().slice(0, 10);
            document.getElementById('prod-date-start').value = dateStart;
            toast(`Início ajustado para ${fmtDate(dateStart)} — evitando sobreposição com o período anterior`, 'info', 5000);
          }
        }
      }

      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) {
        return toast('Configure a URL do Google Apps Script no Painel Admin!', 'warning');
      }

      // Captura o preço/kg do cliente no momento do envio (snapshot histórico)
      const _allClientsSnap = await dbGetAll_raw('clients');
      const _clientSnap = _allClientsSnap.find(c => Number(c.id) === clientId);
      const _priceKgSnap = parseFloat(_clientSnap?.price_kg || 0) || 0;

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
            rows.push({ client_id: clientId, machine_id: machineId, process_id: procId, executed, canceled, capacity, total, date_start: dateStart, date_end: dateEnd, price_kg: _priceKgSnap || undefined, created_at: new Date().toISOString(), synced_at: new Date().toISOString() });
          }
        });
      });

      if (!rows.length) return toast('Nenhum dado preenchido para salvar', 'warning');
      if (_saving) return;

      const btn        = document.getElementById('save-production');
      const progressEl = document.getElementById('save-progress');
      const logEl      = document.getElementById('save-progress-log');

      // Busca nomes para exibir no log
      const allMachines  = await dbGetAll_raw('machines');
      const allProcesses = await dbGetAll_raw('processes');

      const logLine = (icon, msg) => {
        const line = document.createElement('div');
        line.textContent = `${icon} ${msg}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
      };

      setSaving(true, btn, '⏳ Enviando...');
      logEl.innerHTML = '';
      progressEl.classList.remove('hidden');
      logLine('📋', `${rows.length} linha(s) a enviar...`);

      try {
        // ── MODO EDIÇÃO: apaga registros antigos antes de reinserir ──
        if (isEditMode && editGroup) {
          const oldRecs = (await dbGetAll_raw('records')).filter(r =>
            Number(r.client_id) === editGroup.clientId &&
            (r.date_start || '').slice(0, 10) === editGroup.dateStartRaw &&
            (r.date_end   || '').slice(0, 10) === editGroup.dateEndRaw
          );
          logLine('🗑️', `Removendo ${oldRecs.length} linha(s) antigas...`);
          for (const r of oldRecs) {
            await dbDelete('records', r.id);
            await deleteSheetDB(SHEETS.RECORDS, r.id);
          }
        }
        let synced = 0;
        for (const r of rows) {
          const machine = allMachines.find(m => Number(m.id) === Number(r.machine_id));
          const process = allProcesses.find(p => Number(p.id) === Number(r.process_id));
          const label   = `${machine?.name || 'Máq.'} › ${process?.name || 'Proc.'} (exec: ${r.executed}, cancel: ${r.canceled})`;

          logLine('⏳', `Enviando: ${label}`);

          const newId   = await dbAdd('records', r);
          const rWithId = { ...r, id: newId };
          await dbPut('records', rWithId);

          const ok = await callGAS('insert', SHEETS.RECORDS, rWithId);
          if (ok) {
            synced++;
            // Substitui a última linha pelo check
            logEl.lastChild.textContent = `✅ ${label}`;
          } else {
            await dbDelete('records', newId);
            logEl.lastChild.textContent = `❌ Falhou: ${label}`;
            logLine('🛑', 'Envio interrompido — verifique a conexão e tente novamente.');
            toast('Erro ao enviar. Verifique a conexão.', 'error', 7000);
            return;
          }
        }

        logLine('🎉', `Concluído! ${synced} linha(s) registradas com sucesso.`);

        localStorage.setItem('lastSyncTime', new Date().toISOString());
        localStorage.setItem('hygicare_last_client', String(clientId));
        await updateSyncStatus();

        const allClients = await dbGetAll_raw('clients');
        const c = allClients.find(c => Number(c.id) === clientId);
        const clientName = c?.name || `#${clientId}`;

        if (isEditMode) {
          _clearEditMode();
          toast(`✅ Edição salva com sucesso!`, 'success', 5000);
          await renderRecordsList();
          show('screen-reports');
        } else {
          await renderRecordsList();
          toast(`✅ ${synced} registro(s) enviados com sucesso!`, 'success', 5000);
        }

        // Notificação ao vendedor — opt-in via toast (WhatsApp + E-mail)
        const sellerEmail = c?.email_seller || localStorage.getItem('hygicare_cfg_notify_email') || '';
        const waText = [
          `📋 *Relatório Hygicare*`,
          ``,
          `👥 Cliente: ${clientName}`,
          `📅 Período: ${dateStart} a ${dateEnd}`,
          `👤 Gerado por: ${currentUser?.name || 'Sistema'}`,
          `🗓️ Data: ${new Date().toLocaleString('pt-BR')}`,
          ``,
          `Acesse o sistema para visualizar e salvar o PDF.`,
        ].join('\n');
        setTimeout(() => toast('Notificar via WhatsApp?', 'info', 9000, {
          label: '💬 Zap',
          fn: () => window.open(`https://wa.me/?text=${encodeURIComponent(waText)}`, '_blank')
        }), 800);
        if (sellerEmail) {
          const subject = `[Hygicare] Relatório disponível — ${clientName}`;
          const body = [
            'Olá,',
            '',
            'Um novo relatório operacional foi elaborado no sistema.',
            '',
            `Cliente: ${clientName}`,
            `Período: ${dateStart} a ${dateEnd}`,
            `Gerado por: ${currentUser?.name || 'Sistema'}`,
            `Data: ${new Date().toLocaleString('pt-BR')}`,
            '',
            'Acesse o sistema para visualizar e salvar o PDF.',
            '',
            'Hygicare Lavanderia — Sistema de Gestão',
          ].join('\n');
          const mailto = `mailto:${sellerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          setTimeout(() => toast('Notificar vendedor por e-mail?', 'info', 9000, {
            label: '📧 Enviar',
            fn: () => window.open(mailto, '_blank')
          }), 1800);
        }

        document.getElementById('prod-client-select').value = '';
        document.getElementById('prod-date-start').value = '';
        document.getElementById('prod-date-end').value = '';
        document.getElementById('machines-list').innerHTML = '';
        setTimeout(() => { progressEl.classList.add('hidden'); logEl.innerHTML = ''; }, 4000);

      } catch (err) {
        console.error('❌ Erro ao salvar produção:', err);
        toast('❌ Sem conexão com a internet. Estabeleça conexão e tente novamente.', 'error', 7000);
      } finally {
        setSaving(false, btn);
      }
    });

    // =====================================================
    // SELECTS
    // =====================================================
    async function refreshClientsSelects() {
      const clients = await getAll('clients');
      const lastClientId = localStorage.getItem('hygicare_last_client') || '';
      [machineClientSelect, prodClientSelect].forEach(sel => {
        const val = sel.value;
        sel.innerHTML = '<option value="">-- Selecione um cliente --</option>';
        clients.forEach(c => {
          const o = document.createElement('option');
          o.value = c.id;
          o.textContent = `${c.name} (${c.city || ''})`;
          sel.appendChild(o);
        });
        if (val) { sel.value = val; }
        else if (sel === prodClientSelect && lastClientId) {
          sel.value = lastClientId;
          if (sel.value) sel.dispatchEvent(new Event('change'));
        }
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
    // TELA AVISOS
    // =====================================================
    function updateAlertsBadge(count, alertDays) {
      ['nav-alerts-badge', 'drawer-alerts-badge', 'bnav-alerts-badge'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = count;
        el.classList.toggle('hidden', count === 0);
      });
      const widget = document.getElementById('home-alerts-widget');
      const homeCount = document.getElementById('home-alerts-count');
      const homeDays  = document.getElementById('home-alerts-days');
      if (widget)    widget.style.display = count > 0 ? '' : 'none';
      if (homeCount) homeCount.textContent = count;
      if (homeDays && alertDays) homeDays.textContent = alertDays;
      // Badge nativo no ícone do PWA (Android Chrome / iOS Safari 16.4+)
      if ('setAppBadge' in navigator) {
        if (count > 0) navigator.setAppBadge(count).catch(() => {});
        else           navigator.clearAppBadge().catch(() => {});
      }
    }

    async function _computeOverdue() {
      const alertDays = parseInt(localStorage.getItem('hygicare_cfg_alert_days') || '60');
      let clients     = await getAll('clients');
      const records   = await dbGetAll_raw('records');

      // Filtrar clientes pelo papel do usuário logado
      if (currentUser && (currentUser.role === 'gerente' || currentUser.role === 'consultor')) {
        const managed = getManagedSellerNames();
        clients = clients.filter(c => managed.has((c.seller || '').toLowerCase()));
      } else if (currentUser && currentUser.role === 'vendedor') {
        const sellerName = (currentUser.sellerName || '').toLowerCase();
        clients = clients.filter(c => (c.seller || '').toLowerCase() === sellerName);
      }

      const lastDate  = {};
      for (const r of records) {
        const cid = Number(r.client_id);
        const date = r.date_end || r.date_start;
        if (!date) continue;
        if (!lastDate[cid] || date > lastDate[cid]) lastDate[cid] = date;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threshold = new Date(today);
      threshold.setDate(threshold.getDate() - alertDays);
      const thresholdStr = threshold.toISOString().split('T')[0];
      const overdue = [];
      for (const c of clients) {
        if (c.vazao_only) continue;
        const last = lastDate[Number(c.id)] || null;
        if (!last || last < thresholdStr) {
          const daysSince = last ? Math.floor((today.getTime() - new Date(last).getTime()) / 86400000) : null;
          overdue.push({ client: c, last, daysSince });
        }
      }
      overdue.sort((a, b) => {
        if (!a.last && !b.last) return (a.client.name || '').localeCompare(b.client.name || '');
        if (!a.last) return -1;
        if (!b.last) return 1;
        return (b.daysSince || 0) - (a.daysSince || 0);
      });
      return { overdue, alertDays };
    }

    async function refreshAlertsBadge() {
      const { overdue, alertDays } = await _computeOverdue();
      updateAlertsBadge(overdue.length, alertDays);
    }

    async function renderAlertsScreen() {
      const { overdue, alertDays } = await _computeOverdue();
      updateAlertsBadge(overdue.length, alertDays);

      const countEl = document.getElementById('alerts-count-badge');
      if (countEl) countEl.textContent = overdue.length;
      const daysEl = document.getElementById('alerts-days-display');
      if (daysEl) daysEl.textContent = alertDays;

      const list = document.getElementById('alerts-list');
      if (!list) return;

      if (!overdue.length) {
        list.innerHTML = `<div class="empty-state">✅ Tudo em dia!<p>Nenhum cliente está há mais de ${alertDays} dias sem relatório.</p></div>`;
        return;
      }

      // Agrupar por vendedor
      const bySeller = {};
      overdue.forEach(item => {
        const seller = item.client.seller || '(Sem vendedor)';
        if (!bySeller[seller]) bySeller[seller] = [];
        bySeller[seller].push(item);
      });

      list.innerHTML = Object.entries(bySeller).map(([seller, items]) => {
        const waMsg = `*Hygicare — Aviso de Relatórios Pendentes*\n\nVendedor: *${seller}*\n\nClientes sem relatório:\n` +
          items.map(({client, daysSince}) =>
            `• ${client.name}${client.city?' ('+client.city+')':''} — ${daysSince !== null ? daysSince+' dias' : 'sem registros'}`
          ).join('\n') + '\n\nPor favor, agende uma visita ou envie o relatório em breve.';
        const waLink = `https://wa.me/?text=${encodeURIComponent(waMsg)}`;

        const cardsHtml = items.map(({ client, last, daysSince }) => {
          const severe    = daysSince === null || daysSince > alertDays * 2;
          const clr       = severe ? '#dc2626' : '#d97706';
          const bg        = severe ? '#fef2f2' : '#fffbeb';
          const border    = severe ? '#ef4444' : '#f59e0b';
          const lastStr   = last ? fmtDate(last) : 'Nunca';
          const daysLabel = daysSince !== null ? `${daysSince} dias sem relatório` : 'Sem registros';
          const clientId  = client.id;
          return `<div style="background:${bg};border:1px solid ${border};border-left:4px solid ${border};border-radius:8px;padding:0.65rem 1rem;margin-bottom:0.35rem">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem">
              <div style="min-width:0">
                <div style="font-weight:700;font-size:0.92rem;color:var(--text)">👤 ${escHtml(client.name)}</div>
                ${client.city ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:2px">📍 ${escHtml(client.city)}</div>` : ''}
                <div style="font-size:0.8rem;margin-top:0.3rem">
                  <span style="color:${clr};font-weight:700">⏱ ${daysLabel}</span>
                  <span style="color:var(--muted);margin-left:0.5rem;font-size:0.75rem">Último: ${lastStr}</span>
                </div>
              </div>
              <button style="background:var(--primary);color:#fff;border:none;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.78rem;cursor:pointer;flex-shrink:0;white-space:nowrap"
                onclick="(async()=>{const s=document.getElementById('prod-client');if(s){s.value='${clientId}';s.dispatchEvent(new Event('change'));}show('screen-form')})()">
                + Registrar
              </button>
            </div>
          </div>`;
        }).join('');

        return `<div style="margin-bottom:1rem">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:0.55rem 0.9rem;margin-bottom:0.4rem">
            <div style="font-weight:700;font-size:0.88rem;color:var(--text)">👨‍💼 ${escHtml(seller)} <span style="font-weight:400;font-size:0.8rem;color:var(--muted)">(${items.length} cliente${items.length!==1?'s':''})</span></div>
            <a href="${waLink}" target="_blank" rel="noopener"
              style="display:inline-flex;align-items:center;gap:0.3rem;background:#25D366;color:#fff;text-decoration:none;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.78rem;font-weight:600;flex-shrink:0">
              📱 WhatsApp
            </a>
          </div>
          ${cardsHtml}
        </div>`;
      }).join('');
    }

    window.renderAlertsScreen    = renderAlertsScreen;
    window.initPdfReportsScreen  = initPdfReportsScreen;
    window.initPdfConfigScreen   = initPdfConfigScreen;

    // =====================================================
    // TELA VAZÃO
    // =====================================================
    async function syncVazaoData() {
      const pull = async (sheet, store) => {
        try {
          const r = await fetch(`${gasApiUrl()}?sheet=${sheet}`);
          if (r.ok) {
            const items = (await r.json()).data || [];
            await clearStore(store);
            for (const v of items) { if (v.id) await dbPut(store, normalizeItem(v)); }
          }
        } catch(e) {}
      };
      // Máquinas e clientes são necessários para os dropdowns da tela
      await pull(SHEETS.CLIENTS,       'clients');
      await pull(SHEETS.MACHINES,      'machines');
      await pull(SHEETS.VAZOES,        'vazoes');
      await pull(SHEETS.VAZAO_RECORDS, 'vazao_records');
    }

    // =====================================================
    // TELA HISTÓRICO DE CLIENTES
    // =====================================================
    const NOTE_TYPES = {
      manutencao: { icon: '🔧', label: 'Manutenção', color: '#2563eb', bg: '#eff6ff' },
      aviso:      { icon: '⚠️', label: 'Aviso',      color: '#b45309', bg: '#fffbeb' },
      instalacao: { icon: '🔌', label: 'Instalação', color: '#7c3aed', bg: '#f5f3ff' },
      lembrete:   { icon: '📌', label: 'Lembrete',   color: '#15803d', bg: '#f0fdf4' },
    };

    async function renderClientNotesList() {
      const list = document.getElementById('notes-list');
      if (!list) return;

      document.getElementById('btn-new-note')?.classList.toggle('hidden', !canDo('create_note'));

      const [allNotes, clients] = await Promise.all([
        dbGetAll_raw('client_notes'),
        window.getAll('clients'),
      ]);
      const allowedIds = new Set(clients.map(c => String(c.id)));
      const notes = allNotes.filter(n => allowedIds.has(String(n.client_id)));

      // Popular filtro de clientes
      const filterClient = document.getElementById('note-filter-client');
      if (filterClient) {
        const cur = filterClient.value;
        filterClient.innerHTML = '<option value="">👤 Todos os clientes</option>';
        [...clients].sort((a,b) => (a.name||'').localeCompare(b.name||''))
          .forEach(c => { filterClient.innerHTML += `<option value="${c.id}">${escHtml(c.name)}</option>`; });
        if (cur) filterClient.value = cur;
      }

      const clientFilter = filterClient?.value || '';
      const typeFilter   = document.getElementById('note-filter-type')?.value || '';
      const filtered = notes
        .filter(n => !clientFilter || String(n.client_id) === clientFilter)
        .filter(n => !typeFilter   || n.type === typeFilter)
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''));

      // Atualizar badge de contagem
      const badge = document.getElementById('notes-count-badge');
      if (badge) badge.textContent = filtered.length;

      if (!filtered.length) {
        list.innerHTML = `<div class="empty-state"><div style="font-size:2rem;margin-bottom:0.5rem">📋</div><div style="font-weight:600;margin-bottom:0.25rem">Nenhuma nota encontrada</div><div style="font-size:0.85rem">Crie uma nota para registrar manutenções, avisos e lembretes.</div></div>`;
        return;
      }

      list.innerHTML = `<div class="items-list">${filtered.map(n => {
        const client = clients.find(c => String(c.id) === String(n.client_id));
        const t = NOTE_TYPES[n.type] || { icon: '📋', label: n.type || '—', color: '#64748b', bg: '#f8fafc' };
        const badgeClass = { manutencao: 'badge', aviso: 'badge-yellow', instalacao: 'badge', lembrete: 'badge-green' }[n.type] || 'badge-gray';
        return `
          <div class="list-item" style="border-left-color:${t.color}">
            <div class="list-item-content">
              <div class="list-item-name">
                <span class="${badgeClass}" style="background:${t.bg};color:${t.color}">${t.icon} ${t.label}</span>
                ${escHtml(n.title)}
              </div>
              <div class="list-item-details">
                <span class="detail-chip">👤 ${escHtml(client?.name || '—')}</span>
                <span class="detail-chip">📅 ${fmtDate(n.date)}</span>
                <span class="detail-chip">✍️ ${escHtml(n.created_by || '—')}</span>
                ${n.content ? `<span class="detail-chip" style="width:100%;white-space:pre-wrap;line-height:1.5">💬 ${escHtml(n.content)}</span>` : ''}
              </div>
            </div>
            <div class="list-item-actions">
              ${canDo('edit_note')   ? `<button class="btn-edit btn-sm" onclick="window._editNote(${n.id})">✏️ Editar</button>` : ''}
              ${canDo('delete_note') ? `<button class="btn-danger btn-sm" onclick="window._deleteNote(${n.id}, this)">🗑️</button>` : ''}
            </div>
          </div>`;
      }).join('')}</div>`;
    }

    // Filtros disparam re-render
    document.getElementById('note-filter-client')?.addEventListener('change', renderClientNotesList);
    document.getElementById('note-filter-type')?.addEventListener('change', renderClientNotesList);

    // Abrir modal de nova nota
    document.getElementById('btn-new-note')?.addEventListener('click', () => _openNoteForm(null));

    document.getElementById('modal-note-close')?.addEventListener('click',  () => document.getElementById('modal-note').classList.add('hidden'));
    document.getElementById('modal-note-cancel')?.addEventListener('click', () => document.getElementById('modal-note').classList.add('hidden'));

    async function _openNoteForm(note) {
      const clients = await window.getAll('clients');
      const sel = document.getElementById('note-client');
      if (sel) {
        sel.innerHTML = '<option value="">-- Selecione --</option>';
        [...clients].sort((a,b) => (a.name||'').localeCompare(b.name||''))
          .forEach(c => { sel.innerHTML += `<option value="${c.id}">${escHtml(c.name)}</option>`; });
      }
      document.getElementById('note-edit-id').value  = note?.id || '';
      document.getElementById('note-client').value   = note?.client_id || '';
      document.getElementById('note-type').value     = note?.type || 'manutencao';
      document.getElementById('note-date').value     = note?.date || new Date().toISOString().slice(0,10);
      document.getElementById('note-title').value    = note?.title || '';
      document.getElementById('note-content').value  = note?.content || '';
      document.getElementById('modal-note-title').textContent = note ? '✏️ Editar Nota' : '📋 Nova Nota';
      document.getElementById('modal-note').classList.remove('hidden');
    }

    window._editNote = async function(id) {
      if (!canDo('edit_note')) return toast('Sem permissão para editar notas.', 'error');
      const notes = await dbGetAll_raw('client_notes');
      const note  = notes.find(n => Number(n.id) === Number(id));
      if (note) _openNoteForm(note);
    };

    window._deleteNote = async function(id, el) {
      if (!canDo('delete_note')) return toast('Sem permissão para excluir notas.', 'error');
      if (!await confirmAction('Excluir esta nota? Ação irreversível.', '🗑️ Excluir')) return;
      if (el) { el.disabled = true; el.textContent = '⏳'; }
      await dbDelete('client_notes', id);
      const ok = await deleteSheetDB(SHEETS.CLIENT_NOTES, id);
      toast(ok ? 'Nota excluída!' : 'Nota excluída localmente', ok ? 'success' : 'warning');
      await renderClientNotesList();
    };

    // Salvar nota
    document.getElementById('form-note')?.addEventListener('submit', async e => {
      e.preventDefault();
      const editId   = document.getElementById('note-edit-id').value;
      const clientId = Number(document.getElementById('note-client').value);
      const type     = document.getElementById('note-type').value;
      const date     = document.getElementById('note-date').value;
      const title    = document.getElementById('note-title').value.trim();
      const content  = document.getElementById('note-content').value.trim();

      if (!clientId || !type || !date || !title) return toast('Preencha os campos obrigatórios.', 'warning');

      const btn = document.getElementById('btn-save-note');
      setSaving(true, btn);
      try {
        let saved;
        if (editId) {
          const allNotes = await dbGetAll_raw('client_notes');
          const existing = allNotes.find(n => Number(n.id) === Number(editId));
          saved = { ...existing, client_id: clientId, type, date, title, content, synced_at: new Date().toISOString() };
          await dbPut('client_notes', saved);
          const ok = await patchSheetDB(SHEETS.CLIENT_NOTES, saved.id, saved);
          toast(ok ? 'Nota atualizada!' : 'Nota atualizada localmente', ok ? 'success' : 'warning');
        } else {
          saved = { client_id: clientId, type, date, title, content,
            created_by: currentUser?.name || currentUser?.username || '',
            created_at: new Date().toISOString(), synced_at: new Date().toISOString() };
          const newId = await dbAdd('client_notes', saved);
          saved.id = newId;
          await postToSheetDB(SHEETS.CLIENT_NOTES, saved);
          toast('Nota criada!', 'success');
        }
        document.getElementById('modal-note').classList.add('hidden');
        await renderClientNotesList();

        // Oferecer compartilhamento no WhatsApp
        const clients = await window.getAll('clients');
        const client  = clients.find(c => Number(c.id) === Number(clientId));
        const t = NOTE_TYPES[type] || { icon: '📋', label: type };
        const msgLines = [
          `*Hygicare — ${t.icon} ${t.label}*`,
          `*Cliente:* ${client?.name || '—'}`,
          `*Data:* ${fmtDate(date)}`,
          `*Título:* ${title}`,
        ];
        if (content) msgLines.push(`*Detalhe:* ${content}`);
        const waMsg = msgLines.join('\n');
        document.getElementById('whatsapp-preview').textContent = waMsg;
        document.getElementById('modal-whatsapp').classList.remove('hidden');
        document.getElementById('whatsapp-share').onclick = () => {
          window.open('https://wa.me/?text=' + encodeURIComponent(waMsg), '_blank');
          document.getElementById('modal-whatsapp').classList.add('hidden');
        };
        document.getElementById('whatsapp-skip').onclick = () => {
          document.getElementById('modal-whatsapp').classList.add('hidden');
        };
      } catch(err) {
        toast('Erro ao salvar nota: ' + err.message, 'error');
      } finally {
        setSaving(false, btn);
      }
    });

    async function initClientNotesScreen() {
      const clients = await window.getAll('clients');
      const sel = document.getElementById('note-filter-client');
      if (sel) {
        const cur = sel.value;
        sel.innerHTML = '<option value="">Todos os clientes</option>';
        [...clients].sort((a,b) => (a.name||'').localeCompare(b.name||''))
          .forEach(c => { sel.innerHTML += `<option value="${c.id}">${escHtml(c.name)}</option>`; });
        if (cur) sel.value = cur;
      }
      await renderClientNotesList();
    }

    async function initPdfReportsScreen() {
      // Sincronizar dados em background para garantir dados frescos nos PDFs
      if (navigator.onLine && CONFIG.GAS_URL && !CONFIG.GAS_URL.includes('YOUR_GAS_URL')) {
        syncVazaoData().catch(() => {});
        // Sincroniza records e client_notes (usados nos PDFs de produção)
        const _pullStore = async (sheet, store) => {
          try {
            const r = await fetch(`${gasApiUrl()}?sheet=${sheet}`);
            if (r.ok) { const items = (await r.json()).data || []; if (items.length) await saveToStore(store, items); }
          } catch(e) {}
        };
        _pullStore(SHEETS.RECORDS, 'records').catch(() => {});
        _pullStore(SHEETS.CLIENT_NOTES, 'client_notes').catch(() => {});
      }

      const clients = await window.getAll('clients');
      const sorted = [...clients].sort((a,b) => (a.name||'').localeCompare(b.name||''));
      const clientOpts = '<option value="">Selecionar cliente...</option>' +
        sorted.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');

      ['pdf-client-select','pdf-vazao-client','pdf-mach-client'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const cur = el.value;
        el.innerHTML = clientOpts;
        if (cur) el.value = cur;
      });

      // Datas padrão: mês atual
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const today = `${yyyy}-${mm}-${String(now.getDate()).padStart(2,'0')}`;
      const monthStart = `${yyyy}-${mm}-01`;
      [['pdf-summary-start', monthStart],['pdf-summary-end', today],
       ['pdf-client-start',  monthStart],['pdf-client-end',  today],
       ['pdf-vazao-start',   monthStart],['pdf-vazao-end',   today],
       ['pdf-group-start',   monthStart],['pdf-group-end',   today]].forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
      });

      // Preset date buttons (uma única vez por tela)
      if (!document.getElementById('screen-pdf-reports').dataset.presetsWired) {
        document.getElementById('screen-pdf-reports').dataset.presetsWired = '1';
        document.getElementById('screen-pdf-reports').addEventListener('click', e => {
          const btn = e.target.closest('.pdf-preset');
          if (!btn) return;
          const grp = btn.dataset.group;
          const p   = btn.dataset.p;
          const d   = new Date();
          const y   = d.getFullYear(), mo = String(d.getMonth()+1).padStart(2,'0');
          const todayStr = `${y}-${mo}-${String(d.getDate()).padStart(2,'0')}`;
          let s = '', end = todayStr;
          if (p === 'month') {
            s   = `${y}-${mo}-01`;
          } else if (p === '30d') {
            const d30 = new Date(d); d30.setDate(d30.getDate()-29);
            s = `${d30.getFullYear()}-${String(d30.getMonth()+1).padStart(2,'0')}-${String(d30.getDate()).padStart(2,'0')}`;
          } else if (p === '3m') {
            const d3m = new Date(d); d3m.setMonth(d3m.getMonth()-2); d3m.setDate(1);
            s = `${d3m.getFullYear()}-${String(d3m.getMonth()+1).padStart(2,'0')}-01`;
          } else if (p === 'year') {
            s = `${y}-01-01`;
          }
          const map = { summary:['pdf-summary-start','pdf-summary-end'], client:['pdf-client-start','pdf-client-end'], vazao:['pdf-vazao-start','pdf-vazao-end'], group:['pdf-group-start','pdf-group-end'] };
          const [startId, endId] = map[grp] || [];
          if (startId) { document.getElementById(startId).value = s; document.getElementById(endId).value = end; }
        });
      }
    }

    // Comprime imagem antes de salvar no localStorage / GAS
    function _compressImage(file, maxW, maxH, quality) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = ev => {
          const img = new Image();
          img.onerror = reject;
          img.onload = () => {
            const scale = Math.min(1, maxW / img.width, maxH / img.height);
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/png'));
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    // Tela de configurações de layout dos PDFs
    async function initPdfConfigScreen() {
      const b64 = localStorage.getItem('hygicare_logo_b64');
      const prev = document.getElementById('pdf-cfg-logo-preview');
      if (prev) prev.innerHTML = b64
        ? `<img src="${b64}" style="max-width:100%;max-height:100%;object-fit:contain">`
        : '<span style="color:var(--text-muted,#9ca3af);font-size:.82rem">Sem logo</span>';

      const colorEl  = document.getElementById('pdf-cfg-color');
      const nameEl   = document.getElementById('pdf-cfg-company-name');
      const subEl    = document.getElementById('pdf-cfg-company-sub');
      const footerEl = document.getElementById('pdf-cfg-footer-text');
      if (colorEl)  colorEl.value  = localStorage.getItem('pdf_color') || '#1a3f5c';
      if (nameEl)   nameEl.value   = localStorage.getItem('pdf_company_name') || 'HYGICARE';
      if (subEl)    subEl.value    = localStorage.getItem('pdf_company_subtitle') || 'Lavanderia Industrial';
      if (footerEl) footerEl.value = localStorage.getItem('pdf_footer_text') || '';

      const screen = document.getElementById('screen-pdf-config');
      if (!screen || screen.dataset.cfgWired) return;
      screen.dataset.cfgWired = '1';

      document.getElementById('pdf-cfg-logo-input')?.addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const compressed = await _compressImage(file, 400, 160, 0.9);
          localStorage.setItem('hygicare_logo_b64', compressed);
          callGAS('upsert', 'Config', { chave: 'hygicare_logo_b64', valor: compressed });
          const prev = document.getElementById('pdf-cfg-logo-preview');
          if (prev) prev.innerHTML = `<img src="${compressed}" style="max-width:100%;max-height:100%;object-fit:contain">`;
          toast('Logo salvo e sincronizado com todos os usuários!', 'success');
        } catch { toast('Erro ao processar imagem.', 'error'); }
      });

      document.getElementById('pdf-cfg-logo-clear')?.addEventListener('click', () => {
        localStorage.removeItem('hygicare_logo_b64');
        callGAS('upsert', 'Config', { chave: 'hygicare_logo_b64', valor: '' });
        const prev = document.getElementById('pdf-cfg-logo-preview');
        if (prev) prev.innerHTML = '<span style="color:var(--text-muted,#9ca3af);font-size:.82rem">Sem logo</span>';
        const inp = document.getElementById('pdf-cfg-logo-input');
        if (inp) inp.value = '';
        toast('Logo removido.', 'info', 2000);
      });

      document.getElementById('pdf-cfg-save')?.addEventListener('click', () => {
        const color  = document.getElementById('pdf-cfg-color')?.value  || '#1a3f5c';
        const name   = (document.getElementById('pdf-cfg-company-name')?.value  || '').trim() || 'HYGICARE';
        const sub    = (document.getElementById('pdf-cfg-company-sub')?.value   || '').trim() || 'Lavanderia Industrial';
        const footer = (document.getElementById('pdf-cfg-footer-text')?.value   || '').trim();

        localStorage.setItem('pdf_color', color);
        localStorage.setItem('pdf_company_name', name);
        localStorage.setItem('pdf_company_subtitle', sub);
        localStorage.setItem('pdf_footer_text', footer);

        callGAS('upsert', 'Config', { chave: 'pdf_color',            valor: color  });
        callGAS('upsert', 'Config', { chave: 'pdf_company_name',     valor: name   });
        callGAS('upsert', 'Config', { chave: 'pdf_company_subtitle', valor: sub    });
        callGAS('upsert', 'Config', { chave: 'pdf_footer_text',      valor: footer });

        toast('Configurações de PDF salvas e sincronizadas!', 'success');
      });
    }

    document.getElementById('btn-pdf-client')?.addEventListener('click', async () => {
      if (!canDo('pdf_report')) return toast('Sem permissão para gerar PDF.', 'error');
      const clientId = document.getElementById('pdf-client-select')?.value;
      if (!clientId) return toast('Selecione um cliente.', 'warning');
      const startDate = document.getElementById('pdf-client-start')?.value || '';
      const endDate   = document.getElementById('pdf-client-end')?.value   || '';

      const w = window.open('', '_blank');
      if (!w) return toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error');
      w.document.write('<!DOCTYPE html><html><body style="font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc"><p style="color:#546e7a;font-size:1rem">⏳ Gerando ficha...</p></body></html>');

      const [clients, records, machines, processes, notes] = await Promise.all([
        dbGetAll_raw('clients'), dbGetAll_raw('records'),
        dbGetAll_raw('machines'), dbGetAll_raw('processes'),
        dbGetAll_raw('client_notes'),
      ]);

      const client = clients.find(c => Number(c.id) === Number(clientId));
      if (!client) { w.close(); return toast('Cliente não encontrado.', 'error'); }

      let cRecords = records.filter(r => Number(r.client_id) === Number(clientId));
      if (startDate) cRecords = cRecords.filter(r => (r.date_start||r.created_at||'').slice(0,10) >= startDate);
      if (endDate)   cRecords = cRecords.filter(r => (r.date_start||r.created_at||'').slice(0,10) <= endDate);
      cRecords.sort((a,b) => (a.date_start||'').localeCompare(b.date_start||''));

      let cNotes = notes.filter(n => Number(n.client_id) === Number(clientId));
      if (startDate) cNotes = cNotes.filter(n => (n.date||'').slice(0,10) >= startDate);
      if (endDate)   cNotes = cNotes.filter(n => (n.date||'').slice(0,10) <= endDate);
      cNotes.sort((a,b) => (a.date||'').localeCompare(b.date||''));

      const machineMap  = Object.fromEntries(machines.map(m => [m.id, m.name]));
      const processMap  = Object.fromEntries(processes.map(p => [p.id, p.name]));
      const totalKg  = cRecords.reduce((s, r) => s + (Number(r.total) || 0), 0);
      const totalPcs = cRecords.reduce((s, r) => s + (Number(r.capacity) || 0), 0);

      const fmtDate = d => { if (!d) return '-'; const p = new Date(d.length <= 10 ? d + 'T00:00:00' : d); return isNaN(p) ? '-' : p.toLocaleDateString('pt-BR'); };
      const fmtKg   = n => Number(n).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}) + ' kg';
      const periodStr = (startDate || endDate)
        ? `${startDate ? fmtDate(startDate) : 'início'} a ${endDate ? fmtDate(endDate) : 'hoje'}`
        : 'Todo o período';

      const noteTypeLabel = {manutencao:'🔧 Manutenção', aviso:'⚠️ Aviso', instalacao:'🔌 Instalação', lembrete:'📌 Lembrete'};

      const recordRows = cRecords.map(r =>
        `<tr><td>${fmtDate(r.date_start||r.created_at)}</td><td>${escHtml(machineMap[r.machine_id]||'-')}</td><td>${escHtml(processMap[r.process_id]||'-')}</td><td style="text-align:right">${(Number(r.capacity)||0).toLocaleString('pt-BR')}</td><td style="text-align:right">${fmtKg(r.total)}</td><td>${r.executed?'✅ Exec.':r.canceled?'❌ Canc.':'⏳ Pend.'}</td></tr>`
      ).join('') || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:12px">Nenhum registro no período</td></tr>';

      const noteRows = cNotes.map(n =>
        `<tr><td>${fmtDate(n.date)}</td><td>${noteTypeLabel[n.type]||n.type||'-'}</td><td><strong>${escHtml(n.title||'-')}</strong></td><td style="max-width:220px">${escHtml(n.content||'-')}</td><td>${escHtml(n.created_by||'-')}</td></tr>`
      ).join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:12px">Nenhuma nota no período</td></tr>';

      const infoItems = [
        client.cnpj    ? `<div class="ii"><strong>CNPJ/CPF</strong>${escHtml(client.cnpj)}</div>` : '',
        client.phone   ? `<div class="ii"><strong>Telefone</strong>${escHtml(client.phone)}</div>` : '',
        client.address ? `<div class="ii"><strong>Endereço</strong>${escHtml(client.address)}</div>` : '',
        client.city    ? `<div class="ii"><strong>Cidade</strong>${escHtml(client.city)}</div>` : '',
        client.seller  ? `<div class="ii"><strong>Consultor</strong>${escHtml(client.seller)}</div>` : '',
        client.email   ? `<div class="ii"><strong>E-mail</strong>${escHtml(client.email)}</div>` : '',
      ].filter(Boolean).join('');

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Ficha — ${escHtml(client.name)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;padding:16mm 18mm}
h1{font-size:17px;color:#111827;margin-bottom:2px}h2{font-size:12px;color:#1a3f5c;margin:14px 0 6px;border-bottom:1.5px solid #d1d5db;padding-bottom:3px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.logo{font-weight:900;font-size:15px;color:#111827;letter-spacing:.03em}.logo-sub{font-size:9px;color:#6b7280;font-weight:400;letter-spacing:.05em;text-transform:uppercase}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 16px;margin-bottom:10px}
.ii{font-size:10px}.ii strong{color:#6b7280;text-transform:uppercase;font-size:9px;display:block}
.kpis{display:flex;gap:8px;margin:10px 0 12px}.kpi{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;text-align:center;flex:1}
.kv{font-size:17px;font-weight:800;color:#111827}.kl{font-size:9px;color:#6b7280;margin-top:1px;text-transform:uppercase}.kd{font-size:8px;color:#9ca3af;margin-top:2px;font-style:italic}
.period{font-size:10px;color:#6b7280;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:10.5px}th{background:#1a3f5c;color:#fff;padding:5px 7px;text-align:left;font-size:9.5px;text-transform:uppercase}
td{padding:4px 7px;border-bottom:1px solid #f1f5f9}tr:nth-child(even) td{background:#f8fafc}
.abar{display:flex;gap:8px;margin-bottom:12px}.btn-p{padding:7px 14px;background:#1a3f5c;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11px}
.footer{margin-top:16px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:9px;color:#9ca3af;text-align:center}
@media print{.abar{display:none}body{padding:8mm}@page{size:A4 portrait;margin:10mm}}</style></head><body>
<div class="abar"><button class="btn-p" onclick="window.print()">🖨️ Salvar PDF</button>
<button onclick="window.close()" style="padding:7px 14px;border:1px solid #d1d5db;border-radius:5px;cursor:pointer;background:#fff;font-size:11px">✕ Fechar</button></div>
<div class="hdr"><div>${getPdfLogoHtml(false)}<h1 style="margin-top:6px;font-size:17px;color:#111827">${escHtml(client.name)}</h1></div>
<div style="text-align:right;font-size:10px;color:#6b7280">Gerado em ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</div></div>
<div class="info-grid">${infoItems}</div>
<p class="period">📅 Período: <strong>${periodStr}</strong></p>
<div class="kpis">
<div class="kpi"><div class="kv">${cRecords.length}</div><div class="kl">Registros</div><div class="kd">relatórios enviados</div></div>
<div class="kpi"><div class="kv">${fmtKg(totalKg)}</div><div class="kl">Total kg</div><div class="kd">peso total processado</div></div>
<div class="kpi"><div class="kv">${totalPcs.toLocaleString('pt-BR')}</div><div class="kl">Peças</div><div class="kd">itens/enxovais processados</div></div>
<div class="kpi"><div class="kv">${cNotes.length}</div><div class="kl">Notas</div><div class="kd">ocorrências e manutenções</div></div>
</div>
<h2>📋 Histórico de Produção</h2>
<table><thead><tr><th>Data</th><th>Máquina</th><th>Processo</th><th style="text-align:right">Peças</th><th style="text-align:right">Total kg</th><th>Status</th></tr></thead>
<tbody>${recordRows}</tbody></table>
<h2>🔧 Manutenção / Notas</h2>
<table><thead><tr><th>Data</th><th>Tipo</th><th>Título</th><th>Descrição</th><th>Por</th></tr></thead>
<tbody>${noteRows}</tbody></table>
<div class="footer">${getPdfFooterHtml('Ficha do Cliente')}</div>
</body></html>`;

      w.document.open(); w.document.write(html.replaceAll('#1a3f5c', getPdfColor())); w.document.close();
    });

    // =====================================================
    // PDF VAZÃO POR CLIENTE (Item 5)
    // =====================================================
    document.getElementById('btn-pdf-vazao')?.addEventListener('click', async () => {
      if (!canDo('pdf_report')) return toast('Sem permissão para gerar PDF.', 'error');
      const clientId  = document.getElementById('pdf-vazao-client')?.value;
      const startDate = document.getElementById('pdf-vazao-start')?.value || '';
      const endDate   = document.getElementById('pdf-vazao-end')?.value   || '';
      if (!clientId) return toast('Selecione um cliente.', 'warning');
      const w = window.open('', '_blank');
      if (!w) return toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error');
      w.document.write('<!DOCTYPE html><html><body style="font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>⏳ Gerando...</p></body></html>');

      // Sincroniza dados de vazão antes de gerar para incluir leituras de outros dispositivos
      await syncVazaoData().catch(() => {});

      const [clients, vazoes, vazaoRecs, machines] = await Promise.all([
        dbGetAll_raw('clients'), dbGetAll_raw('vazoes'),
        dbGetAll_raw('vazao_records'), dbGetAll_raw('machines'),
      ]);
      const client = clients.find(c => Number(c.id) === Number(clientId));
      if (!client) { w.close(); return toast('Cliente não encontrado.', 'error'); }
      // vazoes são ligadas a machines, não a clients — percorrer a cadeia
      const cMachines   = machines.filter(m => Number(m.client_id) === Number(clientId));
      const cMachineIds = new Set(cMachines.map(m => Number(m.id)));
      const machMap     = Object.fromEntries(cMachines.map(m => [m.id, m.name]));
      const cVazoes     = vazoes.filter(v => cMachineIds.has(Number(v.machine_id)));
      const fmtD = d => { if (!d) return '-'; const p = new Date(d.length<=10?d+'T00:00:00':d); return isNaN(p)?'-':p.toLocaleDateString('pt-BR'); };
      const periodLabel = startDate && endDate
        ? `${fmtD(startDate)} a ${fmtD(endDate)}`
        : startDate ? `A partir de ${fmtD(startDate)}`
        : endDate   ? `Até ${fmtD(endDate)}`
        : 'Todo o período';
      const CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:14mm 16mm}
.abar{display:flex;gap:8px;margin-bottom:12px}.btn-p{padding:6px 12px;background:#1a3f5c;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
h1{font-size:15px;color:#111827;margin:6px 0 2px}
h2{font-size:11px;color:#1a3f5c;margin:14px 0 5px;border-bottom:1px solid #d1d5db;padding-bottom:3px;text-transform:uppercase;letter-spacing:.04em}
h3{font-size:10px;color:#374151;margin:10px 0 4px;font-weight:700}
.period{font-size:10px;color:#6b7280;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:10px}th{background:#1a3f5c;color:#fff;padding:4px 7px;text-align:left;font-size:9px;text-transform:uppercase}
td{padding:3px 7px;border-bottom:1px solid #f1f5f9}tr:nth-child(even) td{background:#f8fafc}
.footer{margin-top:14px;padding-top:7px;border-top:1px solid #e5e7eb;font-size:9px;color:#9ca3af;text-align:center}
@media print{.abar{display:none}body{padding:8mm}@page{size:A4 portrait;margin:10mm}}`;

      // Agrupar vazões por máquina
      const bodyHtml = cMachines.length === 0
        ? '<p style="color:#94a3b8;text-align:center;padding:16px">Nenhuma máquina cadastrada para este cliente.</p>'
        : cMachines.map(m => {
            const mv = cVazoes.filter(v => Number(v.machine_id) === Number(m.id));
            if (!mv.length) return '';
            const trows = mv.map((v, i) => {
              // Usa client_id + vazao_name: machine_id pode ser o ID local (antes
              // do sync com Sheets), tornando o match por machine_id instável.
              // client_id é atribuído do select (já sincronizado) e vazao_name
              // é uma string estável definida pelo usuário.
              let vRecs = vazaoRecs.filter(r =>
                Number(r.client_id) === Number(clientId) &&
                (r.vazao_name || '') === (v.name || ''));
              if (startDate) vRecs = vRecs.filter(r => (r.date || '') >= startDate);
              if (endDate)   vRecs = vRecs.filter(r => (r.date || '') <= endDate);
              const sorted  = vRecs.sort((a,b) => (b.date||'').localeCompare(a.date||''));
              const lastRec = sorted[0];
              const fmtVal  = val => val != null ? Number(val).toLocaleString('pt-BR',{maximumFractionDigits:2}) : '-';
              return `<tr>
                <td>${escHtml(v.name||'-')}</td>
                <td>${escHtml(v.unit||'-')}</td>
                <td style="text-align:right">${lastRec ? fmtVal(lastRec.value) : '-'}</td>
                <td>${fmtD(lastRec?.date)}</td>
                <td style="text-align:center">${vRecs.length}</td>
              </tr>`;
            }).join('');
            return `<h3>⚙️ ${escHtml(m.name)}</h3>
<table><thead><tr><th>Ponto de Vazão</th><th>Unidade</th><th style="text-align:right">Última Leitura</th><th>Data</th><th style="text-align:center">Medições</th></tr></thead>
<tbody>${trows}</tbody></table>`;
          }).join('') || '<p style="color:#94a3b8;text-align:center;padding:16px">Nenhuma vazão cadastrada para este cliente.</p>';

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Vazão — ${escHtml(client.name)}</title>
<style>${CSS}</style></head><body>
<div class="abar"><button class="btn-p" onclick="window.print()">🖨️ Salvar PDF</button>
<button onclick="window.close()" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:5px;cursor:pointer;background:#fff;font-size:11px">✕ Fechar</button></div>
<div class="hdr"><div>${getPdfLogoHtml(false)}<h1 style="margin-top:5px">${escHtml(client.name)}</h1></div>
<div style="text-align:right;font-size:10px;color:#6b7280">Gerado em ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})}</div></div>
<p class="period">📅 Período: <strong>${periodLabel}</strong></p>
<h2>💧 Relatório de Vazão</h2>
${bodyHtml}
<div class="footer">${getPdfFooterHtml('Relatório de Vazão')}</div>
</body></html>`;
      w.document.open(); w.document.write(html.replaceAll('#1a3f5c', getPdfColor())); w.document.close();
    });

    // =====================================================
    // PDF AGRUPADO POR CIDADE / VENDEDOR (Item 6)
    // =====================================================
    document.getElementById('btn-pdf-grouped')?.addEventListener('click', async () => {
      if (!canDo('pdf_report')) return toast('Sem permissão para gerar PDF.', 'error');
      const groupBy  = document.getElementById('pdf-group-by')?.value || 'city';
      const startDate = document.getElementById('pdf-group-start')?.value || '';
      const endDate   = document.getElementById('pdf-group-end')?.value   || '';
      const w = window.open('', '_blank');
      if (!w) return toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error');
      w.document.write('<!DOCTYPE html><html><body style="font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>⏳ Gerando...</p></body></html>');

      let [records, clients] = await Promise.all([dbGetAll_raw('records'), dbGetAll_raw('clients')]);
      // filtro por papel
      if (currentUser?.role === 'gerente' || currentUser?.role === 'consultor') {
        const managed = getManagedSellerNames();
        const myIds = new Set(clients.filter(c => managed.has((c.seller||'').toLowerCase())).map(c => Number(c.id)));
        clients = clients.filter(c => myIds.has(Number(c.id)));
        records = records.filter(r => myIds.has(Number(r.client_id)));
      } else if (currentUser?.role === 'vendedor') {
        const sn = (currentUser.sellerName||'').toLowerCase();
        const myIds = new Set(clients.filter(c => (c.seller||'').toLowerCase()===sn).map(c => Number(c.id)));
        clients = clients.filter(c => myIds.has(Number(c.id)));
        records = records.filter(r => myIds.has(Number(r.client_id)));
      }
      if (startDate) records = records.filter(r => (r.date_start||'').slice(0,10) >= startDate);
      if (endDate)   records = records.filter(r => (r.date_start||'').slice(0,10) <= endDate);

      const fmtKg = v => Number(v).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' kg';
      const fmtD = d => { if(!d) return '-'; const p=new Date(d.length<=10?d+'T00:00:00':d); return isNaN(p)?'-':p.toLocaleDateString('pt-BR'); };
      const groupLabel = groupBy === 'city' ? 'Cidade' : 'Vendedor';
      const getKey = cid => { const c=clients.find(cl=>Number(cl.id)===Number(cid)); return groupBy==='city' ? (c?.city||'(Sem cidade)') : (c?.seller||'(Sem vendedor)'); };
      const groups = {};
      for (const r of records) {
        const k = getKey(r.client_id);
        if (!groups[k]) groups[k] = { kg:0, count:0, clientSet:new Set() };
        groups[k].kg    += parseFloat(r.total)||0;
        groups[k].count += 1;
        groups[k].clientSet.add(String(r.client_id));
      }
      const totalKg = Object.values(groups).reduce((s,v)=>s+v.kg,0);
      const rows = Object.entries(groups).sort((a,b)=>b[1].kg-a[1].kg).map(([k,v],i) => {
        const pct = totalKg>0?(v.kg/totalKg*100).toFixed(1):'0.0';
        return `<tr style="${i%2===0?'':'background:#f8fafc'}">
          <td style="font-weight:600">${escHtml(k)}</td>
          <td style="text-align:center">${v.clientSet.size}</td>
          <td style="text-align:center">${v.count}</td>
          <td style="text-align:right;font-weight:700;color:#16a34a">${fmtKg(v.kg)}</td>
          <td style="text-align:center">${pct}%</td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:10px">Nenhum dado no período</td></tr>';
      const periodStr = startDate||endDate ? `${fmtD(startDate)} a ${fmtD(endDate)}` : 'Todo o período';
      const CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:14mm 16mm}
.abar{display:flex;gap:8px;margin-bottom:12px}.btn-p{padding:6px 12px;background:#1a3f5c;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11px}
.hdr{background:#1a3f5c;color:#fff;padding:16px 20px;border-radius:8px;margin-bottom:14px}
.hdr h1{font-size:16px;margin-bottom:4px}.hdr p{font-size:9px;opacity:.75}
table{width:100%;border-collapse:collapse;font-size:10px}th{background:#1a3f5c;color:#fff;padding:5px 8px;text-align:left;font-size:9px;text-transform:uppercase}
td{padding:4px 8px;border-bottom:1px solid #f1f5f9}.footer{margin-top:14px;padding-top:7px;border-top:1px solid #e5e7eb;font-size:9px;color:#9ca3af;text-align:center}
@media print{.abar{display:none}body{padding:8mm}@page{size:A4 portrait;margin:10mm}}`;
      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório por ${groupLabel}</title>
<style>${CSS}</style></head><body>
<div class="abar"><button class="btn-p" onclick="window.print()">🖨️ Salvar PDF</button>
<button onclick="window.close()" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:5px;cursor:pointer;background:#fff;font-size:11px">✕ Fechar</button></div>
<div class="hdr" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
  <div>${getPdfLogoHtml(true)}</div>
  <div style="text-align:right"><div style="font-size:14px;font-weight:700;color:#fff">Relatório por ${escHtml(groupLabel)}</div>
  <div style="font-size:9px;color:rgba(255,255,255,.7);margin-top:2px">Período: ${escHtml(periodStr)} · Gerado em ${new Date().toLocaleDateString('pt-BR')}</div></div>
</div>
<table><thead><tr><th>${groupLabel}</th><th style="text-align:center">Clientes</th><th style="text-align:center">Registros</th><th style="text-align:right">Total kg</th><th style="text-align:center">%</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr style="background:#f3f4f6;font-weight:700"><td>TOTAL</td><td></td><td style="text-align:center">${records.length}</td><td style="text-align:right">${fmtKg(totalKg)}</td><td></td></tr></tfoot>
</table>
<div class="footer">${getPdfFooterHtml('Relatório Agrupado')}</div>
</body></html>`;
      w.document.open(); w.document.write(html.replaceAll('#1a3f5c', getPdfColor())); w.document.close();
    });

    // =====================================================
    // PDF PROCESSOS E MÁQUINAS POR CLIENTE (Item 7)
    // =====================================================
    document.getElementById('btn-pdf-machines')?.addEventListener('click', async () => {
      if (!canDo('pdf_report')) return toast('Sem permissão para gerar PDF.', 'error');
      const clientId = document.getElementById('pdf-mach-client')?.value;
      if (!clientId) return toast('Selecione um cliente.', 'warning');
      const w = window.open('', '_blank');
      if (!w) return toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error');
      w.document.write('<!DOCTYPE html><html><body style="font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>⏳ Gerando...</p></body></html>');

      const [clients, machines, processes] = await Promise.all([
        dbGetAll_raw('clients'), dbGetAll_raw('machines'), dbGetAll_raw('processes'),
      ]);
      const client = clients.find(c => Number(c.id) === Number(clientId));
      if (!client) { w.close(); return toast('Cliente não encontrado.', 'error'); }
      const cMachines = machines.filter(m => Number(m.client_id) === Number(clientId));
      const CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:14mm 16mm}
.abar{display:flex;gap:8px;margin-bottom:12px}.btn-p{padding:6px 12px;background:#1a3f5c;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:11px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.logo{font-weight:900;font-size:15px;color:#111827}.logo-sub{font-size:9px;color:#6b7280;text-transform:uppercase}
h1{font-size:15px;color:#111827;margin:6px 0 2px}
.mach-block{margin-bottom:14px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
.mach-hdr{background:#1a3f5c;color:#fff;padding:6px 10px;font-weight:700;font-size:11px}
.mach-sub{font-size:9px;opacity:.75;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:10px}th{background:#f3f4f6;color:#1a3f5c;padding:4px 8px;text-align:left;font-size:9px;text-transform:uppercase;border-bottom:1px solid #d1d5db}
td{padding:4px 8px;border-bottom:1px solid #f1f5f9}
.footer{margin-top:14px;padding-top:7px;border-top:1px solid #e5e7eb;font-size:9px;color:#9ca3af;text-align:center}
@media print{.abar{display:none}body{padding:8mm}@page{size:A4 portrait;margin:10mm}}`;
      const machSections = cMachines.map(m => {
        const mProcs = processes.filter(p => Number(p.machine_id) === Number(m.id));
        const procRows = mProcs.map(p => `<tr><td>${escHtml(p.name||'-')}</td><td style="text-align:right">${p.capacity ? Number(p.capacity).toLocaleString('pt-BR')+' kg' : '—'}</td></tr>`).join('')
          || '<tr><td colspan="2" style="color:#94a3b8;text-align:center;padding:6px">Nenhum processo cadastrado</td></tr>';
        return `<div class="mach-block">
          <div class="mach-hdr">⚙️ ${escHtml(m.name||'-')} <span class="mach-sub">· ${m.capacity?Number(m.capacity).toLocaleString('pt-BR')+' kg cap.':''}</span></div>
          <table><thead><tr><th>Processo</th><th style="text-align:right">Capacidade</th></tr></thead><tbody>${procRows}</tbody></table>
        </div>`;
      }).join('') || '<p style="color:#94a3b8;text-align:center;padding:14px">Nenhuma máquina cadastrada para este cliente.</p>';
      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Máquinas — ${escHtml(client.name)}</title>
<style>${CSS}</style></head><body>
<div class="abar"><button class="btn-p" onclick="window.print()">🖨️ Salvar PDF</button>
<button onclick="window.close()" style="padding:6px 12px;border:1px solid #d1d5db;border-radius:5px;cursor:pointer;background:#fff;font-size:11px">✕ Fechar</button></div>
<div class="hdr"><div>${getPdfLogoHtml(false)}<h1 style="margin-top:5px">${escHtml(client.name)}</h1>
${client.city?`<div style="font-size:10px;color:#6b7280;margin-top:2px">📍 ${escHtml(client.city)}${client.seller?' · 👨‍💼 '+escHtml(client.seller):''}</div>`:''}
</div><div style="text-align:right;font-size:10px;color:#6b7280">Gerado em ${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'})}</div></div>
<h2 style="font-size:11px;color:#1a3f5c;border-bottom:1px solid #d1d5db;padding-bottom:3px;margin-bottom:10px;text-transform:uppercase">⚙️ Máquinas e Processos (${cMachines.length})</h2>
${machSections}
<div class="footer">${getPdfFooterHtml('Máquinas e Processos')}</div>
</body></html>`;
      w.document.open(); w.document.write(html.replaceAll('#1a3f5c', getPdfColor())); w.document.close();
    });

    async function initHomeScreen() {
      // Saudação
      const now = new Date();
      const h = now.getHours();
      const greeting = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
      const firstName = (currentUser?.name || currentUser?.username || '').split(' ')[0];
      const greetEl = document.getElementById('home-greeting');
      if (greetEl) greetEl.textContent = `${greeting}${firstName ? ', ' + firstName : ''}! 👋`;
      const dateEl = document.getElementById('home-date');
      if (dateEl) dateEl.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

      // Atalhos de navegação — filtrados por permissão, mesmo estilo home-action-btn
      const shortcutsEl = document.getElementById('home-shortcuts');
      if (shortcutsEl) {
        const ALL_NAV = [
          { perm: 'clients',      screen: 'screen-clients',      fn: async () => { await renderClientsList(); await refreshSellerSelect(); }, icon: '👥', label: 'Clientes' },
          { perm: 'machines',     screen: 'screen-machines',     fn: renderMachinesList,    icon: '⚙️', label: 'Máquinas' },
          { perm: 'processes',    screen: 'screen-processes',    fn: renderProcessesList,   icon: '🔄', label: 'Processos' },
          { perm: 'form',         screen: 'screen-form',         fn: _initFormScreen,       icon: '➕', label: 'Produção' },
          { perm: 'reports',      screen: 'screen-reports',      fn: async () => { await refreshReportClientFilter(); await refreshMonthYearFilter(); await renderRecordsList(); }, icon: '📄', label: 'Relatórios' },
          { perm: 'charts',       screen: 'screen-charts',       fn: async () => { await refreshChartsFilters(); await renderCharts(); }, icon: '📊', label: 'Gráficos' },
          { perm: 'vazao',        screen: 'screen-vazao',        fn: initVazaoScreen,       icon: '💧', label: 'Vazão' },
          { perm: 'recipes',      screen: 'screen-recipes',      fn: initRecipesScreen,     icon: '🗂️', label: 'Receitas' },
          { perm: 'client_notes', screen: 'screen-client-notes', fn: initClientNotesScreen,  icon: '📋', label: 'Histórico' },
          { perm: 'pdf_reports',  screen: 'screen-pdf-reports',  fn: initPdfReportsScreen,   icon: '📄', label: 'Rel. PDF' },
          { perm: 'users',        screen: 'screen-users',        fn: renderUsersList,         icon: '👤', label: 'Usuários' },
        ];
        const permsStr = (currentUser?.permissions || '').trim();
        const allowed  = permsStr ? new Set(permsStr.split(',').map(s => s.trim())) : null;
        const isAdmin  = !currentUser || currentUser.role === 'admin';
        const visible  = ALL_NAV.filter(item => {
          if (item.adminOnly && !isAdmin) return false;
          if (!allowed) return true;
          return allowed.has(item.perm);
        });
        shortcutsEl.innerHTML = visible.map(item =>
          `<button class="home-action-btn" data-screen="${item.screen}">
            <span style="font-size:1.6rem;line-height:1">${item.icon}</span>
            <span>${item.label}</span>
          </button>`
        ).join('');
        shortcutsEl.querySelectorAll('.home-action-btn').forEach(btn => {
          const item = visible.find(v => v.screen === btn.dataset.screen);
          if (!item) return;
          btn.addEventListener('click', async () => { show(item.screen); if (item.fn) await item.fn(); });
        });

        // Botão Novidades na home (visível em mobile onde o sino do header fica oculto)
        const novBtn = document.createElement('button');
        novBtn.className = 'home-action-btn';
        novBtn.id = 'home-novidades-btn';
        novBtn.style.position = 'relative';
        novBtn.innerHTML = `<span style="font-size:1.6rem;line-height:1;position:relative">🔔<span id="home-nov-badge" style="display:none;position:absolute;top:-4px;right:-6px;background:#ef4444;color:#fff;font-size:0.55rem;font-weight:700;border-radius:10px;padding:1px 4px;line-height:1.4;min-width:14px;text-align:center"></span></span><span>Novidades</span>`;
        shortcutsEl.appendChild(novBtn);
        novBtn.addEventListener('click', showNovidades);

        // Preenche badge com contagem
        _countNovidades().then(count => {
          const badge = document.getElementById('home-nov-badge');
          if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
          const dot = document.getElementById('novidades-dot');
          if (dot) dot.style.display = count > 0 ? '' : 'none';
        });
      }

      // KPIs — usar window.getAll para respeitar filtro de vendedor/consultor
      const [allRecordsRaw, clients, machines] = await Promise.all([
        dbGetAll_raw('records'),
        window.getAll('clients'),
        dbGetAll_raw('machines'),
      ]);
      const allowedClientIds = new Set(clients.map(c => String(c.id)));
      const records = allRecordsRaw.filter(r => allowedClientIds.has(String(r.client_id)));

      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const thisMonth = records.filter(r => (r.date_start || '').startsWith(ym));
      const kgMes = thisMonth.reduce((s, r) => s + parseFloat(r.total || 0), 0);

      const kgEl = document.getElementById('home-kg-mes');
      if (kgEl) kgEl.textContent = Math.round(kgMes).toLocaleString('pt-BR') + ' kg';
      const recEl = document.getElementById('home-records-mes');
      if (recEl) recEl.textContent = thisMonth.length;
      const cliEl = document.getElementById('home-clients-count');
      if (cliEl) cliEl.textContent = clients.length;

      const pending = (await dbGetAll_raw('recipes')).filter(r => r.status === 'pending').length;
      const kpiPend = document.getElementById('home-kpi-pending');
      if (kpiPend) kpiPend.style.display = pending ? '' : 'none';
      const pendEl = document.getElementById('home-pending-count');
      if (pendEl) pendEl.textContent = pending;

      // Últimos totais agrupados por cliente+período (igual ao relatório)
      const recentEl = document.getElementById('home-recent-records');
      if (!recentEl) return;
      if (!records.length) {
        recentEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:0.75rem">Nenhum registro ainda.</div>';
        return;
      }
      // Agrupar por clientId + period (date_start mês/ano)
      const groupMap = {};
      for (const r of records) {
        const cId = Number(r.client_id);
        const period = (r.date_start || '').slice(0, 7); // yyyy-mm
        const key = `${cId}|${period}`;
        if (!groupMap[key]) groupMap[key] = { clientId: cId, period, total: 0, lastDate: r.date_start || '', count: 0 };
        groupMap[key].total += parseFloat(r.total || 0);
        groupMap[key].count++;
        if ((r.date_start || '') > groupMap[key].lastDate) groupMap[key].lastDate = r.date_start;
      }
      const groups = Object.values(groupMap)
        .sort((a, b) => b.lastDate.localeCompare(a.lastDate))
        .slice(0, 5);
      recentEl.innerHTML = groups.map(g => {
        const c = clients.find(cl => Number(cl.id) === g.clientId);
        const [yyyy, mm] = g.period.split('-');
        const monthLabel = mm ? new Date(Number(yyyy), Number(mm) - 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : g.period;
        const totalKg = g.total;
        const totalFmt = Math.round(totalKg).toLocaleString('pt-BR') + ' kg';
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)">
            <div style="min-width:0">
              <div style="font-size:0.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c?.name || '—'}</div>
              <div style="font-size:0.73rem;color:var(--muted)">${monthLabel} · ${g.count} registro${g.count > 1 ? 's' : ''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;margin-left:0.75rem">
              <div style="font-size:0.9rem;font-weight:700;color:var(--primary)">${totalFmt}</div>
            </div>
          </div>`;
      }).join('');

      refreshAlertsBadge();

      // Últimas leituras de vazão — 7 dias
      const vazaoCard = document.getElementById('home-recent-vazao-card');
      const vazaoEl   = document.getElementById('home-recent-vazao');
      if (vazaoEl && canDo('vazao')) {
        const cutoff7 = new Date(); cutoff7.setDate(cutoff7.getDate() - 7);
        const cutoffStr = cutoff7.toISOString().slice(0, 10);
        let vRecs = (await dbGetAll_raw('vazao_records'))
          .filter(r => (r.date || '') >= cutoffStr);
        // filtro por clientes acessíveis
        const vcIds = new Set(clients.map(c => String(c.id)));
        vRecs = vRecs.filter(r => vcIds.has(String(r.client_id)));
        if (vRecs.length) {
          if (vazaoCard) vazaoCard.style.display = '';
          // agrupar por data + cliente
          const vg = {};
          for (const r of vRecs) {
            const key = `${r.date}|${r.client_id}`;
            if (!vg[key]) vg[key] = { date: r.date, clientId: r.client_id, count: 0 };
            vg[key].count++;
          }
          const vSorted = Object.values(vg).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 5);
          vazaoEl.innerHTML = vSorted.map(g => {
            const c = clients.find(cl => String(cl.id) === String(g.clientId));
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border)">
              <div>
                <div style="font-size:0.88rem;font-weight:600">${c?.name || '—'}</div>
                <div style="font-size:0.73rem;color:var(--muted)">${fmtDate(g.date)} · ${g.count} leitura${g.count>1?'s':''}</div>
              </div>
              <span style="font-size:0.8rem;color:#0ea5e9;font-weight:700">💧</span>
            </div>`;
          }).join('');
        } else {
          if (vazaoCard) vazaoCard.style.display = 'none';
        }
      }

      // Últimas notas do histórico — 7 dias
      const notesCard = document.getElementById('home-recent-notes-card');
      const notesEl   = document.getElementById('home-recent-notes');
      if (notesEl && canDo('client_notes')) {
        const cutoff7n = new Date(); cutoff7n.setDate(cutoff7n.getDate() - 7);
        const cutoffNStr = cutoff7n.toISOString().slice(0, 10);
        let notes = (await dbGetAll_raw('client_notes'))
          .filter(n => (n.date || n.created_at || '').slice(0,10) >= cutoffNStr);
        const ncIds = new Set(clients.map(c => String(c.id)));
        notes = notes.filter(n => ncIds.has(String(n.client_id)));
        if (notes.length) {
          if (notesCard) notesCard.style.display = '';
          const nSorted = notes.sort((a,b) => {
            const da = (a.date||a.created_at||''); const db = (b.date||b.created_at||'');
            return db.localeCompare(da);
          }).slice(0, 5);
          notesEl.innerHTML = nSorted.map(n => {
            const c = clients.find(cl => String(cl.id) === String(n.client_id));
            const d = (n.date || n.created_at || '').slice(0,10);
            const preview = (n.text || n.note || n.content || '').slice(0, 60);
            return `<div style="padding:0.5rem 0;border-bottom:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <div style="font-size:0.88rem;font-weight:600">${c?.name || '—'}</div>
                <div style="font-size:0.72rem;color:var(--muted);flex-shrink:0;margin-left:0.5rem">${fmtDate(d)}</div>
              </div>
              ${preview ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(preview)}…</div>` : ''}
            </div>`;
          }).join('');
        } else {
          if (notesCard) notesCard.style.display = 'none';
        }
      }

      // Atualiza ponto vermelho no botão 🔔
      _refreshNovidadesDot();
    }

    // =====================================================
    // NOVIDADES — painel de atividade recente (48h)
    // =====================================================
    function _novidadesCutoff() {
      const d = new Date(); d.setHours(d.getHours() - 48); return d.toISOString();
    }

    async function _countNovidades() {
      const cutoff = _novidadesCutoff();
      const [records, vazaoRecs, notes, machines, processes, recipes] = await Promise.all([
        dbGetAll_raw('records'), dbGetAll_raw('vazao_records'), dbGetAll_raw('client_notes'),
        dbGetAll_raw('machines'), dbGetAll_raw('processes'), dbGetAll_raw('recipes'),
      ]);
      const allowedClients = await window.getAll('clients');
      const allowed = new Set(allowedClients.map(c => String(c.id)));
      const since = x => (x.created_at || x.date_start || x.date || '') >= cutoff;
      const machineClient = {};
      machines.forEach(m => { machineClient[String(m.id)] = String(m.client_id); });
      const vazaoCount = vazaoRecs.filter(since).filter(r => allowed.has(machineClient[String(r.machine_id)])).length;
      return records.filter(since).filter(r => allowed.has(String(r.client_id))).length +
             vazaoCount +
             notes.filter(since).filter(n => allowed.has(String(n.client_id))).length +
             allowedClients.filter(since).length +
             machines.filter(since).length + processes.filter(since).length + recipes.filter(since).length;
    }

    async function _refreshNovidadesDot() {
      const dot = document.getElementById('novidades-dot');
      if (!dot) return;
      const count = await _countNovidades();
      dot.style.display = count > 0 ? '' : 'none';
    }

    async function showNovidades() {
      const cutoff = _novidadesCutoff();
      const since = x => (x.created_at || x.date_start || x.date || '') >= cutoff;
      const fmtD = d => { if (!d) return ''; const s = d.slice(0,10); const p = new Date(s+'T00:00:00'); return isNaN(p)?s:p.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}); };

      const [records, vazaoRecs, notes, clientsAll, machines, processes, recipes] = await Promise.all([
        dbGetAll_raw('records'), dbGetAll_raw('vazao_records'), dbGetAll_raw('client_notes'),
        dbGetAll_raw('clients'), dbGetAll_raw('machines'), dbGetAll_raw('processes'), dbGetAll_raw('recipes'),
      ]);
      const allowedIds = new Set((await window.getAll('clients')).map(c => String(c.id)));
      const cName = id => clientsAll.find(c => String(c.id) === String(id))?.name || `#${id}`;

      // Agrupa eventos por cliente+tipo; uma linha por grupo
      const machineClientMap = {};
      machines.forEach(m => { machineClientMap[String(m.id)] = String(m.client_id); });

      const grouped = {}; // key = clientId|tipo
      const addGroup = (clientId, tipo, cor, date, extra) => {
        const key = `${clientId}|${tipo}`;
        if (!grouped[key]) grouped[key] = { name: cName(clientId), tipo, cor, date, count: 0, extras: [] };
        const g = grouped[key];
        if (date > g.date) g.date = date;
        g.count++;
        if (extra && !g.extras.includes(extra)) g.extras.push(extra);
      };

      records.filter(since).filter(r => allowedIds.has(String(r.client_id))).forEach(r =>
        addGroup(String(r.client_id), '📋 Relatório de Produção', '#2563eb', r.date_start||r.created_at||'', null));

      vazaoRecs.filter(since).forEach(r => {
        const clientId = machineClientMap[String(r.machine_id)];
        if (!clientId || !allowedIds.has(clientId)) return;
        addGroup(clientId, '💧 Leitura de Vazão', '#0ea5e9', r.date||r.created_at||'', r.vazao_name||null);
      });

      notes.filter(since).filter(n => allowedIds.has(String(n.client_id))).forEach(n =>
        addGroup(String(n.client_id), '📝 Nota do Histórico', '#7c3aed', n.date||n.created_at||'', null));

      clientsAll.filter(since).forEach(c =>
        addGroup(String(c.id), '👥 Novo Cliente', '#16a34a', c.created_at||'', null));

      // Itens sem cliente: máquina, processo, receita — permanecem individuais
      const standaloneItems = [
        ...machines.filter(since).map(m => ({ name: m.name||'—', tipo: '⚙️ Nova Máquina', cor: '#ea580c', date: m.created_at||'', count: 1, extras: [] })),
        ...processes.filter(since).map(p => ({ name: p.name||'—', tipo: '🔄 Novo Processo', cor: '#d97706', date: p.created_at||'', count: 1, extras: [] })),
        ...recipes.filter(since).map(r => ({ name: r.name||'—', tipo: '🗂️ Nova Receita', cor: '#be185d', date: r.created_at||'', count: 1, extras: [] })),
      ];

      const items = [...Object.values(grouped), ...standaloneItems]
        .sort((a, b) => b.date.localeCompare(a.date));

      const body = items.length === 0
        ? `<div style="text-align:center;color:#9ca3af;padding:1.5rem 0;font-size:0.9rem">Nenhuma novidade nas últimas 48h 😴</div>`
        : items.map(it => {
            const countTag = it.count > 1 ? `<span style="background:${it.cor}22;color:${it.cor};font-size:0.68rem;font-weight:700;border-radius:8px;padding:1px 6px;margin-left:4px">${it.count}x</span>` : '';
            const extrasTag = it.extras.length ? `<span style="color:#64748b;font-weight:400"> · ${escHtml([...new Set(it.extras)].slice(0,4).join(', '))}</span>` : '';
            return `<div style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0;border-bottom:1px solid #f1f5f9">
              <div style="flex:1;min-width:0">
                <div style="font-size:0.87rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(it.name)}</div>
                <div style="font-size:0.75rem;color:${it.cor};margin-top:1px">${it.tipo}${countTag}${extrasTag}</div>
              </div>
              <div style="font-size:0.75rem;color:#9ca3af;flex-shrink:0">${fmtD(it.date)}</div>
            </div>`;
          }).join('');

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1.25rem';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:1.5rem 1.25rem;max-width:360px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,0.25);max-height:80vh;display:flex;flex-direction:column">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.85rem">
            <div style="font-size:1rem;font-weight:700;color:#111827">🔔 Novidades — últimas 48h</div>
            <button id="_nov-close" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#6b7280;padding:0 4px">✕</button>
          </div>
          <div style="overflow-y:auto;flex:1">${body}</div>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.querySelector('#_nov-close').addEventListener('click', close);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    }

    document.getElementById('btn-novidades')?.addEventListener('click', showNovidades);

    async function initVazaoScreen() {
      const dateEl   = document.getElementById('vazao-date');
      const clientSel = document.getElementById('vazao-client');

      // 1. Data padrão = hoje (imediato, sem esperar rede)
      if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

      // 2. Popular clientes do cache local imediatamente
      const fillClients = async () => {
        const clients = await window.getAll('clients');
        const cur = clientSel.value;
        clientSel.innerHTML = '<option value="">-- Selecione --</option>';
        clients.sort((a,b) => (a.name||'').localeCompare(b.name||''))
               .forEach(c => { clientSel.innerHTML += `<option value="${c.id}">${c.name}</option>`; });
        if (cur) { clientSel.value = cur; }
      };
      await fillClients();

      // Restaurar seleção anterior
      if (clientSel.value) await loadVazaoMachines(clientSel.value);

      // 3. Sincronizar em background e atualizar lista silenciosamente
      syncVazaoData().then(() => fillClients()).catch(() => {});
    }

    async function loadVazaoMachines(clientId) {
      const area     = document.getElementById('vazao-machines-area');
      const emptyMsg = document.getElementById('vazao-empty-msg');

      area.style.display = 'none';
      area.innerHTML = '';

      if (!clientId) {
        emptyMsg.textContent = 'Selecione um cliente para ver as máquinas.';
        emptyMsg.style.display = '';
        await renderVazaoLocalHistory(0);
        return;
      }
      emptyMsg.style.display = 'none';

      const allMachines = await window.getAll('machines');
      const machines    = allMachines.filter(m => Number(m.client_id) === Number(clientId));

      if (!machines.length) {
        emptyMsg.textContent = 'Este cliente não possui máquinas cadastradas.';
        emptyMsg.style.display = '';
        await renderVazaoLocalHistory(clientId);
        return;
      }

      const allVazoes = await dbGetAll_raw('vazoes');

      area.innerHTML = machines.map(m => {
        const mv  = allVazoes.filter(v => Number(v.machine_id) === Number(m.id));
        const has = mv.length > 0;
        const rows = has ? mv.map(v => `
          <tr>
            <td style="padding:0.45rem 0.5rem;font-weight:600">${v.name}</td>
            <td style="padding:0.45rem 0.5rem;color:var(--muted);font-size:0.82rem">${v.unit || '—'}</td>
            <td style="padding:0.3rem 0.5rem">
              <input type="number" step="any" min="0"
                class="form-input vazao-result-input"
                data-machine-id="${m.id}"
                data-vazao-id="${v.id}"
                data-vazao-name="${v.name}"
                data-vazao-unit="${v.unit || ''}"
                placeholder="0"
                style="width:100%;max-width:160px;padding:0.4rem 0.7rem" />
            </td>
          </tr>`).join('') : '';

        return `
          <div class="vazao-mach-block${has ? '' : ' vazao-mach-block--empty'}" style="margin-bottom:0.75rem">
            <div class="vazao-mach-block-hdr">
              <span>⚙️ ${m.name}</span>
              ${has ? `<span style="font-size:0.75rem;color:var(--primary);font-weight:600">💧 ${mv.length} vazão(ões)</span>` : '<span style="font-size:0.75rem;color:#b45309;font-weight:600">⚠️ Sem vazões</span>'}
            </div>
            ${has
              ? `<table class="proc-table" style="width:100%">
                  <thead><tr>
                    <th style="text-align:left">Vazão</th>
                    <th style="text-align:left">Unidade</th>
                    <th style="text-align:left;min-width:130px">Resultado</th>
                  </tr></thead>
                  <tbody>${rows}</tbody>
                </table>`
              : `<div style="padding:0.6rem 0.5rem;color:#92400e;font-size:0.85rem">Configure as vazões desta máquina em <strong>⚙️ Máquinas</strong>.</div>`
            }
          </div>`;
      }).join('');

      // Botão salvar ao final das máquinas
      area.innerHTML += `<div style="display:flex;justify-content:flex-end;margin-top:0.5rem">
        <button id="btn-save-vazao" class="btn-primary" style="min-width:160px">💾 Salvar Leituras</button>
      </div>`;
      area.style.display = '';

      // Re-bind do botão (foi recriado no innerHTML)
      document.getElementById('btn-save-vazao')?.addEventListener('click', saveVazaoReadings);

      await renderVazaoLocalHistory(clientId);
    }

    async function saveVazaoReadings() {
      if (!canDo('edit_vazao')) return toast('Sem permissão para salvar leituras de vazão.', 'error');
      const date     = document.getElementById('vazao-date')?.value;
      const clientId = Number(document.getElementById('vazao-client')?.value);
      if (!date || !clientId) return toast('Preencha a data e selecione um cliente', 'warning');

      const inputs = document.querySelectorAll('.vazao-result-input');
      const rows = [];
      inputs.forEach(inp => {
        const val = inp.value.trim();
        if (val !== '') rows.push({
          machine_id: Number(inp.dataset.machineId),
          vazao_id:   Number(inp.dataset.vazaoId),
          vazao_name: inp.dataset.vazaoName,
          vazao_unit: inp.dataset.vazaoUnit,
          value:      parseFloat(val)
        });
      });

      if (!rows.length) return toast('Informe pelo menos um resultado', 'warning');
      if (_saving) return;

      const btn = document.getElementById('btn-save-vazao');
      setSaving(true, btn || null, '⏳ Salvando...');

      try {
        let saved = 0;
        for (const r of rows) {
          const record = {
            date, client_id: clientId, machine_id: r.machine_id,
            vazao_id: r.vazao_id, vazao_name: r.vazao_name,
            vazao_unit: r.vazao_unit, value: r.value,
            user: currentUser?.name || currentUser?.username || '',
            created_at: new Date().toISOString()
          };
          const id = await dbAdd('vazao_records', record);
          record.id = id;
          await postToSheetDB(SHEETS.VAZAO_RECORDS, record);
          saved++;
        }
        toast(`✅ ${saved} leitura(s) salva(s)!`, 'success');
        const _allClientsVz = await dbGetAll_raw('clients');
        const _clientVz = _allClientsVz.find(c => Number(c.id) === clientId);
        notifyEmail('nova_vazao', { clientName: _clientVz?.name || `#${clientId}`, date, count: saved });
        inputs.forEach(inp => inp.value = '');
        await renderVazaoHistory();
        await renderVazaoLocalHistory(clientId);
      } catch(e) {
        toast('Erro ao salvar leituras', 'error');
      } finally {
        setSaving(false, btn || null);
      }
    }

    document.getElementById('vazao-client')?.addEventListener('change', async e => {
      await loadVazaoMachines(e.target.value);
    });
    document.getElementById('vazao-hist-machine')?.addEventListener('change', async () => {
      const clientId = Number(document.getElementById('vazao-client')?.value || 0);
      await renderVazaoLocalHistory(clientId);
    });
    document.getElementById('vazao-hist-period')?.addEventListener('change', async () => {
      const clientId = Number(document.getElementById('vazao-client')?.value || 0);
      await renderVazaoLocalHistory(clientId);
    });

    function _getVazaoMainFilters() {
      const filterClient  = document.getElementById('chart-filter-client')?.value  || '';
      const filterSeller  = document.getElementById('chart-filter-seller')?.value  || '';
      const filterGerente = document.getElementById('chart-filter-gerente')?.value || '';
      const dateStart     = document.getElementById('chart-date-start')?.value || '';
      const dateEnd       = document.getElementById('chart-date-end')?.value   || '';
      const now  = new Date();
      const yyyy = now.getFullYear();
      const mm   = String(now.getMonth() + 1).padStart(2, '0');
      let filterStart = '', filterEnd = '';
      if (dateStart || dateEnd) {
        filterStart = dateStart; filterEnd = dateEnd;
      } else {
        const preset = document.querySelector('.chart-preset-btn.active')?.dataset?.preset || 'year';
        if      (preset === 'month') { filterStart = filterEnd = `${yyyy}-${mm}`; }
        else if (preset === '3m')    { const d = new Date(now); d.setMonth(d.getMonth()-2); filterStart = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; filterEnd = `${yyyy}-${mm}`; }
        else if (preset === '6m')    { const d = new Date(now); d.setMonth(d.getMonth()-5); filterStart = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; filterEnd = `${yyyy}-${mm}`; }
        else if (preset === 'year')  { filterStart = `${yyyy}-01`; filterEnd = `${yyyy}-12`; }
      }
      return { filterClient, filterSeller, filterGerente, filterStart, filterEnd };
    }

    async function _getFilteredVazaoRecords() {
      const clients  = await dbGetAll_raw('clients');
      const machines = await dbGetAll_raw('machines');
      let records    = await dbGetAll_raw('vazao_records');

      // Filtrar por papel
      if (currentUser && (currentUser.role === 'gerente' || currentUser.role === 'consultor')) {
        const managed = getManagedSellerNames();
        const myClientIds = new Set(clients.filter(c => managed.has((c.seller||'').toLowerCase())).map(c=>Number(c.id)));
        records = records.filter(r => myClientIds.has(Number(r.client_id)));
      } else if (currentUser && currentUser.role === 'vendedor') {
        const sellerName = (currentUser.sellerName||'').toLowerCase();
        const myClientIds = new Set(clients.filter(c=>(c.seller||'').toLowerCase()===sellerName).map(c=>Number(c.id)));
        records = records.filter(r => myClientIds.has(Number(r.client_id)));
      }

      // Aplicar filtros principais da tela de gráficos
      const { filterClient, filterSeller, filterGerente, filterStart, filterEnd } = _getVazaoMainFilters();
      if (filterClient) records = records.filter(r => Number(r.client_id) === Number(filterClient));
      if (filterGerente) {
        const allUsers = await _originalGetAll('users');
        const gerente = allUsers.find(u => String(u.id) === filterGerente);
        if (gerente) {
          const gerenteName = (gerente.sellerName || gerente.name || '').toLowerCase();
          const gerenteSellers = new Set(allUsers.filter(u => (u.manager||'').toLowerCase() === gerenteName).map(u => (u.sellerName||u.name||'').toLowerCase()));
          records = records.filter(r => { const c = clients.find(c => Number(c.id) === Number(r.client_id)); return gerenteSellers.has((c?.seller||'').toLowerCase()); });
        }
      }
      if (filterSeller) records = records.filter(r => {
        const c = clients.find(c => Number(c.id) === Number(r.client_id));
        return (c?.seller || '') === filterSeller;
      });
      if (filterStart || filterEnd) {
        records = records.filter(r => {
          const m = (r.date || '').slice(0, 7);
          if (!m) return false;
          if (filterStart && m < filterStart) return false;
          if (filterEnd   && m > filterEnd)   return false;
          return true;
        });
      }

      return { records, clients, machines };
    }

    async function renderVazaoHistory() {
      const list = document.getElementById('vazao-history-list');
      if (!list) return;
      const { records, clients, machines } = await _getFilteredVazaoRecords();

      if (!records.length) {
        list.innerHTML = '<div class="empty-state">💧 Nenhuma leitura registrada.</div>';
        return;
      }

      const groups = {};
      for (const r of records) {
        const key = `${r.date}|${r.client_id}|${r.machine_id}`;
        if (!groups[key]) {
          const client  = clients.find(c => Number(c.id) === Number(r.client_id));
          const machine = machines.find(m => Number(m.id) === Number(r.machine_id));
          groups[key] = { date: r.date, clientName: client?.name || `#${r.client_id}`, machineName: machine?.name || `#${r.machine_id}`, readings: [] };
        }
        groups[key].readings.push(r);
      }

      const sorted = Object.values(groups).sort((a, b) => b.date.localeCompare(a.date));
      list.innerHTML = sorted.map(g => `
        <div class="list-item" style="flex-direction:column;align-items:stretch;gap:0.4rem;padding:0.85rem 1rem">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem">
            <div style="font-weight:700;font-size:0.95rem">${g.clientName}</div>
            <div style="font-size:0.8rem;color:var(--muted)">${fmtDate(g.date)} · ⚙️ ${g.machineName}</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.4rem 1rem;margin-top:0.2rem">
            ${g.readings.map(r => `
              <span style="font-size:0.82rem;background:#f1f5f9;border-radius:6px;padding:3px 10px;border:1px solid var(--border)">
                <strong>${r.vazao_name}</strong>: ${r.value} ${r.vazao_unit || ''}
              </span>
            `).join('')}
          </div>
        </div>
      `).join('');
    }

    async function renderVazaoLocalHistory(clientId) {
      const card  = document.getElementById('vazao-history-card');
      const listEl = document.getElementById('vazao-local-history');
      if (!card || !listEl) return;

      if (!clientId) { card.style.display = 'none'; return; }
      card.style.display = '';

      // Popular filtro de máquinas do cliente
      const machines = await dbGetAll_raw('machines');
      const clientMachines = machines.filter(m => Number(m.client_id) === Number(clientId));
      const machSel = document.getElementById('vazao-hist-machine');
      if (machSel) {
        const prev = machSel.value;
        machSel.innerHTML = '<option value="">⚙️ Todas as máquinas</option>' +
          clientMachines.map(m => `<option value="${m.id}">⚙️ ${m.name}</option>`).join('');
        if (prev) machSel.value = prev;
      }

      const allRecords = await dbGetAll_raw('vazao_records');
      let records = allRecords.filter(r => Number(r.client_id) === Number(clientId));

      const machFilter = Number(machSel?.value || 0);
      if (machFilter) records = records.filter(r => Number(r.machine_id) === machFilter);

      const periodFilter = document.getElementById('vazao-hist-period')?.value || '30';
      if (periodFilter !== 'all') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - Number(periodFilter));
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        records = records.filter(r => (r.date || '') >= cutoffStr);
      }

      if (!records.length) {
        listEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:1rem">Nenhuma leitura no período selecionado.</div>';
        return;
      }

      // Agrupar por máquina + tipo de vazão
      const byMachVazao = {};
      for (const r of records) {
        const m = machines.find(mm => Number(mm.id) === Number(r.machine_id));
        const mName = m?.name || `Máquina #${r.machine_id}`;
        const key = `${r.machine_id}|||${r.vazao_name}`;
        if (!byMachVazao[key]) byMachVazao[key] = { machineName: mName, vazaoName: r.vazao_name || '', unit: r.vazao_unit || '', readings: [] };
        byMachVazao[key].readings.push(r);
      }
      for (const item of Object.values(byMachVazao)) {
        item.readings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      }

      // Agrupar por máquina
      const byMachine = {};
      for (const item of Object.values(byMachVazao)) {
        if (!byMachine[item.machineName]) byMachine[item.machineName] = [];
        byMachine[item.machineName].push(item);
      }

      listEl.innerHTML = Object.entries(byMachine).map(([machineName, items]) => `
        <div class="vazao-hist-mach-label">⚙️ ${machineName}</div>
        ${items.map(item => {
          const latest = item.readings[0];
          const prev   = item.readings[1];
          let delta = '';
          if (prev && Number(prev.value) !== 0) {
            const pct  = ((Number(latest.value) - Number(prev.value)) / Math.abs(Number(prev.value))) * 100;
            const sign = pct >= 0 ? '▲' : '▼';
            const col  = pct >= 0 ? '#ef4444' : '#10b981';
            delta = `<span style="font-size:0.72rem;color:${col};font-weight:700;white-space:nowrap">${sign} ${Math.abs(pct).toFixed(1)}% vs anterior</span>`;
          }
          return `
            <div class="vazao-hist-item">
              <div>
                <div style="font-size:0.88rem;font-weight:600">${item.vazaoName}</div>
                <div style="font-size:0.73rem;color:var(--muted)">${fmtDate(latest.date)}${item.readings.length > 1 ? ` · ${item.readings.length} leituras` : ''}</div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:2px">
                <div style="font-size:1rem;font-weight:700">${latest.value} <span style="font-size:0.73rem;color:var(--muted);font-weight:500">${item.unit}</span></div>
                ${delta}
              </div>
            </div>`;
        }).join('')}
      `).join('');
    }

    async function renderVazaoChart() {
      const { records } = await _getFilteredVazaoRecords();

      // Rebuild canvas para destruir chart anterior
      const old = document.getElementById('chart-vazao-evolucao');
      if (!old) return;
      const nc = document.createElement('canvas');
      nc.id = 'chart-vazao-evolucao';
      nc.height = 180;
      old.replaceWith(nc);
      if (_charts['chart-vazao-evolucao']) { try { _charts['chart-vazao-evolucao'].destroy(); } catch(e){} delete _charts['chart-vazao-evolucao']; }

      if (!records.length) return;

      const dates      = [...new Set(records.map(r => r.date))].sort();
      const vazaoNames = [...new Set(records.map(r => r.vazao_name).filter(Boolean))].sort();

      const datasets = vazaoNames.map((name, i) => ({
        label: name,
        data: dates.map(d => {
          const recs = records.filter(r => r.date === d && r.vazao_name === name);
          if (!recs.length) return null;
          return Math.round(recs.reduce((s, r) => s + Number(r.value), 0) / recs.length * 100) / 100;
        }),
        borderColor: CHART_COLORS[i % CHART_COLORS.length],
        backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '22',
        tension: 0.3,
        fill: false,
        spanGaps: true,
        pointRadius: 4,
        pointHoverRadius: 6,
      }));

      _charts['chart-vazao-evolucao'] = new Chart(nc, {
        type: 'line',
        data: { labels: dates.map(d => fmtDate(d)), datasets },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'top' },
            tooltip: { mode: 'index', intersect: false }
          },
          scales: {
            y: { beginAtZero: false, grid: { color: '#e2e8f0' }, ticks: { font: { size: 11 } } },
            x: { grid: { color: '#e2e8f0' }, ticks: { font: { size: 11 } } }
          }
        }
      });

      await renderVazaoHistory();
    }

    // =====================================================
    // GERENCIAR VAZÕES POR MÁQUINA (painel inline)
    // =====================================================
    function _vazaoBatchRowHtml(idx) {
      return `
        <div class="vazao-batch-row" style="display:flex;gap:0.5rem;align-items:center">
          <input placeholder="Nome (ex: BOMBA ${idx})" class="form-input vazao-batch-name" style="flex:2;min-width:100px;padding:0.4rem 0.7rem" />
          <input placeholder="Unidade (ex: L/s)" class="form-input vazao-batch-unit" style="flex:1;min-width:70px;padding:0.4rem 0.7rem" />
          <button type="button" onclick="this.closest('.vazao-batch-row').remove()" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:1rem;padding:2px 6px;flex-shrink:0" title="Remover">✕</button>
        </div>`;
    }

    window._manageVazoes = async function(machineId, machineName) {
      if (!canDo('edit_bomba')) return toast('Sem permissão para gerenciar vazões.', 'error');
      const existing = document.getElementById(`vazao-mgr-${machineId}`);
      if (existing) { existing.remove(); return; }

      const vazoes = (await dbGetAll_raw('vazoes')).filter(v => Number(v.machine_id) === Number(machineId));
      const panel = document.createElement('div');
      panel.id = `vazao-mgr-${machineId}`;
      panel.className = 'vazao-mgr-panel';
      panel.innerHTML = `
        <div class="vazao-mgr-hdr">
          <span>💧 Vazões de "${machineName}"</span>
          <button class="btn-close" onclick="document.getElementById('vazao-mgr-${machineId}').remove()">✕</button>
        </div>
        <div id="vazao-mgr-list-${machineId}">
          ${vazoes.length ? vazoes.map(v => _vazaoItem(v)).join('') : '<p style="color:var(--muted);font-size:0.85rem;margin:0.5rem 0">Nenhuma vazão cadastrada.</p>'}
        </div>
        <div style="margin-top:0.75rem">
          <div style="font-size:0.75rem;font-weight:700;color:var(--muted);margin-bottom:0.4rem;text-transform:uppercase;letter-spacing:0.4px">Adicionar em lote</div>
          <div id="vazao-batch-rows-${machineId}" style="display:flex;flex-direction:column;gap:0.35rem">
            ${[1,2,3].map(i => _vazaoBatchRowHtml(i)).join('')}
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;justify-content:space-between;align-items:center">
            <button type="button" id="vazao-add-row-${machineId}" class="btn-secondary" style="font-size:0.82rem;padding:0.35rem 0.8rem;min-height:0;width:auto">+ Linha</button>
            <button type="button" id="vazao-save-batch-${machineId}" class="btn-primary" style="font-size:0.85rem;padding:0.4rem 1.1rem;min-height:0;width:auto">💾 Salvar todos</button>
          </div>
        </div>
      `;

      const machCard = document.querySelector(`[data-machine-id="${machineId}"]`);
      if (machCard) machCard.after(panel);
      else document.getElementById('machines-list-cad').appendChild(panel);

      document.getElementById(`vazao-add-row-${machineId}`)?.addEventListener('click', () => {
        const rowsEl = document.getElementById(`vazao-batch-rows-${machineId}`);
        const n = rowsEl.querySelectorAll('.vazao-batch-row').length + 1;
        rowsEl.insertAdjacentHTML('beforeend', _vazaoBatchRowHtml(n));
        rowsEl.querySelector('.vazao-batch-row:last-child .vazao-batch-name')?.focus();
      });

      document.getElementById(`vazao-save-batch-${machineId}`)?.addEventListener('click', async () => {
        const rowsEl = document.getElementById(`vazao-batch-rows-${machineId}`);
        const rows = [...rowsEl.querySelectorAll('.vazao-batch-row')].map(row => ({
          name: row.querySelector('.vazao-batch-name')?.value.trim(),
          unit: row.querySelector('.vazao-batch-unit')?.value.trim() || ''
        })).filter(r => r.name);

        if (!rows.length) return toast('Informe ao menos um nome', 'warning');
        if (_saving) return;

        const btn = document.getElementById(`vazao-save-batch-${machineId}`);
        setSaving(true, btn, '⏳...');
        try {
          const listEl = document.getElementById(`vazao-mgr-list-${machineId}`);
          listEl.querySelectorAll('p').forEach(p => p.remove());

          for (const r of rows) {
            const data = { machine_id: Number(machineId), name: r.name, unit: r.unit, created_at: new Date().toISOString() };
            const id = await dbAdd('vazoes', data);
            data.id = id;
            await postToSheetDB(SHEETS.VAZOES, data);
            if (listEl) listEl.innerHTML += _vazaoItem(data);
          }

          rowsEl.innerHTML = _vazaoBatchRowHtml(1);
          toast(`${rows.length} vazão(ões) adicionada(s)!`, 'success');
        } catch(err) {
          toast('Erro ao salvar', 'error');
        } finally {
          setSaving(false, btn);
        }
      });
    };

    function _vazaoItem(v) {
      return `
        <div id="vazao-item-${v.id}" style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:0.88rem"><strong>${v.name}</strong>${v.unit ? ` <span style="color:var(--muted);font-size:0.78rem">(${v.unit})</span>` : ''}</span>
          <button onclick="window._deleteVazao(${v.id})" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:1rem;padding:2px 6px" title="Excluir">🗑️</button>
        </div>`;
    }

    window._deleteVazao = async function(id) {
      if (!canDo('edit_bomba')) return toast('Sem permissão para excluir vazões.', 'error');
      if (!await confirmAction('Excluir esta vazão? Os registros históricos não serão apagados.', 'Excluir', true)) return;
      await dbDelete('vazoes', id);
      await deleteSheetDB(SHEETS.VAZOES, id);
      document.getElementById(`vazao-item-${id}`)?.remove();
      toast('Vazão removida', 'success');
    };


    // =====================================================
    // TELA RECEITAS
    // =====================================================
    let _editingRecipeId = null; // null = novo, number = editando

    async function _checkDuplicateRecipeName(name, clientId, excludeId = null) {
      if (!name || !clientId) return null;
      const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
      const n = norm(name);
      const all = await dbGetAll_raw('recipes');
      const active = all.filter(r => r.status === 'active' && Number(r.client_id) === Number(clientId) && Number(r.id) !== Number(excludeId));
      return active.find(r => norm(r.name) === n) || active.find(r => norm(r.name).includes(n) || n.includes(norm(r.name))) || null;
    }

    const RECIPE_OPS = ['Enxágue','Pré Lavagem','Lavagem','Alvejamento','Neutralização','Amaciamento'];
    const RECIPE_LEVELS = ['Alto','Médio','Baixo'];

    function _stepRowHtml(step = {}, products = [], idx = 0) {
      const n = step.n || (idx + 1);
      const dlId    = `op-dl-${idx}`;
      const opOpts  = RECIPE_OPS.map(o => `<option value="${o}">`).join('');
      const lvlOpts = RECIPE_LEVELS.map(l => `<option${step.level===l?' selected':''}>${l}</option>`).join('');
      const temp = step.temp || 'Fria';
      const isCustom = temp !== 'Fria' && temp !== 'Quente';
      const stepProds = Array.isArray(step.products) ? step.products.filter(v => v) : [];

      // Normaliza products: string[] (antigo) → {name, dosage}[]
      const normalizedProds = stepProds.map(p =>
        typeof p === 'string' ? { name: p, dosage: step.dosage || '' } : p
      ).filter(p => p && p.name);

      const buildProdOpts = (selected = '') =>
        `<option value="">-- Produto --</option>` +
        products.map(p => `<option value="${p.name}"${p.name===selected?' selected':''}>${p.name}</option>`).join('');

      const buildProdLine = (name = '', dosage = '') =>
        `<div class="step-prod-line" style="display:flex;gap:3px;margin-bottom:3px;align-items:center">
          <select class="form-input step-prod-sel" style="flex:2;font-size:0.82rem;padding:0.25rem 0.35rem">${buildProdOpts(name)}</select>
          <input type="text" class="form-input step-prod-dosage" value="${dosage}" placeholder="Dose" style="flex:1;min-width:55px;max-width:75px;font-size:0.82rem;padding:0.25rem 0.35rem"/>
          <button type="button" class="step-prod-del" style="padding:0 7px;height:30px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;color:#dc2626;font-size:0.82rem;flex-shrink:0">×</button>
        </div>`;

      const prodLinesHtml = normalizedProds.length
        ? normalizedProds.map(p => buildProdLine(p.name, p.dosage)).join('')
        : buildProdLine('');

      const prodsHtml = products.length
        ? `<div class="step-prods-wrap">
            <div class="step-prod-lines">${prodLinesHtml}</div>
            <button type="button" class="step-prod-add" style="font-size:0.75rem;padding:2px 8px;background:#f0fdf4;border:1px solid #86efac;border-radius:6px;cursor:pointer;color:#16a34a;margin-top:2px">+ Produto</button>
           </div>`
        : '<span style="font-size:0.82rem;color:#94a3b8">Sem produtos cadastrados</span>';

      return `
        <div class="step-card">
          <datalist id="${dlId}">${opOpts}</datalist>
          <div class="step-card-hdr">
            <span class="step-num">Etapa <strong class="step-num-val">${n}</strong></span>
            <button type="button" class="btn-danger btn-sm step-del-btn" style="padding:0.18rem 0.45rem;font-size:0.73rem">🗑️ Remover</button>
          </div>
          <div class="step-card-body">
            <div class="step-row-fields" style="gap:0.4rem">
              <div class="form-field" style="flex:2;min-width:100px">
                <label>Operação</label>
                <input list="${dlId}" class="form-input step-op" value="${step.operation||''}" placeholder="Selecione ou digite..." autocomplete="off"/>
              </div>
              <div class="form-field" style="flex:0 0 68px">
                <label>Tempo</label>
                <input type="number" class="form-input step-time" min="0" value="${step.time||''}" placeholder="min"/>
              </div>
              <div class="form-field" style="flex:1;min-width:68px">
                <label>Nível</label>
                <select class="form-input step-level">${lvlOpts}</select>
              </div>
            </div>
            <div class="step-row-fields" style="gap:0.4rem">
              <div class="form-field" style="flex:0 0 100px">
                <label>Temp.</label>
                <select class="form-input step-temp-sel">
                  <option ${!isCustom&&temp==='Fria'?'selected':''}>Fria</option>
                  <option ${!isCustom&&temp==='Quente'?'selected':''}>Quente</option>
                  <option value="__custom" ${isCustom?'selected':''}>Custom °C</option>
                </select>
                <input type="number" class="form-input step-temp-val" value="${isCustom?temp:''}" placeholder="°C" style="margin-top:3px;display:${isCustom?'':'none'}"/>
              </div>
              <div class="form-field" style="flex:1;min-width:140px">
                <label>Produto / Dose</label>
                ${prodsHtml}
              </div>
            </div>
          </div>
        </div>`;
    }

    function _collectSteps() {
      return [...document.querySelectorAll('#recipe-steps-body .step-card')].map((card, i) => {
        const tempSel = card.querySelector('.step-temp-sel')?.value;
        const tempVal = card.querySelector('.step-temp-val')?.value;
        const temp = tempSel === '__custom' ? (tempVal || 'Fria') : (tempSel || 'Fria');
        const products = [...card.querySelectorAll('.step-prod-line')].map(line => ({
          name:   line.querySelector('.step-prod-sel')?.value  || '',
          dosage: line.querySelector('.step-prod-dosage')?.value || '',
        })).filter(p => p.name);
        return {
          n: i + 1,
          operation: card.querySelector('.step-op')?.value || '',
          time: parseFloat(card.querySelector('.step-time')?.value) || 0,
          temp,
          level: card.querySelector('.step-level')?.value || 'Alto',
          products,
        };
      });
    }

    // Delegação de eventos para os cards de etapas
    document.getElementById('recipe-steps-body')?.addEventListener('click', e => {
      if (e.target.classList.contains('step-del-btn')) {
        e.target.closest('.step-card').remove();
        _renumberStepRows();
      }
      if (e.target.classList.contains('step-prod-del')) {
        e.target.closest('.step-prod-line').remove();
      }
      if (e.target.classList.contains('step-prod-add')) {
        const linesDiv = e.target.previousElementSibling;
        if (!linesDiv) return;
        const firstSel = linesDiv.querySelector('.step-prod-sel');
        const opts = firstSel ? firstSel.innerHTML : '<option value="">-- Produto --</option>';
        const line = document.createElement('div');
        line.className = 'step-prod-line';
        line.style.cssText = 'display:flex;gap:3px;margin-bottom:3px;align-items:center';
        line.innerHTML = `<select class="form-input step-prod-sel" style="flex:2;font-size:0.82rem;padding:0.25rem 0.35rem">${opts}</select><input type="text" class="form-input step-prod-dosage" placeholder="Dose" style="flex:1;min-width:55px;max-width:75px;font-size:0.82rem;padding:0.25rem 0.35rem"/><button type="button" class="step-prod-del" style="padding:0 7px;height:30px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;cursor:pointer;color:#dc2626;font-size:0.82rem;flex-shrink:0">×</button>`;
        line.querySelector('.step-prod-sel').value = '';
        linesDiv.appendChild(line);
      }
    });
    document.getElementById('recipe-steps-body')?.addEventListener('change', e => {
      if (e.target.classList.contains('step-temp-sel')) {
        const valEl = e.target.nextElementSibling;
        if (valEl) valEl.style.display = e.target.value === '__custom' ? '' : 'none';
      }
    });

    function _renumberStepRows() {
      document.querySelectorAll('#recipe-steps-body .step-num-val').forEach((el, i) => {
        el.textContent = i + 1;
      });
    }

    function _setAllMachinesToggle(allMachines) {
      const yes = document.getElementById('recipe-allmach-yes');
      const no  = document.getElementById('recipe-allmach-no');
      const row = document.getElementById('recipe-machine-info-row');
      if (allMachines) {
        yes.style.cssText = 'flex:1;font-weight:700;background:var(--primary);color:#fff;border-color:var(--primary)';
        no.style.cssText  = 'flex:1';
        if (row) row.style.display = 'none';
      } else {
        yes.style.cssText = 'flex:1';
        no.style.cssText  = 'flex:1;font-weight:700;background:#dc2626;color:#fff;border-color:#dc2626';
        if (row) row.style.display = '';
      }
      document.getElementById('recipe-allmach-yes').dataset.active = allMachines ? '1' : '';
    }

    async function _openRecipeForm(recipeId = null) {
      _editingRecipeId = recipeId;
      const isEdit = recipeId !== null;
      document.getElementById('modal-recipe-title').textContent = isEdit ? '✏️ Editar Receita' : '📝 Nova Receita';
      document.getElementById('recipe-edit-notes-row').style.display = isEdit ? '' : 'none';
      document.getElementById('recipe-edit-notes').value = '';
      document.getElementById('recipe-name-warn').style.display = 'none';

      const clients = await window.getAll('clients');
      const clientSel = document.getElementById('recipe-client');
      clientSel.innerHTML = '<option value="">-- Selecione --</option>';
      clients.sort((a,b) => (a.name||'').localeCompare(b.name||'')).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        clientSel.appendChild(opt);
      });

      document.getElementById('recipe-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('recipe-name').value = '';
      document.getElementById('recipe-machine-info').value = '';
      document.getElementById('recipe-steps-body').innerHTML = '';
      _setAllMachinesToggle(true);

      if (isEdit) {
        const recipe = (await dbGetAll_raw('recipes')).find(r => Number(r.id) === Number(recipeId));
        if (!recipe) return toast('Receita não encontrada', 'error');
        clientSel.value = recipe.client_id;
        document.getElementById('recipe-name').value = recipe.name || '';
        document.getElementById('recipe-date').value = recipe.date || new Date().toISOString().slice(0, 10);
        const allMach = recipe.all_machines === true || recipe.all_machines === 'true' || recipe.all_machines === '1' || recipe.all_machines === 1 || recipe.all_machines === undefined || recipe.all_machines === '';
        _setAllMachinesToggle(allMach);
        if (!allMach) document.getElementById('recipe-machine-info').value = recipe.machine_info || '';
        const steps = JSON.parse(recipe.steps || '[]');
        const products = await dbGetAll_raw('recipe_products');
        steps.forEach((s, i) => document.getElementById('recipe-steps-body').insertAdjacentHTML('beforeend', _stepRowHtml(s, products, i)));
      } else {
        const products = await dbGetAll_raw('recipe_products');
        document.getElementById('recipe-steps-body').innerHTML = _stepRowHtml({}, products, 0);
      }

      document.getElementById('modal-recipe').classList.remove('hidden');
    }

    document.getElementById('recipe-allmach-yes')?.addEventListener('click', () => _setAllMachinesToggle(true));
    document.getElementById('recipe-allmach-no')?.addEventListener('click',  () => _setAllMachinesToggle(false));

    document.getElementById('recipe-name')?.addEventListener('blur', async () => {
      const name = document.getElementById('recipe-name').value.trim();
      const clientId = document.getElementById('recipe-client').value;
      const warn = document.getElementById('recipe-name-warn');
      if (!name || !clientId) { warn.style.display = 'none'; return; }
      const dup = await _checkDuplicateRecipeName(name, clientId, _editingRecipeId);
      if (dup) {
        warn.textContent = `⚠️ Já existe uma receita chamada "${dup.name}" para este cliente.`;
        warn.style.display = '';
      } else {
        warn.style.display = 'none';
      }
    });

    async function _addStep() {
      const products = await dbGetAll_raw('recipe_products');
      const container = document.getElementById('recipe-steps-body');
      const count = container.querySelectorAll('.step-card').length;
      container.insertAdjacentHTML('beforeend', _stepRowHtml({}, products, count));
      const modalBox = document.querySelector('#modal-recipe .modal-box');
      if (modalBox) setTimeout(() => modalBox.scrollTo({ top: modalBox.scrollHeight, behavior: 'smooth' }), 50);
    }
    document.getElementById('btn-add-step')?.addEventListener('click', _addStep);
    document.getElementById('btn-add-step-bottom')?.addEventListener('click', _addStep);

    document.getElementById('btn-new-recipe')?.addEventListener('click', () => {
      if (!canDo('create_recipe')) return toast('Sem permissão para criar receitas.', 'error');
      _openRecipeForm(null);
    });
    document.getElementById('modal-recipe-close')?.addEventListener('click',  () => document.getElementById('modal-recipe').classList.add('hidden'));
    document.getElementById('modal-recipe-cancel')?.addEventListener('click', () => document.getElementById('modal-recipe').classList.add('hidden'));

    document.getElementById('btn-save-recipe')?.addEventListener('click', async () => {
      if (_saving) return;
      const _isEditingRecipe = !!document.getElementById('recipe-edit-id')?.value;
      if (_isEditingRecipe && !canDo('edit_recipe'))   return toast('Sem permissão para editar receitas.', 'error');
      if (!_isEditingRecipe && !canDo('create_recipe')) return toast('Sem permissão para criar receitas.', 'error');
      const clientId  = Number(document.getElementById('recipe-client')?.value);
      const name      = (document.getElementById('recipe-name')?.value || '').trim();
      const date      = document.getElementById('recipe-date')?.value;
      const allMach   = !!document.getElementById('recipe-allmach-yes')?.dataset?.active;
      const machInfo  = (document.getElementById('recipe-machine-info')?.value || '').trim();
      if (!clientId) return toast('Selecione o cliente', 'warning');
      if (!name)     return toast('Informe o nome da receita', 'warning');
      if (!date)     return toast('Informe a data', 'warning');
      if (!allMach && !machInfo) return toast('Informe qual(is) máquina(s)', 'warning');
      const steps = _collectSteps();
      if (!steps.length) return toast('Adicione pelo menos uma etapa', 'warning');

      // Verificar duplicata e pedir confirmação se necessário
      const dup = await _checkDuplicateRecipeName(name, clientId, _editingRecipeId);
      if (dup) {
        const ok = await confirmAction(`Já existe uma receita chamada "${dup.name}" para este cliente.\n\nDeseja continuar mesmo assim?`, 'Continuar');
        if (!ok) return;
      }

      const btn = document.getElementById('btn-save-recipe');
      setSaving(true, btn);
      try {
        const now = new Date().toISOString();
        const creator = currentUser?.name || currentUser?.username || '';

        if (_editingRecipeId === null) {
          const recipe = {
            client_id: clientId, name, date, version: 1,
            all_machines: allMach, machine_info: allMach ? '' : machInfo,
            created_by: creator, status: 'active',
            edit_notes: '', rejection_notes: '', approved_by: '', approved_at: '',
            steps: JSON.stringify(steps), created_at: now
          };
          const id = await dbAdd('recipes', recipe);
          recipe.id = id;
          await dbPut('recipes', recipe);
          await postToSheetDB(SHEETS.RECIPES, recipe);
          toast('✅ Receita criada!', 'success');
        } else {
          const current = (await dbGetAll_raw('recipes')).find(r => Number(r.id) === Number(_editingRecipeId));
          if (!current) return toast('Receita original não encontrada', 'error');
          const editNotes = document.getElementById('recipe-edit-notes')?.value.trim() || '';
          const pending = {
            client_id: clientId, name, date, version: (Number(current.version) || 1) + 1,
            all_machines: allMach, machine_info: allMach ? '' : machInfo,
            created_by: creator, status: 'pending',
            replaces_id: current.id,
            edit_notes: editNotes, rejection_notes: '', approved_by: '', approved_at: '',
            steps: JSON.stringify(steps), created_at: now
          };
          const pid = await dbAdd('recipes', pending);
          pending.id = pid;
          await postToSheetDB(SHEETS.RECIPES, pending);
          toast('⏳ Edição enviada para aprovação!', 'info', 5000);
        }

        document.getElementById('modal-recipe').classList.add('hidden');
        await renderRecipesList();
      } catch(err) {
        toast('Erro ao salvar receita: ' + err.message, 'error');
      } finally {
        setSaving(false, btn);
      }
    });

    async function renderRecipesList() {
      const list = document.getElementById('recipes-list');
      if (!list) return;
      document.getElementById('btn-new-recipe')?.classList.toggle('hidden', !canDo('create_recipe'));

      // Skeleton enquanto carrega
      if (!list.querySelector('.skeleton-card')) {
        list.innerHTML = [1,2,3].map(() => `
          <div class="skeleton-card">
            <div class="skeleton-line short"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line xshort"></div>
          </div>`).join('');
      }

      const filterClientId = Number(document.getElementById('recipe-filter-client')?.value || 0);

      const [clients, allRecipesRaw] = await Promise.all([
        dbGetAll_raw('clients'),
        dbGetAll_raw('recipes'),
      ]);
      let allRecipes = allRecipesRaw;

      // Filtrar por papel (vendedor vê só clientes seus)
      if (currentUser?.role === 'vendedor') {
        const sn = (currentUser.sellerName||'').toLowerCase();
        const myIds = new Set(clients.filter(c=>(c.seller||'').toLowerCase()===sn).map(c=>Number(c.id)));
        allRecipes = allRecipes.filter(r => myIds.has(Number(r.client_id)));
      } else if (currentUser?.role === 'gerente' || currentUser?.role === 'consultor') {
        const managed = getManagedSellerNames();
        const myIds = new Set(clients.filter(c=>managed.has((c.seller||'').toLowerCase())).map(c=>Number(c.id)));
        allRecipes = allRecipes.filter(r => myIds.has(Number(r.client_id)));
      }

      // Mostrar aprovações pendentes (só admin)
      const isPendingAdmin = currentUser?.role === 'admin';
      const pendingSec = document.getElementById('recipes-pending-section');
      if (isPendingAdmin) {
        const pendings = allRecipes.filter(r => r.status === 'pending');
        pendingSec.style.display = pendings.length ? '' : 'none';
        document.getElementById('recipes-pending-count').textContent = pendings.length;
        document.getElementById('recipes-pending-list').innerHTML = pendings.map(r => {
          const c = clients.find(c => Number(c.id) === Number(r.client_id));
          const allMach = String(r.all_machines) === '1' || r.all_machines === true || r.all_machines === 'true';
          const machChip = allMach
            ? '<span style="font-size:0.75rem;background:#dcfce7;color:#15803d;padding:1px 7px;border-radius:999px;font-weight:600">✅ Todas as máquinas</span>'
            : (r.machine_info ? `<span style="font-size:0.75rem;background:#fef3c7;color:#b45309;padding:1px 7px;border-radius:999px;font-weight:600">⚙️ ${r.machine_info}</span>` : '');
          return `<div class="list-item" style="flex-direction:column;gap:0.4rem;padding:0.7rem 1rem">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem">
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.3rem">
                <strong>${c?.name||'?'}</strong>
                <span style="color:var(--muted)">·</span>
                <span style="font-weight:600">📋 ${r.name||'—'}</span>
                ${machChip}
                <span style="font-size:0.78rem;color:var(--muted)">— por ${r.created_by}</span>
              </div>
              <div style="display:flex;gap:0.4rem">
                <button class="btn-secondary btn-sm" onclick="window._viewRecipe(${r.id})">👁️ Ver</button>
                <button class="btn-danger btn-sm" onclick="window._rejectRecipe(${r.id})">✕ Recusar</button>
                <button class="btn-primary btn-sm" style="background:#16a34a" onclick="window._approveRecipe(${r.id})">✅ Aprovar</button>
              </div>
            </div>
            ${r.edit_notes ? `<div style="font-size:0.8rem;color:#64748b">📝 ${r.edit_notes}</div>` : ''}
          </div>`;
        }).join('') || '<div class="empty-state" style="padding:0.5rem">Nenhuma aprovação pendente.</div>';
      } else {
        if (pendingSec) pendingSec.style.display = 'none';
      }

      // Filtro de status via chips
      const activeStatusChip = document.querySelector('#recipes-status-filters .qf-btn.active')?.dataset?.rs || 'all';
      let displayed = allRecipes.filter(r => activeStatusChip === 'all' ? r.status === 'active' : r.status === activeStatusChip);
      if (filterClientId) displayed = displayed.filter(r => Number(r.client_id) === filterClientId);

      // Filtro de busca por texto
      const searchTerm = (document.getElementById('recipe-search')?.value || '').toLowerCase().trim();
      if (searchTerm) {
        displayed = displayed.filter(r => {
          const c = clients.find(c => Number(c.id) === Number(r.client_id));
          const text = [c?.name, r.name, r.machine_info].filter(Boolean).join(' ').toLowerCase();
          return text.includes(searchTerm);
        });
      }
      displayed.sort((a,b) => {
        const ca = clients.find(c => Number(c.id) === Number(a.client_id))?.name || '';
        const cb = clients.find(c => Number(c.id) === Number(b.client_id))?.name || '';
        if (ca !== cb) return ca.localeCompare(cb);
        return (a.name||'').localeCompare(b.name||'');
      });

      document.getElementById('recipes-count').textContent = displayed.length;

      if (!displayed.length) {
        const searchTerm2 = (document.getElementById('recipe-search')?.value || '').trim();
        list.innerHTML = searchTerm2
          ? `<div class="empty-state"><span class="empty-icon">🔍</span><strong>Nenhum resultado para "${searchTerm2}"</strong><p>Tente outro termo ou limpe a busca.</p></div>`
          : `<div class="empty-state"><span class="empty-icon">🗂️</span><strong>Nenhuma receita cadastrada</strong><p>Crie a primeira receita para este filtro.</p><button class="btn-primary btn-sm" onclick="document.getElementById('btn-new-recipe').click()">+ Nova Receita</button></div>`;
        return;
      }

      // Agrupar por cliente
      const byClient = new Map();
      for (const r of displayed) {
        const cKey = String(r.client_id);
        if (!byClient.has(cKey)) byClient.set(cKey, []);
        byClient.get(cKey).push(r);
      }

      const _allMachBool = r => String(r.all_machines) === '1' || r.all_machines === true || r.all_machines === 'true';

      const recipeCardHtml = r => {
        const hasPending = allRecipes.some(x => x.status === 'pending' && Number(x.replaces_id) === Number(r.id));
        const allMach = _allMachBool(r);
        const machChip = allMach
          ? '<span style="font-size:0.73rem;background:#dcfce7;color:#15803d;border:1px solid #86efac;border-radius:999px;padding:1px 8px;font-weight:600">✅ Todas as máquinas</span>'
          : (r.machine_info ? `<span style="font-size:0.73rem;background:#fef3c7;color:#b45309;border:1px solid #fde68a;border-radius:999px;padding:1px 8px;font-weight:600">⚙️ ${r.machine_info}</span>` : '');
        const steps = (() => { try { return JSON.parse(r.steps||'[]'); } catch(e){ return []; } })();
        const dateStr = r.date ? fmtDate(r.date) : '';
        return `
          <div style="border:1px solid var(--border);border-radius:8px;padding:0.55rem 0.75rem;margin-bottom:0.4rem;background:#fff">
            <div style="display:flex;flex-wrap:wrap;gap:0.25rem 0.3rem;align-items:center;margin-bottom:0.35rem">
              <span style="font-size:0.88rem;font-weight:700;color:var(--text);flex:1;min-width:0">📋 ${r.name||'—'}</span>
              ${hasPending ? '<span style="font-size:0.72rem;background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:999px;font-weight:600">⏳ Pendente</span>' : ''}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.25rem 0.4rem;align-items:center;margin-bottom:0.4rem">
              ${machChip}
              ${dateStr ? `<span style="font-size:0.71rem;color:var(--muted)">📅 ${dateStr}</span>` : ''}
              ${r.version ? `<span style="font-size:0.68rem;background:#f1f5f9;border:1px solid var(--border);border-radius:5px;padding:1px 6px;color:#64748b;font-weight:600">v${r.version}</span>` : ''}
              <span style="font-size:0.7rem;color:var(--muted);margin-left:auto">${r.created_by||'—'}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.2rem 0.4rem;margin-bottom:0.45rem">
              ${steps.slice(0,5).map(s => `<span style="font-size:0.7rem;background:#f1f5f9;border-radius:5px;padding:1px 6px;border:1px solid var(--border);color:#1a3f5c"><strong>${s.n}.</strong> ${s.operation||'—'}</span>`).join('')}
              ${steps.length > 5 ? `<span style="font-size:0.7rem;color:var(--muted)">+${steps.length-5} mais</span>` : ''}
              ${!steps.length ? `<span style="font-size:0.7rem;color:var(--muted)">Sem etapas</span>` : ''}
            </div>
            <div style="display:flex;gap:0.3rem">
              ${!hasPending && canDo('edit_recipe') ? `<button class="btn-edit btn-sm" onclick="window._editRecipeOpen(${r.id})" style="flex:2">✏️ Editar</button>` : ''}
              <button class="btn-secondary btn-sm" onclick="window._viewRecipe(${r.id})" style="flex:1">👁️ Ver</button>
              <button class="btn-secondary btn-sm" onclick="window._toggleRecipeMore(${r.id})" style="flex:0 0 2.2rem;padding:0 !important;font-size:1.15rem;font-weight:700;letter-spacing:1px" title="Mais opções">⋯</button>
            </div>
            <div class="recipe-more-panel" id="rmore-${r.id}">
              ${currentUser?.role === 'admin' ? `<button class="btn-danger btn-sm" onclick="window._deleteRecipe(${r.id})" style="flex:0 0 auto">🗑️ Excluir</button>` : ''}
            </div>
          </div>`;
      };

      list.innerHTML = [...byClient.entries()].map(([cKey, recs]) => {
        const c = clients.find(c => String(c.id) === cKey);
        const cBodyId = `cb-${cKey}`;
        return `
          <div style="border:1px solid #bfdbfe;border-radius:12px;margin-bottom:0.75rem;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
            <div style="background:#eff6ff;padding:0.55rem 0.9rem;display:flex;align-items:center;gap:0.6rem;cursor:pointer;user-select:none;border-bottom:1px solid #bfdbfe"
                 onclick="(function(h){const b=document.getElementById('${cBodyId}');const open=b.style.display!=='none';b.style.display=open?'none':'block';h.querySelector('.carr').textContent=open?'▶':'▼';})(this)">
              <span class="carr" style="font-size:0.65rem;color:#93c5fd;min-width:10px">▼</span>
              <span style="font-size:0.95rem">👥</span>
              <span style="font-weight:700;font-size:0.92rem;color:var(--primary-dark)">${c?.name||'?'}</span>
              <span style="font-size:0.72rem;background:#dbeafe;color:var(--primary);padding:2px 9px;border-radius:999px;font-weight:600;margin-left:auto">${recs.length} receita${recs.length>1?'s':''}</span>
              <button onclick="event.stopPropagation();window._shareClientRecipesPdf('${cKey}')" style="flex-shrink:0;padding:2px 10px;border:1.5px solid #93c5fd;border-radius:6px;background:#fff;color:#1d4ed8;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap">📄 PDF</button>
            </div>
            <div id="${cBodyId}" style="padding:0.6rem 0.75rem;background:#fff">
              ${recs.map(r => recipeCardHtml(r)).join('')}
            </div>
          </div>`;
      }).join('');
    }

    window._editRecipeOpen = (id) => _openRecipeForm(id);

    window._toggleRecipeMore = function(id) {
      const panel = document.getElementById('rmore-' + id);
      if (!panel) return;
      document.querySelectorAll('.recipe-more-panel.open').forEach(p => { if (p !== panel) p.classList.remove('open'); });
      panel.classList.toggle('open');
    };

    window._deleteRecipe = async function(id) {
      const all = await dbGetAll_raw('recipes');
      const rec = all.find(r => Number(r.id) === Number(id));
      if (!rec) { toast('⚠️ Receita não encontrada', 'warning'); return; }
      const clients = await dbGetAll_raw('clients');
      const c = clients.find(c => Number(c.id) === Number(rec.client_id));
      const nameHint = [c?.name, rec.name].filter(Boolean).join(' › ');
      const confirmMsg = nameHint
        ? `Excluir receita\n"${nameHint}"?\n\nTodas as versões (ativas, arquivadas, pendentes) serão removidas.`
        : 'Excluir esta receita e todas as suas versões?';
      if (!await confirmAction(confirmMsg, '🗑️ Excluir', true)) return;
      const nId = Number(id);
      const toDelete = all.filter(r => Number(r.id) === nId || Number(r.replaces_id) === nId);
      let gasErr = 0;
      for (const r of toDelete) {
        await dbDelete('recipes', r.id);
        const ok = await deleteSheetDB(SHEETS.RECIPES, r.id);
        if (!ok) gasErr++;
      }
      if (gasErr > 0 && navigator.onLine) {
        toast('⚠️ Removido localmente, mas o servidor não confirmou. Clique Atualizar pode reaparecer.', 'warning', 7000);
      } else {
        toast('Receita excluída!', 'success');
      }
      await renderRecipesList();
      await updateRecipeBadge();
    };

    window._viewRecipe = async function(recipeId) {
      const allRecipes = await dbGetAll_raw('recipes');
      const recipe = allRecipes.find(r => r.id === recipeId);
      if (!recipe) return;
      const clients = await dbGetAll_raw('clients');
      const c = clients.find(c => Number(c.id) === Number(recipe.client_id));
      const steps = (() => { try { return JSON.parse(recipe.steps||'[]'); } catch(e){ return []; } })();

      const allMach = String(recipe.all_machines) === '1' || recipe.all_machines === true || recipe.all_machines === 'true';
      const machChip = allMach
        ? '<span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:2px 10px;border-radius:999px;font-size:0.78rem;font-weight:700">✅ Todas as máquinas</span>'
        : (recipe.machine_info ? `<span style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;padding:2px 10px;border-radius:999px;font-size:0.78rem;font-weight:700">⚙️ ${recipe.machine_info}</span>` : '');

      const statusLabel = { active:'✅ Ativa', pending:'⏳ Pendente', archived:'📦 Arquivada', rejected:'❌ Recusada' }[recipe.status] || recipe.status;

      const stepsHtml = steps.length ? steps.map(s => {
        const prods = Array.isArray(s.products) ? s.products.filter(p => p && (typeof p==='string' ? p : p?.name)) : [];
        const prodsHtml = prods.length
          ? prods.map(p => {
              const name = typeof p==='string' ? p : (p?.name||'—');
              const dose = typeof p==='string' ? '—' : (p?.dosage||'—');
              return `<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:3px 0;border-top:1px solid #e2e8f0;font-size:0.8rem"><span>${name}</span><span style="color:var(--muted);white-space:nowrap">${dose}</span></div>`;
            }).join('')
          : '';
        const chips = [
          s.time  ? `<span style="background:#dbeafe;color:#1d4ed8;border-radius:5px;padding:2px 8px;font-size:0.75rem;font-weight:600">⏱ ${s.time} min</span>` : '',
          s.temp  ? `<span style="background:#fef3c7;color:#92400e;border-radius:5px;padding:2px 8px;font-size:0.75rem;font-weight:600">🌡 ${s.temp}°C</span>` : '',
          s.level ? `<span style="background:#dcfce7;color:#15803d;border-radius:5px;padding:2px 8px;font-size:0.75rem;font-weight:600">💧 ${s.level}</span>` : '',
        ].filter(Boolean).join('');
        return `<div style="border-left:3px solid var(--primary);background:#f8fafc;border-radius:0 8px 8px 0;padding:0.6rem 0.75rem;margin-bottom:0.5rem">
          <div style="display:flex;align-items:center;gap:0.5rem${(chips||prodsHtml)?';margin-bottom:0.4rem':''}">
            <span style="background:var(--primary);color:#fff;border-radius:50%;width:22px;height:22px;min-width:22px;display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:800">${s.n}</span>
            <span style="font-weight:700;font-size:0.9rem;color:var(--text)">${s.operation||'—'}</span>
          </div>
          ${chips?`<div style="display:flex;flex-wrap:wrap;gap:0.3rem${prodsHtml?';margin-bottom:0.4rem':''}">${chips}</div>`:''}
          ${prodsHtml?`<div>${prodsHtml}</div>`:''}
        </div>`;
      }).join('') : `<p style="color:var(--muted);font-size:0.88rem;padding:0.5rem 0">Sem etapas cadastradas.</p>`;

      // Versão ativa relacionada (quando visualizando versão arquivada/recusada)
      const activeVersion = recipe.status !== 'active'
        ? allRecipes.find(r => r.status === 'active' && Number(r.id) === Number(recipe.replaces_id || -1))
          || allRecipes.find(r => r.status === 'active' && Number(r.replaces_id) === Number(recipe.id))
        : null;
      const activeVersionHtml = activeVersion
        ? `<div style="margin-top:0.75rem;padding:0.5rem 0.75rem;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:0.5rem">
            <span style="font-size:0.85rem;color:#15803d">📋 Existe uma versão ativa desta receita</span>
            <button class="btn-primary btn-sm" style="background:#16a34a" onclick="window._viewRecipe(${activeVersion.id})">Ver versão atual</button>
           </div>` : '';

      // Versões arquivadas (pendentes que foram substituídas)
      const archived = allRecipes.filter(r => r.status === 'archived' && Number(r.replaces_id) === Number(recipe.replaces_id || -1) && Number(r.id) !== Number(recipe.id))
        .concat(allRecipes.filter(r => r.status === 'archived' && Number(r.id) === Number(recipe.replaces_id || -1)));
      const archivedHtml = archived.length
        ? `<div style="margin-top:1rem"><strong style="font-size:0.85rem">📜 Versão anterior</strong>
           <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.4rem">
             ${archived.map(v => `<button class="btn-secondary btn-sm" onclick="window._viewRecipe(${v.id})">${fmtDate(v.date||v.created_at?.slice(0,10))}</button>`).join('')}
           </div></div>` : '';

      document.getElementById('modal-recipe-view-title').textContent = `📝 ${c?.name||'?'} — ${recipe.name||'—'}`;
      document.getElementById('modal-recipe-view-body').innerHTML = `
        <div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:10px;padding:0.75rem 1rem;margin-bottom:0.85rem">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.3rem 0.5rem;margin-bottom:0.35rem">
            ${machChip}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.25rem 0.75rem;font-size:0.78rem;color:var(--muted)">
            <span>📅 ${fmtDate(recipe.date||recipe.created_at?.slice(0,10))}</span>
            ${recipe.version ? `<span>Versão <strong style="color:var(--text)">v${recipe.version}</strong></span>` : ''}
            <span>${statusLabel}</span>
            <span>Por <strong style="color:var(--text)">${recipe.created_by||'—'}</strong></span>
          </div>
          ${recipe.edit_notes?`<p style="margin-top:0.4rem;font-size:0.78rem;color:#b45309">📝 ${recipe.edit_notes}</p>`:''}
          ${recipe.rejection_notes?`<p style="margin-top:0.4rem;font-size:0.78rem;color:#dc2626">❌ Motivo: ${recipe.rejection_notes}</p>`:''}
        </div>
        <div style="font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.45rem">Etapas (${steps.length})</div>
        ${stepsHtml}
        ${activeVersionHtml}
        ${archivedHtml}`;

      const isAdmin = currentUser?.role === 'admin';
      document.getElementById('btn-edit-recipe').style.display    = recipe.status === 'active' ? '' : 'none';
      document.getElementById('btn-approve-recipe').style.display  = isAdmin && recipe.status === 'pending' ? '' : 'none';
      document.getElementById('btn-reject-recipe').style.display   = isAdmin && recipe.status === 'pending' ? '' : 'none';
      document.getElementById('btn-edit-recipe').dataset.recipeId  = recipe.id;
      document.getElementById('btn-approve-recipe').dataset.recipeId = recipe.id;
      document.getElementById('btn-reject-recipe').dataset.recipeId  = recipe.id;
      const pdfBtn = document.getElementById('btn-recipe-pdf');
      if (pdfBtn) { pdfBtn.style.display = ''; pdfBtn.dataset.recipeId = recipe.id; }

      document.getElementById('modal-recipe-view').classList.remove('hidden');
    };

    document.getElementById('btn-edit-recipe')?.addEventListener('click', function() {
      document.getElementById('modal-recipe-view').classList.add('hidden');
      _openRecipeForm(Number(this.dataset.recipeId));
    });
    document.getElementById('btn-approve-recipe')?.addEventListener('click', async function() {
      await window._approveRecipe(Number(this.dataset.recipeId));
      document.getElementById('modal-recipe-view').classList.add('hidden');
    });
    document.getElementById('btn-reject-recipe')?.addEventListener('click', async function() {
      await window._rejectRecipe(Number(this.dataset.recipeId));
      document.getElementById('modal-recipe-view').classList.add('hidden');
    });
    document.getElementById('btn-recipe-pdf')?.addEventListener('click', function() {
      _shareRecipePdf(Number(this.dataset.recipeId));
    });
    document.getElementById('modal-recipe-view-close')?.addEventListener('click',  () => document.getElementById('modal-recipe-view').classList.add('hidden'));
    document.getElementById('modal-recipe-view-close2')?.addEventListener('click', () => document.getElementById('modal-recipe-view').classList.add('hidden'));

    async function _shareRecipePdf(recipeId) {
      if (!canDo('pdf_report')) return toast('Sem permissão para gerar PDF.', 'error');
      const win = window.open('', '_blank', 'width=900,height=700');
      if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
      const allRecipes = await dbGetAll_raw('recipes');
      const recipe = allRecipes.find(r => r.id === recipeId);
      if (!recipe) { win.close(); return toast('Receita não encontrada', 'error'); }
      const clients = await dbGetAll_raw('clients');
      const c = clients.find(c => Number(c.id) === Number(recipe.client_id));
      const steps = (() => { try { return JSON.parse(recipe.steps||'[]'); } catch(e){ return []; } })();
      const dateStr = fmtDate(recipe.date || recipe.created_at?.slice(0,10));
      const allMach = String(recipe.all_machines) === '1' || recipe.all_machines === true || recipe.all_machines === 'true';
      const machStr = allMach ? 'Todas as máquinas' : (recipe.machine_info || '—');
      const stepsRows = steps.map(s => {
        const prods = Array.isArray(s.products) ? s.products.filter(p => typeof p==='string' ? p : p?.name) : [];
        const prodNames = prods.map(p => typeof p==='string' ? p : p.name).join('<br>') || '—';
        const dosages   = prods.map(p => typeof p==='string' ? '—' : (p.dosage || '—')).join('<br>') || '—';
        return `<tr>
          <td style="text-align:center;font-weight:700;background:#f1f5f9">${s.n}</td>
          <td>${s.operation||'—'}</td>
          <td style="text-align:center">${s.time ? s.time+' min' : '—'}</td>
          <td style="text-align:center">${s.temp||'—'}</td>
          <td style="text-align:center">${s.level||'—'}</td>
          <td>${prodNames}</td>
          <td style="text-align:center">${dosages}</td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>PROCESSOS DE LAVAGENS - ${c?.name||'?'} - ${recipe.name||''} - ${dateStr}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:13px;color:#1e293b;padding:20px}
.hdr{background:#1d4ed8;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0}
.hdr h1{font-size:1.1rem;margin-bottom:2px}
.hdr p{font-size:0.75rem;color:#93c5fd;margin:0}
.info-block{background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:14px 18px 16px;margin-bottom:16px}
.info-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 16px;margin-top:10px}
.info-item label{font-size:0.68rem;color:#64748b;font-weight:700;text-transform:uppercase;display:block;margin-bottom:1px}
.info-item span{font-size:0.9rem;font-weight:600}
h2{font-size:0.88rem;font-weight:700;color:#1d4ed8;margin-bottom:8px;border-bottom:2px solid #dbeafe;padding-bottom:4px}
table{width:100%;border-collapse:collapse}
thead th{background:#1d4ed8;color:#fff;padding:7px 9px;text-align:left;font-size:0.75rem}
tbody tr:nth-child(even){background:#f8fafc}
tbody td{padding:6px 9px;border-bottom:1px solid #e2e8f0;font-size:12px;vertical-align:top}
.footer{margin-top:20px;font-size:0.7rem;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:10px}
@media screen{
  .action-bar{position:sticky;top:0;z-index:999;background:#1d4ed8;padding:6px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  .action-bar button{padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer}
  .btn-close-rcp{background:#fff;color:#1d4ed8}
  .btn-print-rcp{background:#4caf50;color:#fff}
  .action-bar-label{color:#bfdbfe;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
@media print{.action-bar{display:none}body{padding:10px}}
</style></head><body>
<div class="action-bar">
  <button class="btn-close-rcp" onclick="window.close()">✕ Fechar</button>
  <button class="btn-print-rcp" onclick="window.print()">🖨️ Salvar PDF</button>
  <span class="action-bar-label">${c?.name||'?'} · ${recipe.name||'—'}</span>
</div>
<div class="hdr"><h1>📝 Receita de Lavagem</h1><p>Hygicare Lavanderia</p></div>
<div class="info-block">
  <div class="info-grid">
    <div class="info-item"><label>Cliente</label><span>${c?.name||'—'}</span></div>
    <div class="info-item" style="grid-column:span 2"><label>Nome da Receita</label><span>${recipe.name||'—'}</span></div>
    <div class="info-item" style="grid-column:span 2"><label>Máquinas</label><span>${machStr}</span></div>
    <div class="info-item"><label>Data</label><span>${dateStr}</span></div>
    <div class="info-item"><label>Versão</label><span>${recipe.version ? 'v'+recipe.version : 'v1'}</span></div>
    <div class="info-item"><label>Criado por</label><span>${recipe.created_by||'—'}</span></div>
  </div>
</div>
<h2>📋 Etapas (${steps.length})</h2>
<table>
  <thead><tr><th style="width:34px">N.</th><th>Operação</th><th style="text-align:center">Tempo</th><th style="text-align:center">Temp.</th><th style="text-align:center">Nível</th><th>Produto(s)</th><th>Dosagem</th></tr></thead>
  <tbody>${stepsRows}</tbody>
</table>
<div class="footer">Hygicare Lavanderia — Gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
</body></html>`;
      win.document.write(html);
      win.document.close();
    }

    async function _shareClientRecipesPdf(clientId) {
      if (!canDo('pdf_report')) return toast('Sem permissão para gerar PDF.', 'error');
      const win = window.open('', '_blank', 'width=950,height=750');
      if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
      clientId = Number(clientId);
      const [allRecipes, clients] = await Promise.all([dbGetAll_raw('recipes'), dbGetAll_raw('clients')]);
      const c = clients.find(cl => Number(cl.id) === clientId);
      if (!c) { win.close(); return toast('Cliente não encontrado', 'error'); }

      const activeRecipes = allRecipes
        .filter(r => r.status === 'active' && Number(r.client_id) === clientId)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      if (!activeRecipes.length) { win.close(); return toast('Nenhuma receita ativa para este cliente', 'warning'); }

      const lastIso = activeRecipes.reduce((best, r) => {
        const d = r.date || r.created_at?.slice(0, 10) || '';
        return d > best ? d : best;
      }, '');
      const lastDateStr = fmtDate(lastIso);

      const recipeSections = activeRecipes.map(r => {
        const allMach = String(r.all_machines) === '1' || r.all_machines === true || r.all_machines === 'true';
        const machStr = allMach ? 'Todas as máquinas' : (r.machine_info || '—');
        const steps = (() => { try { return JSON.parse(r.steps || '[]'); } catch(e) { return []; } })();
        const stepsRows = steps.map(s => {
          const prods = Array.isArray(s.products) ? s.products.filter(x => typeof x === 'string' ? x : x?.name) : [];
          const prodNames = prods.map(x => typeof x === 'string' ? x : x.name).join('<br>') || '—';
          const dosages   = prods.map(x => typeof x === 'string' ? '—' : (x.dosage || '—')).join('<br>') || '—';
          return `<tr>
            <td style="text-align:center;font-weight:700;background:#f1f5f9">${s.n}</td>
            <td>${s.operation || '—'}</td>
            <td style="text-align:center">${s.time ? s.time + ' min' : '—'}</td>
            <td style="text-align:center">${s.temp || '—'}</td>
            <td style="text-align:center">${s.level || '—'}</td>
            <td>${prodNames}</td>
            <td style="text-align:center">${dosages}</td>
          </tr>`;
        }).join('');
        return `
        <div class="rs">
          <div class="rs-hdr">
            <span class="rs-proc">📋 ${escHtml(r.name||'—')}</span>
            <span class="rs-meta">⚙️ ${escHtml(machStr)} &nbsp;·&nbsp; ${fmtDate(r.date||r.created_at?.slice(0,10))}</span>
          </div>
          ${steps.length
            ? `<table><thead><tr><th style="width:34px">N.</th><th>Operação</th><th>Tempo</th><th>Temp.</th><th>Nível</th><th>Produto(s)</th><th>Dosagem</th></tr></thead><tbody>${stepsRows}</tbody></table>`
            : '<p style="color:#94a3b8;font-size:0.82rem;padding:8px 14px">Sem etapas cadastradas.</p>'}
        </div>`;
      }).join('');

      const titleStr = `PROCESSOS DE LAVAGENS - ${c.name} - ${lastDateStr}`;
      const htmlDoc = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${escHtml(titleStr)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:13px;color:#1e293b;padding:20px}
.doc-hdr{background:#1d4ed8;color:#fff;padding:16px 20px;border-radius:8px;margin-bottom:16px}
.doc-hdr h1{font-size:1.1rem;font-weight:700;margin-bottom:3px}
.doc-hdr p{font-size:0.75rem;color:#93c5fd}
.rs{border:1px solid #e2e8f0;border-radius:8px;margin-bottom:14px;overflow:hidden;break-inside:avoid}
.rs-hdr{background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px}
.rs-proc{font-weight:700;font-size:0.88rem;color:#1d4ed8}
.rs-meta{font-size:0.75rem;color:#64748b}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{background:#1d4ed8;color:#fff;padding:6px 9px;text-align:left;font-size:0.72rem;font-weight:700}
tbody tr:nth-child(even){background:#f8fafc}
tbody td{padding:5px 9px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.footer{margin-top:18px;font-size:0.7rem;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:10px}
@media screen{
  .abar{position:sticky;top:0;z-index:999;background:#1d4ed8;padding:6px 10px;display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .abar button{padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer}
  .btn-x{background:#fff;color:#1d4ed8}
  .btn-p{background:#16a34a;color:#fff}
  .abar-lbl{color:#bfdbfe;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
@media print{.abar{display:none}body{padding:10px}}
</style></head><body>
<div class="abar">
  <button class="btn-x" onclick="window.close()">✕ Fechar</button>
  <button class="btn-p" onclick="window.print()">🖨️ Salvar PDF</button>
  <span class="abar-lbl">${escHtml(c.name)} · ${activeRecipes.length} receita${activeRecipes.length > 1 ? 's' : ''}</span>
</div>
<div class="doc-hdr">
  <h1>📋 Processos de Lavagens</h1>
  <p>${escHtml(c.name)} &nbsp;·&nbsp; Hygicare Lavanderia &nbsp;·&nbsp; Última atualização: ${lastDateStr}</p>
</div>
${recipeSections}
<div class="footer">Hygicare Lavanderia — ${escHtml(c.name)} — Gerado em ${new Date().toLocaleString('pt-BR')}</div>
</body></html>`;

      win.document.write(htmlDoc);
      win.document.close();
    }
    window._shareClientRecipesPdf = _shareClientRecipesPdf;

    window._approveRecipe = async function(pendingId) {
      const all = await dbGetAll_raw('recipes');
      const pending = all.find(r => Number(r.id) === Number(pendingId));
      if (!pending || pending.status !== 'pending') return toast('Receita não encontrada ou não está pendente', 'error');

      if (pending.replaces_id) {
        const currentActive = all.find(r => r.status === 'active' && Number(r.id) === Number(pending.replaces_id));
        if (currentActive) {
          const archived = { ...currentActive, status: 'archived' };
          await dbPut('recipes', archived);
          await patchSheetDB(SHEETS.RECIPES, archived.id, archived);
        }
      }

      const approved = { ...pending, status: 'active', approved_by: currentUser?.name||'', approved_at: new Date().toISOString() };
      await dbPut('recipes', approved);
      await patchSheetDB(SHEETS.RECIPES, approved.id, approved);

      toast('✅ Receita aprovada e publicada!', 'success');
      await renderRecipesList();
      await updateRecipeBadge();
    };

    window._rejectRecipe = async function(pendingId) {
      const notes = window.prompt('Motivo da recusa (opcional):') ?? null;
      if (notes === null) return; // usuário cancelou o prompt
      const all = await dbGetAll_raw('recipes');
      const pending = all.find(r => r.id === pendingId);
      if (!pending) return;
      const rejected = { ...pending, status: 'rejected', rejection_notes: notes || '' };
      await dbPut('recipes', rejected);
      await patchSheetDB(SHEETS.RECIPES, rejected.id, rejected);
      toast('Edição recusada.', 'info');
      await renderRecipesList();
      await updateRecipeBadge();
    };

    // Filtros da lista
    document.getElementById('recipe-filter-client')?.addEventListener('change', async () => await renderRecipesList());

    // Chips de status das receitas
    document.getElementById('recipes-status-filters')?.addEventListener('click', async e => {
      const btn = e.target.closest('.qf-btn');
      if (!btn) return;
      document.querySelectorAll('#recipes-status-filters .qf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await renderRecipesList();
    });

    // Produtos de receita
    document.getElementById('btn-recipe-products')?.addEventListener('click', async () => {
      await _renderRecipeProductsList();
      document.getElementById('modal-recipe-products').classList.remove('hidden');
    });
    document.getElementById('modal-recipe-products-close')?.addEventListener('click', () => document.getElementById('modal-recipe-products').classList.add('hidden'));

    async function _renderRecipeProductsList() {
      const products = await dbGetAll_raw('recipe_products');
      const listEl = document.getElementById('recipe-products-list');
      if (!products.length) {
        listEl.innerHTML = '<div class="empty-state" style="padding:0.5rem">Nenhum produto cadastrado ainda.</div>';
        return;
      }
      listEl.innerHTML = products.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(p => `
        <div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid var(--border)">
          <span style="flex:1;font-size:0.88rem"><strong>${p.name}</strong>${p.category?` <span style="color:var(--muted);font-size:0.78rem">(${p.category})</span>`:''}</span>
          <button onclick="window._deleteRecipeProduct(${p.id})" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:1rem;padding:2px 6px" title="Excluir">🗑️</button>
        </div>`).join('');
    }

    document.getElementById('form-recipe-product')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (_saving) return;
      const fd   = new FormData(e.target);
      const name = fd.get('name').trim();
      if (!name) return;
      const addBtn = e.target.querySelector('button[type="submit"]');
      setSaving(true, addBtn, '⏳...');
      try {
        const data = { name, category: fd.get('category').trim(), created_at: new Date().toISOString() };
        const id = await dbAdd('recipe_products', data);
        data.id = id;
        await postToSheetDB(SHEETS.RECIPE_PRODUCTS, data);
        e.target.reset();
        await _renderRecipeProductsList();
        toast('Produto adicionado!', 'success');
      } catch(err) {
        toast('Erro ao salvar produto', 'error');
      } finally {
        setSaving(false, addBtn);
      }
    });

    window._deleteRecipeProduct = async function(id) {
      if (!await confirmAction('Excluir este produto?', 'Excluir', true)) return;
      await dbDelete('recipe_products', id);
      await deleteSheetDB(SHEETS.RECIPE_PRODUCTS, id);
      await _renderRecipeProductsList();
      toast('Produto removido', 'success');
    };

    async function initRecipesScreen() {
      const clients = await window.getAll('clients');
      const sel = document.getElementById('recipe-filter-client');
      const cur = sel?.value;
      if (sel) {
        sel.innerHTML = '<option value="">👥 Todos os clientes</option>';
        clients.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).forEach(c => sel.innerHTML += `<option value="${c.id}">${c.name}</option>`);
        if (cur) sel.value = cur;
      }
      // Conectar campo de busca (idempotente)
      const searchInput = document.getElementById('recipe-search');
      if (searchInput && !searchInput.dataset.bound) {
        searchInput.dataset.bound = '1';
        let debounce;
        searchInput.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => renderRecipesList(), 200); });
      }
      await renderRecipesList();
      await updateRecipeBadge();
    }

    async function updateRecipeBadge() {
      const count = (await dbGetAll_raw('recipes')).filter(r => r.status === 'pending').length;
      ['recipe-pending-badge', 'drawer-recipe-badge', 'bnav-recipe-badge'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = count;
        el.classList.toggle('hidden', count === 0);
      });
    }

    // =====================================================
    // RELATÓRIO — FILTROS
    // =====================================================
    async function refreshMonthYearFilter() {
      const sel = document.getElementById('filter-month-year');
      if (!sel) return;
      const records = await dbGetAll_raw('records');
      const months = new Set();
      for (const r of records) {
        const d = (r.date_start || r.created_at || '').slice(0, 7);
        if (d && d.length === 7) months.add(d);
      }
      const sorted = [...months].sort().reverse();
      const current = sel.value;
      sel.innerHTML = '<option value="">📅 Mês/Ano</option>';
      for (const m of sorted) {
        const [y, mo] = m.split('-').map(Number);
        const label = new Date(y, mo - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = label.charAt(0).toUpperCase() + label.slice(1);
        if (m === current) opt.selected = true;
        sel.appendChild(opt);
      }
    }

    function getReportFilters() {
      const activeQf = document.querySelector('#records-quick-filters .qf-btn.active')?.dataset?.qf || 'all';
      const now = new Date();
      let dateStart = document.getElementById('filter-date-start')?.value || '';
      let dateEnd   = document.getElementById('filter-date-end')?.value   || '';
      if (activeQf !== 'all' && !dateStart && !dateEnd) {
        if (activeQf === 'week') {
          const d = new Date(now); d.setDate(d.getDate() - 7);
          dateStart = d.toISOString().slice(0, 10);
          dateEnd   = now.toISOString().slice(0, 10);
        } else if (activeQf === 'month') {
          dateStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
          dateEnd   = now.toISOString().slice(0, 10);
        } else if (activeQf === 'lastmonth') {
          const d1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const d2 = new Date(now.getFullYear(), now.getMonth(), 0);
          dateStart = d1.toISOString().slice(0, 10);
          dateEnd   = d2.toISOString().slice(0, 10);
        }
      }
      return {
        text:      (document.getElementById('search-records')?.value      || '').toLowerCase(),
        clientId:  Number(document.getElementById('filter-client-records')?.value || 0),
        seller:    document.getElementById('filter-seller-records')?.value || '',
        dateStart,
        dateEnd,
      };
    }

    function applyFilters() { renderRecordsList(getReportFilters()); }

    document.getElementById('search-records')     .addEventListener('input',  applyFilters);
    document.getElementById('filter-client-records').addEventListener('change', applyFilters);
    document.getElementById('filter-seller-records')?.addEventListener('change', applyFilters);
    document.getElementById('filter-date-start')  .addEventListener('change', applyFilters);
    document.getElementById('filter-date-end')    .addEventListener('change', applyFilters);

    document.getElementById('filter-month-year')?.addEventListener('change', function() {
      const val = this.value;
      if (val) {
        const [y, m] = val.split('-').map(Number);
        const first = `${val}-01`;
        const last  = new Date(y, m, 0).toISOString().slice(0, 10);
        document.getElementById('filter-date-start').value = first;
        document.getElementById('filter-date-end').value   = last;
        document.getElementById('records-quick-filters')?.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
      } else {
        document.getElementById('filter-date-start').value = '';
        document.getElementById('filter-date-end').value   = '';
        document.querySelector('#records-quick-filters .qf-btn[data-qf="all"]')?.classList.add('active');
      }
      applyFilters();
    });

    document.getElementById('records-quick-filters')?.querySelectorAll('.qf-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.getElementById('records-quick-filters').querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const mySelect = document.getElementById('filter-month-year');
        if (mySelect) { mySelect.value = ''; }
        document.getElementById('filter-date-start').value = '';
        document.getElementById('filter-date-end').value   = '';
        applyFilters();
      });
    });
    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      document.getElementById('search-records').value = '';
      document.getElementById('filter-client-records').value = '';
      const sellerSel = document.getElementById('filter-seller-records');
      if (sellerSel) sellerSel.value = '';
      const mySelect = document.getElementById('filter-month-year');
      if (mySelect) mySelect.value = '';
      document.getElementById('filter-date-start').value = '';
      document.getElementById('filter-date-end').value = '';
      document.getElementById('records-quick-filters')?.querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('#records-quick-filters .qf-btn[data-qf="all"]')?.classList.add('active');
      renderRecordsList({});
    });

    // Popular select de clientes nos filtros
    async function refreshReportClientFilter() {
      const clients = await window.getAll('clients');
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
      const { text = '', clientId = 0, seller = '', dateStart = '', dateEnd = '' } =
        typeof filters === 'string' ? { text: filters } : filters;

      const [recordsRaw, clients, machines, processes] = await Promise.all([
        dbGetAll_raw('records'),
        dbGetAll_raw('clients'),
        dbGetAll_raw('machines'),
        dbGetAll_raw('processes'),
      ]);
      let records = recordsRaw;

      // Filtrar registros por papel do usuário
      if (currentUser && (currentUser.role === 'gerente' || currentUser.role === 'consultor')) {
        const managed = getManagedSellerNames();
        const myClientIds = new Set(
          clients.filter(c => managed.has((c.seller || '').toLowerCase())).map(c => Number(c.id))
        );
        records = records.filter(r => myClientIds.has(Number(r.client_id)));
      } else if (currentUser && currentUser.role === 'vendedor') {
        const sellerName = (currentUser.sellerName || '').toLowerCase();
        const myClientIds = new Set(
          clients.filter(c => (c.seller || '').toLowerCase() === sellerName).map(c => Number(c.id))
        );
        records = records.filter(r => myClientIds.has(Number(r.client_id)));
      }

      // Popular dropdown de vendedores e aplicar filtro
      const sellerSel = document.getElementById('filter-seller-records');
      if (sellerSel) {
        const sellers = [...new Set(clients.map(c => c.seller).filter(Boolean))].sort();
        const prevSel = sellerSel.value;
        sellerSel.innerHTML = '<option value="">👤 Todos os vendedores</option>' +
          sellers.map(s => `<option value="${s}">${s}</option>`).join('');
        if (prevSel) sellerSel.value = prevSel;
      }
      if (seller) {
        const sellerClientIds = new Set(
          clients.filter(c => (c.seller || '') === seller).map(c => Number(c.id))
        );
        records = records.filter(r => sellerClientIds.has(Number(r.client_id)));
      }

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
        const procName    = process?.name || '(Processo removido)';
        const period      = `${fmtDate(r.date_start)} → ${fmtDate(r.date_end)}`;

        // Agrupamento pelo mês do período do registro (date_start), não pela data de sync
        const rawDate = r.date_start || r.synced_at || r.created_at || '';
        let createdMonth = 'Sem data';
        if (rawDate) {
          const parts = rawDate.slice(0, 7).split('-');
          if (parts.length >= 2) {
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
            if (!isNaN(d)) {
              createdMonth = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
              createdMonth = createdMonth.charAt(0).toUpperCase() + createdMonth.slice(1);
            }
          }
        }
        // Chave de ordenação para o mês
        const monthSortKey = rawDate ? rawDate.slice(0, 7) : '0000-00';

        const key = `${clientName}|||${period}`;
        if (!grouped[key]) grouped[key] = { clientName, clientId: Number(r.client_id), period, dateStartRaw: (r.date_start || '').slice(0, 10), dateEndRaw: (r.date_end || '').slice(0, 10), createdMonth, monthSortKey, rows: [], totalKg: 0, precoKg: parseFloat(r.price_kg || client?.price_kg || 0) || null };
        grouped[key].rows.push({ machineName, procName, procId: Number(r.process_id), machId: Number(r.machine_id), executed: r.executed || 0, canceled: r.canceled || 0, capacity: r.capacity || 0, total: r.total || 0 });
        grouped[key].totalKg += parseFloat(r.total || 0);
      }

      // Atualizar badge com número de grupos (não registros brutos)
      const countEl = document.getElementById('records-count');
      if (countEl) countEl.textContent = Object.keys(grouped).length;

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
          const ds = g.dateStartRaw; // ISO YYYY-MM-DD
          const de = g.dateEndRaw;
          if (!ds) return false;
          if (dateStart && de && de < dateStart) return false;
          if (dateEnd   && ds > dateEnd)         return false;
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
      _recordGroups = {};

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
          _recordGroups[safeKey] = g;

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
                ${canDo('edit_record') ? `<button class="btn-record-action" style="background:var(--warning);color:#fff" onclick="window._editRecord('${safeKey}')" title="Editar registro">✏️ Editar</button>` : ''}
                ${canDo('delete_record') ? `<button class="btn-record-action" style="background:var(--danger);color:#fff" onclick="window._deleteRecord('${safeKey}', this)" title="Excluir registro">🗑️ Excluir</button>` : ''}
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

      refreshAlertsBadge();

      // ---- Imprimir um grupo ----
      window._printGroup = function(safeKey) {
        const g = _recordGroups[safeKey];
        if (!g) return;
        const win = window.open('', '_blank', 'width=1000,height=750');
        if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
        win.document.write(buildReportHtml(g, true).replaceAll('#1a3f5c', getPdfColor()));
        win.document.close();
      };

      // ---- Gerar PDF de um grupo (abre janela de impressão) ----
      window._pdfGroup = function(safeKey) {
        const g = _recordGroups[safeKey];
        if (!g) return;
        const win = window.open('', '_blank', 'width=1000,height=750');
        if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
        win.document.write(buildReportHtml(g, true).replaceAll('#1a3f5c', getPdfColor()));
        win.document.close();
        toast('Abrindo relatório — use Imprimir → Salvar como PDF', 'info');
      };

      // ---- Compartilhar relatório ----
      window._shareGroup = async function(safeKey) {
        const g = _recordGroups?.[safeKey];
        if (!g) return toast('Relatório não encontrado', 'error');

        _shareCtx = { g, safeKey };

        // Preenche e-mail do vendedor (busca por id direto para tolerar nome gerado como "Cliente #22")
        const clients = await dbGetAll_raw('clients');
        const client  = clients.find(c => Number(c.id) === Number(g.clientId)) ||
                        clients.find(c => c.name === g.clientName);
        document.getElementById('share-meta').textContent =
          `${g.clientName} · ${g.period} · ${g.totalKg.toFixed(2)} kg`;
        document.getElementById('share-email-seller').value = client?.email_seller || '';
        document.getElementById('share-status').textContent = '';
        document.getElementById('modal-share').classList.remove('hidden');
      };

      // ---- Verificar PDFs (status dos relatórios locais) ----
      window._checkDrivePdfs = async function() {
        const btn = document.getElementById('btn-check-drive-pdfs');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando...'; }
        try {
          const records  = await dbGetAll_raw('records');
          const clients  = await dbGetAll_raw('clients');
          const clientMap = {};
          clients.forEach(c => { clientMap[c.id] = c.name; });
          const byClient = {};
          records.forEach(r => {
            const name = clientMap[r.clientId] || `#${r.clientId}`;
            if (!byClient[name]) byClient[name] = { count: 0, last: '' };
            byClient[name].count++;
            if (!byClient[name].last || r.dateStart > byClient[name].last) byClient[name].last = r.dateStart;
          });
          const entries = Object.entries(byClient).sort((a, b) => a[0].localeCompare(b[0]));
          if (entries.length === 0) {
            toast('Nenhum registro encontrado no sistema', 'info');
          } else {
            const lines = entries.map(([name, d]) => `${name}: ${d.count} registro(s)`).join(' | ');
            toast(`📋 ${entries.length} cliente(s) com dados — ${records.length} registros no total`, 'success', 6000);
          }
        } catch(e) {
          toast('Erro ao verificar registros', 'error');
        }
        if (btn) { btn.disabled = false; btn.textContent = '📋 Verificar PDFs'; }
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

      // Filtrar por período — usa date_start nos dois lados para evitar
      // duplicação quando períodos têm a mesma data de fim/início
      if (start) records = records.filter(r => r.date_start && r.date_start >= start);
      if (end)   records = records.filter(r => r.date_start && r.date_start <= end);
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

      const _ffd = iso => iso ? fmtDate(iso).replace(/\//g, '-') : '';
      const _pStart = _ffd(start), _pEnd = _ffd(end);
      const _period = _pStart && _pEnd && _pStart !== _pEnd ? `${_pStart} a ${_pEnd}` : (_pStart || 'geral');
      const _safeName = client.name.replace(/[/\\:*?"<>|]/g, '').trim();
      doc.save(`RELATÓRIO DE LAVANDERIA - ${_safeName} - ${_period}.pdf`);
      toast('PDF gerado com sucesso!', 'success');
    }

    // =====================================================
    // RENDER INICIAL
    // =====================================================
    await initHomeScreen();
    await renderRecordsList();
    await updateRecipeBadge();

    // Botões de ação rápida na tela Home
    document.querySelectorAll('.home-action-btn[data-nav-to]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const screenId = btn.dataset.navTo;
        show(screenId);
        if (screenId === 'screen-home')      await initHomeScreen();
        if (screenId === 'screen-clients')   { await renderClientsList(); await refreshSellerSelect(); }
        if (screenId === 'screen-charts')    { await refreshChartsFilters(); await renderCharts(); }
        if (screenId === 'screen-vazao')     await initVazaoScreen();
        if (screenId === 'screen-recipes')   await initRecipesScreen();
        if (screenId === 'screen-reports')   await renderRecordsList(getReportFilters());
        if (screenId === 'screen-form') await _initFormScreen();
      });
    });

    // =====================================================
    // GRAFICOS
    // =====================================================
    let _charts = {};
    const CHART_IDS = ['chart-por-mes','chart-kg-cliente','chart-exec-cancel','chart-kg-maquina','chart-por-vendedor'];
    const CHART_COLORS = ['#2563eb','#16a34a','#f59e0b','#7c3aed','#0891b2','#be185d','#ea580c','#dc2626'];

    async function refreshChartsFilters() {
      const clients = await window.getAll('clients');
      const sel = document.getElementById('chart-filter-client');
      if (sel) {
        const cur = sel.value;
        sel.innerHTML = '<option value="">👥 Todos os clientes</option>';
        clients.sort((a,b) => (a.name||'').localeCompare(b.name||''))
               .forEach(c => sel.innerHTML += `<option value="${c.id}">${c.name}</option>`);
        if (cur) sel.value = cur;
      }
      const selS = document.getElementById('chart-filter-seller');
      if (selS) {
        if (currentUser && currentUser.role === 'vendedor') {
          selS.style.display = 'none';
        } else if (currentUser && (currentUser.role === 'gerente' || currentUser.role === 'consultor')) {
          const managed = getManagedSellerNames();
          const cur = selS.value;
          selS.style.display = '';
          selS.innerHTML = '<option value="">👤 Todos os meus vendedores</option>';
          [...managed].sort().forEach(s => {
            const label = s.charAt(0).toUpperCase() + s.slice(1);
            selS.innerHTML += `<option value="${label}">${label}</option>`;
          });
          if (cur) selS.value = cur;
        } else {
          const allClients = await dbGetAll_raw('clients');
          const cur = selS.value;
          const users = await _originalGetAll('users');
          const sellers = [...new Set([
            ...users.map(u => u.sellerName || u.name).filter(Boolean),
            ...allClients.map(c => c.seller).filter(Boolean)
          ])].sort();
          selS.innerHTML = '<option value="">👤 Todos os vendedores</option>';
          sellers.forEach(s => selS.innerHTML += `<option value="${s}">${s}</option>`);
          if (cur) selS.value = cur;
        }
      }

      // Filtro por gerente — visível apenas para admin
      const selG = document.getElementById('chart-filter-gerente');
      if (selG) {
        if (!currentUser || currentUser.role !== 'admin') {
          selG.style.display = 'none';
        } else {
          const users = await _originalGetAll('users');
          const gerentes = users.filter(u => u.role === 'gerente');
          const cur = selG.value;
          selG.innerHTML = '<option value="">👨‍💼 Todos os gerentes</option>' +
            gerentes.sort((a, b) => (a.name||'').localeCompare(b.name||''))
              .map(g => `<option value="${g.id}">${g.name || g.sellerName || g.username}</option>`)
              .join('');
          if (cur) selG.value = cur;
          selG.style.display = '';
        }
      }
    }

    function _resetChartCanvases(heights = {}) {
      Object.values(_charts).forEach(c => { try { c.destroy(); } catch(e) {} });
      _charts = {};
      CHART_IDS.forEach(id => {
        const old = document.getElementById(id);
        if (!old) return;
        const nc = document.createElement('canvas');
        nc.id = id;
        nc.height = heights[id] || 220;
        old.replaceWith(nc);
      });
    }

    function _setKpis(totalKg, totalRec, totalClients, cancelPct, mediaMensal) {
      const fmt = v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0);
      const el = id => document.getElementById(id);
      if (el('kpi-total-kg'))     el('kpi-total-kg').textContent     = fmt(totalKg) + ' kg';
      if (el('kpi-registros'))    el('kpi-registros').textContent    = totalRec;
      if (el('kpi-clientes'))     el('kpi-clientes').textContent     = totalClients;
      if (el('kpi-cancelamento')) el('kpi-cancelamento').textContent = cancelPct.toFixed(1) + '%';
      if (el('kpi-media-mensal')) el('kpi-media-mensal').textContent = mediaMensal != null ? fmt(mediaMensal) + ' kg' : '—';
    }

    async function renderCharts() {
      await loadChartJs();
      let records  = await dbGetAll_raw('records');
      const clients   = await dbGetAll_raw('clients');
      const machines  = await dbGetAll_raw('machines');
      const processes = await dbGetAll_raw('processes');

      // Filtrar por papel do usuário
      if (currentUser && (currentUser.role === 'gerente' || currentUser.role === 'consultor')) {
        const managed = getManagedSellerNames();
        const myClientIds = new Set(
          clients.filter(c => managed.has((c.seller || '').toLowerCase())).map(c => Number(c.id))
        );
        records = records.filter(r => myClientIds.has(Number(r.client_id)));
      } else if (currentUser && currentUser.role === 'vendedor') {
        const sellerName = (currentUser.sellerName || '').toLowerCase();
        const myClientIds = new Set(
          clients.filter(c => (c.seller || '').toLowerCase() === sellerName).map(c => Number(c.id))
        );
        records = records.filter(r => myClientIds.has(Number(r.client_id)));
      }

      // Período — inputs de data têm prioridade sobre os presets
      const dateStart = document.getElementById('chart-date-start')?.value || '';
      const dateEnd   = document.getElementById('chart-date-end')?.value || '';
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm   = String(now.getMonth() + 1).padStart(2, '0');
      let filterStart = '', filterEnd = '';
      if (dateStart || dateEnd) {
        filterStart = dateStart;
        filterEnd   = dateEnd;
      } else {
        const activePeriod = document.querySelector('.chart-preset-btn.active')?.dataset?.preset || 'year';
        if (activePeriod === 'month') {
          filterStart = filterEnd = `${yyyy}-${mm}`;
        } else if (activePeriod === '3m') {
          const d3 = new Date(now); d3.setMonth(d3.getMonth() - 2);
          filterStart = `${d3.getFullYear()}-${String(d3.getMonth()+1).padStart(2,'0')}`;
          filterEnd   = `${yyyy}-${mm}`;
        } else if (activePeriod === '6m') {
          const d6 = new Date(now); d6.setMonth(d6.getMonth() - 5);
          filterStart = `${d6.getFullYear()}-${String(d6.getMonth()+1).padStart(2,'0')}`;
          filterEnd   = `${yyyy}-${mm}`;
        } else if (activePeriod === 'year') {
          filterStart = `${yyyy}-01`;
          filterEnd   = `${yyyy}-12`;
        }
      }

      const filterClient  = document.getElementById('chart-filter-client')?.value  || '';
      const filterSeller  = document.getElementById('chart-filter-seller')?.value  || '';
      const filterGerente = document.getElementById('chart-filter-gerente')?.value || '';

      // Aplicar filtros
      if (filterClient) records = records.filter(r => Number(r.client_id) === Number(filterClient));
      if (filterGerente) {
        const allUsers = await _originalGetAll('users');
        const gerente  = allUsers.find(u => String(u.id) === filterGerente);
        if (gerente) {
          const gerenteName    = (gerente.sellerName || gerente.name || '').toLowerCase();
          const gerenteSellers = new Set(
            allUsers.filter(u => (u.manager || '').toLowerCase() === gerenteName)
              .map(u => (u.sellerName || u.name || '').toLowerCase())
          );
          records = records.filter(r => {
            const c = findClientById(r.client_id, clients);
            return gerenteSellers.has((c?.seller || '').toLowerCase());
          });
        }
      }
      if (filterSeller) records = records.filter(r => {
        const c = findClientById(r.client_id, clients);
        return (c?.seller || '') === filterSeller;
      });
      if (filterStart || filterEnd) {
        records = records.filter(r => {
          const m = (r.date_start || '').slice(0, 7);
          if (!m) return false; // sem date_start = excluir do período
          if (filterStart && m < filterStart) return false;
          if (filterEnd   && m > filterEnd)   return false;
          return true;
        });
      }

      // Destruir e recriar canvas
      _resetChartCanvases({ 'chart-por-mes': 160 });

      // KPIs
      const totalKg    = records.reduce((s, r) => s + parseFloat(r.total || 0), 0);
      const totalExec  = records.reduce((s, r) => s + parseFloat(r.executed || 0), 0);
      const totalCanc  = records.reduce((s, r) => s + parseFloat(r.canceled || 0), 0);
      const cancelPct  = (totalExec + totalCanc) > 0 ? (totalCanc / (totalExec + totalCanc)) * 100 : 0;
      const clientsSet = new Set(records.map(r => r.client_id));
      // Média calculada após agrupar por mês (feita abaixo e reutilizada aqui via closure)
      let _mediaMensal = null;
      _setKpis(totalKg, records.length, clientsSet.size, cancelPct, null);

      if (!records.length) {
        CHART_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.insertAdjacentHTML('afterend',
            `<p style="text-align:center;color:#94a3b8;padding:2rem 0;margin:0;font-size:0.85rem">📭 Sem dados para este período</p>`);
        });
        // Renderiza vazão mesmo sem registros de produção (ex: cliente apenas-vazão)
        await renderVazaoChart();
        await renderVazaoHistory();
        return;
      }

      // ── Gráfico 1: Evolução mensal (linha) ──────────────────
      const porMes = {};
      for (const r of records) {
        const raw = r.date_start || '';
        const key = raw.slice(0, 7);
        if (!key) continue;
        const [_ky, _km] = key.split('-');
        const label = new Date(Number(_ky), Number(_km) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
        if (!porMes[key]) porMes[key] = { label, kg: 0 };
        porMes[key].kg += parseFloat(r.total || 0);
      }
      const mesSorted = Object.entries(porMes).sort((a,b) => a[0].localeCompare(b[0]));
      // Dividir pelo total de meses do período selecionado, limitado ao mês atual
      const _nowKey = `${yyyy}-${mm}`;
      let _chartPeriodMonths = 0;
      if (filterStart || filterEnd) {
        const _fs = filterStart || (mesSorted[0]?.[0] ?? _nowKey);
        const _fe = filterEnd && filterEnd <= _nowKey ? filterEnd : _nowKey;
        const [fsY, fsM] = _fs.split('-').map(Number);
        const [feY, feM] = _fe.split('-').map(Number);
        _chartPeriodMonths = (feY - fsY) * 12 + (feM - fsM) + 1;
      } else if (mesSorted.length > 0) {
        const [fy, fm] = mesSorted[0][0].split('-').map(Number);
        const [ly, lm] = mesSorted[mesSorted.length - 1][0].split('-').map(Number);
        _chartPeriodMonths = (ly - fy) * 12 + (lm - fm) + 1;
      }
      _mediaMensal = _chartPeriodMonths > 0 ? totalKg / _chartPeriodMonths : 0;
      const _mediaRecords = mesSorted.length > 0 ? totalKg / mesSorted.length : 0;
      // Guardar estado para o toggle de modo de média
      const _fmtM = v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0);
      window._chartAvgState = { mediaPeriod: _mediaMensal, mediaRecords: _mediaRecords, mesSorted, fmtM: _fmtM };
      // Resetar toggle para modo padrão (÷ Meses) e atualizar KPI
      document.querySelectorAll('.avg-mode-btn').forEach(b => {
        const on = b.dataset.avg === 'period';
        b.style.background   = on ? '#2563eb' : '#f8fafc';
        b.style.color        = on ? '#fff'     : '#64748b';
        b.style.borderColor  = on ? '#bfdbfe'  : '#e2e8f0';
      });
      const _lblMedia = document.getElementById('kpi-media-label');
      if (_lblMedia) _lblMedia.textContent = 'Média kg/período';
      const _elMedia = document.getElementById('kpi-media-mensal');
      if (_elMedia) _elMedia.textContent = _fmtM(_mediaMensal) + ' kg';
      const ctxM = document.getElementById('chart-por-mes');
      if (ctxM) _charts.porMes = new Chart(ctxM, {
        type: 'line',
        data: {
          labels: mesSorted.map(e => e[1].label),
          datasets: [
            {
              label: 'kg processado',
              data: mesSorted.map(e => +e[1].kg.toFixed(2)),
              borderColor: '#2563eb',
              backgroundColor: 'rgba(37,99,235,0.1)',
              fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 6
            },
            {
              label: `Média (${(_mediaMensal/1000 >= 1 ? (_mediaMensal/1000).toFixed(1)+'k' : _mediaMensal.toFixed(0))} kg/mês)`,
              data: mesSorted.map(() => +_mediaMensal.toFixed(2)),
              borderColor: '#f59e0b',
              borderDash: [6, 3],
              backgroundColor: 'transparent',
              fill: false, tension: 0, pointRadius: 0, pointHoverRadius: 0, borderWidth: 2
            }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: mesSorted.length > 1, labels: { font: { size: 11 } } } },
          scales: { y: { beginAtZero: true, ticks: { callback: v => v+'kg' } } }
        }
      });

      // ── Gráfico 2: kg por cliente (barra horizontal) ────────
      const kgCliente = {};
      for (const r of records) {
        const c = findClientById(r.client_id, clients);
        const name = c?.name || `Cliente #${r.client_id}`;
        kgCliente[name] = (kgCliente[name] || 0) + parseFloat(r.total || 0);
      }
      const sortedCli = Object.entries(kgCliente).sort((a,b) => b[1]-a[1]).slice(0, 10);
      const ctxC = document.getElementById('chart-kg-cliente');
      if (ctxC) _charts.kgCliente = new Chart(ctxC, {
        type: 'bar',
        data: {
          labels: sortedCli.map(e => e[0]),
          datasets: [{ label: 'kg', data: sortedCli.map(e => +e[1].toFixed(2)), backgroundColor: CHART_COLORS }]
        },
        options: {
          indexAxis: 'y', responsive: true,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, ticks: { callback: v => v+'kg' } } }
        }
      });

      // ── Gráfico 3: Execução vs Cancelamento por mês (barra agrupada) ──
      const execCancel = {};
      for (const r of records) {
        const key = (r.date_start || '').slice(0, 7);
        if (!key) continue;
        const [_ky, _km] = key.split('-');
        const label = new Date(Number(_ky), Number(_km) - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
        if (!execCancel[key]) execCancel[key] = { label, exec: 0, cancel: 0 };
        execCancel[key].exec   += parseFloat(r.executed || 0) * parseFloat(r.capacity || 0);
        execCancel[key].cancel += parseFloat(r.canceled || 0) * parseFloat(r.capacity || 0);
      }
      const ecSorted = Object.entries(execCancel).sort((a,b) => a[0].localeCompare(b[0]));
      const ctxEC = document.getElementById('chart-exec-cancel');
      if (ctxEC) _charts.execCancel = new Chart(ctxEC, {
        type: 'bar',
        data: {
          labels: ecSorted.map(e => e[1].label),
          datasets: [
            { label: 'Executado (kg)', data: ecSorted.map(e => +e[1].exec.toFixed(2)), backgroundColor: '#16a34a' },
            { label: 'Cancelado (kg)', data: ecSorted.map(e => +e[1].cancel.toFixed(2)), backgroundColor: '#dc2626' }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: false }, y: { beginAtZero: true, ticks: { callback: v => v+'kg' } } }
        }
      });

      // ── Gráfico 4: kg por processo (doughnut %) ─────────────
      const kgProc = {};
      for (const r of records) {
        const p = processes.find(p => Number(p.id) === Number(r.process_id));
        if (!p) continue;
        kgProc[p.name] = (kgProc[p.name] || 0) + parseFloat(r.total || 0);
      }
      const totalKgProc = Object.values(kgProc).reduce((s, v) => s + v, 0);
      const sortedProc = Object.entries(kgProc).sort((a,b) => b[1]-a[1]).slice(0, 10);
      const ctxMaq = document.getElementById('chart-kg-maquina');
      if (ctxMaq) _charts.kgMaquina = new Chart(ctxMaq, {
        type: 'doughnut',
        data: {
          labels: sortedProc.map(e => e[0]),
          datasets: [{ data: sortedProc.map(e => +e[1].toFixed(2)), backgroundColor: CHART_COLORS }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const val = ctx.parsed;
                  const pct = totalKgProc > 0 ? ((val / totalKgProc) * 100).toFixed(1) : 0;
                  return ` ${val.toFixed(2)} kg (${pct}%)`;
                }
              }
            }
          }
        }
      });

      // ── Gráfico 5: kg por máquina (pie) ────────────────────
      const kgMach = {};
      for (const r of records) {
        const m = machines.find(m => Number(m.id) === Number(r.machine_id));
        const name = m?.name || `Máq. #${r.machine_id}`;
        kgMach[name] = (kgMach[name] || 0) + parseFloat(r.total || 0);
      }
      const sortedMach = Object.entries(kgMach).sort((a, b) => b[1] - a[1]);
      const totalKgMach = sortedMach.reduce((s, [, v]) => s + v, 0);
      const ctxV = document.getElementById('chart-por-vendedor');
      if (ctxV) _charts.porVendedor = new Chart(ctxV, {
        type: 'pie',
        data: {
          labels: sortedMach.map(([k]) => k),
          datasets: [{ data: sortedMach.map(([, v]) => +v.toFixed(2)), backgroundColor: CHART_COLORS }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const val = ctx.parsed;
                  const pct = totalKgMach > 0 ? ((val / totalKgMach) * 100).toFixed(1) : 0;
                  return ` ${val.toLocaleString('pt-BR', {minimumFractionDigits:2})} kg (${pct}%)`;
                }
              }
            }
          }
        }
      });

      // Gráfico de Vazão
      await renderVazaoChart();

      // Histórico de Leituras
      await renderVazaoHistory();
    }

    // Preset buttons — aplicam o período e re-renderizam
    document.querySelectorAll('.chart-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const ds = document.getElementById('chart-date-start');
        const de = document.getElementById('chart-date-end');
        if (ds) ds.value = '';
        if (de) de.value = '';
        renderCharts();
      });
    });

    // Inputs de data — desativam presets e re-renderizam
    ['chart-date-start','chart-date-end'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        document.querySelectorAll('.chart-preset-btn').forEach(b => b.classList.remove('active'));
        renderCharts();
      });
    });

    // Filtros de cliente, gerente e vendedor — auto-aplicam
    document.getElementById('chart-filter-client')?.addEventListener('change', () => renderCharts());
    document.getElementById('chart-filter-gerente')?.addEventListener('change', () => renderCharts());
    document.getElementById('chart-filter-seller')?.addEventListener('change', () => renderCharts());

    // Limpar filtros
    document.getElementById('btn-clear-charts')?.addEventListener('click', () => {
      ['chart-filter-client','chart-filter-gerente','chart-filter-seller','chart-date-start','chart-date-end'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.querySelectorAll('.chart-preset-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-preset="year"]')?.classList.add('active');
      renderCharts();
    });

    // Toggle modo de média (÷ Meses / ÷ Registros)
    document.querySelectorAll('.avg-mode-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const mode = this.dataset.avg;
        const s = window._chartAvgState;
        if (!s) return;
        const avg = mode === 'records' ? s.mediaRecords : s.mediaPeriod;
        // Atualizar visual dos botões
        document.querySelectorAll('.avg-mode-btn').forEach(b => {
          const on = b.dataset.avg === mode;
          b.style.background  = on ? '#2563eb' : '#f8fafc';
          b.style.color       = on ? '#fff'     : '#64748b';
          b.style.borderColor = on ? '#bfdbfe'  : '#e2e8f0';
        });
        // Atualizar KPI
        const valEl = document.getElementById('kpi-media-mensal');
        const lblEl = document.getElementById('kpi-media-label');
        if (valEl) valEl.textContent = s.fmtM(avg) + ' kg';
        if (lblEl) lblEl.textContent = mode === 'records' ? 'Média kg/mês c/ envio' : 'Média kg/período';
        // Atualizar linha de média no gráfico
        const ch = _charts?.porMes;
        if (ch && ch.data.datasets[1]) {
          ch.data.datasets[1].data  = s.mesSorted.map(() => +avg.toFixed(2));
          ch.data.datasets[1].label = `${mode === 'records' ? 'Média/mês c/ envio' : 'Média/mês'} (${s.fmtM(avg)} kg)`;
          ch.update();
        }
      });
    });

    // Botão Relatório Resumo (nova tela de relatórios PDF)
    document.getElementById('btn-pdf-summary')?.addEventListener('click', () => {
      const s = document.getElementById('pdf-summary-start')?.value || '';
      const e = document.getElementById('pdf-summary-end')?.value   || '';
      _printSummaryReport(s, e);
    });

    async function _printSummaryReport(overrideStart, overrideEnd) {
      if (!canDo('pdf_report')) return toast('Sem permissão para gerar PDF.', 'error');
      // Abrir janela ANTES dos awaits — mobile bloqueia window.open após async
      const w = window.open('', '_blank');
      if (!w) return toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error');
      w.document.write('<!DOCTYPE html><html><body style="font-family:Arial;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc"><p style="color:#546e7a;font-size:1rem">⏳ Gerando relatório...</p></body></html>');

      let records   = await dbGetAll_raw('records');
      const clients   = await dbGetAll_raw('clients');
      const processes = await dbGetAll_raw('processes');

      // Filtro por papel do usuário
      if (currentUser && (currentUser.role === 'gerente' || currentUser.role === 'consultor')) {
        const managed = getManagedSellerNames();
        const myClientIds = new Set(
          clients.filter(c => managed.has((c.seller || '').toLowerCase())).map(c => Number(c.id))
        );
        records = records.filter(r => myClientIds.has(Number(r.client_id)));
      } else if (currentUser && currentUser.role === 'vendedor') {
        const sellerName = (currentUser.sellerName || '').toLowerCase();
        const myClientIds = new Set(
          clients.filter(c => (c.seller || '').toLowerCase() === sellerName).map(c => Number(c.id))
        );
        records = records.filter(r => myClientIds.has(Number(r.client_id)));
      }

      // Período — usa override (tela PDF) ou fallback para filtros de gráficos
      const dateStart = overrideStart || document.getElementById('chart-date-start')?.value || '';
      const dateEnd   = overrideEnd   || document.getElementById('chart-date-end')?.value   || '';
      const now  = new Date();
      const yyyy = now.getFullYear();
      const mm   = String(now.getMonth() + 1).padStart(2, '0');
      let filterStart = '', filterEnd = '';
      if (dateStart || dateEnd) {
        filterStart = dateStart;
        filterEnd   = dateEnd;
      } else {
        const activePeriod = document.querySelector('.chart-preset-btn.active')?.dataset?.preset || 'year';
        if (activePeriod === 'month') {
          filterStart = filterEnd = `${yyyy}-${mm}`;
        } else if (activePeriod === '3m') {
          const d3 = new Date(now); d3.setMonth(d3.getMonth() - 2);
          filterStart = `${d3.getFullYear()}-${String(d3.getMonth()+1).padStart(2,'0')}`;
          filterEnd   = `${yyyy}-${mm}`;
        } else if (activePeriod === '6m') {
          const d6 = new Date(now); d6.setMonth(d6.getMonth() - 5);
          filterStart = `${d6.getFullYear()}-${String(d6.getMonth()+1).padStart(2,'0')}`;
          filterEnd   = `${yyyy}-${mm}`;
        } else if (activePeriod === 'year') {
          filterStart = `${yyyy}-01`;
          filterEnd   = `${yyyy}-12`;
        }
      }

      const filterClient  = document.getElementById('chart-filter-client')?.value  || '';
      const filterSeller  = document.getElementById('chart-filter-seller')?.value  || '';
      const filterGerente = document.getElementById('chart-filter-gerente')?.value || '';

      // Filtros por cliente / gerente / vendedor
      if (filterClient) records = records.filter(r => Number(r.client_id) === Number(filterClient));
      if (filterGerente) {
        const allUsers = await _originalGetAll('users');
        const gerente  = allUsers.find(u => String(u.id) === filterGerente);
        if (gerente) {
          const gerenteName    = (gerente.sellerName || gerente.name || '').toLowerCase();
          const gerenteSellers = new Set(
            allUsers.filter(u => (u.manager || '').toLowerCase() === gerenteName)
              .map(u => (u.sellerName || u.name || '').toLowerCase())
          );
          records = records.filter(r => {
            const c = findClientById(r.client_id, clients);
            return gerenteSellers.has((c?.seller || '').toLowerCase());
          });
        }
      }
      if (filterSeller) records = records.filter(r => {
        const c = findClientById(r.client_id, clients);
        return (c?.seller || '') === filterSeller;
      });

      // Guardar cópia antes do filtro de data para calcular crescimento
      const recordsPreDate = [...records];

      if (filterStart || filterEnd) {
        records = records.filter(r => {
          const m = (r.date_start || '').slice(0, 7);
          if (!m) return false;
          if (filterStart && m < filterStart) return false;
          if (filterEnd   && m > filterEnd)   return false;
          return true;
        });
      }

      // KPIs
      const totalKg    = records.reduce((s, r) => s + parseFloat(r.total    || 0), 0);
      const totalExec  = records.reduce((s, r) => s + parseFloat(r.executed || 0), 0);
      const totalCanc  = records.reduce((s, r) => s + parseFloat(r.canceled || 0), 0);
      const cancelPct  = (totalExec + totalCanc) > 0 ? (totalCanc / (totalExec + totalCanc)) * 100 : 0;
      const clientsSet = new Set(records.map(r => r.client_id));

      const ticketMedio  = records.length > 0 ? totalKg / records.length : 0;

      // Crescimento vs período anterior de mesma duração
      let crescimento = null;
      if (filterStart && filterEnd) {
        const [fsYear, fsMon] = filterStart.split('-').map(Number);
        const [feYear, feMon] = filterEnd.split('-').map(Number);
        const totalMonths   = (feYear - fsYear) * 12 + (feMon - fsMon) + 1;
        const prevEndDate   = new Date(fsYear, fsMon - 2, 1);
        const prevStartDate = new Date(prevEndDate.getFullYear(), prevEndDate.getMonth() - totalMonths + 1, 1);
        const prevS = `${prevStartDate.getFullYear()}-${String(prevStartDate.getMonth()+1).padStart(2,'0')}`;
        const prevE = `${prevEndDate.getFullYear()}-${String(prevEndDate.getMonth()+1).padStart(2,'0')}`;
        const prevKg = recordsPreDate
          .filter(r => { const m = (r.date_start||'').slice(0,7); return m >= prevS && m <= prevE; })
          .reduce((s, r) => s + parseFloat(r.total || 0), 0);
        if (prevKg > 0) crescimento = ((totalKg - prevKg) / prevKg) * 100;
        else if (totalKg > 0) crescimento = 100;
      }

      // Agregados
      const kgCliente = {};
      for (const r of records) {
        const c = clients.find(cl => Number(cl.id) === Number(r.client_id));
        const name = c?.name || `Cliente #${r.client_id}`;
        if (!kgCliente[name]) kgCliente[name] = { kg: 0, submissoes: new Set() };
        kgCliente[name].kg += parseFloat(r.total || 0);
        kgCliente[name].submissoes.add(`${r.date_start}|${r.date_end}`);
      }
      const byClient = Object.entries(kgCliente)
        .map(([name, c]) => [name, { kg: c.kg, recs: c.submissoes.size }])
        .sort((a, b) => b[1].kg - a[1].kg);

      const kgProcess = {};
      for (const r of records) {
        const p = processes.find(p => Number(p.id) === Number(r.process_id));
        if (!p) continue;
        kgProcess[p.name] = (kgProcess[p.name] || 0) + parseFloat(r.total || 0);
      }
      const byProcess = Object.entries(kgProcess).sort((a, b) => b[1] - a[1]);

      const kgMonth = {};
      for (const r of records) {
        const key = (r.date_start || '').slice(0, 7);
        if (!key) continue;
        const [_ky, _km] = key.split('-');
        const label = new Date(Number(_ky), Number(_km) - 1, 1)
          .toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
        if (!kgMonth[key]) kgMonth[key] = { label, kg: 0 };
        kgMonth[key].kg += parseFloat(r.total || 0);
      }
      const monthsSorted = Object.entries(kgMonth).sort((a, b) => a[0].localeCompare(b[0]));
      // Dividir pelo total de meses do período selecionado, limitado ao mês atual
      const _rptNowKey = `${yyyy}-${mm}`;
      let _periodMonths = 0;
      if (filterStart || filterEnd) {
        const _fs = filterStart || (monthsSorted[0]?.[0] ?? _rptNowKey);
        const _fe = filterEnd && filterEnd <= _rptNowKey ? filterEnd : _rptNowKey;
        const [fsY, fsM] = _fs.split('-').map(Number);
        const [feY, feM] = _fe.split('-').map(Number);
        _periodMonths = (feY - fsY) * 12 + (feM - fsM) + 1;
      } else if (monthsSorted.length > 0) {
        const [fy, fm] = monthsSorted[0][0].split('-').map(Number);
        const [ly, lm] = monthsSorted[monthsSorted.length - 1][0].split('-').map(Number);
        _periodMonths = (ly - fy) * 12 + (lm - fm) + 1;
      }
      const mediaMensal  = _periodMonths      > 0 ? totalKg / _periodMonths      : 0;
      const mediaByDados = monthsSorted.length > 0 ? totalKg / monthsSorted.length : 0;
      const byMonthWithGrowth = monthsSorted.map(([, d], i) => {
        const prev   = i > 0 ? monthsSorted[i-1][1].kg : null;
        const growth = prev && prev > 0 ? ((d.kg - prev) / prev) * 100 : null;
        return { label: d.label, kg: d.kg, growth };
      });

      // Clientes sem atividade no período filtrado
      const activeClientIds = new Set(records.map(r => Number(r.client_id)));
      let allClientsInScope = clients;
      if (filterClient) allClientsInScope = clients.filter(c => Number(c.id) === Number(filterClient));
      else if (filterSeller) allClientsInScope = clients.filter(c => (c.seller || '') === filterSeller);
      const inactiveClients = allClientsInScope
        .filter(c => !activeClientIds.has(Number(c.id)))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      // Labels legíveis para o cabeçalho
      const fmtMonth = m => {
        if (!m) return '';
        const [y, mo] = m.split('-');
        return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      };
      const periodLabel = filterStart && filterEnd
        ? (filterStart === filterEnd ? fmtMonth(filterStart)
          : `${fmtMonth(filterStart)} a ${fmtMonth(filterEnd)}`)
        : filterStart ? `A partir de ${fmtMonth(filterStart)}`
        : filterEnd   ? `Até ${fmtMonth(filterEnd)}`
        : 'Todos os períodos';
      const clientLabel = filterClient
        ? (clients.find(c => Number(c.id) === Number(filterClient))?.name || 'Cliente selecionado')
        : null;
      const sellerLabel = filterSeller || null;

      const totalSubmissoes = new Set(
        records.map(r => `${r.client_id}|${r.date_start}|${r.date_end}`)
      ).size;

      // Resumo por cidade
      const _kgCity = {};
      for (const r of records) {
        const c = clients.find(cl => Number(cl.id) === Number(r.client_id));
        const city = c?.city?.trim() || '(Sem cidade)';
        if (!_kgCity[city]) _kgCity[city] = { kg: 0, count: 0, clientSet: new Set() };
        _kgCity[city].kg    += parseFloat(r.total) || 0;
        _kgCity[city].count += 1;
        _kgCity[city].clientSet.add(String(r.client_id));
      }
      const byCity = Object.entries(_kgCity)
        .map(([city, v]) => [city, { kg: v.kg, count: v.count, clients: v.clientSet.size }])
        .sort((a, b) => b[1].kg - a[1].kg);

      const html = _buildSummaryHtml({
        periodLabel, clientLabel, sellerLabel,
        totalKg, totalRecords: totalSubmissoes, activeClients: clientsSet.size,
        cancelPct, ticketMedio: totalSubmissoes > 0 ? totalKg / totalSubmissoes : 0,
        mediaMensal, mediaByDados, crescimento,
        byClient, byProcess, byMonthWithGrowth, inactiveClients, byCity,
        today: new Date().toLocaleDateString('pt-BR')
      });

      w.document.open();
      w.document.write(html.replaceAll('#1a3f5c', getPdfColor()));
      w.document.close();
    }

    function _buildSummaryHtml(d) {
      const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const fmt = (v, dec = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
      const fmtPct = v => (v >= 0 ? '+' : '') + fmt(v, 1) + '%';

      const kpiCards = [
        { label: 'Total Processado',    value: `${fmt(d.totalKg)} kg`,         color: '#111827' },
        { label: 'Relatórios Enviados', value: d.totalRecords,                  color: '#111827' },
        { label: 'Clientes Ativos',     value: d.activeClients,                 color: '#111827' },
        { label: 'Média kg/mês',        html: `<div style="line-height:1.5">${fmt(d.mediaMensal)} kg <span style="font-size:0.65em;color:#6b7280;font-weight:400">÷ meses período</span></div><div style="line-height:1.4;font-size:0.88em;color:#b45309">${fmt(d.mediaByDados)} kg <span style="font-size:0.65em;color:#6b7280;font-weight:400">÷ meses c/ envio</span></div>`,  color: '#111827' },
        { label: 'Cancelamentos',       value: `${fmt(d.cancelPct, 1)}%`,       color: d.cancelPct > 10 ? '#c62828' : '#2e7d32' },
        d.crescimento !== null
          ? { label: 'Crescimento',     value: fmtPct(d.crescimento),           color: d.crescimento >= 0 ? '#2e7d32' : '#c62828' }
          : { label: 'Crescimento',     value: '—',                              color: '#546e7a' }
      ];

      const kpiHtml = kpiCards.map(k =>
        `<div class="kpi-card"><div class="kpi-label">${esc(k.label)}</div><div class="kpi-value" style="color:${k.color}">${k.html || esc(String(k.value))}</div></div>`
      ).join('');

      const clientRows = d.byClient.map(([name, c], i) => {
        const pctKg = d.totalKg > 0 ? (c.kg / d.totalKg * 100).toFixed(1) : '0.0';
        return `<tr>
          <td class="tc">${i+1}</td>
          <td class="tl">${esc(name)}</td>
          <td class="tc">${fmt(c.kg)} kg</td>
          <td class="tc">${c.recs}</td>
          <td class="tc">${pctKg}%</td>
        </tr>`;
      }).join('');

      const procRows = d.byProcess.map(([name, kg], i) => {
        const pctKg = d.totalKg > 0 ? (kg / d.totalKg * 100).toFixed(1) : '0.0';
        return `<tr>
          <td class="tc">${i+1}</td>
          <td class="tl">${esc(name)}</td>
          <td class="tc">${fmt(kg)} kg</td>
          <td class="tc">${pctKg}%</td>
        </tr>`;
      }).join('');

      const monthRows = d.byMonthWithGrowth.map(m => {
        const gHtml = m.growth !== null
          ? `<span style="color:${m.growth >= 0 ? '#2e7d32' : '#c62828'};font-weight:bold">${m.growth >= 0 ? '+' : ''}${fmt(m.growth, 1)}%</span>`
          : '—';
        return `<tr><td class="tl">${esc(m.label)}</td><td class="tc">${fmt(m.kg)} kg</td><td class="tc">${gHtml}</td></tr>`;
      }).join('');
      const monthFooter = d.byMonthWithGrowth.length > 1
        ? `<tfoot>
            <tr><td class="tl" style="font-weight:bold;color:#374151">Média ÷ meses período</td><td class="tc" style="font-weight:bold;color:#374151">${fmt(d.mediaMensal)} kg/mês</td><td></td></tr>
            <tr><td class="tl" style="font-weight:bold;color:#b45309">Média ÷ meses c/ envio</td><td class="tc" style="font-weight:bold;color:#b45309">${fmt(d.mediaByDados)} kg/mês</td><td></td></tr>
           </tfoot>`
        : '';

      const cityRows = (d.byCity || []).map(([city, v], i) => {
        const pct = d.totalKg > 0 ? (v.kg / d.totalKg * 100).toFixed(1) : '0.0';
        return `<tr>
          <td class="tc">${i+1}</td>
          <td class="tl">${esc(city)}</td>
          <td class="tc">${v.clients}</td>
          <td class="tc">${fmt(v.kg)} kg</td>
          <td class="tc">${pct}%</td>
        </tr>`;
      }).join('');

      let inactiveSec = '';
      if (d.inactiveClients.length > 0) {
        const chips = d.inactiveClients.map(c =>
          `<span class="inactive-chip">${esc(c.name || '#'+c.id)}</span>`
        ).join('');
        inactiveSec = `<div class="sec">
          <div class="sec-hd" style="background:#78909c">CLIENTES SEM ATIVIDADE NO PERÍODO (${d.inactiveClients.length})</div>
          <div style="padding:10px 12px;display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
        </div>`;
      }

      let filterInfo = `Período: <strong>${esc(d.periodLabel)}</strong>`;
      if (d.clientLabel) filterInfo += ` · Cliente: <strong>${esc(d.clientLabel)}</strong>`;
      if (d.sellerLabel) filterInfo += ` · Vendedor: <strong>${esc(d.sellerLabel)}</strong>`;

      return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório Resumo — ${esc(d.periodLabel)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10px;color:#212121;background:#fff}
.hdr{display:flex;align-items:center;background:#1a3f5c;color:#fff;min-height:60px;padding:0 12px;gap:10px;margin-bottom:8px}
.hdr-logo{font-weight:900;font-size:14px;letter-spacing:.04em;flex-shrink:0;color:#fff}
.hdr-logo-sub{font-size:8px;opacity:.65;text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
.hdr-c{flex:1;text-align:center;line-height:1.4}
.hdr-c h1{font-size:16px;font-weight:bold;color:#fff}
.hdr-info{font-size:9px;color:#d1d5db;margin-top:3px}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}
.kpi-card{border:1px solid #e5e7eb;border-radius:4px;padding:8px 10px;text-align:center;page-break-inside:avoid;background:#f9fafb}
.kpi-label{font-size:8px;color:#6b7280;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
.kpi-value{font-size:15px;font-weight:bold}
.sec{margin-bottom:8px;border:1px solid #e5e7eb;page-break-inside:avoid}
.sec-hd{background:#1a3f5c;color:#fff;text-align:center;padding:4px;font-size:11px;font-weight:bold;letter-spacing:.4px}
table{width:100%;border-collapse:collapse;font-size:9px}
thead th{background:#f3f4f6;color:#1a3f5c;font-size:9px;font-weight:bold;padding:4px 6px;border:1px solid #e5e7eb;white-space:nowrap}
th.tl,td.tl{text-align:left}
th.tc,td.tc{text-align:center}
tbody tr:nth-child(even) td{background:#f9fafb}
tbody td{padding:3px 6px;border:1px solid #e5e7eb;vertical-align:middle}
tfoot td{background:#f3f4f6;font-weight:bold;padding:3px 6px;border:1px solid #e5e7eb;font-size:9px}
.inactive-chip{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:20px;padding:3px 10px;font-size:9px;color:#1a3f5c}
.filter-info{background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:6px 12px;font-size:9px;color:#6b7280;margin-bottom:8px}
.rpt-footer{margin-top:10px;border-top:2px solid #1a3f5c;padding:7px 0 0;text-align:center;font-size:8px;color:#6b7280;line-height:1.7}
.rpt-footer strong{color:#1a3f5c}
@media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4 portrait;margin:10mm}.sec{page-break-inside:avoid}.action-bar{display:none}}
@media screen{
  .action-bar{position:sticky;top:0;z-index:999;background:#1a3f5c;padding:6px 10px;display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
  .action-bar button{padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
  .btn-close-rpt{background:#fff;color:#1a3f5c}
  .btn-print-rpt{background:#4caf50;color:#fff}
  .action-bar-label{color:#d1d5db;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
  body{max-width:960px;margin:0 auto;padding:0 8px}
}
@media screen and (max-width:600px){
  .kpi-grid{grid-template-columns:repeat(2,1fr)}
  .kpi-value{font-size:12px}
}
</style>
</head>
<body>
<div class="action-bar">
  <button class="btn-close-rpt" onclick="window.close()">✕ Fechar</button>
  <button class="btn-print-rpt" onclick="window.print()">🖨️ Salvar PDF</button>
  <span class="action-bar-label">Relatório Resumo · ${esc(d.periodLabel)}</span>
</div>
<div class="hdr">
  <div style="flex-shrink:0">${getPdfLogoHtml(true)}</div>
  <div class="hdr-c">
    <h1>RELATÓRIO RESUMO DE LAVANDERIA</h1>
    <div class="hdr-info">${esc(d.periodLabel)} · Gerado em ${esc(d.today)}</div>
  </div>
</div>
<div class="filter-info">${filterInfo}</div>
<div class="kpi-grid">${kpiHtml}</div>
<div class="sec">
  <div class="sec-hd">TOTAIS POR CLIENTE</div>
  <table>
    <thead><tr><th class="tc" style="width:28px">#</th><th class="tl">Cliente</th><th class="tc">Total kg</th><th class="tc">Relatórios</th><th class="tc">% Total</th></tr></thead>
    <tbody>${clientRows || '<tr><td colspan="5" class="tc" style="color:#9e9e9e;padding:12px">Sem dados</td></tr>'}</tbody>
    <tfoot><tr><td colspan="2" style="text-align:right">Total:</td><td class="tc">${fmt(d.totalKg)} kg</td><td class="tc">${d.totalRecords}</td><td></td></tr></tfoot>
  </table>
</div>
<div class="sec">
  <div class="sec-hd">TOTAIS POR PROCESSO</div>
  <table>
    <thead><tr><th class="tc" style="width:28px">#</th><th class="tl">Processo</th><th class="tc">Total kg</th><th class="tc">% Total</th></tr></thead>
    <tbody>${procRows || '<tr><td colspan="4" class="tc" style="color:#9e9e9e;padding:12px">Sem dados</td></tr>'}</tbody>
  </table>
</div>
<div class="sec">
  <div class="sec-hd">EVOLUÇÃO MENSAL</div>
  <table>
    <thead><tr><th class="tl">Mês</th><th class="tc">Total kg</th><th class="tc">Crescimento m/m</th></tr></thead>
    <tbody>${monthRows || '<tr><td colspan="3" class="tc" style="color:#9e9e9e;padding:12px">Sem dados</td></tr>'}</tbody>
    ${monthFooter}
  </table>
</div>
${(d.byCity || []).length > 1 ? `<div class="sec">
  <div class="sec-hd">TOTAIS POR CIDADE</div>
  <table>
    <thead><tr><th class="tc" style="width:28px">#</th><th class="tl">Cidade</th><th class="tc">Clientes</th><th class="tc">Total kg</th><th class="tc">% Total</th></tr></thead>
    <tbody>${cityRows}</tbody>
  </table>
</div>` : ''}
${inactiveSec}
<div class="rpt-footer">${getPdfFooterHtml('Relatório Resumo')}</div>
</body>
</html>`;
    }

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
      const roleLabel = { admin: 'Admin', gerente: 'Gerente', vendedor: 'Vendedor', consultor: 'Consultor', diretor: 'Diretor' };
      const roleClass = { admin: 'role-admin', gerente: 'role-gerente', vendedor: 'role-vendedor', consultor: 'role-consultor', diretor: 'role-diretor' };
      list.innerHTML = filtered.map(u => {
        const managedBy = u.role === 'vendedor' && u.manager ? `· 👔 ${u.manager}` : '';
        const managedCount = u.role === 'gerente'
          ? users.filter(x => (x.manager || '').toLowerCase() === (u.sellerName || u.name || '').toLowerCase()).length
          : 0;
        const managerInfo = u.role === 'gerente' && managedCount > 0 ? `· 👥 ${managedCount} vendedor(es)` : '';
        const consultorInfo = u.role === 'consultor' && u.sellers_access
          ? `· 👁️ ${u.sellers_access.split(',').filter(Boolean).length} vendedor(es)` : '';
        return `
        <div class="list-item">
          <div class="list-item-info">
            <div class="list-item-name">
              ${u.name || u.username}
              <span class="user-chip-role ${roleClass[u.role] || 'role-vendedor'}">${roleLabel[u.role] || u.role}</span>
            </div>
            <div class="list-item-meta">
              👤 ${u.username}${u.email ? ` · 📧 ${u.email}` : ''} ${managedBy} ${managerInfo} ${consultorInfo}
            </div>
          </div>
          <div class="list-item-actions">
            <button class="btn-edit" onclick="window._editUser(${u.id})">✏️ Editar</button>
            ${u.username !== currentUser?.username
              ? `<button class="btn-delete" onclick="window._deleteUser(${u.id}, '${u.username}', this)">🗑️</button>`
              : '<span style="font-size:0.75rem;color:#94a3b8">(você)</span>'}
          </div>
        </div>`;
      }).join('');
    }

    document.getElementById('search-users')?.addEventListener('input', e =>
      renderUsersList(e.target.value));

    async function populateManagerSelect(selectedManager = '') {
      const sel = document.getElementById('user-manager');
      if (!sel) return;
      const allUsers = await dbGetAll_raw('users');
      const managers = allUsers.filter(u => u.role === 'gerente');
      sel.innerHTML = '<option value="">-- Sem gerente --</option>';
      managers.forEach(m => {
        sel.innerHTML += `<option value="${m.sellerName || m.name}" ${(m.sellerName || m.name) === selectedManager ? 'selected' : ''}>${m.name}</option>`;
      });
    }

    function toggleManagerRow(role) {
      const row = document.getElementById('user-manager-row');
      if (row) row.style.display = role === 'vendedor' ? '' : 'none';
      const sellersRow = document.getElementById('user-sellers-row');
      if (sellersRow) {
        sellersRow.style.display = role === 'consultor' ? '' : 'none';
        if (role === 'consultor') populateSellersCheckboxes();
      }
    }

    async function populateSellersCheckboxes(selectedAccess = '') {
      const container = document.getElementById('user-sellers-checkboxes');
      if (!container) return;
      const allUsers = await dbGetAll_raw('users');
      const sellers = allUsers.filter(u => u.role === 'vendedor' || u.role === 'gerente');
      const selectedSet = new Set(selectedAccess.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
      if (!sellers.length) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:0.84rem">Nenhum vendedor cadastrado</span>';
        return;
      }
      const gerentes  = sellers.filter(u => u.role === 'gerente');
      const vendedores = sellers.filter(u => u.role === 'vendedor');
      const mkChk = s => {
        const name = s.sellerName || s.name || '';
        const checked = selectedSet.has(name.toLowerCase()) ? 'checked' : '';
        const tag = s.role === 'gerente' ? ' <span style="font-size:0.7em;color:#1a3f5c;font-weight:700">(gerente)</span>' : '';
        return `<label class="perm-check"><input type="checkbox" name="seller_access" value="${name}" ${checked} /> ${name}${tag}</label>`;
      };
      container.innerHTML =
        (gerentes.length  ? `<div style="font-size:0.72rem;color:#6b7280;font-weight:600;margin:4px 0 2px;width:100%">GERENTES</div>${gerentes.map(mkChk).join('')}` : '') +
        (vendedores.length ? `<div style="font-size:0.72rem;color:#6b7280;font-weight:600;margin:4px 0 2px;width:100%">VENDEDORES</div>${vendedores.map(mkChk).join('')}` : '');
    }

    document.getElementById('user-role')?.addEventListener('change', e => toggleManagerRow(e.target.value));

    // Abrir modal novo usuário
    document.getElementById('btn-new-user')?.addEventListener('click', async () => {
      document.getElementById('edit-user-id').value = '';
      document.getElementById('modal-user-title').textContent = '👤 Novo Usuário';
      document.getElementById('form-user').reset();
      document.getElementById('user-password').required = true;
      toggleManagerRow(document.getElementById('user-role')?.value || 'vendedor');
      await populateManagerSelect();
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
      toggleManagerRow(u.role || 'vendedor');
      await populateManagerSelect(u.manager || '');
      if (u.role === 'consultor') await populateSellersCheckboxes(u.sellers_access || '');
      // Restaurar checkboxes de permissão
      const savedPerms = new Set((u.permissions || '').split(',').map(s => s.trim()).filter(Boolean));
      SCREEN_PERM_KEYS.forEach(k => {
        const el = document.querySelector(`input[name="perm_${k}"]`);
        if (el) el.checked = !u.permissions || savedPerms.has(k);
      });
      const hasAnyAction = [...savedPerms].some(p => ACTION_KEYS.has(p));
      [...ACTION_KEYS].forEach(k => {
        const el = document.querySelector(`input[name="perm_${k}"]`);
        if (el) el.checked = !u.permissions || !hasAnyAction || savedPerms.has(k);
      });
      document.getElementById('modal-user').classList.remove('hidden');
    };

    // Excluir usuário
    window._deleteUser = async function(id, username, el) {
      const allUsers = await dbGetAll_raw('users');
      const allClients = await dbGetAll_raw('clients');
      const targetUser = allUsers.find(u => u.id === id);
      if (targetUser) {
        const tName = (targetUser.sellerName || targetUser.name || '').toLowerCase();
        const hasManaged = allUsers.some(u => (u.manager || '').toLowerCase() === tName);
        if (hasManaged) return toast('Não é possível excluir: este usuário gerencia vendedores no sistema.', 'error', 4000);
        const hasClients = allClients.some(c => (c.seller || '').toLowerCase() === tName);
        if (hasClients) return toast('Não é possível excluir: este usuário possui clientes vinculados.', 'error', 4000);
      }
      if (!confirm(`Excluir o usuário "${username}"? Esta ação não pode ser desfeita.`)) return;
      if (el) { el.disabled = true; el.textContent = '⏳'; }
      await dbDelete('users', id);
      const ok = await deleteSheetDB(SHEETS.USERS, id);
      toast(ok ? 'Usuário excluído!' : 'Usuário excluído localmente', ok ? 'success' : 'warning');
      await renderUsersList();
      refreshSellerSelect();
    };

    // Salvar usuário (criar/editar)
    document.getElementById('form-user')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (_saving) return;
      const editId = document.getElementById('edit-user-id').value;
      const name     = document.getElementById('user-name').value.trim();
      const username = document.getElementById('user-username').value.trim().toLowerCase();
      const role     = document.getElementById('user-role').value;
      const email    = document.getElementById('user-email').value.trim();
      const password = document.getElementById('user-password').value;
      const manager  = role === 'vendedor' ? (document.getElementById('user-manager')?.value || '') : '';
      const sellers_access = role === 'consultor'
        ? Array.from(document.querySelectorAll('input[name="seller_access"]:checked')).map(el => el.value).join(',')
        : '';
      const permissions = role === 'admin' ? '' :
        [...SCREEN_PERM_KEYS, ...ACTION_KEYS].filter(k => document.querySelector(`input[name="perm_${k}"]`)?.checked).join(',');

      if (!name || !username) return toast('Preencha nome e usuário', 'warning');

      // Verificar duplicata de username
      const allUsers = await dbGetAll_raw('users');
      const dup = allUsers.find(u => u.username === username && Number(u.id) !== Number(editId));
      if (dup) return toast(`Usuário "${username}" já existe`, 'error');

      const submitBtnUser = document.getElementById('form-user')?.querySelector('button[type="submit"]');
      setSaving(true, submitBtnUser);
      try {
        if (editId) {
          const existing = allUsers.find(u => Number(u.id) === Number(editId));
          const updated = { ...existing, name, username, role, email, sellerName: name, manager, permissions, sellers_access };
          if (password) updated.password = password;
          await dbPut('users', updated);
          const ok = await patchSheetDB(SHEETS.USERS, updated.id, updated);
          toast(ok ? 'Usuário atualizado e sincronizado!' : 'Usuário atualizado localmente', ok ? 'success' : 'warning');
        } else {
          if (!password) { setSaving(false, submitBtnUser); return toast('Informe uma senha', 'warning'); }
          const data = { name, username, password, role, email, active: 'TRUE', sellerName: name, manager, permissions, sellers_access, created_at: new Date().toISOString() };
          const id = await dbAdd('users', data);
          data.id = id;
          await postToSheetDB(SHEETS.USERS, data);
          toast('Usuário criado!', 'success');
        }

        document.getElementById('modal-user').classList.add('hidden');
        await renderUsersList();
        refreshSellerSelect();
        const updatedList = await dbGetAll_raw('users');
        localStorage.setItem('hygicare_users', JSON.stringify(updatedList));
        updatedList.forEach(du => {
          if (!du.username) return;
          const idx = window.USERS.findIndex(u => u.username === du.username);
          const mapped = { username: du.username, password: du.password,
            role: du.role || 'vendedor', name: du.name, sellerName: du.name,
            manager: du.manager || '', permissions: du.permissions || '',
            sellers_access: du.sellers_access || '' };
          if (idx >= 0) window.USERS[idx] = mapped; else window.USERS.push(mapped);
        });
      } catch(err) {
        toast('Erro ao salvar usuário: ' + err.message, 'error');
      } finally {
        setSaving(false, submitBtnUser);
      }
    });

    // =====================================================
    // EDITAR / EXCLUIR REGISTROS
    // =====================================================
    window._editRecord = async function(safeKey) {
      if (!canDo('edit_record')) return toast('Sem permissão para editar registros.', 'error');
      const g = _recordGroups?.[safeKey];
      if (!g) return toast('Registro não encontrado', 'error');
      _editingRecord = { safeKey, ...g };
      show('screen-form');
      await _initFormScreen();
    };

    window._deleteRecord = async function(safeKey, el) {
      // Ação destrutiva: exige admin OU permissão explícita (sem backward compat)
      const _hasDeletePerm = currentUser?.role === 'admin' ||
        (currentUser?.permissions || '').split(',').map(s => s.trim()).includes('delete_record');
      if (!_hasDeletePerm) return toast('Sem permissão para excluir registros.', 'warning');
      const gPreview = _recordGroups?.[safeKey];
      const confirmMsg = gPreview
        ? `Excluir registros de\n"${gPreview.clientName}" — ${gPreview.period}?\n\nEsta ação não pode ser desfeita.`
        : 'Excluir este grupo de registros? Esta ação não pode ser desfeita.';
      if (!await confirmAction(confirmMsg, '🗑️ Excluir', true)) return;
      if (el) { el.disabled = true; el.textContent = '⏳ Excluindo...'; }
      const g = _recordGroups?.[safeKey];
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
      if (_saving) return;
      const safeKey = document.getElementById('edit-record-key').value;
      const g = _recordGroups?.[safeKey];
      if (!g) return;
      const newDs = document.getElementById('edit-record-date-start').value;
      const newDe = document.getElementById('edit-record-date-end').value;
      const all = await dbGetAll_raw('records');
      const [ds, de] = (g.period || '').split(' → ');

      const btn = document.getElementById('form-edit-record').querySelector('button[type="submit"]');
      setSaving(true, btn, '⏳ Salvando...');

      let i = 0;
      let patchOk = 0;
      const toEdit = all.filter(r =>
        Number(r.client_id) === Number(g.clientId) &&
        fmtDate(r.date_start) === ds &&
        fmtDate(r.date_end)   === de
      );

      try {
        for (const r of toEdit) {
          const exec  = parseFloat(document.getElementById(`edit-row-exec-${i}`)?.value ?? r.executed);
          const canc  = parseFloat(document.getElementById(`edit-row-canc-${i}`)?.value ?? r.canceled);
          const cap   = parseFloat(r.capacity || 0);
          const total = (exec + canc) * cap;
          const updated = { ...r, date_start: newDs, date_end: newDe, executed: exec, canceled: canc, total };
          await dbPut('records', updated);
          const ok = await patchSheetDB(SHEETS.RECORDS, r.id, updated);
          if (ok) patchOk++;
          i++;
        }

        const syncMsg = patchOk === toEdit.length
          ? '✅ Registro atualizado e sincronizado!'
          : `⚠️ Atualizado localmente (${patchOk}/${toEdit.length} sincronizados na planilha)`;
        document.getElementById('modal-edit-record').classList.add('hidden');
        toast(syncMsg, patchOk === toEdit.length ? 'success' : 'warning', 5000);
        await renderRecordsList();
        notifyEmail('edicao_registro', { clientName: g.clientName, period: `${newDs} → ${newDe}` });
      } catch(err) {
        toast('Erro ao salvar edição: ' + err.message, 'error');
      } finally {
        setSaving(false, btn);
      }
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
      } else if (tipo === 'nova_vazao') {
        subject = `[Hygicare] Leitura de vazão registrada — ${dados.clientName}`;
        body = `Olá,\n\nUma leitura de vazão foi salva no sistema.\n\nCliente: ${dados.clientName}\nData: ${dados.date}\nLeituras: ${dados.count} resultado(s)\nUsuário: ${currentUser?.name}\nRegistrado em: ${new Date().toLocaleString('pt-BR')}`;
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

    // Auto-sync no login: sincroniza users primeiro (permissões imediatas), depois tudo
    if (localStorage.getItem('_autoSync')) {
      localStorage.removeItem('_autoSync');
      setTimeout(async () => {
        toast('Atualizando permissões...', 'info', 2000);
        await doRefresh('users', true);   // permissões aplicadas em segundos
        doRefresh('all', true);           // resto dos dados em background
      }, 400);
    }

  } // fim initApp()

}); // fim DOMContentLoaded
