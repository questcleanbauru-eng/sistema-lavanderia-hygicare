// ============================================================
// HYGICARE LAVANDERIA — Google Apps Script API  v5
// ============================================================
// INSTRUÇÕES DE INSTALAÇÃO:
//   1. Abra sua planilha Google Sheets
//   2. Menu: Extensões > Apps Script
//   3. Apague todo o código existente
//   4. Cole TODO este arquivo
//   5. Clique em "Salvar" (ícone de disquete)
//   6. Clique em "Implantar" > "Nova implantação"
//        — OU —
//      "Implantar" > "Gerenciar implantações" > ✏️ Editar
//        > "Nova versão" > "Implantar"  (mantém a mesma URL)
//   7. Tipo: "Aplicativo da Web"
//   8. Executar como: "Eu"
//   9. Quem pode acessar: "Qualquer pessoa"
//  10. Copie a URL gerada e cole no Painel Admin do sistema
// ============================================================

// ── Cabeçalhos canônicos por aba ─────────────────────────────
// Esta é a ÚNICA fonte da verdade para estrutura das colunas.
// Se uma aba já existe mas está faltando alguma coluna,
// a função ensureHeaders() adiciona automaticamente ao final.
const HEADERS = {
  Clientes:       ['id','name','city','seller','email_client','send_client',
                   'email_seller','send_seller','price_kg','created_at'],
  Maquinas:       ['id','name','client_id','capacity','created_at'],
  Processos:      ['id','name','machine_id','capacity','active','created_at'],
  Registros:      ['id','client_id','machine_id','process_id','executed',
                   'canceled','capacity','total','date_start','date_end',
                   'price_kg','created_at','synced_at','maintenance'],
  Usuarios:       ['id','name','username','password','role','email',
                   'active','sellerName','manager','permissions','sellers_access','created_at'],
  Vazoes:         ['id','machine_id','name','unit','created_at'],
  VazaoRegistros:  ['id','date','client_id','machine_id','vazao_id',
                    'vazao_name','vazao_unit','value','user','created_at'],
  Receitas:        ['id','client_id','name','date','version','all_machines','machine_info','created_by','status',
                    'replaces_id','edit_notes','rejection_notes',
                    'approved_by','approved_at','steps','created_at'],
  ReceitaProdutos: ['id','name','category','created_at'],
  ClienteNotas:    ['id','client_id','type','title','content','date','created_by','created_at','synced_at','scheduled_date'],
  Config:          ['chave','valor'],
  AppConfig:       ['id','key','active','message','updated_at'],
};

// ── Resposta padrão ──────────────────────────────────────────
function respond(data, status) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status || 'ok', data }))
    .setMimeType(ContentService.MimeType.JSON);
}
function respondError(msg, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', error: msg, code: code || 400 }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Keep-alive: configure um gatilho de tempo a cada 10 min ─
function keepAlive() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
}

// ── Teste de e-mail — execute esta função direto no editor ──
// Passos: no Apps Script, selecione "testEmail" no dropdown
// de funções e clique em ▶ Executar. Verifique o e-mail e
// o Log de execução para confirmar o resultado.
function testEmail() {
  const toEmail = getConfig('notification_email');
  if (!toEmail) {
    Logger.log('❌ notification_email não configurado na aba Config.');
    Logger.log('   Adicione uma linha: | notification_email | seu@email.com |');
    return;
  }
  Logger.log('📧 Enviando e-mail de teste para: ' + toEmail);
  try {
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
    MailApp.sendEmail({
      to: toEmail,
      subject: '[Hygicare] ✅ Teste de Notificação — Sistema funcionando!',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:600px;">'
        + '<div style="background:#1e3a8a;padding:16px 20px;border-radius:8px 8px 0 0;">'
        + '<h2 style="color:#fff;margin:0;font-size:18px;">Hygicare Lavanderia</h2>'
        + '<p style="color:#93c5fd;margin:4px 0 0;font-size:13px;">Sistema de Notificações</p>'
        + '</div>'
        + '<div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">'
        + '<h3 style="margin:0 0 8px;color:#16a34a;">✅ E-mail de teste enviado com sucesso!</h3>'
        + '<p style="color:#555;font-size:14px;margin:0 0 12px;">As notificações automáticas do sistema estão funcionando corretamente.</p>'
        + '<table style="border-collapse:collapse;font-size:13px;">'
        + '<tr><td style="padding:4px 10px 4px 0;color:#555;font-weight:600;">Planilha</td><td style="color:#222;">' + SpreadsheetApp.getActiveSpreadsheet().getName() + '</td></tr>'
        + '<tr><td style="padding:4px 10px 4px 0;color:#555;font-weight:600;">Destinatário</td><td style="color:#222;">' + toEmail + '</td></tr>'
        + '<tr><td style="padding:4px 10px 4px 0;color:#555;font-weight:600;">Data/Hora</td><td style="color:#222;">' + now + '</td></tr>'
        + '</table>'
        + '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">'
        + '<p style="margin:0;font-size:12px;color:#94a3b8;">🕐 ' + now + ' &nbsp;|&nbsp; Hygicare Sistema de Lavanderia</p>'
        + '</div></div>'
    });
    Logger.log('✅ E-mail enviado com sucesso para: ' + toEmail);
  } catch(err) {
    Logger.log('❌ Erro ao enviar e-mail: ' + err.message);
    Logger.log('   Verifique se o Apps Script tem permissão para enviar e-mails (MailApp).');
  }
}

// ── Obter ou criar aba com cabeçalhos ────────────────────────
function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const headers = HEADERS[name];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#1e3a8a')
        .setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

// ── Garantir que TODAS as colunas canônicas existem na aba ──
// Adiciona colunas faltantes ao final (sem mover as existentes).
// Retorna os headers REAIS da planilha após a verificação.
function ensureHeaders(sheet, sheetName) {
  const canonical = HEADERS[sheetName];
  if (!canonical) return null;

  const lastCol  = sheet.getLastColumn();
  const existing = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
    : [];

  const missing = canonical.filter(h => !existing.includes(h));
  if (missing.length > 0) {
    let nextCol = existing.length + 1;
    missing.forEach(header => {
      sheet.getRange(1, nextCol).setValue(header);
      sheet.getRange(1, nextCol)
        .setFontWeight('bold')
        .setBackground('#1e3a8a')
        .setFontColor('#ffffff');
      nextCol++;
    });
    Logger.log('ensureHeaders [' + sheetName + ']: adicionadas → ' + missing.join(', '));
  }

  // Retorna a lista real de headers (incluindo os recém-adicionados)
  const totalCols = sheet.getLastColumn();
  if (totalCols === 0) return canonical;
  return sheet.getRange(1, 1, 1, totalCols).getValues()[0].map(String);
}

// ── Converter linha para objeto ──────────────────────────────
function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

// ── Converter objeto para linha (na ordem dos headers reais) ─
function objToRow(headers, obj) {
  return headers.map(h => (obj[h] !== undefined && obj[h] !== null) ? obj[h] : '');
}

// ── Ler todos os dados de uma aba ────────────────────────────
function readSheet(sheetName) {
  const sheet = getOrCreateSheet(sheetName);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0].map(String);
  return data.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined))
    .map(row => rowToObj(headers, row));
}

// ── Encontrar número da linha pelo id ────────────────────────
function findRowById(sheet, id) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return -1;
  const idIdx = data[0].map(String).indexOf('id');
  if (idIdx < 0) return -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(id)) return i + 1; // 1-based
  }
  return -1;
}

// ── Ler valor da aba Config por chave ───────────────────────
// Busca a coluna 'valor' pelo cabeçalho, não pelo índice fixo,
// para funcionar mesmo que existam colunas extras na planilha.
function getConfig(key) {
  try {
    const sheet = getOrCreateSheet('Config');
    const data  = sheet.getDataRange().getValues();
    if (data.length < 1) return null;
    const headers  = data[0].map(String);
    const chaveIdx = headers.indexOf('chave');
    // Aceita tanto 'valor' quanto qualquer outra coluna que contenha 'valor'
    let valorIdx = headers.indexOf('valor');
    if (valorIdx < 0) {
      // fallback: última coluna que tenha "valor" no nome
      valorIdx = headers.reduce((found, h, i) => h.toLowerCase().includes('valor') ? i : found, -1);
    }
    if (chaveIdx < 0 || valorIdx < 0) return null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][chaveIdx]) === key) {
        const v = data[i][valorIdx];
        return (v !== null && v !== undefined && v !== '') ? String(v) : null;
      }
    }
  } catch(e) {
    Logger.log('getConfig error: ' + e.message);
  }
  return null;
}

// ── Rótulos amigáveis para as abas ──────────────────────────
const SHEET_LABELS = {
  Clientes:       'Cliente',
  Maquinas:       'Máquina',
  Processos:      'Processo',
  Registros:      'Registro de Lavagem',
  Usuarios:       'Usuário',
  Vazoes:         'Vazão',
  VazaoRegistros:  'Leitura de Vazão',
  Receitas:        'Receita',
  ReceitaProdutos: 'Produto de Receita',
  ClienteNotas:    'Nota de Cliente',
  Config:          'Configuração',
  AppConfig:       'Configuração do App',
};

// ── Enviar e-mail de notificação ─────────────────────────────
// Lê o e-mail de destino da chave "notification_email" na aba Config.
// Se não estiver configurado, não faz nada (sem erro).
function sendNotification(action, sheetName, payload, actor) {
  try {
    const toEmail = getConfig('notification_email');
    if (!toEmail) return; // notificações não configuradas

    // Aba Config e Usuarios (senhas) não disparam notificação
    if (sheetName === 'Config' || sheetName === 'Usuarios') return;

    // Verificar se notificações para esta aba estão habilitadas
    const disabledKey = 'notif_disable_' + sheetName.toLowerCase();
    if (getConfig(disabledKey) === 'true') return;

    const actionLabels = {
      insert: '✅ Novo registro criado',
      update: '✏️ Registro atualizado',
      delete: '🗑️ Registro excluído',
      upsert: '🔄 Sincronização (upsert)',
    };
    const actionLabel  = actionLabels[action] || action;
    const sheetLabel   = SHEET_LABELS[sheetName] || sheetName;
    const now          = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
    const actorLabel   = actor ? (' por <strong>' + actor + '</strong>') : '';

    // ── Montar tabela de dados ────────────────────────────
    let dataHtml = '';
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const skip = ['password']; // campos sensíveis — nunca enviar por e-mail
      dataHtml = '<table style="border-collapse:collapse;font-size:13px;margin-top:8px;">';
      Object.entries(payload).forEach(([k, v]) => {
        if (skip.includes(k)) return;
        const val = (v === null || v === undefined || v === '') ? '<em style="color:#999">—</em>' : String(v);
        dataHtml += '<tr>'
          + '<td style="padding:4px 10px 4px 0;color:#555;white-space:nowrap;font-weight:600;">' + k + '</td>'
          + '<td style="padding:4px 0;color:#222;">' + val + '</td>'
          + '</tr>';
      });
      dataHtml += '</table>';
    } else if (Array.isArray(payload)) {
      dataHtml = '<p style="color:#555;font-size:13px;">' + payload.length + ' item(s) afetado(s).</p>';
    }

    const subject = '[Hygicare] ' + actionLabel + ' — ' + sheetLabel;
    const body = '<div style="font-family:Arial,sans-serif;max-width:600px;">'
      + '<div style="background:#1e3a8a;padding:16px 20px;border-radius:8px 8px 0 0;">'
      + '<h2 style="color:#fff;margin:0;font-size:18px;">Hygicare Lavanderia</h2>'
      + '<p style="color:#93c5fd;margin:4px 0 0;font-size:13px;">Sistema de Notificações</p>'
      + '</div>'
      + '<div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">'
      + '<h3 style="margin:0 0 4px;color:#1e3a8a;">' + actionLabel + '</h3>'
      + '<p style="margin:0 0 12px;color:#555;font-size:14px;">'
      + 'Módulo: <strong>' + sheetLabel + '</strong>' + actorLabel
      + '</p>'
      + dataHtml
      + '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">'
      + '<p style="margin:0;font-size:12px;color:#94a3b8;">🕐 ' + now + ' &nbsp;|&nbsp; Hygicare Sistema de Lavanderia</p>'
      + '</div></div>';

    MailApp.sendEmail({ to: toEmail, subject: subject, htmlBody: body });
  } catch(err) {
    // Nunca deixar falha de e-mail interromper a operação principal
    Logger.log('sendNotification error: ' + err.message);
  }
}

// ── Gerar próximo ID (max atual + 1) ────────────────────────
function nextId(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 1;
  const idIdx = data[0].map(String).indexOf('id');
  if (idIdx < 0) return 1;
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const v = parseInt(data[i][idIdx]);
    if (!isNaN(v) && v > max) max = v;
  }
  return max + 1;
}

// ============================================================
// GET — Leitura + Ações especiais (?action=test-email)
// ?sheet=Clientes          → retorna uma aba
// ?sheet=all               → retorna todas as abas de uma vez
// ?action=test-email       → envia e-mail de teste
// ============================================================
function doGet(e) {
  try {
    const params = e.parameter || {};

    // Teste de listagem de PDFs via GET: ?action=list-pdfs
    if (params.action === 'list-pdfs') {
      return respondListFolderPdfs();
    }

    // Teste de e-mail via GET: ?action=test-email
    if (params.action === 'test-email') {
      const toEmail = getConfig('notification_email');
      if (!toEmail) return respondError('notification_email não configurado na aba Config.');
      try {
        const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
        MailApp.sendEmail({
          to: toEmail,
          subject: '[Hygicare] ✅ Teste de Notificação — Sistema funcionando!',
          htmlBody: '<div style="font-family:Arial,sans-serif;max-width:600px;">'
            + '<div style="background:#1e3a8a;padding:16px 20px;border-radius:8px 8px 0 0;">'
            + '<h2 style="color:#fff;margin:0;font-size:18px;">Hygicare Lavanderia</h2>'
            + '<p style="color:#93c5fd;margin:4px 0 0;font-size:13px;">Sistema de Notificações</p>'
            + '</div>'
            + '<div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">'
            + '<h3 style="margin:0 0 8px;color:#16a34a;">✅ E-mail de teste enviado com sucesso!</h3>'
            + '<p style="color:#555;font-size:14px;margin:0 0 12px;">As notificações automáticas do sistema estão funcionando corretamente.</p>'
            + '<table style="border-collapse:collapse;font-size:13px;">'
            + '<tr><td style="padding:4px 10px 4px 0;color:#555;font-weight:600;">Planilha</td><td>' + SpreadsheetApp.getActiveSpreadsheet().getName() + '</td></tr>'
            + '<tr><td style="padding:4px 10px 4px 0;color:#555;font-weight:600;">Destinatário</td><td>' + toEmail + '</td></tr>'
            + '<tr><td style="padding:4px 10px 4px 0;color:#555;font-weight:600;">Data/Hora</td><td>' + now + '</td></tr>'
            + '</table>'
            + '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;">'
            + '<p style="margin:0;font-size:12px;color:#94a3b8;">🕐 ' + now + ' &nbsp;|&nbsp; Hygicare Sistema de Lavanderia</p>'
            + '</div></div>'
        });
        return respond({ sent: true, to: toEmail });
      } catch(err) {
        return respondError('Erro ao enviar e-mail: ' + err.message);
      }
    }

    // Leitura de abas
    const sheetParam = params.sheet || 'Clientes';
    if (sheetParam === 'all') {
      const result = {};
      Object.keys(HEADERS).forEach(name => {
        try { result[name] = readSheet(name); }
        catch(err) { result[name] = []; }
      });
      return respond(result);
    }
    return respond(readSheet(sheetParam));

  } catch(err) {
    return respondError(err.message);
  }
}

// ============================================================
// POST — Inserir / Atualizar / Excluir / Upsert
// Dados chegam via URLSearchParams: e.parameter.payload = JSON
// { action, sheet, data, id }
// action: 'insert' | 'update' | 'delete' | 'upsert'
// ============================================================
function doPost(e) {
  try {
    // ── Ler o payload ─────────────────────────────────────
    // O app envia via URLSearchParams (form-urlencoded) com a chave "payload"
    // para evitar o redirect 302 que o GAS faz com application/json.
    let body;
    try {
      const raw = (e.parameter && e.parameter.payload)
        ? e.parameter.payload
        : (e.postData ? e.postData.contents : '{}');
      body = JSON.parse(raw);
    } catch(err) {
      return respondError('JSON inválido: ' + err.message);
    }

    const { action, sheet: sheetName, data, id, actor } = body;

    // ── ENVIAR RELATÓRIO POR E-MAIL COM PDF ──────────────
    // Deve ser verificado ANTES do check de sheetName, pois não usa aba
    if (action === 'sendReportEmail') {
      return respondSendReportEmail(body);
    }

    // ── SALVAR PDF NO DRIVE ───────────────────────────────
    if (action === 'savePdfToDrive') {
      return respondSavePdfToDrive(body);
    }

    // -- ENVIAR E-MAIL COM PDF JA SALVO NO DRIVE --------
    if (action === 'sendEmailWithPdf') {
      return respondSendEmailWithPdf(body);
    }

    // ── LISTAR PDFs DA PASTA NO DRIVE ─────────────────────
    if (action === 'listFolderPdfs') {
      return respondListFolderPdfs();
    }

    // ── ENVIAR RELATÓRIO NO CORPO DO E-MAIL (sem PDF) ─────
    if (action === 'sendProductionReportBody') {
      return respondSendProductionReportBody(body);
    }

    // ── CONFIGURAR DISPARO MENSAL ─────────────────────────
    if (action === 'setupMonthlyTriggers') {
      try { setupMonthlyTriggers(); return respond({ ok: true, message: 'Gatilho mensal configurado para dia 1 às 8h' }); }
      catch(e) { return respondError('Erro ao configurar gatilho: ' + e.message); }
    }

    if (!sheetName) return respondError('Campo "sheet" obrigatório');

    const sheet = getOrCreateSheet(sheetName);
    // ensureHeaders garante que todas as colunas canônicas existem
    // e retorna os headers REAIS da planilha (na ordem real das colunas)
    const headers = ensureHeaders(sheet, sheetName) || Object.keys(data || {});

    // ── INSERT ────────────────────────────────────────────
    if (action === 'insert') {
      if (!data) return respondError('Campo "data" obrigatório para insert');
      const items    = Array.isArray(data) ? data : [data];
      const inserted = [];
      items.forEach(item => {
        if (!item.id)         item.id         = nextId(sheet);
        if (!item.created_at) item.created_at = new Date().toISOString();
        sheet.appendRow(objToRow(headers, item));
        inserted.push(item.id);
      });
      sendNotification('insert', sheetName, Array.isArray(data) ? data : data, actor);
      // Para compatibilidade com o frontend, quando um único item é inserido,
      // retornar também `id` no objeto `data` (assim o frontend lê `res.data.id`).
      const singleId = inserted.length === 1 ? inserted[0] : null;
      return respond({ inserted, count: inserted.length, id: singleId });
    }

    // ── UPDATE (PATCH) ────────────────────────────────────
    if (action === 'update') {
      if (!id)   return respondError('Campo "id" obrigatório para update');
      if (!data) return respondError('Campo "data" obrigatório para update');
      const rowNum = findRowById(sheet, id);
      if (rowNum < 0) return respondError('ID ' + id + ' não encontrado', 404);
      const currentRow = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
      const currentObj = rowToObj(headers, currentRow);
      const merged     = { ...currentObj, ...data, id: currentObj.id };
      sheet.getRange(rowNum, 1, 1, headers.length).setValues([objToRow(headers, merged)]);
      sendNotification('update', sheetName, merged, actor);
      return respond({ updated: id });
    }

    // ── DELETE ────────────────────────────────────────────
    if (action === 'delete') {
      if (!id) return respondError('Campo "id" obrigatório para delete');
      const rowNum = findRowById(sheet, id);
      if (rowNum < 0) return respondError('ID ' + id + ' não encontrado', 404);
      sheet.deleteRow(rowNum);
      sendNotification('delete', sheetName, { id }, actor);
      return respond({ deleted: id });
    }

    // ── UPSERT ────────────────────────────────────────────
    if (action === 'upsert') {
      if (!data) return respondError('Campo "data" obrigatório para upsert');
      const items   = Array.isArray(data) ? data : [data];
      const results = [];

      // Aba Config usa 'chave' como chave primária (não 'id')
      const isConfig = sheetName === 'Config';

      items.forEach(item => {
        if (!item.created_at && !isConfig) item.created_at = new Date().toISOString();

        // Config: upsert por 'chave' — deduplica linhas com mesma chave
        if (isConfig && item.chave) {
          const allData  = sheet.getDataRange().getValues();
          const chaveIdx = allData.length > 0 ? allData[0].map(String).indexOf('chave') : -1;
          const matchRows = []; // todos os números de linha (1-based) com essa chave
          if (chaveIdx >= 0) {
            for (let i = 1; i < allData.length; i++) {
              if (String(allData[i][chaveIdx]) === String(item.chave)) matchRows.push(i + 1);
            }
          }
          if (matchRows.length > 0) {
            // Atualiza a primeira linha encontrada
            sheet.getRange(matchRows[0], 1, 1, headers.length).setValues([objToRow(headers, item)]);
            // Remove duplicatas em ordem reversa (evita deslocamento de índices)
            for (let d = matchRows.length - 1; d >= 1; d--) sheet.deleteRow(matchRows[d]);
            results.push({ chave: item.chave, op: 'updated' });
          } else {
            sheet.appendRow(objToRow(headers, item));
            results.push({ chave: item.chave, op: 'inserted' });
          }
          return;
        }

        // Demais abas: upsert por 'id'
        if (item.id) {
          const rowNum = findRowById(sheet, item.id);
          if (rowNum > 0) {
            const currentRow = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
            const merged     = { ...rowToObj(headers, currentRow), ...item };
            sheet.getRange(rowNum, 1, 1, headers.length).setValues([objToRow(headers, merged)]);
            results.push({ id: item.id, op: 'updated' });
            return;
          }
        }
        if (!item.id) item.id = nextId(sheet);
        sheet.appendRow(objToRow(headers, item));
        results.push({ id: item.id, op: 'inserted' });
      });
      sendNotification('upsert', sheetName, items, actor);
      return respond({ results, count: results.length });
    }

    return respondError('Ação desconhecida: ' + action);

  } catch(err) {
    return respondError(err.message);
  }
}

// ============================================================
// ENVIAR RELATÓRIO POR E-MAIL COM PDF EM ANEXO
// ============================================================
// Payload esperado:
// {
//   action: 'sendReportEmail',
//   to: 'destinatario@email.com',     ← obrigatório
//   clientName: 'Nome do Cliente',
//   period: 'Jan/2026 – Mar/2026',
//   totalKg: 1234.5,
//   totalRows: 10,
//   htmlContent: '<html>...</html>',  ← HTML completo do relatório
//   senderName: 'Bruno',              ← opcional
// }
function respondSendReportEmail(body) {
  const to          = (body.to || '').trim();
  const clientName  = body.clientName  || 'Cliente';
  const period      = body.period      || '';
  const totalKg     = parseFloat(body.totalKg  || 0).toFixed(2);
  const totalRows   = body.totalRows   || 0;
  const rows        = body.rows        || [];
  const senderName  = body.senderName  || 'Equipe Hygicare';

  if (!to) return respondError('E-mail de destino não informado.');

  const subject = '[Hygicare] Relatório de Lavanderia — ' + clientName + ' (' + period + ')';

  // ── Montar tabela de linhas para o PDF ──────────────────
  let rowsHtml = '';
  const byMachine = {};
  rows.forEach(function(r) {
    if (!byMachine[r.machineName]) byMachine[r.machineName] = [];
    byMachine[r.machineName].push(r);
  });

  Object.keys(byMachine).forEach(function(mName) {
    const mRows = byMachine[mName];
    const mTotal = mRows.reduce(function(s, r) { return s + parseFloat(r.total || 0); }, 0);
    rowsHtml += '<tr style="background:#dbeafe"><td colspan="5" style="padding:7px 10px;font-weight:700;color:#1e40af;font-size:0.82rem;border:1px solid #bfdbfe">🔧 ' + mName + ' — ' + mTotal.toFixed(2) + ' kg</td></tr>';
    mRows.forEach(function(r) {
      rowsHtml +=
        '<tr>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0">' + r.procName + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">' + r.executed + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">' + r.canceled + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">' + r.capacity + ' kg</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#15803d">' + parseFloat(r.total || 0).toFixed(2) + ' kg</td>' +
        '</tr>';
    });
  });

  // ── HTML do relatório para PDF ──────────────────────────
  const reportHtml =
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<title>Relatório — ' + clientName + '</title>' +
    '<style>body{font-family:Arial,sans-serif;color:#1e293b;padding:24px;font-size:13px}' +
    'h1{margin:0 0 4px;font-size:1.4rem;color:#1e3a8a}' +
    '.sub{color:#64748b;font-size:0.82rem;margin-bottom:16px}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:20px}' +
    'thead th{background:#1e3a8a;color:#fff;padding:7px 10px;text-align:left;font-size:0.78rem}' +
    '.total-row td{background:#dcfce7;font-weight:700;color:#15803d;border:1px solid #86efac;padding:7px 10px}' +
    '</style></head><body>' +
    '<h1>' + clientName.toUpperCase() + '</h1>' +
    '<div class="sub">Hygicare Lavanderia &nbsp;|&nbsp; Período: ' + period + ' &nbsp;|&nbsp; Gerado em: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + '</div>' +
    '<table><thead><tr>' +
    '<th>Processo</th><th style="text-align:center">Exec.</th><th style="text-align:center">Cancel.</th><th style="text-align:center">Cap.</th><th style="text-align:right">Total</th>' +
    '</tr></thead><tbody>' + rowsHtml +
    '<tr class="total-row"><td colspan="4">TOTAL GERAL</td><td style="text-align:right">' + totalKg + ' kg</td></tr>' +
    '</tbody></table></body></html>';

  // ── Corpo do e-mail ─────────────────────────────────────
  const emailHtml =
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
    '<div style="background:#1e3a8a;padding:20px 24px;border-radius:8px 8px 0 0">' +
      '<h2 style="color:#fff;margin:0;font-size:1.1rem">🧺 Hygicare Lavanderia</h2>' +
      '<p style="color:#93c5fd;margin:4px 0 0;font-size:0.82rem">Relatório de processamento</p>' +
    '</div>' +
    '<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">' +
      '<p style="margin:0 0 14px">Olá,<br>Segue em <strong>anexo</strong> o relatório de lavanderia.</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">' +
        '<tr style="background:#dbeafe"><td style="padding:8px 12px;font-weight:700;color:#1e40af;border:1px solid #bfdbfe">👤 Cliente</td><td style="padding:8px 12px;border:1px solid #bfdbfe">' + clientName + '</td></tr>' +
        '<tr><td style="padding:8px 12px;font-weight:700;color:#1e40af;border:1px solid #bfdbfe">📅 Período</td><td style="padding:8px 12px;border:1px solid #bfdbfe">' + period + '</td></tr>' +
        '<tr style="background:#dbeafe"><td style="padding:8px 12px;font-weight:700;color:#1e40af;border:1px solid #bfdbfe">⚖️ Total</td><td style="padding:8px 12px;border:1px solid #bfdbfe">' + totalKg + ' kg</td></tr>' +
        '<tr><td style="padding:8px 12px;font-weight:700;color:#1e40af;border:1px solid #bfdbfe">📋 Processos</td><td style="padding:8px 12px;border:1px solid #bfdbfe">' + totalRows + ' linha(s)</td></tr>' +
      '</table>' +
      '<p style="color:#64748b;font-size:0.82rem;margin:0">Atenciosamente,<br><strong>' + senderName + '</strong></p>' +
    '</div></div>';

  // ── Gerar PDF via Google Drive ──────────────────────────
  let pdfBlob = null;
  let hasPdf  = false;
  try {
    const tempFile = DriveApp.createFile(
      'relatorio_' + Date.now() + '.html',
      reportHtml,
      MimeType.HTML
    );
    pdfBlob = tempFile.getAs(MimeType.PDF);
    pdfBlob.setName('Relatorio_' + clientName.replace(/[^a-zA-Z0-9]/g,'_') + '_' + period.replace(/[^a-zA-Z0-9]/g,'_') + '.pdf');
    tempFile.setTrashed(true);
    hasPdf = true;
  } catch (err) {
    Logger.log('Erro ao gerar PDF: ' + err.message);
  }

  const mailOptions = {
    to:       to,
    subject:  subject,
    htmlBody: emailHtml,
    name:     'Hygicare Lavanderia',
  };
  if (pdfBlob) mailOptions.attachments = [pdfBlob];

  MailApp.sendEmail(mailOptions);

  return respond({
    ok:     true,
    hasPdf: hasPdf,
    to:     to,
    message: hasPdf
      ? 'E-mail enviado para ' + to + ' com PDF em anexo.'
      : 'E-mail enviado para ' + to + ' (PDF não gerado — verifique permissões do Drive).',
  });
}

// ============================================================
// HELPER: montar HTML do relat�rio internamente a partir de rows[]
// ============================================================
function buildReportHtml(clientName, period, totalKg, rows) {
  var byMachine = {};
  rows.forEach(function(r) {
    if (!byMachine[r.machineName]) byMachine[r.machineName] = [];
    byMachine[r.machineName].push(r);
  });

  var rowsHtml = '';
  Object.keys(byMachine).forEach(function(mName) {
    var mRows = byMachine[mName];
    var mTotal = mRows.reduce(function(s, r) { return s + parseFloat(r.total || 0); }, 0);
    rowsHtml += '<tr style="background:#dbeafe"><td colspan="5" style="padding:7px 10px;font-weight:700;color:#1e40af;font-size:0.82rem;border:1px solid #bfdbfe">&#x1F527; ' + mName + ' &mdash; ' + mTotal.toFixed(2) + ' kg</td></tr>';
    mRows.forEach(function(r) {
      rowsHtml +=
        '<tr>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0">' + r.procName + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">' + r.executed + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">' + r.canceled + '</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:center">' + r.capacity + ' kg</td>' +
        '<td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:#15803d">' + parseFloat(r.total || 0).toFixed(2) + ' kg</td>' +
        '</tr>';
    });
  });

  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<title>Relat�rio � ' + clientName + '</title>' +
    '<style>body{font-family:Arial,sans-serif;color:#1e293b;padding:24px;font-size:13px}' +
    'h1{margin:0 0 4px;font-size:1.4rem;color:#1e3a8a}' +
    '.sub{color:#64748b;font-size:0.82rem;margin-bottom:16px}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:20px}' +
    'thead th{background:#1e3a8a;color:#fff;padding:7px 10px;text-align:left;font-size:0.78rem}' +
    '.total-row td{background:#dcfce7;font-weight:700;color:#15803d;border:1px solid #86efac;padding:7px 10px}' +
    '</style></head><body>' +
    '<h1>' + clientName.toUpperCase() + '</h1>' +
    '<div class="sub">Hygicare Lavanderia &nbsp;|&nbsp; Per�odo: ' + period + ' &nbsp;|&nbsp; Gerado em: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + '</div>' +
    '<table><thead><tr>' +
    '<th>Processo</th><th style="text-align:center">Exec.</th><th style="text-align:center">Cancel.</th><th style="text-align:center">Cap.</th><th style="text-align:right">Total</th>' +
    '</tr></thead><tbody>' + rowsHtml +
    '<tr class="total-row"><td colspan="4">TOTAL GERAL</td><td style="text-align:right">' + totalKg + ' kg</td></tr>' +
    '</tbody></table></body></html>';
}

// ============================================================
// SALVAR PDF NO DRIVE (sem enviar e-mail imediatamente)
// ============================================================
// Payload: { action:'savePdfToDrive', clientName, period, totalKg, rows:[{machineName,procName,executed,canceled,capacity,total}] }
// Retorna: { ok, fileId, fileUrl, name }
// O arquivo fica na pasta "Hygicare Relatorios" no Google Drive.
function respondSavePdfToDrive(body) {
  var clientName = body.clientName || 'Cliente';
  var period     = body.period     || '';
  var totalKg    = parseFloat(body.totalKg || 0).toFixed(2);
  var rows       = body.rows       || [];

  var safeName = 'Relatorio_' + clientName.replace(/[^a-zA-Z0-9]/g, '_') + '_' + period.replace(/[^a-zA-Z0-9]/g, '_');
  var reportHtml = buildReportHtml(clientName, period, totalKg, rows);

  // Pasta "Hygicare Relatorios" no Drive (cria automaticamente se n�o existir)
  var folders = DriveApp.getFoldersByName('Hygicare Relatorios');
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Hygicare Relatorios');

  var fileId = null, fileUrl = null;

  try {
    var tempHtml = DriveApp.createFile(safeName + '_tmp.html', reportHtml, MimeType.HTML);
    var pdfBlob  = tempHtml.getAs(MimeType.PDF);
    pdfBlob.setName(safeName + '.pdf');
    var pdfFile  = folder.createFile(pdfBlob);
    tempHtml.setTrashed(true);
    fileId  = pdfFile.getId();
    fileUrl = pdfFile.getUrl();
    // Tornar acess�vel por link (n�o exige login para baixar via export link)
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(err) {
    return respondError('Falha ao gerar PDF: ' + err.message);
  }

  var downloadUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;
  return respond({ ok: true, fileId: fileId, fileUrl: fileUrl, downloadUrl: downloadUrl, name: safeName + '.pdf' });
}

// ============================================================
// ENVIAR E-MAIL COM PDF J� SALVO NO DRIVE
// ============================================================
// Payload: { action:'sendEmailWithPdf', fileId, to, clientName, period, totalKg, senderName }
// Retorna: { ok, message }
function respondSendEmailWithPdf(body) {
  var fileId     = (body.fileId     || '').trim();
  var to         = (body.to         || '').trim();
  var clientName = body.clientName  || 'Cliente';
  var period     = body.period      || '';
  var totalKg    = parseFloat(body.totalKg || 0).toFixed(2);
  var senderName = body.senderName  || 'Equipe Hygicare';

  if (!fileId) return respondError('fileId n�o informado.');
  if (!to)     return respondError('E-mail de destino n�o informado.');

  var subject = '[Hygicare] Relat�rio de Lavanderia � ' + clientName + ' (' + period + ')';

  var emailHtml =
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
    '<div style="background:#1e3a8a;padding:20px 24px;border-radius:8px 8px 0 0">' +
      '<h2 style="color:#fff;margin:0;font-size:1.1rem">&#x1F9FA; Hygicare Lavanderia</h2>' +
      '<p style="color:#93c5fd;margin:4px 0 0;font-size:0.82rem">Relat�rio de processamento</p>' +
    '</div>' +
    '<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">' +
      '<p style="margin:0 0 14px">Ol�,<br>Segue em <strong>anexo</strong> o relat�rio de lavanderia.</p>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">' +
        '<tr style="background:#dbeafe"><td style="padding:8px 12px;font-weight:700;color:#1e40af;border:1px solid #bfdbfe">&#x1F464; Cliente</td><td style="padding:8px 12px;border:1px solid #bfdbfe">' + clientName + '</td></tr>' +
        '<tr><td style="padding:8px 12px;font-weight:700;color:#1e40af;border:1px solid #bfdbfe">&#x1F4C5; Per�odo</td><td style="padding:8px 12px;border:1px solid #bfdbfe">' + period + '</td></tr>' +
        '<tr style="background:#dbeafe"><td style="padding:8px 12px;font-weight:700;color:#1e40af;border:1px solid #bfdbfe">&#x2696; Total</td><td style="padding:8px 12px;border:1px solid #bfdbfe">' + totalKg + ' kg</td></tr>' +
      '</table>' +
      '<p style="color:#64748b;font-size:0.82rem;margin:0">Atenciosamente,<br><strong>' + senderName + '</strong></p>' +
    '</div></div>';

  try {
    var file    = DriveApp.getFileById(fileId);
    var pdfBlob = file.getBlob().copyBlob();
    pdfBlob.setName(file.getName());
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: emailHtml, name: 'Hygicare Lavanderia', attachments: [pdfBlob] });
  } catch(err) {
    return respondError('Falha ao enviar e-mail: ' + err.message);
  }

  return respond({ ok: true, message: 'E-mail enviado para ' + to + ' com PDF em anexo.' });
}

// ============================================================
// LISTAR PDFs NA PASTA "Hygicare Relatórios" DO DRIVE
// ============================================================
// Retorna: { ok, files: [{name, id, url, downloadUrl}] }
// O app.js usa o nome "Relatorio_001_*" para identificar o relId
// e libera os botões de e-mail automaticamente.
function respondListFolderPdfs() {
  try {
    // Tenta encontrar a pasta testando variações do nome (com/sem acento, maiúsc.)
    var folderNames = ['Hygicare Relatorios', 'Hygicare Relatórios', 'hygicare relatorios', 'hygicare relatórios'];
    var folder = null;
    for (var i = 0; i < folderNames.length; i++) {
      var it = DriveApp.getFoldersByName(folderNames[i]);
      if (it.hasNext()) { folder = it.next(); break; }
    }
    if (!folder) return respond({ ok: true, files: [], debug: 'Pasta não encontrada. Nomes testados: ' + folderNames.join(', ') });

    var files = folder.getFiles(); // lista TODOS os arquivos (não filtra por MIME)
    var result = [];
    while (files.hasNext()) {
      var f = files.next();
      var fname = f.getName();
      // Aceita arquivos com extensão .pdf (case insensitive) ou tipo PDF
      if (!fname.toLowerCase().endsWith('.pdf') && f.getMimeType() !== MimeType.PDF) continue;
      result.push({
        name: fname,
        id: f.getId(),
        url: f.getUrl(),
        downloadUrl: 'https://drive.google.com/uc?export=download&id=' + f.getId()
      });
    }
    return respond({ ok: true, files: result, folderFound: folder.getName() });
  } catch(e) {
    return respondError('Erro ao listar pasta: ' + e.message);
  }
}

// ============================================================
// E-MAILS AUTOMÁTICOS MENSAIS — helpers e funções de envio
// ============================================================

function _fmtKg(n) {
  var s = parseFloat(n || 0).toFixed(2);
  var parts = s.split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + parts[1];
}

function _emailShell(badge, headerBg, bodyHtml) {
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto">'
    + '<div style="background:' + (headerBg || 'linear-gradient(135deg,#1e3a8a,#1d4ed8)') + ';padding:28px 24px 20px;text-align:center">'
    + '<div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px">&#128167; Hygicare</div>'
    + '<div style="font-size:12px;color:rgba(255,255,255,0.75);margin:3px 0 10px">Lavanderia Hospitalar</div>'
    + '<div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.35);border-radius:20px;padding:5px 16px;font-size:12px;font-weight:700;color:#fff;letter-spacing:1px">' + badge + '</div>'
    + '</div>'
    + '<div style="background:#f4f6fb;padding:16px">' + bodyHtml + '</div>'
    + '<div style="background:#f8fafc;padding:12px 20px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8">'
    + 'Hygicare Lavanderia &bull; Gerado automaticamente em ' + now + '<br>'
    + 'Este e-mail &eacute; enviado pelo sistema de gest&atilde;o Hygicare.'
    + '</div>'
    + '</div>';
}

function _emailKpis(kpis) {
  var borders = { blue: '#1d4ed8', green: '#16a34a', amber: '#d97706', red: '#dc2626' };
  var w = Math.floor(100 / kpis.length);
  var cells = kpis.map(function(k) {
    var bc = borders[k.color || 'blue'] || '#1d4ed8';
    return '<td style="padding:0 4px;width:' + w + '%">'
      + '<div style="background:#fff;border-top:3px solid ' + bc + ';border-radius:8px;padding:12px 8px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.07)">'
      + '<div style="font-size:20px;font-weight:800;color:#1e293b;line-height:1.1">' + k.val + '</div>'
      + '<div style="font-size:10px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em">' + k.label + '</div>'
      + '</div></td>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;margin:14px 0"><tr>' + cells + '</tr></table>';
}

function _emailSecHd(title, color) {
  var bg = { blue: '#1e3a8a', amber: '#92400e', green: '#14532d', red: '#991b1b' };
  return '<div style="background:' + (bg[color || 'blue'] || '#1e3a8a') + ';color:#fff;padding:8px 14px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">' + title + '</div>';
}

function _emailCard(hdTitle, hdColor, innerHtml) {
  return '<div style="background:#fff;border-radius:8px;overflow:hidden;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">'
    + _emailSecHd(hdTitle, hdColor) + innerHtml + '</div>';
}

// ── HTML: Relatório Operacional ──────────────────────────────
function _buildOperationalEmailHtml(monthLabel, totalKg, ranking, inactiveClients) {
  var maxKg = ranking.length > 0 ? ranking[0].kg : 1;
  var content = _emailKpis([
    { val: _fmtKg(totalKg) + ' kg', label: 'Total processado',      color: 'blue'  },
    { val: ranking.length,           label: 'Clientes ativos',       color: 'green' },
    { val: inactiveClients.length,   label: 'Sem relat&oacute;rio',  color: inactiveClients.length > 0 ? 'red' : 'green' },
  ]);

  if (ranking.length > 0) {
    var rankRows = ranking.map(function(r, i) {
      var pct  = totalKg > 0 ? (r.kg / totalKg * 100).toFixed(1) : '0.0';
      var barW = maxKg  > 0 ? Math.round(r.kg / maxKg * 100) : 0;
      var medalBg = ['#fef3c7', '#f1f5f9', '#ffedd5'][i] || '#e0f2fe';
      var rowBg   = i % 2 === 0 ? '#fafafa' : '#fff';
      return '<tr style="background:' + rowBg + '">'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;text-align:center">'
        + '<div style="width:22px;height:22px;border-radius:50%;background:' + medalBg + ';display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#1e293b">' + (i+1) + '</div></td>'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9"><strong style="font-size:12px">' + r.name + '</strong>'
        + '<div style="background:#e2e8f0;border-radius:3px;height:4px;margin-top:4px"><div style="background:#1d4ed8;border-radius:3px;height:4px;width:' + barW + '%"></div></div></td>'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748b">' + (r.seller || '&mdash;') + '</td>'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;text-align:center"><strong>' + _fmtKg(r.kg) + '</strong></td>'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:11px">' + pct + '%</td></tr>';
    }).join('');
    var thStyle = 'background:#f1f5f9;padding:6px 8px;font-size:10px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0';
    content += _emailCard(
      '&#127942; Ranking de Clientes &mdash; ' + monthLabel, 'blue',
      '<table style="width:100%;border-collapse:collapse">'
      + '<thead><tr>'
      + '<th style="' + thStyle + ';text-align:center">#</th>'
      + '<th style="' + thStyle + '">Cliente</th>'
      + '<th style="' + thStyle + '">Vendedor</th>'
      + '<th style="' + thStyle + ';text-align:center">Total kg</th>'
      + '<th style="' + thStyle + ';text-align:center">%</th>'
      + '</tr></thead><tbody>' + rankRows + '</tbody>'
      + '<tfoot><tr style="background:#f0fdf4">'
      + '<td colspan="3" style="padding:8px 10px;font-weight:700;color:#15803d;border-top:1px solid #bbf7d0;text-align:right">Total Geral</td>'
      + '<td style="padding:8px 10px;font-weight:700;color:#15803d;border-top:1px solid #bbf7d0;text-align:center">' + _fmtKg(totalKg) + ' kg</td>'
      + '<td style="padding:8px 10px;font-weight:700;color:#15803d;border-top:1px solid #bbf7d0;text-align:center">100%</td>'
      + '</tr></tfoot></table>'
    );
  }

  if (inactiveClients.length > 0) {
    var inactRows = inactiveClients.map(function(c) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #f1f5f9">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:#dc2626;flex-shrink:0"></div>'
        + '<div><div style="font-size:12px;font-weight:600;color:#1e293b">' + c.name + '</div>'
        + '<div style="font-size:11px;color:#64748b">Vendedor: ' + (c.seller || '&mdash;') + '</div></div></div>';
    }).join('');
    content += _emailCard('&#9888;&#65039; Clientes sem relat&oacute;rio em ' + monthLabel, 'red', inactRows);
  }

  return _emailShell('&#128202; Relat&oacute;rio Operacional &mdash; ' + monthLabel, 'linear-gradient(135deg,#1e3a8a,#1d4ed8)', content);
}

// ── HTML: Clientes sem Relatório ─────────────────────────────
function _buildMissingClientsEmailHtml(monthLabel, groups) {
  var content = groups.map(function(sg) {
    if (!sg.clients || sg.clients.length === 0) return '';
    var rows = sg.clients.map(function(c) {
      var isRed    = c.daysSince === undefined || c.daysSince > 45;
      var badge    = c.daysSince !== undefined ? c.daysSince + ' dias' : 'Nunca';
      var badgeBg  = isRed ? '#fee2e2' : '#fef3c7';
      var badgeClr = isRed ? '#991b1b' : '#92400e';
      var dotClr   = isRed ? '#dc2626' : '#d97706';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid #f1f5f9">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:' + dotClr + ';flex-shrink:0"></div>'
        + '<div style="flex:1"><div style="font-size:12px;font-weight:600;color:#1e293b">' + c.name + '</div>'
        + '<div style="font-size:11px;color:#64748b">' + (c.lastRecord ? 'Último: ' + c.lastRecord : 'Nenhum registro encontrado') + '</div></div>'
        + '<div style="background:' + badgeBg + ';color:' + badgeClr + ';border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;white-space:nowrap">' + badge + '</div>'
        + '</div>';
    }).join('');
    return _emailCard('&#128203; ' + (sg.seller || 'Vendedor'), 'amber', rows);
  }).join('');
  return _emailShell('&#9888;&#65039; Clientes Pendentes &mdash; ' + monthLabel, 'linear-gradient(135deg,#92400e,#d97706)', content);
}

// ── HTML: Relatório de Vazão ─────────────────────────────────
function _buildVazaoEmailHtml(monthLabel, clientName, machineGroups) {
  var totalReadings = machineGroups.reduce(function(s, m) { return s + m.readings.length; }, 0);
  var lowCount      = machineGroups.reduce(function(s, m) {
    return s + m.readings.filter(function(r) { return r.status === 'low'; }).length;
  }, 0);
  var pct = totalReadings > 0 ? Math.round((totalReadings - lowCount) / totalReadings * 100) : 100;

  var content = _emailKpis([
    { val: machineGroups.length, label: 'M&aacute;quinas monitoradas', color: 'blue'  },
    { val: totalReadings,        label: 'Medi&ccedil;&otilde;es no m&ecirc;s', color: 'green' },
    { val: pct + '%',            label: 'Dentro do padr&atilde;o',    color: pct >= 80 ? 'green' : 'amber' },
  ]);

  content += '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:11px;color:#64748b">'
    + '<strong style="color:#1e293b">&#128712; Legenda:</strong> '
    + '&#9989; <strong>Normal</strong> = leitura &ge; 80% da m&eacute;dia hist&oacute;rica&nbsp;&nbsp;'
    + '&#9888;&#65039; <strong>Baixa</strong> = leitura &lt; 80% da m&eacute;dia hist&oacute;rica desta bomba (poss&iacute;vel desgaste ou obstru&ccedil;&atilde;o)'
    + '</div>';

  var thStyle = 'background:#f1f5f9;padding:6px 8px;font-size:10px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0';
  machineGroups.forEach(function(m) {
    var inner;
    if (m.readings.length === 0) {
      inner = '<div style="padding:12px 14px;color:#64748b;font-size:12px">Nenhuma leitura no m&ecirc;s.</div>';
    } else {
      var trs = m.readings.map(function(r) {
        var isLow = r.status === 'low';
        return '<tr>'
          + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">' + r.date + '</td>'
          + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">' + r.vazaoName + '</td>'
          + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:center"><strong style="color:' + (isLow ? '#dc2626' : '#1e293b') + '">' + parseFloat(r.value || 0).toFixed(2) + ' ' + (r.unit || '') + '</strong></td>'
          + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:center;color:#64748b">' + (r.avg !== undefined && r.avg > 0 ? parseFloat(r.avg).toFixed(2) + ' ' + (r.unit || '') : '&mdash;') + '</td>'
          + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:center">' + (isLow ? '<span style="color:#dc2626;font-weight:700">&#9888;&#65039; Baixa</span>' : '<span style="color:#16a34a;font-weight:700">&#9989; Normal</span>') + '</td>'
          + '</tr>';
      }).join('');
      inner = '<table style="width:100%;border-collapse:collapse">'
        + '<thead><tr>'
        + '<th style="' + thStyle + '">Data</th>'
        + '<th style="' + thStyle + '">Bomba</th>'
        + '<th style="' + thStyle + ';text-align:center">Leitura</th>'
        + '<th style="' + thStyle + ';text-align:center">M&eacute;dia hist.</th>'
        + '<th style="' + thStyle + ';text-align:center">Status</th>'
        + '</tr></thead><tbody>' + trs + '</tbody></table>';
    }
    content += _emailCard('&#9881;&#65039; ' + m.machineName, 'blue', inner);
  });

  return _emailShell('&#128167; Vaz&atilde;o &mdash; ' + clientName + ' &middot; ' + monthLabel, 'linear-gradient(135deg,#0c4a6e,#0284c7)', content);
}

// ── HTML: Relatório de Produção (corpo do e-mail) ────────────
function _buildProductionReportBodyHtml(clientName, period, totalKg, rows, senderName) {
  var byMachine = {};
  var machineOrder = [];
  rows.forEach(function(r) {
    var mn = r.machineName || 'Máquina';
    if (!byMachine[mn]) { byMachine[mn] = []; machineOrder.push(mn); }
    byMachine[mn].push(r);
  });
  machineOrder.sort(function(a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }); });

  var thStyle = 'background:#f1f5f9;padding:6px 8px;font-size:10px;font-weight:700;color:#475569;border-bottom:1px solid #e2e8f0';
  var content = _emailKpis([
    { val: _fmtKg(totalKg) + ' kg', label: 'Total processado',     color: 'blue'  },
    { val: machineOrder.length,      label: 'M&aacute;quinas',      color: 'green' },
    { val: rows.length,              label: 'Linhas de processo',    color: 'amber' },
  ]);

  machineOrder.forEach(function(mname) {
    var mRows = byMachine[mname];
    var mKg   = mRows.reduce(function(s, r) { return s + parseFloat(r.total || 0); }, 0);
    var trs   = mRows.map(function(r) {
      var total = parseFloat(r.total || 0);
      var isZero = total === 0;
      return '<tr style="' + (isZero ? 'opacity:0.55' : '') + '">'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px">' + (r.procName || '&mdash;') + '</td>'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:center">' + (parseInt(r.executed) || 0) + '</td>'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:center;color:' + (parseInt(r.canceled) > 0 ? '#dc2626' : 'inherit') + '">' + (parseInt(r.canceled) || 0) + '</td>'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:center">' + ((parseInt(r.executed) || 0) + (parseInt(r.canceled) || 0)) + '</td>'
        + '<td style="padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:right">' + (isZero ? '&mdash;' : '<strong>' + _fmtKg(total) + ' kg</strong>') + '</td>'
        + '</tr>';
    }).join('');
    content += '<div style="background:#fff;border-radius:8px;overflow:hidden;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,0.06)">'
      + '<div style="background:#1d4ed8;color:#fff;padding:8px 14px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">&#9881;&#65039; ' + mname + '</div>'
      + '<table style="width:100%;border-collapse:collapse">'
      + '<thead><tr>'
      + '<th style="' + thStyle + '">Processo</th>'
      + '<th style="' + thStyle + ';text-align:center">Exec.</th>'
      + '<th style="' + thStyle + ';text-align:center">Cancel.</th>'
      + '<th style="' + thStyle + ';text-align:center">Total proc.</th>'
      + '<th style="' + thStyle + ';text-align:right">Total kg</th>'
      + '</tr></thead><tbody>' + trs + '</tbody></table>'
      + '<div style="background:#eff6ff;padding:8px 14px;font-size:12px;font-weight:700;color:#1d4ed8;border-top:1px solid #bfdbfe;text-align:right">Total ' + mname + ': ' + _fmtKg(mKg) + ' kg</div>'
      + '</div>';
  });

  content += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:12px">'
    + '<table style="width:100%;border-collapse:collapse"><tbody>'
    + '<tr><td style="font-size:14px;font-weight:700;color:#1e293b;padding:4px 0">Total processado</td>'
    + '<td style="font-size:22px;font-weight:800;color:#15803d;text-align:right;padding:4px 0">' + _fmtKg(totalKg) + ' kg</td></tr>'
    + '<tr><td style="font-size:11px;color:#64748b;padding:4px 0">Gerado por</td>'
    + '<td style="font-size:11px;color:#64748b;text-align:right;padding:4px 0">' + (senderName || 'Sistema') + '</td></tr>'
    + '<tr><td style="font-size:11px;color:#64748b;padding:4px 0">Emitido em</td>'
    + '<td style="font-size:11px;color:#64748b;text-align:right;padding:4px 0">' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') + '</td></tr>'
    + '</tbody></table></div>';

  return _emailShell('&#128203; ' + clientName + ' &middot; ' + period, 'linear-gradient(135deg,#1e3a8a,#1d4ed8)', content);
}

// ============================================================
// ENVIAR RELATÓRIO DE PRODUÇÃO NO CORPO DO E-MAIL (sem PDF)
// Payload: callGAS('sendProductionReportBody', null, { clientName, period, totalKg, rows, senderName, senderEmail })
// ============================================================
function respondSendProductionReportBody(body) {
  try {
    var d           = body.data || {};
    var clientName  = d.clientName  || 'Cliente';
    var period      = d.period      || '';
    var totalKg     = parseFloat(d.totalKg || 0);
    var rows        = d.rows        || [];
    var senderName  = d.senderName  || 'Equipe Hygicare';
    var senderEmail = (d.senderEmail || '').trim();

    var adminEmail = getConfig('notification_email') || '';
    var recipients = [];
    if (adminEmail) recipients.push(adminEmail);
    if (senderEmail && recipients.indexOf(senderEmail) < 0) recipients.push(senderEmail);
    if (recipients.length === 0) return respondError('Nenhum destinatário configurado. Adicione o e-mail admin em Config.');

    var html    = _buildProductionReportBodyHtml(clientName, period, totalKg, rows, senderName);
    var subject = '[Hygicare] Relatório de Produção — ' + clientName + ' (' + period + ')';
    recipients.forEach(function(to) {
      MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: 'Hygicare Sistema' });
    });
    return respond({ ok: true, to: recipients.join(', '), count: recipients.length });
  } catch(e) {
    return respondError('Erro ao enviar: ' + e.message);
  }
}

// ============================================================
// RELATÓRIO OPERACIONAL MENSAL — envia no 1° do mês
// ============================================================
function sendMonthlyOperationalEmail() {
  try {
    var now       = new Date();
    var prev      = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var year      = prev.getFullYear();
    var month     = prev.getMonth() + 1;
    var monthLabel = Utilities.formatDate(prev, Session.getScriptTimeZone(), 'MM/yyyy');

    var clients = readSheet('Clientes');
    var records = readSheet('Registros');

    var monthRecs = records.filter(function(r) {
      var d = String(r.date_start || '');
      if (d.length < 7) return false;
      var p = d.split('-');
      return parseInt(p[0]) === year && parseInt(p[1]) === month;
    });

    var byClient = {};
    monthRecs.forEach(function(r) {
      var cid = String(r.client_id);
      byClient[cid] = (byClient[cid] || 0) + parseFloat(r.total || 0);
    });
    var totalKg  = Object.keys(byClient).reduce(function(s, k) { return s + byClient[k]; }, 0);
    var activeIds = Object.keys(byClient);

    var inactive = clients.filter(function(c) { return activeIds.indexOf(String(c.id)) < 0; });
    var ranking  = clients
      .filter(function(c) { return activeIds.indexOf(String(c.id)) >= 0; })
      .map(function(c) { return { name: c.name, seller: c.seller || '', kg: byClient[String(c.id)] || 0, email_seller: c.email_seller || '', id: String(c.id) }; })
      .sort(function(a, b) { return b.kg - a.kg; });

    var adminEmail = getConfig('notification_email');
    if (adminEmail) {
      MailApp.sendEmail({ to: adminEmail, name: 'Hygicare Sistema',
        subject: '[Hygicare] Relatório Operacional — ' + monthLabel,
        htmlBody: _buildOperationalEmailHtml(monthLabel, totalKg, ranking, inactive) });
    }

    var sellerMap = {};
    clients.forEach(function(c) {
      if (!c.email_seller) return;
      if (!sellerMap[c.email_seller]) sellerMap[c.email_seller] = [];
      sellerMap[c.email_seller].push(c);
    });
    Object.keys(sellerMap).forEach(function(email) {
      if (email === adminEmail) return;
      var sc  = sellerMap[email];
      var ids = sc.map(function(c) { return String(c.id); });
      var sr  = ranking.filter(function(r) { return ids.indexOf(r.id) >= 0; });
      var si  = inactive.filter(function(c) { return ids.indexOf(String(c.id)) >= 0; });
      var sk  = sr.reduce(function(s, r) { return s + r.kg; }, 0);
      MailApp.sendEmail({ to: email, name: 'Hygicare Sistema',
        subject: '[Hygicare] Seu Relatório Operacional — ' + monthLabel,
        htmlBody: _buildOperationalEmailHtml(monthLabel, sk, sr, si) });
    });
    Logger.log('sendMonthlyOperationalEmail: ok');
  } catch(e) { Logger.log('sendMonthlyOperationalEmail error: ' + e.message); }
}

// ============================================================
// CLIENTES SEM RELATÓRIO — envia no 1° do mês
// ============================================================
function sendMissingClientsEmail() {
  try {
    var now       = new Date();
    var prev      = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var year      = prev.getFullYear();
    var month     = prev.getMonth() + 1;
    var monthLabel = Utilities.formatDate(prev, Session.getScriptTimeZone(), 'MM/yyyy');

    var clients = readSheet('Clientes');
    var records = readSheet('Registros');

    var hasRec = {};
    var lastDate = {};
    records.forEach(function(r) {
      var cid = String(r.client_id);
      var d   = String(r.date_start || '');
      if (!d || d.length < 7) return;
      var p = d.split('-');
      if (parseInt(p[0]) === year && parseInt(p[1]) === month) hasRec[cid] = true;
      if (!lastDate[cid] || d > lastDate[cid]) lastDate[cid] = d;
    });

    var inactive = clients.filter(function(c) { return !hasRec[String(c.id)]; });
    if (inactive.length === 0) { Logger.log('sendMissingClientsEmail: todos com registro'); return; }

    var sellerMap = {};
    inactive.forEach(function(c) {
      var seller = c.seller || 'Sem vendedor';
      var email  = c.email_seller || '';
      if (!sellerMap[seller]) sellerMap[seller] = { seller: seller, email: email, clients: [] };
      var last = lastDate[String(c.id)];
      var days = last ? Math.floor((now - new Date(last)) / 86400000) : undefined;
      sellerMap[seller].clients.push({
        name: c.name,
        lastRecord: last ? Utilities.formatDate(new Date(last), Session.getScriptTimeZone(), 'dd/MM/yyyy') : null,
        daysSince: days,
      });
    });

    var allGroups  = Object.keys(sellerMap).map(function(k) { return sellerMap[k]; });
    var adminEmail = getConfig('notification_email');
    if (adminEmail) {
      MailApp.sendEmail({ to: adminEmail, name: 'Hygicare Sistema',
        subject: '[Hygicare] Clientes sem relatório — ' + monthLabel,
        htmlBody: _buildMissingClientsEmailHtml(monthLabel, allGroups) });
    }
    allGroups.forEach(function(sg) {
      if (!sg.email || sg.email === adminEmail) return;
      MailApp.sendEmail({ to: sg.email, name: 'Hygicare Sistema',
        subject: '[Hygicare] Seus clientes sem relatório — ' + monthLabel,
        htmlBody: _buildMissingClientsEmailHtml(monthLabel, [sg]) });
    });
    Logger.log('sendMissingClientsEmail: ok, ' + inactive.length + ' inativo(s)');
  } catch(e) { Logger.log('sendMissingClientsEmail error: ' + e.message); }
}

// ============================================================
// RELATÓRIO DE VAZÃO MENSAL — envia no 1° do mês
// ============================================================
function sendMonthlyVazaoEmail() {
  try {
    var now       = new Date();
    var prev      = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var year      = prev.getFullYear();
    var month     = prev.getMonth() + 1;
    var monthLabel = Utilities.formatDate(prev, Session.getScriptTimeZone(), 'MM/yyyy');

    var clients       = readSheet('Clientes');
    var vazaoRegs     = readSheet('VazaoRegistros');
    var machines      = readSheet('Maquinas');
    var technicoEmail = getConfig('email_tecnico');

    var machineNames = {};
    machines.forEach(function(m) { machineNames[String(m.id)] = m.name; });

    // Média histórica por (machine_id + '_' + vazao_id)
    var histData = {};
    vazaoRegs.forEach(function(r) {
      var key = String(r.machine_id) + '_' + String(r.vazao_id);
      if (!histData[key]) histData[key] = { sum: 0, count: 0 };
      histData[key].sum   += parseFloat(r.value || 0);
      histData[key].count += 1;
    });

    var monthRegs = vazaoRegs.filter(function(r) {
      var d = String(r.date || '');
      if (d.length < 7) return false;
      var p = d.split('-');
      return parseInt(p[0]) === year && parseInt(p[1]) === month;
    });
    if (monthRegs.length === 0) { Logger.log('sendMonthlyVazaoEmail: sem leituras'); return; }

    var byClient = {};
    monthRegs.forEach(function(r) {
      var cid = String(r.client_id);
      var mid = String(r.machine_id);
      if (!byClient[cid]) byClient[cid] = {};
      if (!byClient[cid][mid]) byClient[cid][mid] = [];
      var key = mid + '_' + String(r.vazao_id);
      var h   = histData[key];
      var avg = h && h.count > 0 ? h.sum / h.count : 0;
      var val = parseFloat(r.value || 0);
      byClient[cid][mid].push({
        date: r.date ? Utilities.formatDate(new Date(r.date), Session.getScriptTimeZone(), 'dd/MM/yyyy') : '',
        vazaoName: r.vazao_name || ('Bomba ' + r.vazao_id),
        value: val,
        unit:  r.vazao_unit || '',
        avg:   avg > 0 ? avg : undefined,
        status: avg > 0 && val < avg * 0.8 ? 'low' : 'normal',
      });
    });

    var clientMap = {};
    clients.forEach(function(c) { clientMap[String(c.id)] = c; });

    Object.keys(byClient).forEach(function(cid) {
      var client = clientMap[cid];
      if (!client) return;
      var clientEmail = String(client.send_client) === 'true' ? (client.email_client || '') : '';
      var toArr = [];
      if (clientEmail) toArr.push(clientEmail);
      if (technicoEmail && toArr.indexOf(technicoEmail) < 0) toArr.push(technicoEmail);
      if (toArr.length === 0) return;

      var machineGroups = Object.keys(byClient[cid]).map(function(mid) {
        return {
          machineName: machineNames[mid] || mid,
          readings: byClient[cid][mid].sort(function(a, b) { return a.date.localeCompare(b.date); }),
        };
      }).sort(function(a, b) { return a.machineName.localeCompare(b.machineName, 'pt-BR', { numeric: true, sensitivity: 'base' }); });

      MailApp.sendEmail({ to: toArr.join(','), name: 'Hygicare Sistema',
        subject: '[Hygicare] Relatório de Vazão — ' + client.name + ' · ' + monthLabel,
        htmlBody: _buildVazaoEmailHtml(monthLabel, client.name, machineGroups) });
    });
    Logger.log('sendMonthlyVazaoEmail: ok, clientes=' + Object.keys(byClient).length);
  } catch(e) { Logger.log('sendMonthlyVazaoEmail error: ' + e.message); }
}

// ============================================================
// DISPARO MENSAL — chamado pelo gatilho de tempo no dia 1 às 8h
// ============================================================
function runMonthlyTrigger() {
  Logger.log('runMonthlyTrigger: ' + new Date().toISOString());
  if (getConfig('email_monthly_operational') === 'true') sendMonthlyOperationalEmail();
  if (getConfig('email_monthly_missing')     === 'true') sendMissingClientsEmail();
  if (getConfig('email_monthly_vazao')       === 'true') sendMonthlyVazaoEmail();
  Logger.log('runMonthlyTrigger: concluído');
}

// Configura o gatilho de tempo: dia 1 de cada mês às 8h.
// Pode ser chamado via painel admin ou manualmente no editor do Apps Script.
function setupMonthlyTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'runMonthlyTrigger') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runMonthlyTrigger').timeBased().onMonthDay(1).atHour(8).create();
  Logger.log('setupMonthlyTriggers: gatilho criado — dia 1 às 8h');
}
