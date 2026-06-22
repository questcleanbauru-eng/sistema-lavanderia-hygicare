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
2. Rode localmente ou publique na web (instruções abaixo). Para desenvolvimento local há scripts prontos: `start-local.ps1` (PowerShell) e `start-local.bat` (Windows).
3. **Faça login** com uma das contas de teste
4. Cadastre clientes, máquinas e processos
5. Vá em "Envio Produção", selecione o cliente, preencha os campos e salve localmente
6. A sincronização com SheetDB ocorrerá a cada X horas ou manualmente com "Sincronizar Agora"

## 🌐 Publicar na web

Opções simples para publicar este projeto como um site estático (PWA): Vercel, GitHub Pages ou Netlify. Nenhum build step é necessário — os arquivos já são estáticos.

1) Vercel (recomendado)
- Crie uma conta em https://vercel.com e conecte seu repositório GitHub/GitLab/Bitbucket.
- Configure um novo projeto apontando para este repositório. Framework preset: "Other" ou "Static Site".
- Build command: (vazio)
- Output directory: `/` (raiz)
- Deploy. A cada push para a branch principal o site será atualizado automaticamente.

4) GitHub Pages via GitHub Actions (automático)
- Neste repositório já incluí um workflow GitHub Actions em `.github/workflows/deploy-pages.yml` que publica a raiz do projeto no GitHub Pages quando houver push para a branch `main`.
- Passos:
  1. Faça push do repositório para o GitHub (branch `main`).
  2. Vá em Settings → Pages e confirme a source (o workflow já fará o deploy automático quando um artefato for enviado).
  3. Aguarde alguns minutos após o push; a URL será https://<seu-usuario>.github.io/<repo>.

Observação: se preferir usar Vercel para deploy (mais simples e com HTTPS automático), siga as instruções do item 1.
2) GitHub Pages
- Faça push do repositório para o GitHub.
- Vá nas configurações do repo -> Pages -> Source e selecione a branch `main` (ou `gh-pages`) com a pasta `/ (root)`.
- Salve e aguarde a URL (geralmente https://<seu-usuario>.github.io/<repo>). Para SPAs, já incluí um `404.html` para fallback.

3) Netlify
- Crie uma conta em https://app.netlify.com e clique em "New site from Git".
- Conecte o repositório e escolha a branch. Build command: (vazio). Publish directory: `/`.
- Deploy.

## 🧪 Testar localmente

Opções rápidas no Windows:

PowerShell (recomendado):

```powershell
.\start-local.ps1 -Port 8080
```

CMD/Explorer:

```cmd
start-local.bat
```

Se você preferir usar ferramentas conhecidas:

```powershell
# Python 3
python -m http.server 8080

# ou com Node (http-server)
npx http-server -p 8080 -c-1
```

Abra então http://localhost:8080 no navegador.

## 📝 Notas
- O `service-worker.js` já está presente; ao publicar, garanta que o HTTPS esteja habilitado (Vercel/Netlify/GitHub Pages fornecem HTTPS automaticamente).
- Se usar um domínio customizado, configure o CNAME nas configurações da plataforma.

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
