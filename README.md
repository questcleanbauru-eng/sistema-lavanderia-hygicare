# Sistema Lavanderia - PWA

Aplicação PWA offline-first para cadastro de clientes, máquinas, processos, envio de produção e geração de relatórios em PDF.

## 🔐 Sistema de Login

O sistema possui dois tipos de usuário:

### Admin (Administrador)
- **Usuário:** admin
- **Senha:** admin123
- **Permissões:** Acesso total ao sistema, visualiza todos os clientes, máquinas e processos

### Vendedor
- **Usuário:** vendedor1
- **Senha:** vend123
- **Permissões:** Visualiza apenas clientes vinculados ao seu nome (campo "vendedor")

**Importante:** Em produção, as senhas devem ser criptografadas e armazenadas em um backend seguro.

## 📁 Arquivos principais
- `index.html` - UI com tela de login e app principal
- `styles.css` - Estilos responsivos
- `app.js` - Lógica da aplicação (login, cadastros, sync, PDF)
- `auth.js` - Sistema de autenticação e usuários
- `db.js` - wrapper IndexedDB
- `config.js` - configurar URL do SheetDB e intervalos
- `service-worker.js` - cache
- `manifest.json` - PWA manifest

## 🚀 Como usar

1. Abra `config.js` e coloque a URL da sua API do SheetDB (ex: https://sheetdb.io/api/v1/XYZ)
2. Abra `index.html` no navegador (preferível rodar via um servidor local como Live Server)
3. **Faça login** com uma das contas de teste
4. Cadastre clientes, máquinas e processos
5. Vá em "Envio Produção", selecione o cliente, preencha os campos e salve localmente
6. A sincronização com SheetDB ocorrerá a cada X horas ou manualmente com "Sincronizar Agora"

## 👥 Fluxo por tipo de usuário

### Administrador
1. Login como admin
2. Cadastra todos os clientes (de todos os vendedores)
3. Cadastra máquinas e processos
4. Visualiza e gera relatórios de todos

### Vendedor
1. Login como vendedor
2. Vê apenas clientes onde o campo "vendedor" = seu nome
3. Pode cadastrar/editar apenas seus clientes
4. Gera relatórios apenas dos seus clientes

## 🔧 Adicionar novos usuários

Edite o arquivo `auth.js` e adicione novos usuários ao array `USERS`:

```javascript
{
  username: 'joao',
  password: 'senha123',
  role: 'vendedor',
  name: 'João Silva',
  sellerName: 'João Silva',  // Nome que aparece no campo vendedor dos clientes
  canEdit: true,
  canDelete: false
}
```

## 📝 Notas
- Você precisa criar as planilhas no Google Sheets e conectar usando SheetDB
- Envio de e-mails não está integrado a um serviço SMTP nesta versão
- Para produção, implemente autenticação backend real (JWT, OAuth, etc.)
