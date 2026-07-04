// Vercel serverless proxy — encaminha requisições para o Google Apps Script
// evitando restrições de CORS do browser.
// A URL do GAS é lida de variável de ambiente (GAS_URL) configurada no Vercel Dashboard
// — nunca hardcode aqui para não expor o endpoint publicamente.

const GAS_URL = (process.env.GAS_URL || '').trim();

module.exports = async function handler(req, res) {
  if (!GAS_URL) {
    return res.status(503).json({ status: 'error', error: 'GAS_URL não configurada no servidor' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const qs  = new URL(req.url, 'http://x').search; // preserva ?sheet=Clientes etc.
      const r   = await fetch(GAS_URL + qs);
      const txt = await r.text();
      return res.status(r.status).send(txt);
    }

    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();

      const r   = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const txt = await r.text();
      return res.status(r.status).send(txt);
    }

    return res.status(405).json({ status: 'error', error: 'Método não permitido' });
  } catch (err) {
    return res.status(502).json({ status: 'error', error: err.message });
  }
};
