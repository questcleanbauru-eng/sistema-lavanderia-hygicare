// ============================================================
// HYGICARE LAVANDERIA — Google Apps Script API
// ============================================================
// INSTRUÇÕES DE INSTALAÇÃO:
//   1. Abra sua planilha Google Sheets
//   2. Menu: Extensões > Apps Script
//   3. Apague todo o código existente
//   4. Cole TODO este arquivo
//   5. Clique em "Salvar" (ícone de disquete)
//   6. Clique em "Implantar" > "Nova implantação"
//   7. Tipo: "Aplicativo da Web"
//   8. Executar como: "Eu"
//   9. Quem pode acessar: "Qualquer pessoa"
//  10. Clique em "Implantar" e copie a URL gerada
//  11. Cole essa URL no campo "API URL" no Painel Admin do sistema
// ============================================================

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// Mapa de abas (igual ao config.js do sistema)
const SHEET_NAMES = {
  clientes:   'Clientes',
  maquinas:   'Maquinas',
  processos:  'Processos',
  registros:  'Registros',
  usuarios:   'Usuarios',
  config:     'Config',
};

// ── Cabeçalhos esperados por aba ──────────────────────────
const HEADERS = {
  Clientes:   ['id','name','city','seller','email_client','send_client','email_seller','send_seller','price_kg','created_at'],
  Maquinas:   ['id','name','client_id','capacity','created_at'],
  Processos:  ['id','name','machine_id','capacity','created_at'],
  Registros:  ['id','client_id','machine_id','process_id','executed','canceled','capacity','total','date_start','date_end','created_at','synced_at'],
  Usuarios:   ['id','name','username','password','role','email','active','sellerName','created_at'],
  Config:     ['chave','valor'],
};

// ── Resposta padrão com CORS ──────────────────────────────
function respond(data, status) {
  const output = ContentService
    .createTextOutput(JSON.stringify({ status: status || 'ok', data }))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

function respondError(msg, code) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', error: msg, code: code || 400 }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Obter ou criar aba ────────────────────────────────────
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

// ── Converter linha para objeto ───────────────────────────
function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

// ── Converter objeto para linha (na ordem dos headers) ────
function objToRow(headers, obj) {
  return headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : '');
}

// ── Ler todos os dados de uma aba ─────────────────────────
function readSheet(sheetName) {
  const sheet = getOrCreateSheet(sheetName);
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0].map(String);
  return data.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => rowToObj(headers, row));
}

// ── Encontrar linha pelo id ───────────────────────────────
function findRowById(sheet, id) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return -1;
  const headers = data[0].map(String);
  const idIdx   = headers.indexOf('id');
  if (idIdx < 0) return -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]) === String(id)) return i + 1; // 1-based row number
  }
  return -1;
}

// ── Gerar próximo ID ──────────────────────────────────────
function nextId(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 1;
  const headers = data[0].map(String);
  const idIdx   = headers.indexOf('id');
  if (idIdx < 0) return 1;
  let max = 0;
  for (let i = 1; i < data.length; i++) {
    const v = parseInt(data[i][idIdx]);
    if (!isNaN(v) && v > max) max = v;
  }
  return max + 1;
}

// ============================================================
// GET — Leitura
// ?action=get&sheet=Clientes
// ?action=get&sheet=all   → retorna todas as abas de uma vez
// ============================================================
function doGet(e) {
  try {
    const params = e.parameter || {};
    const action = params.action || 'get';
    const sheetParam = params.sheet || '';

    // Retorna TODAS as abas de uma vez (economia de chamadas)
    if (sheetParam === 'all') {
      const result = {};
      Object.values(SHEET_NAMES).forEach(name => {
        try { result[name] = readSheet(name); }
        catch(err) { result[name] = []; }
      });
      return respond(result);
    }

    // Retorna uma aba específica
    const sheetName = sheetParam || 'Clientes';
    const rows = readSheet(sheetName);
    return respond(rows);

  } catch(err) {
    return respondError(err.message);
  }
}

// ============================================================
// POST — Inserir / Atualizar / Excluir
// Body JSON: { action, sheet, data, id }
// action: 'insert' | 'update' | 'delete' | 'upsert'
// ============================================================
function doPost(e) {
  try {
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch(err) {
      return respondError('JSON inválido no body');
    }

    const { action, sheet: sheetName, data, id } = body;

    if (!sheetName) return respondError('Campo "sheet" obrigatório');

    const sheet   = getOrCreateSheet(sheetName);
    const headers = HEADERS[sheetName] || Object.keys(data || {});

    // ── INSERT ────────────────────────────────────────────
    if (action === 'insert') {
      if (!data) return respondError('Campo "data" obrigatório para insert');
      const items = Array.isArray(data) ? data : [data];
      const inserted = [];
      items.forEach(item => {
        const newId = item.id || nextId(sheet);
        item.id = newId;
        const row = objToRow(headers, item);
        sheet.appendRow(row);
        inserted.push(newId);
      });
      return respond({ inserted, count: inserted.length });
    }

    // ── UPDATE (PATCH) ────────────────────────────────────
    if (action === 'update') {
      if (!id) return respondError('Campo "id" obrigatório para update');
      if (!data) return respondError('Campo "data" obrigatório para update');
      const rowNum = findRowById(sheet, id);
      if (rowNum < 0) return respondError(`ID ${id} não encontrado`, 404);
      // Ler linha atual e mesclar
      const currentRow = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
      const currentObj = rowToObj(headers, currentRow);
      const merged     = { ...currentObj, ...data, id: currentObj.id };
      const newRow     = objToRow(headers, merged);
      sheet.getRange(rowNum, 1, 1, headers.length).setValues([newRow]);
      return respond({ updated: id });
    }

    // ── DELETE ────────────────────────────────────────────
    if (action === 'delete') {
      if (!id) return respondError('Campo "id" obrigatório para delete');
      const rowNum = findRowById(sheet, id);
      if (rowNum < 0) return respondError(`ID ${id} não encontrado`, 404);
      sheet.deleteRow(rowNum);
      return respond({ deleted: id });
    }

    // ── UPSERT (insert ou update pelo id) ─────────────────
    if (action === 'upsert') {
      if (!data) return respondError('Campo "data" obrigatório para upsert');
      const items = Array.isArray(data) ? data : [data];
      const results = [];
      items.forEach(item => {
        if (item.id) {
          const rowNum = findRowById(sheet, item.id);
          if (rowNum > 0) {
            const currentRow = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
            const currentObj = rowToObj(headers, currentRow);
            const merged     = { ...currentObj, ...item };
            sheet.getRange(rowNum, 1, 1, headers.length).setValues([objToRow(headers, merged)]);
            results.push({ id: item.id, op: 'updated' });
            return;
          }
        }
        const newId = item.id || nextId(sheet);
        item.id = newId;
        sheet.appendRow(objToRow(headers, item));
        results.push({ id: newId, op: 'inserted' });
      });
      return respond({ results, count: results.length });
    }

    return respondError(`Ação desconhecida: ${action}`);

  } catch(err) {
    return respondError(err.message);
  }
}
