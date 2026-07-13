// Configuracoes — Google Apps Script
const CONFIG = {
  // URL do Google Apps Script publicado
  GAS_URL: "https://script.google.com/macros/s/AKfycbzvQTnHT3IIojMVEKHyoWgkx4dYr7AuhrVROEfGzZjFRajR0xYtkC7TFoqaA3evTYBuag/exec",
  SYNC_INTERVAL_HOURS: 6
};

// Planilhas/abas esperadas na planilha Google Sheets
const SHEETS = {
  CLIENTS: "Clientes",
  MACHINES: "Maquinas",
  PROCESSES: "Processos",
  RECORDS: "Registros",
  USERS: "Usuarios",
  VAZOES: "Vazoes",
  VAZAO_RECORDS: "VazaoRegistros",
  RECIPES: "Receitas",
  RECIPE_PRODUCTS: "ReceitaProdutos",
  CLIENT_NOTES: "ClienteNotas"
};

// Modo de debug
const DEBUG = false;
