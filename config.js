// Configuracoes — Google Apps Script (substitui SheetDB)
const CONFIG = {
  // ✅ Cole aqui a URL gerada ao implantar o google-apps-script.js
  // Formato: https://script.google.com/macros/s/XXXXX/exec
  // Após colar, faça deploy no Vercel — todos os usuários recebem automaticamente
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
  RECIPE_PRODUCTS: "ReceitaProdutos"
};

// Modo de debug
const DEBUG = true;
