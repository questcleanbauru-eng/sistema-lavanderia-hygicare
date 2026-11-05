// Vercel Cron — lembrete periódico pra todo mundo (cada usuário + o admin)
// abrir o app. Dispara TODO DIA às 09h (Brasília) — ver vercel.json — mas só
// manda notificação de verdade quando a config salva pelo Admin (tela
// Admin → "Lembrete Automático de Acesso", aba Config no Sheets, chave
// hygicare_push_reminder_cfg) diz que HOJE é o dia certo (semanal: dia da
// semana configurado; mensal: dia do mês configurado). Fora isso, só
// confere e sai sem mandar nada.
//
// Idempotência: depois de mandar, grava a data de hoje na chave
// hygicare_push_reminder_last_sent — se essa função rodar de novo no mesmo
// dia (reentrega do Vercel, etc.) ela não manda duplicado.
//
// Reaproveita o mesmo mecanismo Web Push de /api/send-push.js, só que em
// massa: busca os usuários ativos e as inscrições na planilha e manda pra
// todo mundo que já ativou push em algum dispositivo — o admin já é um
// usuário normal na aba Usuarios, cai no mesmo laço, sem lista separada.
//
// Protegido por CRON_SECRET: o Vercel manda esse valor automaticamente no
// header Authorization quando é ELE quem chama a rota (ver vercel.json).
// Sem essa env var configurada, o endpoint fica bloqueado por padrão (nunca
// aberto) — não dá pra alguém de fora disparar notificação pra todo mundo.
//
// Variáveis de ambiente (mesmas de send-push.js, + CRON_SECRET):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, GAS_URL, GAS_SECRET, CRON_SECRET

const webpush = require('web-push');

const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT     = (process.env.VAPID_SUBJECT     || 'mailto:contato@hygicare.com.br').trim();
const GAS_URL           = (process.env.GAS_URL    || '').trim();
const GAS_SECRET        = (process.env.GAS_SECRET || '').trim();
const CRON_SECRET       = (process.env.CRON_SECRET || '').trim();

let _vapidReady = false;
function _ensureVapid() {
  if (_vapidReady) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  _vapidReady = true;
  return true;
}

async function _readSheet(name) {
  if (!GAS_URL) return [];
  const qs = GAS_SECRET
    ? `?sheet=${name}&_secret=${encodeURIComponent(GAS_SECRET)}`
    : `?sheet=${name}`;
  const r = await fetch(GAS_URL + qs);
  if (!r.ok) return [];
  const json = await r.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function _deleteSubscription(id) {
  if (!GAS_URL || !id) return;
  try {
    const body = new URLSearchParams({
      payload: JSON.stringify({ action: 'delete', sheet: 'PushSubscriptions', id }),
    });
    if (GAS_SECRET) body.set('_secret', GAS_SECRET);
    await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  } catch (e) { /* inscrição morta que sobrevive não quebra nada */ }
}

async function _upsertConfig(chave, valor) {
  if (!GAS_URL) return;
  try {
    const body = new URLSearchParams({
      payload: JSON.stringify({ action: 'upsert', sheet: 'Config', data: { chave, valor } }),
    });
    if (GAS_SECRET) body.set('_secret', GAS_SECRET);
    await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  } catch (e) { /* melhor esforço — se falhar, a próxima rodada tenta de novo amanhã */ }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Fail-closed: sem CRON_SECRET configurado, o endpoint fica bloqueado —
  // nunca aberto por padrão (diferente das chaves VAPID, aqui não dá pra
  // simplesmente "funcionar sem" porque manda notificação pra todo mundo).
  if (!CRON_SECRET) {
    return res.status(503).json({ status: 'error', error: 'CRON_SECRET não configurado no servidor' });
  }
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ status: 'error', error: 'Não autorizado' });
  }

  try {
    const configRows = await _readSheet('Config');
    let cfg = { enabled: false, frequency: 'monthly', weekday: 1, dayOfMonth: 1 };
    const cfgRow = configRows.find(r => r.chave === 'hygicare_push_reminder_cfg');
    if (cfgRow && cfgRow.valor) { try { cfg = { ...cfg, ...JSON.parse(cfgRow.valor) }; } catch (e) {} }
    const lastSent = configRows.find(r => r.chave === 'hygicare_push_reminder_last_sent')?.valor || '';

    if (!cfg.enabled) {
      return res.status(200).json({ status: 'ok', sent: false, reason: 'lembrete desativado pelo admin' });
    }

    // Brasília não observa horário de verão desde 2019 — offset fixo -03:00
    const br = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const weekday    = br.getUTCDay();   // 0=domingo ... 6=sábado
    const dayOfMonth = br.getUTCDate();
    const todayKey   = br.toISOString().slice(0, 10); // YYYY-MM-DD (data em Brasília)

    const isDue = cfg.frequency === 'weekly'
      ? weekday === Number(cfg.weekday ?? 1)
      : dayOfMonth === Number(cfg.dayOfMonth ?? 1);

    if (!isDue) {
      return res.status(200).json({ status: 'ok', sent: false, reason: 'hoje não é o dia configurado', todayKey });
    }
    if (lastSent === todayKey) {
      return res.status(200).json({ status: 'ok', sent: false, reason: 'já enviado hoje', todayKey });
    }
    if (!_ensureVapid()) {
      return res.status(503).json({ status: 'error', error: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas no servidor' });
    }

    const [users, subs] = await Promise.all([_readSheet('Usuarios'), _readSheet('PushSubscriptions')]);
    const activeUsernames = new Set(
      users
        .filter(u => u.username && u.active !== false && u.active !== 'false' && u.active !== 'FALSE')
        .map(u => String(u.username).trim().toLowerCase())
    );

    const payload = JSON.stringify({
      title: '🔔 Lembrete — Hygicare Lavanderia',
      body: 'Abra o app pra manter tudo atualizado. É só isso! 😉',
      data: { screen: 'screen-home' },
    });

    // Agrupa as inscrições por usuário (cada um pode ter vários dispositivos)
    const byUser = {};
    for (const s of subs) {
      const uname = String(s.username || '').trim().toLowerCase();
      if (!activeUsernames.has(uname)) continue;
      (byUser[uname] = byUser[uname] || []).push(s);
    }

    let usersNotified = 0, totalSent = 0, totalRemoved = 0;
    await Promise.all(Object.entries(byUser).map(async ([, userSubs]) => {
      let sentForUser = 0;
      await Promise.all(userSubs.map(async (s) => {
        const pushSub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
        try {
          await webpush.sendNotification(pushSub, payload);
          sentForUser++; totalSent++;
        } catch (err) {
          const code = err && err.statusCode;
          if (code === 404 || code === 410) { await _deleteSubscription(s.id); totalRemoved++; }
        }
      }));
      if (sentForUser > 0) usersNotified++;
    }));

    await _upsertConfig('hygicare_push_reminder_last_sent', todayKey);

    return res.status(200).json({ status: 'ok', sent: true, todayKey, activeUsers: activeUsernames.size, usersNotified, totalSent, totalRemoved });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
};
