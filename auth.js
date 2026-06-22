// auth.js - Sistema de autentica��o e controle de acesso

// Usu�rios do sistema
// Em produ��o, isso deve vir de um backend seguro
const USERS = [
  { 
    username: 'admin', 
    password: 'admin123', 
    role: 'admin', 
    name: 'Administrador',
    canEdit: true,
    canDelete: true
  },
  {
    username: 'vendedor1', 
    password: 'vend123', 
    role: 'vendedor', 
    name: 'Jo�o Silva',
    sellerName: 'Jo�o Silva',
    canEdit: true,
    canDelete: false
  },
  { 
    username: 'vendedor2', 
    password: 'vend456', 
    role: 'vendedor', 
    name: 'Maria Santos',
    sellerName: 'Maria Santos',
    canEdit: true,
    canDelete: false
  }
];

// Exportar para uso global
window.USERS = USERS;
