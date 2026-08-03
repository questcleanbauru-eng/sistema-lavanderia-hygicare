// Vercel serverless proxy — encaminha requisições para o Google Apps Script
// evitando restrições de CORS do browser.
// Variáveis de ambiente no Vercel Dashboard:
//   GAS_URL    — URL do Google Apps Script publicado (nunca expor no client)
//   GAS_SECRET — token secreto validado pelo GAS (nunca expor no client)

const GAS_URL    = (process.env.GAS_URL    || '').trim();
const GAS_SECRET = (process.env.GAS_SECRET || '').trim();

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
      // Preserva parâmetros do cliente e injeta o secret
      const clientParams = new URLSearchParams(new URL(req.url, 'http://x').search.slice(1));
      if (GAS_SECRET) clientParams.set('_secret', GAS_SECRET);
      const qs = clientParams.toString();
      const r   = await fetch(qs ? GAS_URL + '?' + qs : GAS_URL);
      const txt = await r.text();
      return res.status(r.status).send(txt);
    }

    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      // Injeta _secret como parâmetro adicional no body (form-urlencoded)
      let body = Buffer.concat(chunks).toString();
      if (GAS_SECRET) body += '&_secret=' + encodeURIComponent(GAS_SECRET);

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
