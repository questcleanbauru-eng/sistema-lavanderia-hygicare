// Vercel Cron — lembrete mensal pra todo mundo (cada usuário + o admin)
// abrir o app e manter tudo atualizado. Dispara 1x por mês (agendado em
// vercel.json) e usa o mesmo mecanismo Web Push de /api/send-push.js, só
// que em massa: busca os usuários ativos e as inscrições na planilha e
// manda a notificação pra todo mundo que já ativou push em algum
// dispositivo — não precisa de lista separada pra admin, o admin já é um
// usuário normal na aba Usuarios e cai no mesmo laço.
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
  if (!_ensureVapid()) {
    return res.status(503).json({ status: 'error', error: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas no servidor' });
  }

  try {
    const [users, subs] = await Promise.all([_readSheet('Usuarios'), _readSheet('PushSubscriptions')]);
    const activeUsernames = new Set(
      users
        .filter(u => u.username && u.active !== false && u.active !== 'false' && u.active !== 'FALSE')
        .map(u => String(u.username).trim().toLowerCase())
    );

    const payload = JSON.stringify({
      title: '🔔 Lembrete mensal — Hygicare Lavanderia',
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

    return res.status(200).json({ status: 'ok', activeUsers: activeUsernames.size, usersNotified, totalSent, totalRemoved });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
};
