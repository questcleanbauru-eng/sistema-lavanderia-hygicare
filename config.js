// Configuracoes — Google Apps Script (substitui SheetDB)
const CONFIG = {
  // Cole a URL do seu Apps Script implantado aqui (ou configure no Painel Admin)
  GAS_URL: "YOUR_GAS_URL",
  SYNC_INTERVAL_HOURS: 6
};

// Planilhas/abas esperadas na planilha Google Sheets
const SHEETS = {
  CLIENTS: "Clientes",
  MACHINES: "Maquinas",
  PROCESSES: "Processos",
  RECORDS: "Registros",
  USERS: "Usuarios"
};

// Modo de debug
const DEBUG = true;
