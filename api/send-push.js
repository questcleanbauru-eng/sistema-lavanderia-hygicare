// Vercel serverless — envia notificações Web Push de verdade (chegam com o
// app fechado). É o único lugar do sistema que roda Node "puro": o Apps
// Script não consegue assinar/criptografar payloads Web Push (VAPID), então
// aqui é onde a lib "web-push" entra.
//
// Não guarda nada: a cada chamada busca as inscrições do usuário na própria
// planilha (aba PushSubscriptions, via o mesmo Apps Script que já serve o
// resto do app) e manda a notificação. Se o endpoint não existir mais
// (404/410 — usuário desinstalou, trocou de navegador etc.) apaga a
// inscrição morta.
//
// Quem chama isto (app.js no cliente, ou o Apps Script num gatilho diário)
// SEMPRE envolve a chamada em try/catch e ignora o resultado — notificação
// nunca pode derrubar o fluxo principal (salvar um relatório, por exemplo).
//
// Variáveis de ambiente no Vercel Dashboard:
//   VAPID_PUBLIC_KEY  — mesma chave pública hardcoded em app.js (não é secreta)
//   VAPID_PRIVATE_KEY — SÓ aqui no servidor, nunca no client
//   VAPID_SUBJECT     — "mailto:algum@email.com" (exigido pelo protocolo push)
//   GAS_URL           — mesma URL do Apps Script usada por /api/proxy.js
//   GAS_SECRET        — mesmo secret usado por /api/proxy.js (opcional)

const webpush = require('web-push');

const VAPID_PUBLIC_KEY  = (process.env.VAPID_PUBLIC_KEY  || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT     = (process.env.VAPID_SUBJECT     || 'mailto:contato@hygicare.com.br').trim();
const GAS_URL           = (process.env.GAS_URL    || '').trim();
const GAS_SECRET        = (process.env.GAS_SECRET || '').trim();
const SHEET_NAME         = 'PushSubscriptions';

let _vapidReady = false;
function _ensureVapid() {
  if (_vapidReady) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  _vapidReady = true;
  return true;
}

async function _readSubscriptions() {
  if (!GAS_URL) return [];
  const qs = GAS_SECRET
    ? `?sheet=${SHEET_NAME}&_secret=${encodeURIComponent(GAS_SECRET)}`
    : `?sheet=${SHEET_NAME}`;
  const r = await fetch(GAS_URL + qs);
  if (!r.ok) return [];
  const json = await r.json();
  return Array.isArray(json.data) ? json.data : [];
}

async function _deleteSubscription(id) {
  if (!GAS_URL || !id) return;
  try {
    const body = new URLSearchParams({
      payload: JSON.stringify({ action: 'delete', sheet: SHEET_NAME, id }),
    });
    if (GAS_SECRET) body.set('_secret', GAS_SECRET);
    await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (e) { /* melhor esforço — uma inscrição morta que sobrevive não quebra nada */ }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', error: 'Método não permitido' });
  }
  if (!_ensureVapid()) {
    return res.status(503).json({ status: 'error', error: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configuradas no servidor' });
  }

  try {
    // req.body já vem parseado (JSON) nas Vercel Functions; fallback manual por segurança
    let body = req.body;
    if (!body || typeof body === 'string') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString() || body || '{}';
      body = JSON.parse(raw);
    }

    const username = String(body.username || '').trim();
    const title    = String(body.title || 'Hygicare Lavanderia').slice(0, 120);
    const msgBody  = String(body.body || '').slice(0, 500);
    const data     = body.data && typeof body.data === 'object' ? body.data : {};
    if (!username) return res.status(400).json({ status: 'error', error: 'Campo "username" obrigatório' });

    const all = await _readSubscriptions();
    const subs = all.filter(s => String(s.username || '').toLowerCase() === username.toLowerCase());
    if (!subs.length) return res.status(200).json({ status: 'ok', sent: 0, removed: 0, reason: 'sem inscrição para este usuário' });

    const payload = JSON.stringify({ title, body: msgBody, data });
    let sent = 0, removed = 0;
    await Promise.all(subs.map(async (s) => {
      const pushSub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(pushSub, payload);
        sent++;
      } catch (err) {
        const code = err && err.statusCode;
        if (code === 404 || code === 410) { await _deleteSubscription(s.id); removed++; }
        // outros erros (ex.: rede) — melhor esforço, não propaga
      }
    }));

    return res.status(200).json({ status: 'ok', sent, removed, total: subs.length });
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
};
