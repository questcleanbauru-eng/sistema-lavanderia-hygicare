// Configuracoes — Google Apps Script
const CONFIG = {
  // Todas as requisições passam pelo proxy Vercel (GAS_URL fica escondido no servidor)
  GAS_URL: "/api/proxy",
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
  CLIENT_NOTES: "ClienteNotas",
  APP_CONFIG: "AppConfig",
  FINANCEIRO: "Financeiro",
  EQUIPAMENTOS: "Equipamentos"
};

// Modo de debug
const DEBUG = false;
