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
      await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      // Avisa o usuário quando uma nova versão estiver disponível
      navigator.serviceWorker.addEventListener('controllerchange', () => {
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
      const dbUsers = await _originalGetAll('users');
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
    const _roleLabel = { admin: 'Admin', gerente: 'Gerente', vendedor: 'Vendedor', consultor: 'Consultor' }[currentUser.role] || 'Vendedor';
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

  if (currentUser) showApp();

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
  <div class="sec-hd" style="background:#263238">FATURAMENTO</div>
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
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:10px;color:#212121;background:#fff}
.hdr{display:flex;align-items:center;background:#1a237e;color:#fff;min-height:60px;max-height:60px;padding:0 10px;gap:10px;margin-bottom:8px}
.hdr-logo{width:40px;height:40px;background:rgba(255,255,255,.18);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;text-align:center;line-height:1.3;flex-shrink:0;letter-spacing:.5px}
.hdr-c{flex:1;text-align:center;line-height:1.3}
.hdr-c h1{font-size:18px;font-weight:bold;color:#fff;letter-spacing:.3px}
.hdr-info{font-size:10px;color:#c5cae9;margin-top:4px}
.hdr-sub{font-size:9px;color:#9fa8da;margin-top:2px}
.sec{margin-bottom:8px;border:1px solid #ddd;page-break-inside:avoid}
.sec-hd{background:#1a237e;color:#fff;text-align:center;padding:4px;font-size:11px;font-weight:bold;letter-spacing:.4px}
.blue{background:#1a237e}.gray{background:#37474f}
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
.rpt-footer{margin-top:10px;border-top:2px solid #1a237e;padding:7px 0 0;text-align:center;font-size:8px;color:#555;line-height:1.7;page-break-inside:avoid}
.rpt-footer strong{color:#1a237e;font-size:8.5px}
@media print{body{background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4 portrait;margin:10mm}.sec{page-break-inside:avoid}.action-bar{display:none}}
@media screen{
  .action-bar{position:sticky;top:0;z-index:999;background:#1a237e;padding:6px 10px;display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
  .action-bar button{padding:5px 12px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
  .btn-close-rpt{background:#fff;color:#1a237e}
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
  <div class="hdr-logo" style="width:50px;height:42px;font-size:7px;letter-spacing:.3px">HYGICARE</div>
  <div class="hdr-c">
    <h1>${esc(g.clientName)}</h1>
    <div class="hdr-info">Período: ${esc(g.period)}${daysLabel?'&nbsp;&nbsp;|&nbsp;&nbsp;'+daysLabel:''}</div>
    <div class="hdr-sub">Relatório de Produção &nbsp;·&nbsp; Emitido em ${today} &nbsp;·&nbsp; Hygicare Lavanderia</div>
  </div>
  <div class="hdr-logo" style="width:50px;height:42px;font-size:7px;letter-spacing:.3px">HC LAV</div>
</div>

${sectionsHtml}

<div class="sec">
  <div class="sec-hd gray">TOTAL GERAL</div>
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

<div class="rpt-footer">
  <strong>Hygicare Produtos de Higiene Ltda EPP.</strong> — DISTRIBUIDOR AUTORIZADO DIVERSEY<br>
  Rua Dr. Jose Ranieri, 9-41 Jd. Cruzeiro do Sul — CEP: 17030-370 Bauru/SP &nbsp;|&nbsp; e-mail: comercial@hygicare.com.br &nbsp;|&nbsp; Tel/Fax: (14) 3879-7040<br>
  CNPJ: 08.159.080/0001-34 &nbsp;|&nbsp; Inscrição Estadual: 209.376.609.111
</div>

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
      const dbUsers = await _originalGetAll('users');
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

    function show(id) {
      screens.forEach(s => s.classList.add('hidden'));
      document.getElementById(id).classList.remove('hidden');
      navBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.screen === id || b.id === 'nav-' + id.replace('screen-', ''));
      });
      // Sync bottom nav active state
      document.querySelectorAll('.bnav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.target === id);
      });
      // FAB: oculto na tela de registro e na home (já tem atalho)
      const fab = document.getElementById('fab-btn');
      if (fab) fab.classList.toggle('hidden', id === 'screen-form' || id === 'screen-home');
      // Close drawer if open
      closeDrawer();
    }

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
        if (screenId === 'screen-reports') { await refreshReportClientFilter(); await renderRecordsList(); }
        if (screenId === 'screen-users')   await renderUsersList();
        if (screenId === 'screen-admin')   { refreshAdminPanel(); renderProcColorsAdmin(); testApis(); }
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
        if (screenId === 'screen-vazao')     await initVazaoScreen();
        if (screenId === 'screen-recipes')   await initRecipesScreen();
        if (screenId === 'screen-users')     await renderUsersList();
        if (screenId === 'screen-admin')     { refreshAdminPanel(); renderProcColorsAdmin(); testApis(); }
      });
    });

    // Logout no drawer
    document.getElementById('drawer-logout')?.addEventListener('click', () => {
      document.getElementById('btn-logout')?.click();
    });

    // Estado compartilhado entre funções (sem poluir window)
    let _shareCtx      = null;
    let _recordGroups  = {};
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
        const access = (currentUser.sellers_access || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        return new Set(access);
      }
      const allUsers = JSON.parse(localStorage.getItem('hygicare_users') || '[]');
      const myName = (currentUser.sellerName || currentUser.name || '').toLowerCase();
      return new Set(
        allUsers
          .filter(u => (u.manager || '').toLowerCase() === myName)
          .map(u => (u.sellerName || u.name || '').toLowerCase())
      );
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
        if (!currentUser || currentUser.role === 'admin') return data;
        if (store !== 'clients') return data;
        if (currentUser.role === 'gerente' || currentUser.role === 'consultor') {
          const managed = getManagedSellerNames();
          return data.filter(c => managed.has((c.seller || '').toLowerCase()));
        }
        return data.filter(c => (c.seller || '').toLowerCase() === (currentUser.sellerName || '').toLowerCase());
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
      'nav-recipes':   'screen-recipes',
      'nav-form':      'screen-form',
      'nav-reports':   'screen-reports',
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
        if (screenId === 'screen-vazao')     await initVazaoScreen();
        if (screenId === 'screen-recipes')   await initRecipesScreen();
        if (screenId === 'screen-form') await _initFormScreen();
        if (screenId === 'screen-reports') { await refreshReportClientFilter(); await renderRecordsList(); }
        if (screenId === 'screen-users')     await renderUsersList();
        if (screenId === 'screen-admin')     { refreshAdminPanel(); renderProcColorsAdmin(); testApis(); }
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

      if (gasUrl) { localStorage.setItem('hygicare_cfg_gas_url', gasUrl); CONFIG.GAS_URL = gasUrl; }
      if (sync)   { localStorage.setItem('hygicare_cfg_sync_interval', sync); CONFIG.SYNC_INTERVAL_HOURS = parseInt(sync); callGAS('upsert', 'Config', { chave: 'hygicare_cfg_sync_interval', valor: sync }); }
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
    function applyNavPermissions() {
      if (!currentUser || currentUser.role === 'admin') return;
      // Consultor nunca acessa o admin
      if (currentUser.role === 'consultor') {
        document.getElementById('nav-admin')?.style.setProperty('display', 'none');
        document.querySelector('.bnav-btn[data-target="screen-admin"]')?.style.setProperty('display', 'none');
        document.querySelector('.drawer-item[data-target="screen-admin"]')?.style.setProperty('display', 'none');
      }
      const permsStr = (currentUser.permissions || '').trim();
      if (!permsStr) return; // sem restrições = acesso total
      const allowed = new Set(permsStr.split(',').map(s => s.trim()).filter(Boolean));
      const map = {
        clients:   'screen-clients',
        machines:  'screen-machines',
        processes: 'screen-processes',
        form:      'screen-form',
        reports:   'screen-reports',
        charts:    'screen-charts',
        vazao:     'screen-vazao',
        recipes:   'screen-recipes',
        users:     'screen-users',
      };
      Object.entries(map).forEach(([perm, screenId]) => {
        if (allowed.has(perm)) return;
        const navId = 'nav-' + screenId.replace('screen-', '');
        document.getElementById(navId)?.style.setProperty('display', 'none');
        document.querySelector(`.bnav-btn[data-target="${screenId}"]`)?.style.setProperty('display', 'none');
        document.querySelector(`.drawer-item[data-target="${screenId}"]`)?.style.setProperty('display', 'none');
      });
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
      editMachineIdField.value = '';
      document.getElementById('form-machine-title').textContent = 'Nova Máquina';
      machineClientSelect.value = '';
      document.getElementById('machine-rows').innerHTML = _machineRowHtml();
      document.getElementById('machine-add-row-wrap').style.display = '';
      formMachineCard.classList.remove('hidden');
    };
    document.getElementById('btn-new-process').onclick = () => {
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

    // Sync silencioso na inicialização — preenche IndexedDB a partir do GAS
    // sem exibir diálogos de confirmação, para que dados apareçam automaticamente.
    (async () => {
      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) return;
      if (!navigator.onLine) return;
      try {
        // Sincroniza sempre ao abrir — debounce de 2 min para evitar dupla chamada
        const lastSync = localStorage.getItem('lastSyncTime');
        const minsAgo = lastSync ? (Date.now() - new Date(lastSync).getTime()) / 60000 : Infinity;
        if (minsAgo < 2) return;

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
        await syncAdminConfig();
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
      clients:       { sheet: SHEETS.CLIENTS,       store: 'clients',       label: 'clientes'        },
      machines:      { sheet: SHEETS.MACHINES,      store: 'machines',      label: 'máquinas'        },
      processes:     { sheet: SHEETS.PROCESSES,     store: 'processes',     label: 'processos'       },
      records:       { sheet: SHEETS.RECORDS,       store: 'records',       label: 'registros'       },
      users:         { sheet: SHEETS.USERS,         store: 'users',         label: 'usuários'        },
      vazoes:          { sheet: SHEETS.VAZOES,          store: 'vazoes',          label: 'vazões'           },
      vazao_records:   { sheet: SHEETS.VAZAO_RECORDS,   store: 'vazao_records',   label: 'leituras vazão'   },
      recipes:         { sheet: SHEETS.RECIPES,         store: 'recipes',         label: 'receitas'         },
      recipe_products: { sheet: SHEETS.RECIPE_PRODUCTS, store: 'recipe_products', label: 'produtos receita' },
    };

    async function doRefresh(target = 'all') {
      if (!CONFIG.GAS_URL || CONFIG.GAS_URL.includes('YOUR_GAS_URL')) {
        return toast('Configure a URL do Google Apps Script no Painel Admin!', 'warning');
      }

      const isAll = target === 'all';
      const labelTarget = isAll ? 'Todos os dados' : (SHEET_MAP[target]?.label || target);

      if (isAll) {
        const ok = await confirmAction('Buscar dados atualizados do Google Sheets?\nIsso consome uma chamada de API.', '🔄 Atualizar', false);
        if (!ok) return;
      }

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
        if (isAll) await syncAdminConfig();

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
        if (updated.includes('recipes') || updated.includes('recipe_products') || isAll) {
          // Reparar process_name para receitas que ainda estão sem ele após o sync
          const allRecipesRepair = await dbGetAll_raw('recipes');
          const allProcsRepair   = await dbGetAll_raw('processes');
          for (const r of allRecipesRepair) {
            if (!r.process_name) {
              const p = findRecipeProcess(allProcsRepair, r);
              if (p?.name) await dbPut('recipes', { ...r, process_name: p.name });
            }
          }
          await renderRecipesList();
          await updateRecipeBadge();
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
      // Para recipes: preservar campos locais que o GAS não armazena (process_name)
      if (storeName === 'recipes') {
        const existing = await dbGetAll_raw('recipes');
        const snapById = new Map(existing.map(r => [Number(r.id), r]));
        await clearStore('recipes');
        let saved = 0;
        for (const item of items) {
          try {
            const n = normalizeItem(item);
            const old = snapById.get(Number(n.id));
            if (old?.process_name && !n.process_name) n.process_name = old.process_name;
            await dbPut('recipes', n);
            saved++;
          } catch (err) { console.warn('⚠️ Erro ao salvar recipe:', err, item); }
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
        const managed = ['hygicare_proc_groups', 'hygicare_periodo_habilitado', 'hygicare_cfg_sync_interval', 'notification_email'];
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
      formClientCard.classList.remove('hidden');
      formClientCard.scrollIntoView({ behavior: 'smooth' });
    }

    async function deleteClient(id) {
      const records = await dbGetAll_raw('records');
      const hasRecords = records.some(r => Number(r.client_id) === Number(id));
      const msg = hasRecords
        ? '⚠️ Este cliente possui registros de produção vinculados.\n\nExcluir mesmo assim? Todas as máquinas, processos e registros serão removidos.'
        : 'Excluir este cliente? Todas as máquinas e processos vinculados também serão removidos.';
      if (!await confirmAction(msg, 'Excluir')) return;

      const gasOk = await deleteSheetDB(SHEETS.CLIENTS, id);
      if (!gasOk && navigator.onLine) {
        if (!await confirmAction('Não foi possível excluir no Google Sheets.\nExcluir apenas localmente?', 'Excluir local')) return;
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

    async function deleteMachine(id) {
      const records = await dbGetAll_raw('records');
      const hasRecords = records.some(r => Number(r.machine_id) === Number(id));
      const msg = hasRecords
        ? '⚠️ Esta máquina possui registros de produção vinculados.\n\nExcluir mesmo assim? Os processos e registros vinculados serão removidos.'
        : 'Excluir esta máquina? Os processos vinculados também serão removidos.';
      if (!await confirmAction(msg, 'Excluir')) return;
      const gasOk = await deleteSheetDB(SHEETS.MACHINES, id);
      if (!gasOk && navigator.onLine) {
        if (!await confirmAction('Não foi possível excluir no Google Sheets.\nExcluir apenas localmente?', 'Excluir local')) return;
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

    async function deleteProcess(id) {
      if (!await confirmAction('Excluir este processo?', 'Excluir')) return;
      const gasOk = await deleteSheetDB(SHEETS.PROCESSES, id);
      if (!gasOk && navigator.onLine) {
        if (!await confirmAction('Não foi possível excluir no Google Sheets.\nExcluir apenas localmente?', 'Excluir local')) return;
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
      return `
        <div class="list-item">
          <div class="list-item-content">
            <div class="list-item-name">
              👤 ${c.name}
              <span class="badge">${c.city || 'Sem cidade'}</span>
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
            <button class="btn-edit" onclick="window._editClient(${c.id})">✏️ Editar</button>
            <button class="btn-danger" onclick="window._deleteClient(${c.id})">🗑️</button>
          </div>
        </div>`;
    }

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

      if (_clientsGrouped) {
        const bySeller = {};
        for (const c of clients) {
          const s = c.seller || '(Sem vendedor)';
          if (!bySeller[s]) bySeller[s] = [];
          bySeller[s].push(c);
        }
        list.innerHTML = Object.entries(bySeller)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([seller, cs]) => `
            <div class="client-group">
              <div class="client-group-hdr">👨‍💼 ${seller}<span class="count-badge" style="margin-left:auto">${cs.length}</span></div>
              ${cs.map(_clientItemHtml).join('')}
            </div>`)
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

      list.innerHTML = Object.entries(byClient).sort((a,b) => a[0].localeCompare(b[0])).map(([clientName, { client, items }], idx) => {
        const groupId = `mach-group-${idx}`;
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
            ${items.map(m => `
              <div class="list-item" data-machine-id="${m.id}">
                <div class="list-item-content">
                  <div class="list-item-name">
                    ⚙️ ${m.name}
                    <span class="badge badge-yellow">${m.capacity} kg</span>
                  </div>
                </div>
                <div class="list-item-actions">
                  <button class="btn-secondary btn-sm" onclick="window._manageVazoes(${m.id},'${m.name.replace(/'/g,"\\'")}')">💧 Vazões</button>
                  <button class="btn-edit" onclick="window._editMachine(${m.id})">✏️ Editar</button>
                  <button class="btn-danger" onclick="window._deleteMachine(${m.id})">🗑️</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `}).join('');
    }

    document.getElementById('search-machines').addEventListener('input', e => renderMachinesList(e.target.value));
    document.getElementById('filter-machine-client').addEventListener('change', e => renderMachinesList(document.getElementById('search-machines').value, Number(e.target.value)));

    // =====================================================
    // RENDER — PROCESSOS
    // =====================================================
    async function renderProcessesList(filter = '', machineFilter = 0) {
      await refreshMachinesForProcessSelect();
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

      list.innerHTML = Object.entries(byClient).sort((a,b) => a[0].localeCompare(b[0])).map(([clientName, { items }], idx) => {
        const groupId = `proc-group-${idx}`;
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
          </div>
        </div>
      `}).join('');
    }

    document.getElementById('search-processes').addEventListener('input', e => renderProcessesList(e.target.value));
    document.getElementById('filter-process-machine').addEventListener('change', e => renderProcessesList(document.getElementById('search-processes').value, Number(e.target.value)));

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
      if (endField) endField.style.display = periodoOn ? '' : 'none';

      const today    = new Date().toISOString().slice(0, 10);
      const startEl  = document.getElementById('prod-date-start');
      const endEl    = document.getElementById('prod-date-end');
      if (periodoOn) {
        if (startEl && !startEl.value) startEl.value = today.slice(0, 7) + '-01';
        if (endEl   && !endEl.value)   endEl.value   = today;
      } else {
        if (startEl && !startEl.value) startEl.value = today;
        if (endEl) endEl.value = '';
      }

      const clientId = Number(document.getElementById('prod-client-select')?.value);
      if (clientId) await renderMachinesAndProcesses(clientId);
    }

    document.getElementById('save-production').addEventListener('click', async () => {
      const clientId = Number(prodClientSelect.value);
      if (!clientId) return toast('Selecione um cliente', 'warning');
      const periodoOn = localStorage.getItem('hygicare_periodo_habilitado') === 'true';
      let dateStart = document.getElementById('prod-date-start').value;
      let dateEnd   = periodoOn ? document.getElementById('prod-date-end').value : dateStart;
      if (!dateStart) return toast('Preencha a data', 'warning');
      if (periodoOn && !dateEnd) return toast('Preencha a data fim', 'warning');

      // Auto-corrigir sobreposição: se date_start bate com o date_end do último
      // lote salvo para este cliente, avança 1 dia automaticamente
      {
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
        await renderRecordsList();

        const allClients = await dbGetAll_raw('clients');
        const c = allClients.find(c => Number(c.id) === clientId);
        const clientName = c?.name || `#${clientId}`;

        toast(`✅ ${synced} registro(s) enviados com sucesso!`, 'success', 5000);

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

      // KPIs
      const [records, clients, machines] = await Promise.all([
        dbGetAll_raw('records'),
        dbGetAll_raw('clients'),
        dbGetAll_raw('machines'),
      ]);

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
    }

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
    window._manageVazoes = async function(machineId, machineName) {
      // Cria/exibe um painel de gestão inline
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
        <form id="vazao-add-form-${machineId}" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem">
          <input name="name" placeholder="Nome (ex: Vazão 1)" required class="form-input" style="flex:2;min-width:120px;padding:0.4rem 0.7rem" />
          <input name="unit" placeholder="Unidade (ex: L/s)" class="form-input" style="flex:1;min-width:80px;padding:0.4rem 0.7rem" />
          <button type="submit" class="btn-primary" style="padding:0.4rem 0.9rem;font-size:0.85rem">+ Adicionar</button>
        </form>
      `;

      // Inserir após o card da máquina
      const machCard = document.querySelector(`[data-machine-id="${machineId}"]`);
      if (machCard) machCard.after(panel);
      else document.getElementById('machines-list-cad').appendChild(panel);

      document.getElementById(`vazao-add-form-${machineId}`)?.addEventListener('submit', async e => {
        e.preventDefault();
        if (_saving) return;
        const fd = new FormData(e.target);
        const data = { machine_id: Number(machineId), name: fd.get('name').trim(), unit: fd.get('unit').trim(), created_at: new Date().toISOString() };
        if (!data.name) return;
        const addBtn = e.target.querySelector('button[type="submit"]');
        setSaving(true, addBtn, '⏳...');
        try {
          const id = await dbAdd('vazoes', data);
          data.id = id;
          await postToSheetDB(SHEETS.VAZOES, data);
          e.target.reset();
          const listEl = document.getElementById(`vazao-mgr-list-${machineId}`);
          if (listEl) listEl.innerHTML += _vazaoItem(data);
          toast('Vazão adicionada!', 'success');
        } catch(err) {
          toast('Erro ao adicionar vazão', 'error');
        } finally {
          setSaving(false, addBtn);
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

    // Retorna array de machine IDs a partir de machine_ids (JSON) com fallback para machine_id legado
    function parseMachineIds(recipe) {
      try {
        if (recipe.machine_ids) return JSON.parse(recipe.machine_ids).map(Number).filter(Boolean);
      } catch(e) {}
      return recipe.machine_id ? [Number(recipe.machine_id)] : [];
    }

    function _collectMachineIds() {
      return [...document.querySelectorAll('#recipe-machines-checkboxes .machine-chk:checked')]
        .map(chk => Number(chk.dataset.machineId)).filter(Boolean);
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

    let _isLoadingRecipeForm = false;

    async function _openRecipeForm(recipeId = null) {
      _isLoadingRecipeForm = true;
      _editingRecipeId = recipeId;
      const isEdit = recipeId !== null;
      document.getElementById('modal-recipe-title').textContent = isEdit ? '✏️ Editar Receita' : '📝 Nova Receita';
      document.getElementById('recipe-edit-notes-row').style.display = isEdit ? '' : 'none';
      document.getElementById('recipe-edit-notes').value = '';

      // Preencher cliente select
      const clients = await window.getAll('clients');
      const clientSel = document.getElementById('recipe-client');
      clientSel.innerHTML = '<option value="">-- Selecione --</option>';
      clients.sort((a,b) => (a.name||'').localeCompare(b.name||'')).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        clientSel.appendChild(opt);
      });

      document.getElementById('recipe-process').innerHTML = '<option value="">-- Selecione as máquinas primeiro --</option>';
      document.getElementById('recipe-date').value = new Date().toISOString().slice(0, 10);
      document.getElementById('recipe-steps-body').innerHTML = '';

      if (isEdit) {
        const recipe = (await dbGetAll_raw('recipes')).find(r => r.id === recipeId);
        if (!recipe) { _isLoadingRecipeForm = false; return toast('Receita não encontrada', 'error'); }
        const selectedMachineIds = parseMachineIds(recipe);
        const allProcsEdit = await dbGetAll_raw('processes');
        const foundProc = findRecipeProcess(allProcsEdit, recipe);
        const bestProcessId = foundProc?.id ?? recipe.process_id;
        clientSel.value = recipe.client_id;
        await _loadRecipeMachines(recipe.client_id, selectedMachineIds);
        const firstMachId = selectedMachineIds[0];
        if (firstMachId) await _loadRecipeProcesses(firstMachId, bestProcessId, recipe.process_name || foundProc?.name || null);
        document.getElementById('recipe-date').value = recipe.date || '';
        const steps = JSON.parse(recipe.steps || '[]');
        const products = await dbGetAll_raw('recipe_products');
        const stepsContainer = document.getElementById('recipe-steps-body');
        steps.forEach((s, i) => { stepsContainer.insertAdjacentHTML('beforeend', _stepRowHtml(s, products, i)); });
      } else {
        const products = await dbGetAll_raw('recipe_products');
        document.getElementById('recipe-steps-body').innerHTML = _stepRowHtml({}, products, 0);
      }

      _isLoadingRecipeForm = false;
      document.getElementById('modal-recipe').classList.remove('hidden');
    }

    async function _loadRecipeMachines(clientId, selectedIds = []) {
      const container = document.getElementById('recipe-machines-checkboxes');
      if (!container) return;
      document.getElementById('recipe-process').innerHTML = '<option value="">-- Selecione as máquinas primeiro --</option>';

      if (!clientId) {
        container.innerHTML = '<span style="font-size:0.83rem;color:var(--muted)">Selecione um cliente primeiro</span>';
        return;
      }
      const machines = (await dbGetAll_raw('machines'))
        .filter(m => Number(m.client_id) === Number(clientId))
        .sort((a,b) => (a.name||'').localeCompare(b.name||''));

      if (!machines.length) {
        container.innerHTML = '<span style="font-size:0.83rem;color:var(--muted)">Nenhuma máquina cadastrada para este cliente</span>';
        return;
      }
      const selSet = new Set(selectedIds.map(Number));
      container.innerHTML = machines.map(m => `
        <label style="display:flex;align-items:center;gap:0.55rem;padding:0.3rem 0.25rem;cursor:pointer;border-radius:6px">
          <input type="checkbox" class="machine-chk" data-machine-id="${m.id}"
                 ${selSet.has(Number(m.id)) ? 'checked' : ''}
                 style="width:16px;height:16px;accent-color:var(--primary);flex-shrink:0"/>
          <span style="font-size:0.88rem;font-weight:600">⚙️ ${m.name}</span>
          ${m.capacity ? `<span style="font-size:0.75rem;color:var(--muted)">${m.capacity} kg</span>` : ''}
        </label>`).join('');

      // Carregar processos da primeira máquina selecionada
      const firstSel = machines.find(m => selSet.has(Number(m.id)));
      if (firstSel) await _loadRecipeProcesses(firstSel.id);
    }

    let _procLoadToken = 0;
    async function _loadRecipeProcesses(machineId, selectId = null, selectName = null) {
      const token = ++_procLoadToken;
      const processSel = document.getElementById('recipe-process');
      if (!processSel) return;
      processSel.innerHTML = '<option value="">-- Selecione --</option>';
      if (!machineId) return;

      const allProcs = await dbGetAll_raw('processes');
      const filtered = allProcs.filter(p => Number(p.machine_id) === Number(machineId));
      // Deduplicar por nome: mantém o de ID maior (mais recente)
      const byName = new Map();
      filtered.forEach(p => {
        const key = (p.name || '').toLowerCase().trim();
        if (!byName.has(key) || Number(p.id) > Number(byName.get(key).id)) byName.set(key, p);
      });
      const procs = [...byName.values()];
      const allRecipes = await dbGetAll_raw('recipes');
      if (token !== _procLoadToken) return;

      // Nomes de processos que já têm receita ativa cobrindo esta máquina
      const takenNames = new Set(
        allRecipes
          .filter(r => r.status === 'active' && parseMachineIds(r).includes(Number(machineId)))
          .map(r => (r.process_name || '').toLowerCase().trim())
          .filter(Boolean)
      );

      // Ao editar, o processo da própria receita não é bloqueado
      let ownProcName = '';
      if (_editingRecipeId !== null) {
        const cur = allRecipes.find(r => r.id === _editingRecipeId);
        if (cur) ownProcName = (cur.process_name || '').toLowerCase().trim();
      }

      procs.sort((a,b) => (a.name||'').localeCompare(b.name||''))
           .forEach(p => {
             const pName = (p.name || '').toLowerCase().trim();
             const taken = takenNames.has(pName) && pName !== ownProcName;
             const opt = document.createElement('option');
             opt.value = p.id;
             opt.textContent = p.name + (taken ? ' — já tem receita' : '');
             opt.disabled = taken;
             processSel.appendChild(opt);
           });

      if (selectId) processSel.value = selectId;
      // Fallback por nome quando o ID não bate (GAS ID mismatch pós-sync)
      if ((!processSel.value || processSel.value === '') && selectName) {
        const nameLow = selectName.toLowerCase().trim();
        for (const opt of processSel.options) {
          if (!opt.disabled && opt.value && opt.textContent.toLowerCase().trim().startsWith(nameLow)) {
            processSel.value = opt.value;
            break;
          }
        }
      }
      // Fallback: se só tem um processo disponível para a máquina, seleciona automaticamente
      if (!processSel.value || processSel.value === '') {
        const available = Array.from(processSel.options).filter(o => o.value && !o.disabled);
        if (available.length === 1) processSel.value = available[0].value;
      }
    }

    document.getElementById('recipe-client')?.addEventListener('change', e => {
      if (_isLoadingRecipeForm) return;
      _loadRecipeMachines(e.target.value, []);
    });
    document.getElementById('recipe-machines-checkboxes')?.addEventListener('change', async e => {
      if (_isLoadingRecipeForm) return;
      if (!e.target.classList.contains('machine-chk')) return;
      const firstId = _collectMachineIds()[0];
      if (firstId) await _loadRecipeProcesses(firstId);
      else document.getElementById('recipe-process').innerHTML = '<option value="">-- Selecione --</option>';
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

    document.getElementById('btn-new-recipe')?.addEventListener('click', () => _openRecipeForm(null));
    document.getElementById('modal-recipe-close')?.addEventListener('click',  () => document.getElementById('modal-recipe').classList.add('hidden'));
    document.getElementById('modal-recipe-cancel')?.addEventListener('click', () => document.getElementById('modal-recipe').classList.add('hidden'));

    document.getElementById('btn-save-recipe')?.addEventListener('click', async () => {
      if (_saving) return;
      const clientId   = Number(document.getElementById('recipe-client')?.value);
      const machineIds = _collectMachineIds();
      const processId  = Number(document.getElementById('recipe-process')?.value);
      const date       = document.getElementById('recipe-date')?.value;
      if (!clientId)          return toast('Selecione o cliente', 'warning');
      if (!machineIds.length) return toast('Selecione pelo menos uma máquina', 'warning');
      if (!processId)         return toast('Selecione o processo', 'warning');
      const steps = _collectSteps();
      if (!steps.length) return toast('Adicione pelo menos uma etapa', 'warning');

      const btn = document.getElementById('btn-save-recipe');
      setSaving(true, btn);
      try {
        const now = new Date().toISOString();
        const creator = currentUser?.name || currentUser?.username || '';
        const allProcsNow = await dbGetAll_raw('processes');
        const selProc = allProcsNow.find(p => Number(p.id) === processId);
        const processName = selProc?.name || document.getElementById('recipe-process')?.options[document.getElementById('recipe-process')?.selectedIndex]?.text || '';
        const machineIdsJson = JSON.stringify(machineIds);
        const primaryMachineId = machineIds[0];

        if (_editingRecipeId === null) {
          // Nova receita — vai direto ativa
          const recipe = {
            client_id: clientId, machine_id: primaryMachineId, machine_ids: machineIdsJson,
            process_id: processId, process_name: processName, date, created_by: creator,
            status: 'active', version: 1, original_id: 0,
            edit_notes: '', rejection_notes: '', approved_by: '', approved_at: '',
            steps: JSON.stringify(steps), created_at: now
          };
          const id = await dbAdd('recipes', recipe);
          recipe.id = id;
          recipe.original_id = id; // self-reference
          await dbPut('recipes', recipe);
          await postToSheetDB(SHEETS.RECIPES, recipe);
          toast('✅ Receita criada!', 'success');
        } else {
          // Edição — cria versão pendente para aprovação
          const current = (await dbGetAll_raw('recipes')).find(r => r.id === _editingRecipeId);
          if (!current) return toast('Receita original não encontrada', 'error');
          const editNotes = document.getElementById('recipe-edit-notes')?.value.trim() || '';
          const pending = {
            client_id: clientId, machine_id: primaryMachineId, machine_ids: machineIdsJson,
            process_id: processId, process_name: processName, date, created_by: creator,
            status: 'pending', version: (current.version || 1) + 1,
            original_id: current.original_id || current.id,
            replaces_id: current.id,
            edit_notes: editNotes, rejection_notes: '', approved_by: '', approved_at: '',
            steps: JSON.stringify(steps), created_at: now
          };
          const pid = await dbAdd('recipes', pending);
          pending.id = pid;
          await postToSheetDB(SHEETS.RECIPES, pending);
          toast('⏳ Edição enviada para aprovação do administrador!', 'info', 5000);
        }

        document.getElementById('modal-recipe').classList.add('hidden');
        await renderRecipesList();
      } catch(err) {
        toast('Erro ao salvar receita: ' + err.message, 'error');
      } finally {
        setSaving(false, btn);
      }
    });

    // Busca processo para uma receita com fallbacks (ID → nome → único processo da máquina)
    function findRecipeProcess(allProcesses, recipe) {
      let p = allProcesses.find(p => Number(p.id) === Number(recipe.process_id));
      if (p) return p;
      if (recipe.process_name) {
        const nl = recipe.process_name.toLowerCase().trim();
        p = allProcesses.find(p => Number(p.machine_id) === Number(recipe.machine_id) && (p.name||'').toLowerCase().trim() === nl);
        if (!p) p = allProcesses.find(p => (p.name||'').toLowerCase().trim() === nl);
        if (p) return p;
      }
      const mProcs = allProcesses.filter(p => Number(p.machine_id) === Number(recipe.machine_id));
      return mProcs.length === 1 ? mProcs[0] : null;
    }

    async function renderRecipesList() {
      const list = document.getElementById('recipes-list');
      if (!list) return;

      // Skeleton enquanto carrega
      if (!list.querySelector('.skeleton-card')) {
        list.innerHTML = [1,2,3].map(() => `
          <div class="skeleton-card">
            <div class="skeleton-line short"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line xshort"></div>
          </div>`).join('');
      }

      const filterClientId  = Number(document.getElementById('recipe-filter-client')?.value  || 0);
      const filterMachineId = Number(document.getElementById('recipe-filter-machine')?.value || 0);

      const [clients, machines, processes, allRecipesRaw] = await Promise.all([
        dbGetAll_raw('clients'),
        dbGetAll_raw('machines'),
        dbGetAll_raw('processes'),
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
          const machIds = parseMachineIds(r);
          const machNamesP = machIds.map(mid => machines.find(m => Number(m.id) === mid)?.name || '?').join(', ');
          const p = findRecipeProcess(processes, r);
          const procName = p?.name || r.process_name || null;
          return `<div class="list-item" style="flex-direction:column;gap:0.4rem;padding:0.7rem 1rem">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.4rem">
              <div>
                <strong>${c?.name||'?'}</strong> · ⚙️ ${machNamesP||'?'}${procName ? ' · 🔄 '+procName : ''}
                <span style="font-size:0.78rem;color:var(--muted)"> — v${r.version} · por ${r.created_by}</span>
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
      let statusFilter = activeStatusChip === 'all' ? 'active' : activeStatusChip;
      let displayed = allRecipes.filter(r => activeStatusChip === 'all' ? r.status === 'active' : r.status === statusFilter);
      if (filterClientId)  displayed = displayed.filter(r => Number(r.client_id) === filterClientId);
      if (filterMachineId) displayed = displayed.filter(r => parseMachineIds(r).includes(filterMachineId));

      // Filtro de busca por texto
      const searchTerm = (document.getElementById('recipe-search')?.value || '').toLowerCase().trim();
      if (searchTerm) {
        displayed = displayed.filter(r => {
          const c = clients.find(c => Number(c.id) === Number(r.client_id));
          const machIds = parseMachineIds(r);
          const machNamesS = machIds.map(mid => machines.find(m => Number(m.id) === mid)?.name || '').filter(Boolean);
          const p = findRecipeProcess(processes, r);
          const text = [c?.name, ...machNamesS, p?.name, r.process_name].filter(Boolean).join(' ').toLowerCase();
          return text.includes(searchTerm);
        });
      }
      displayed.sort((a,b) => {
        const ca = clients.find(c => Number(c.id) === Number(a.client_id))?.name || '';
        const cb = clients.find(c => Number(c.id) === Number(b.client_id))?.name || '';
        if (ca !== cb) return ca.localeCompare(cb);
        return (a.process_name||'').localeCompare(b.process_name||'');
      });

      document.getElementById('recipes-count').textContent = displayed.length;

      if (!displayed.length) {
        const searchTerm2 = (document.getElementById('recipe-search')?.value || '').trim();
        list.innerHTML = searchTerm2
          ? `<div class="empty-state"><span class="empty-icon">🔍</span><strong>Nenhum resultado para "${searchTerm2}"</strong><p>Tente outro termo ou limpe a busca.</p></div>`
          : `<div class="empty-state"><span class="empty-icon">🗂️</span><strong>Nenhuma receita cadastrada</strong><p>Crie a primeira receita para este filtro.</p><button class="btn-primary btn-sm" onclick="document.getElementById('btn-new-recipe').click()">+ Nova Receita</button></div>`;
        return;
      }

      // Agrupar por cliente → processo
      const byClient = new Map();
      for (const r of displayed) {
        const cKey = String(r.client_id);
        const pName = r.process_name || findRecipeProcess(processes, r)?.name || `proc_${r.process_id}`;
        const pKey  = pName.toLowerCase().trim();
        if (!byClient.has(cKey)) byClient.set(cKey, new Map());
        if (!byClient.get(cKey).has(pKey)) byClient.get(cKey).set(pKey, { procName: pName, recs: [] });
        byClient.get(cKey).get(pKey).recs.push(r);
      }

      const recipeCardHtml = r => {
        const machIds  = parseMachineIds(r);
        const machNamesC = machIds.map(mid => machines.find(m => Number(m.id) === mid)?.name || '?');
        const steps = (() => { try { return JSON.parse(r.steps||'[]'); } catch(e){ return []; } })();
        const hasPending = allRecipes.some(x => x.status === 'pending' && (x.original_id === r.original_id || x.original_id === r.id));
        return `
          <div style="border:1px solid var(--border);border-radius:8px;padding:0.55rem 0.75rem;margin-bottom:0.4rem;background:#fff">
            <div style="display:flex;flex-wrap:wrap;gap:0.25rem 0.3rem;align-items:center;margin-bottom:0.4rem">
              ${machNamesC.map(n => `<span style="font-size:0.73rem;background:#f1f5f9;border:1px solid var(--border);border-radius:5px;padding:1px 7px;font-weight:600;color:#334155">⚙️ ${n}</span>`).join('')}
              ${hasPending ? '<span style="font-size:0.72rem;background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:999px;font-weight:600;margin-left:auto">⏳ Pendente</span>' : ''}
              <span style="font-size:0.7rem;color:var(--muted);margin-left:${hasPending?'0':'auto'}">v${r.version} · ${r.created_by||'—'}</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.2rem 0.4rem;margin-bottom:0.45rem">
              ${steps.slice(0,5).map(s => `<span style="font-size:0.7rem;background:#f1f5f9;border-radius:5px;padding:1px 6px;border:1px solid var(--border);color:#374151"><strong>${s.n}.</strong> ${s.operation||'—'}</span>`).join('')}
              ${steps.length > 5 ? `<span style="font-size:0.7rem;color:var(--muted)">+${steps.length-5} mais</span>` : ''}
              ${!steps.length ? `<span style="font-size:0.7rem;color:var(--muted)">Sem etapas</span>` : ''}
            </div>
            <div style="display:flex;gap:0.3rem">
              ${!hasPending ? `<button class="btn-edit btn-sm" onclick="window._editRecipeOpen(${r.id})" style="flex:2">✏️ Editar</button>` : ''}
              <button class="btn-secondary btn-sm" onclick="window._viewRecipe(${r.id})" style="flex:1">👁️ Ver</button>
              <button class="btn-secondary btn-sm" onclick="window._toggleRecipeMore(${r.id})" style="flex:0 0 2.2rem;padding:0 !important;font-size:1.15rem;font-weight:700;letter-spacing:1px" title="Mais opções">⋯</button>
            </div>
            <div class="recipe-more-panel" id="rmore-${r.id}">
              ${currentUser?.role === 'admin' ? `<button class="btn-danger btn-sm" onclick="window._deleteRecipe(${r.id}, ${r.original_id||r.id})" style="flex:0 0 auto">🗑️ Excluir</button>` : ''}
            </div>
          </div>`;
      };

      list.innerHTML = [...byClient.entries()].map(([cKey, procMap]) => {
        const c = clients.find(c => String(c.id) === cKey);
        const totalRecs = [...procMap.values()].reduce((s, v) => s + v.recs.length, 0);
        const procsHtml = [...procMap.entries()].map(([pKey, {procName, recs}]) => {
          const pBodyId = `pb-${cKey}-${pKey.replace(/\W/g,'_')}`;
          return `
            <div style="margin-bottom:0.4rem;border:1px solid #e2e8f0;border-radius:7px;overflow:hidden">
              <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.65rem;cursor:pointer;background:#f8fafc;border-left:2px solid #93c5fd;user-select:none"
                   onclick="(function(h){const b=document.getElementById('${pBodyId}');const open=b.style.display!=='none';b.style.display=open?'none':'block';h.querySelector('.parr').textContent=open?'▶':'▼';})(this)">
                <span class="parr" style="font-size:0.6rem;color:#64748b;min-width:10px">▼</span>
                <span style="font-size:0.82rem;font-weight:700;color:var(--text)">🔄 ${procName}</span>
                <span style="font-size:0.7rem;background:#e2e8f0;border-radius:999px;padding:1px 7px;color:#64748b;font-weight:600;margin-left:auto">${recs.length} receita${recs.length>1?'s':''}</span>
              </div>
              <div id="${pBodyId}" style="padding:0.45rem 0.5rem;background:#fff">
                ${recs.map(r => recipeCardHtml(r)).join('')}
              </div>
            </div>`;
        }).join('');

        const cBodyId = `cb-${cKey}`;
        return `
          <div style="border:1px solid #bfdbfe;border-radius:12px;margin-bottom:0.75rem;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
            <div style="background:#eff6ff;padding:0.55rem 0.9rem;display:flex;align-items:center;gap:0.6rem;cursor:pointer;user-select:none;border-bottom:1px solid #bfdbfe"
                 onclick="(function(h){const b=document.getElementById('${cBodyId}');const open=b.style.display!=='none';b.style.display=open?'none':'block';h.querySelector('.carr').textContent=open?'▶':'▼';})(this)">
              <span class="carr" style="font-size:0.65rem;color:#93c5fd;min-width:10px">▼</span>
              <span style="font-size:0.95rem">👥</span>
              <span style="font-weight:700;font-size:0.92rem;color:var(--primary-dark)">${c?.name||'?'}</span>
              <span style="font-size:0.72rem;background:#dbeafe;color:var(--primary);padding:2px 9px;border-radius:999px;font-weight:600;margin-left:auto">${totalRecs} receita${totalRecs>1?'s':''}</span>
              <button onclick="event.stopPropagation();window._shareClientRecipesPdf('${cKey}')" style="flex-shrink:0;padding:2px 10px;border:1.5px solid #93c5fd;border-radius:6px;background:#fff;color:#1d4ed8;font-size:0.72rem;font-weight:700;cursor:pointer;white-space:nowrap">📄 PDF</button>
            </div>
            <div id="${cBodyId}" style="padding:0.6rem 0.75rem;background:#fff">
              ${procsHtml}
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

    window._deleteRecipe = async function(id, originalId) {
      const allPrev = await dbGetAll_raw('recipes');
      const recPrev = allPrev.find(r => r.id === Number(id));
      const [allClPrev, allMcPrev, allPrPrev] = await Promise.all([dbGetAll_raw('clients'), dbGetAll_raw('machines'), dbGetAll_raw('processes')]);
      const cPrev = allClPrev.find(c => Number(c.id) === Number(recPrev?.client_id));
      const machIdsPrev = recPrev ? parseMachineIds(recPrev) : [];
      const machNamesPrev = machIdsPrev.map(mid => allMcPrev.find(m => Number(m.id) === mid)?.name).filter(Boolean).join(', ');
      const pPrev = recPrev ? findRecipeProcess(allPrPrev, recPrev) : null;
      const nameHint = [cPrev?.name, machNamesPrev, pPrev?.name || recPrev?.process_name].filter(Boolean).join(' › ');
      const confirmMsg = nameHint
        ? `Excluir receita\n"${nameHint}"?\n\nTodas as versões (ativas, arquivadas, pendentes) serão removidas.`
        : 'Excluir esta receita e todas as suas versões?';
      if (!await confirmAction(confirmMsg, '🗑️ Excluir', true)) return;
      const all = await dbGetAll_raw('recipes');
      const nId = Number(id), nOrigId = Number(originalId);
      const toDelete = all.filter(r => Number(r.id) === nId || Number(r.original_id) === nOrigId || Number(r.id) === nOrigId);
      if (!toDelete.length) { toast('⚠️ Receita não encontrada', 'warning'); return; }
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

    // Listeners do modal de replicação
    document.getElementById('modal-recipe-replicate-close')?.addEventListener('click', () => document.getElementById('modal-recipe-replicate').classList.add('hidden'));
    document.getElementById('modal-recipe-replicate-cancel')?.addEventListener('click', () => document.getElementById('modal-recipe-replicate').classList.add('hidden'));

    let _replicateSourceId = null;
    window._replicateRecipe = async function(recipeId) {
      _replicateSourceId = recipeId;
      const allRecipes = await dbGetAll_raw('recipes');
      const source = allRecipes.find(r => r.id === recipeId);
      if (!source) return;

      const machines  = await dbGetAll_raw('machines');
      const processes = await dbGetAll_raw('processes');

      // Combinações máquina+processo do mesmo cliente
      const clientMachines = machines.filter(m => Number(m.client_id) === Number(source.client_id));
      const sourceMachIds = new Set(parseMachineIds(source).map(Number));
      const targets = [];
      for (const m of clientMachines) {
        // Pular máquinas que já fazem parte da receita de origem
        if (sourceMachIds.has(Number(m.id))) continue;
        const machProcs = processes.filter(p => Number(p.machine_id) === Number(m.id));
        for (const p of machProcs) {
          // Verificar se já existe receita ativa cobrindo esta máquina com este processo
          const hasActive = allRecipes.some(r =>
            r.status === 'active' &&
            parseMachineIds(r).includes(Number(m.id)) &&
            (r.process_name || '').toLowerCase() === (p.name || '').toLowerCase()
          );
          targets.push({ machineId: m.id, machineName: m.name, processId: p.id, processName: p.name, hasActive });
        }
      }

      // Agrupar targets por máquina
      const byMachine = {};
      for (const t of targets) {
        if (!byMachine[t.machineId]) byMachine[t.machineId] = { name: t.machineName, procs: [] };
        byMachine[t.machineId].procs.push(t);
      }

      // Máquina de origem (para identificar)
      const srcMachine = machines.find(m => Number(m.id) === Number(source.machine_id));
      const srcProcess = processes.find(p => Number(p.id) === Number(source.process_id));

      const targetsEl = document.getElementById('replicate-targets');
      if (!Object.keys(byMachine).length) {
        targetsEl.innerHTML = '<div class="empty-state">Nenhuma outra combinação disponível para este cliente.</div>';
      } else {
        targetsEl.innerHTML = Object.entries(byMachine).map(([mId, mg]) => {
          const available = mg.procs.filter(t => !t.hasActive);
          const taken     = mg.procs.filter(t => t.hasActive);
          return `
          <div style="margin-bottom:0.75rem;border:1px solid var(--border);border-radius:10px;overflow:hidden">
            <div style="background:#f8fafc;padding:0.5rem 0.75rem;font-weight:600;font-size:0.88rem;border-bottom:1px solid var(--border)">
              ⚙️ ${mg.name}
            </div>
            <div style="padding:0.4rem 0.5rem">
              ${available.map(t => `
                <label style="display:flex;align-items:center;gap:0.55rem;padding:0.45rem 0.5rem;border-radius:7px;cursor:pointer;hover:background:#f0f9ff">
                  <input type="checkbox" class="replicate-target-chk" data-machine="${t.machineId}" data-process="${t.processId}" style="width:16px;height:16px;flex-shrink:0;accent-color:#2563eb"/>
                  <span style="font-size:0.85rem">🔄 ${t.processName}</span>
                </label>`).join('')}
              ${taken.map(t => `
                <div style="display:flex;align-items:center;gap:0.55rem;padding:0.45rem 0.5rem;border-radius:7px;opacity:0.5">
                  <span style="width:16px;height:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:0.75rem">✅</span>
                  <span style="font-size:0.85rem">🔄 ${t.processName}</span>
                  <span style="font-size:0.72rem;color:#15803d;background:#dcfce7;padding:1px 6px;border-radius:999px;margin-left:auto">já tem receita</span>
                </div>`).join('')}
              ${!available.length && !taken.length ? '<div style="font-size:0.82rem;color:var(--muted);padding:0.4rem 0.5rem">Nenhum processo cadastrado</div>' : ''}
            </div>
          </div>`;
        }).join('');
      }

      // Mostrar receita de origem
      document.getElementById('replicate-source-info').innerHTML =
        `Receita de <strong>${srcMachine?.name||'?'}</strong>${srcProcess ? ` · 🔄 <strong>${srcProcess.name}</strong>` : ''} — as etapas serão copiadas para os processos selecionados.`;

      document.getElementById('modal-recipe-replicate').classList.remove('hidden');
    };

    document.getElementById('btn-confirm-replicate')?.addEventListener('click', async () => {
      const checked = [...document.querySelectorAll('.replicate-target-chk:checked')];
      if (!checked.length) return toast('Selecione ao menos uma combinação', 'warning');

      const allRecipes = await dbGetAll_raw('recipes');
      const source = allRecipes.find(r => r.id === _replicateSourceId);
      if (!source) return;

      const submitBtn = document.getElementById('btn-confirm-replicate');
      setSaving(true, submitBtn, 'Replicando...');
      try {
        const isAdmin = currentUser?.role === 'admin';
        const now = new Date().toISOString();
        let count = 0;
        const allProcsForRep = await dbGetAll_raw('processes');
        for (const chk of checked) {
          const machineId = Number(chk.dataset.machine);
          const processId = Number(chk.dataset.process);
          const tgtProc = allProcsForRep.find(p => Number(p.id) === processId);
          const copy = {
            client_id:    source.client_id,
            machine_id:   machineId,
            machine_ids:  JSON.stringify([machineId]),
            process_id:   processId,
            process_name: tgtProc?.name || '',
            steps:       source.steps,
            status:      isAdmin ? 'active' : 'pending',
            version:     1,
            created_by:  currentUser?.name || currentUser?.username || '',
            created_at:  now,
            date:        now.slice(0, 10),
            edit_notes:  `Replicada da receita #${source.id}`,
          };
          const id = await dbAdd('recipes', copy);
          copy.id = id;
          copy.original_id = id;
          await dbPut('recipes', copy);
          await postToSheetDB(SHEETS.RECIPES, copy);
          count++;
        }
        toast(`✅ ${count} receita${count > 1 ? 's replicadas' : ' replicada'}!`, 'success');
        document.getElementById('modal-recipe-replicate').classList.add('hidden');
        await renderRecipesList();
        await updateRecipeBadge();
      } catch(err) {
        toast('Erro ao replicar: ' + err.message, 'error');
      } finally {
        setSaving(false, submitBtn);
      }
    });

    window._viewRecipe = async function(recipeId) {
      const allRecipes = await dbGetAll_raw('recipes');
      const recipe = allRecipes.find(r => r.id === recipeId);
      if (!recipe) return;
      const clients   = await dbGetAll_raw('clients');
      const machines  = await dbGetAll_raw('machines');
      const processes = await dbGetAll_raw('processes');
      const c = clients.find(c => Number(c.id) === Number(recipe.client_id));
      const machIds = parseMachineIds(recipe);
      const recMachines = machIds.map(mid => machines.find(m => Number(m.id) === mid)).filter(Boolean);
      const p = findRecipeProcess(processes, recipe);
      const procName = p?.name || recipe.process_name || null;
      const steps = (() => { try { return JSON.parse(recipe.steps||'[]'); } catch(e){ return []; } })();

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

      // Versões arquivadas
      const archived = allRecipes.filter(r => (r.original_id === recipe.original_id || r.original_id === recipe.id) && r.status === 'archived')
                                  .sort((a,b) => b.version - a.version);
      const archivedHtml = archived.length
        ? `<div style="margin-top:1rem"><strong style="font-size:0.85rem">📜 Versões anteriores</strong>
           <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.4rem">
             ${archived.map(v => `<button class="btn-secondary btn-sm" onclick="window._viewRecipe(${v.id})">v${v.version} — ${fmtDate(v.date||v.created_at?.slice(0,10))}</button>`).join('')}
           </div></div>` : '';

      // Link para versão ativa (quando visualizando uma versão arquivada/recusada)
      const activeVersion = recipe.status !== 'active'
        ? allRecipes.find(r => r.status === 'active' && (r.original_id === recipe.original_id || r.id === recipe.original_id || r.original_id === recipe.id))
        : null;
      const activeVersionHtml = activeVersion
        ? `<div style="margin-top:0.75rem;padding:0.5rem 0.75rem;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:0.5rem">
            <span style="font-size:0.85rem;color:#15803d">📋 Existe uma versão ativa desta receita</span>
            <button class="btn-primary btn-sm" style="background:#16a34a" onclick="window._viewRecipe(${activeVersion.id})">Ver v${activeVersion.version} atual</button>
           </div>` : '';

      document.getElementById('modal-recipe-view-title').textContent = `📝 ${c?.name||'?'}`;
      document.getElementById('modal-recipe-view-body').innerHTML = `
        <div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:10px;padding:0.75rem 1rem;margin-bottom:0.85rem">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.3rem 0.5rem;margin-bottom:0.35rem">
            ${recMachines.map(m => `<span style="font-size:0.85rem;font-weight:700;color:var(--text)">⚙️ ${m.name}${m.capacity?' ('+m.capacity+' kg)':''}</span>`).join('<span style="color:var(--muted)">·</span>')}
            ${procName?`<span style="background:#dbeafe;color:var(--primary-dark);padding:2px 10px;border-radius:999px;font-size:0.78rem;font-weight:700">🔄 ${procName}</span>`:''}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.25rem 0.75rem;font-size:0.78rem;color:var(--muted)">
            <span>📅 ${fmtDate(recipe.date||recipe.created_at?.slice(0,10))}</span>
            <span>Versão <strong style="color:var(--text)">v${recipe.version}</strong></span>
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
      const allRecipes = await dbGetAll_raw('recipes');
      const recipe = allRecipes.find(r => r.id === recipeId);
      if (!recipe) return toast('Receita não encontrada', 'error');
      const clients   = await dbGetAll_raw('clients');
      const machines  = await dbGetAll_raw('machines');
      const processes = await dbGetAll_raw('processes');
      const c = clients.find(c => Number(c.id) === Number(recipe.client_id));
      const machIds = parseMachineIds(recipe);
      const recMachinesPdf = machIds.map(mid => machines.find(m => Number(m.id) === mid)).filter(Boolean);
      const machinesStr = recMachinesPdf.map(m => `${m.name}${m.capacity?' ('+m.capacity+' kg)':''}`).join(', ') || '—';
      const p = findRecipeProcess(processes, recipe);
      const procName = p?.name || recipe.process_name || null;
      const steps = (() => { try { return JSON.parse(recipe.steps||'[]'); } catch(e){ return []; } })();
      const dateStr = fmtDate(recipe.date || recipe.created_at?.slice(0,10));
      const stepsRows = steps.map(s => {
        const prods = Array.isArray(s.products) ? s.products.filter(p => typeof p==='string' ? p : p?.name) : [];
        const prodNames = prods.map(p => typeof p==='string' ? p : p.name).join('<br>') || '—';
        const dosages   = prods.map(p => typeof p==='string' ? '—' : (p.dosage || '—')).join('<br>') || '—';
        return `
        <tr>
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
<title>PROCESSOS DE LAVAGENS - ${c?.name||'?'} - v${recipe.version} - ${dateStr}</title>
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
  <span class="action-bar-label">${c?.name||'?'} · ${machinesStr}${procName ? ' · '+procName : ''}</span>
</div>
<div class="hdr"><h1>📝 Receita de Lavagem</h1><p>Hygicare Lavanderia</p></div>
<div class="info-block">
  <div class="info-grid">
    <div class="info-item"><label>Cliente</label><span>${c?.name||'—'}</span></div>
    <div class="info-item" style="grid-column:span 2"><label>Máquinas</label><span>${machinesStr}</span></div>
    <div class="info-item"><label>Processo</label><span>${procName||'—'}</span></div>
    <div class="info-item"><label>Data</label><span>${dateStr}</span></div>
    <div class="info-item"><label>Versão</label><span>v${recipe.version}</span></div>
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
      const win = window.open('', '_blank', 'width=900,height=700');
      if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
      win.document.write(html);
      win.document.close();
    }

    async function _shareClientRecipesPdf(clientId) {
      clientId = Number(clientId);
      const [allRecipes, clients, machines, processes] = await Promise.all([
        dbGetAll_raw('recipes'),
        dbGetAll_raw('clients'),
        dbGetAll_raw('machines'),
        dbGetAll_raw('processes'),
      ]);
      const c = clients.find(cl => Number(cl.id) === clientId);
      if (!c) return toast('Cliente não encontrado', 'error');

      const activeRecipes = allRecipes
        .filter(r => r.status === 'active' && Number(r.client_id) === clientId)
        .sort((a, b) => (a.process_name || '').localeCompare(b.process_name || ''));
      if (!activeRecipes.length) return toast('Nenhuma receita ativa para este cliente', 'warning');

      const maxVersion = Math.max(...activeRecipes.map(r => Number(r.version) || 0));
      const lastIso = activeRecipes.reduce((best, r) => {
        const d = r.date || r.created_at?.slice(0, 10) || '';
        return d > best ? d : best;
      }, '');
      const lastDateStr = fmtDate(lastIso);

      const recipeSections = activeRecipes.map(r => {
        const machIds = parseMachineIds(r);
        const machNames = machIds.map(mid => {
          const m = machines.find(m => Number(m.id) === mid);
          return m ? `${m.name}${m.capacity ? ' (' + m.capacity + ' kg)' : ''}` : '?';
        }).join(', ') || '—';
        const p = findRecipeProcess(processes, r);
        const procName = p?.name || r.process_name || '—';
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
            <span class="rs-proc">🔄 ${escHtml(procName)}</span>
            <span class="rs-meta">⚙️ ${escHtml(machNames)} &nbsp;·&nbsp; v${r.version}</span>
          </div>
          ${steps.length
            ? `<table><thead><tr><th style="width:34px">N.</th><th>Operação</th><th>Tempo</th><th>Temp.</th><th>Nível</th><th>Produto(s)</th><th>Dosagem</th></tr></thead><tbody>${stepsRows}</tbody></table>`
            : '<p style="color:#94a3b8;font-size:0.82rem;padding:8px 14px">Sem etapas cadastradas.</p>'}
        </div>`;
      }).join('');

      const titleStr = `PROCESSOS DE LAVAGENS - ${c.name} - v${maxVersion} - ${lastDateStr}`;
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
  <span class="abar-lbl">${escHtml(c.name)} · ${activeRecipes.length} processo${activeRecipes.length > 1 ? 's' : ''}</span>
</div>
<div class="doc-hdr">
  <h1>📋 Processos de Lavagens</h1>
  <p>${escHtml(c.name)} &nbsp;·&nbsp; Hygicare Lavanderia &nbsp;·&nbsp; v${maxVersion} &nbsp;·&nbsp; Última atualização: ${lastDateStr}</p>
</div>
${recipeSections}
<div class="footer">Hygicare Lavanderia — ${escHtml(c.name)} — Gerado em ${new Date().toLocaleString('pt-BR')}</div>
</body></html>`;

      const win = window.open('', '_blank', 'width=950,height=750');
      if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
      win.document.write(htmlDoc);
      win.document.close();
    }
    window._shareClientRecipesPdf = _shareClientRecipesPdf;

    window._approveRecipe = async function(pendingId) {
      const all = await dbGetAll_raw('recipes');
      const pending = all.find(r => r.id === pendingId);
      if (!pending || pending.status !== 'pending') return toast('Receita não encontrada ou não está pendente', 'error');

      // Usa replaces_id (preciso) se disponível, senão fallback pelo original_id
      const currentActive = (pending.replaces_id
        ? all.find(r => r.status === 'active' && r.id === pending.replaces_id)
        : null)
        || all.find(r => r.status === 'active' && (r.original_id === pending.original_id || r.id === pending.original_id));
      if (currentActive) {
        const pendingMachSet = new Set(parseMachineIds(pending).map(Number));
        const activeMachIds  = parseMachineIds(currentActive).map(Number);
        const remaining      = activeMachIds.filter(id => !pendingMachSet.has(id));

        if (remaining.length > 0) {
          // Máquinas removidas da edição continuam com a receita original (apenas atualiza machine_ids)
          const kept = { ...currentActive, machine_id: remaining[0], machine_ids: JSON.stringify(remaining) };
          await dbPut('recipes', kept);
          await patchSheetDB(SHEETS.RECIPES, kept.id, kept);
        } else {
          // Todas as máquinas migraram → arquiva original
          const archived = { ...currentActive, status: 'archived' };
          await dbPut('recipes', archived);
          await patchSheetDB(SHEETS.RECIPES, archived.id, archived);
        }
      }

      // Ativar a versão pendente
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
    document.getElementById('recipe-filter-client')?.addEventListener('change', async e => {
      const sel = document.getElementById('recipe-filter-machine');
      sel.innerHTML = '<option value="">⚙️ Todas as máquinas</option>';
      if (e.target.value) {
        const mach = (await dbGetAll_raw('machines')).filter(m => Number(m.client_id) === Number(e.target.value));
        mach.sort((a,b)=>(a.name||'').localeCompare(b.name||'')).forEach(m => sel.innerHTML += `<option value="${m.id}">${m.name}</option>`);
      }
      await renderRecipesList();
    });
    document.getElementById('recipe-filter-machine')?.addEventListener('change', async () => await renderRecipesList());

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
    document.getElementById('records-quick-filters')?.querySelectorAll('.qf-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.getElementById('records-quick-filters').querySelectorAll('.qf-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        applyFilters();
      });
    });
    document.getElementById('btn-clear-filters').addEventListener('click', () => {
      document.getElementById('search-records').value = '';
      document.getElementById('filter-client-records').value = '';
      const sellerSel = document.getElementById('filter-seller-records');
      if (sellerSel) sellerSel.value = '';
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
        const procName    = process?.name || `Processo #${r.process_id}`;
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
        if (!grouped[key]) grouped[key] = { clientName, clientId: Number(r.client_id), period, createdMonth, monthSortKey, rows: [], totalKg: 0, precoKg: parseFloat(client?.price_kg || 0) || null };
        grouped[key].rows.push({ machineName, procName, executed: r.executed || 0, canceled: r.canceled || 0, capacity: r.capacity || 0, total: r.total || 0 });
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
        const g = _recordGroups[safeKey];
        if (!g) return;
        const win = window.open('', '_blank', 'width=1000,height=750');
        if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
        win.document.write(buildReportHtml(g, true));
        win.document.close();
      };

      // ---- Gerar PDF de um grupo (abre janela de impressão) ----
      window._pdfGroup = function(safeKey) {
        const g = _recordGroups[safeKey];
        if (!g) return;
        const win = window.open('', '_blank', 'width=1000,height=750');
        if (!win) { toast('Pop-up bloqueado! Permita pop-ups para este site.', 'error'); return; }
        win.document.write(buildReportHtml(g, true));
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

    // Reparar process_name em receitas existentes sem precisar clicar Atualizar
    (async () => {
      try {
        const recs = await dbGetAll_raw('recipes');
        const procs = await dbGetAll_raw('processes');
        let repaired = 0;
        for (const r of recs) {
          if (!r.process_name) {
            const p = findRecipeProcess(procs, r);
            if (p?.name) { await dbPut('recipes', { ...r, process_name: p.name }); repaired++; }
          }
        }
        if (repaired > 0) { await renderRecipesList(); await updateRecipeBadge(); }
      } catch(e) { /* silencioso */ }
    })();

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

    function _setKpis(totalKg, totalRec, totalClients, cancelPct) {
      const fmt = v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0);
      const el = id => document.getElementById(id);
      if (el('kpi-total-kg'))     el('kpi-total-kg').textContent     = fmt(totalKg) + ' kg';
      if (el('kpi-registros'))    el('kpi-registros').textContent    = totalRec;
      if (el('kpi-clientes'))     el('kpi-clientes').textContent     = totalClients;
      if (el('kpi-cancelamento')) el('kpi-cancelamento').textContent = cancelPct.toFixed(1) + '%';
    }

    async function renderCharts() {
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
      _setKpis(totalKg, records.length, clientsSet.size, cancelPct);

      if (!records.length) {
        CHART_IDS.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.insertAdjacentHTML('afterend',
            `<p style="text-align:center;color:#94a3b8;padding:2rem 0;margin:0;font-size:0.85rem">📭 Sem dados para este período</p>`);
        });
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
      const ctxM = document.getElementById('chart-por-mes');
      if (ctxM) _charts.porMes = new Chart(ctxM, {
        type: 'line',
        data: {
          labels: mesSorted.map(e => e[1].label),
          datasets: [{
            label: 'kg processado',
            data: mesSorted.map(e => +e[1].kg.toFixed(2)),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37,99,235,0.1)',
            fill: true, tension: 0.4, pointRadius: 4, pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
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
        const name = p?.name || `Proc. #${r.process_id}`;
        kgProc[name] = (kgProc[name] || 0) + parseFloat(r.total || 0);
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
      const roleLabel = { admin: 'Admin', gerente: 'Gerente', vendedor: 'Vendedor', consultor: 'Consultor' };
      const roleClass = { admin: 'role-admin', gerente: 'role-gerente', vendedor: 'role-vendedor', consultor: 'role-consultor' };
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
              ? `<button class="btn-delete" onclick="window._deleteUser(${u.id}, '${u.username}')">🗑️</button>`
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
      const sellers = allUsers.filter(u => u.role === 'vendedor');
      const selectedSet = new Set(selectedAccess.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
      if (!sellers.length) {
        container.innerHTML = '<span style="color:#94a3b8;font-size:0.84rem">Nenhum vendedor cadastrado</span>';
        return;
      }
      container.innerHTML = sellers.map(s => {
        const name = s.sellerName || s.name || '';
        const checked = selectedSet.has(name.toLowerCase()) ? 'checked' : '';
        return `<label class="perm-check"><input type="checkbox" name="seller_access" value="${name}" ${checked} /> ${name}</label>`;
      }).join('');
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
      ['clients','machines','processes','form','reports','charts','users','vazao'].forEach(k => {
        const el = document.querySelector(`input[name="perm_${k}"]`);
        if (el) el.checked = !u.permissions || savedPerms.has(k);
      });
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
      const permKeys = ['clients','machines','processes','form','reports','charts','users','vazao','recipes'];
      const permissions = role === 'admin' ? '' :
        permKeys.filter(k => document.querySelector(`input[name="perm_${k}"]`)?.checked).join(',');

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
      const g = _recordGroups?.[safeKey];
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
      const gPreview = _recordGroups?.[safeKey];
      const confirmMsg = gPreview
        ? `Excluir registros de\n"${gPreview.clientName}" — ${gPreview.period}?\n\nEsta ação não pode ser desfeita.`
        : 'Excluir este grupo de registros? Esta ação não pode ser desfeita.';
      if (!await confirmAction(confirmMsg, '🗑️ Excluir', true)) return;
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
