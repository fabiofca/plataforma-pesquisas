# Plataforma Pesquisas

Plataforma web de pesquisas separada do projeto da rádio, com painel administrativo, página pública para respostas, roleta de prêmios, relatórios e controle de recursos por plano.

## Estrutura

```text
plataforma-pesquisas/
  web/      # frontend React + Vite
  server/   # API Node + Express + PostgreSQL
  scripts/  # scripts de desenvolvimento e deploy
  docs/     # documentação técnica
```

## Stack

- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express + TypeScript
- Banco: PostgreSQL
- Testes: Vitest
- Deploy: Ubuntu/VPS com PM2 + Nginx

## Funcionalidades já implementadas

- autenticação com perfis `master` e `user`
- cadastro público de conta
- gestão de usuários pelo perfil master
- editor de pesquisas com publicação por slug
- página pública para resposta de pesquisa
- compartilhamento por link e QR code
- rastreio de acessos por link e QR code
- relatórios por pesquisa com filtros por período
- exportações de relatórios em CSV e PDF pelo backend
- roleta de prêmios com campanha e itens configuráveis
- controle de recursos por plano no backend

## Regras do master padrão

A plataforma mantém um usuário master padrão persistido no banco pela coluna `is_default_master`.

Esse usuário:

- pode ter nome, email, telefone e senha alterados
- não pode perder a proteção ao trocar de email
- não pode ser rebaixado para `user`
- não pode ser bloqueado
- não pode ser removido

Masters criados depois continuam com comportamento normal e podem ser bloqueados ou removidos.

## Como rodar localmente

### 1. Backend

```bash
cd server
cp .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

### 2. Frontend

```bash
cd web
cp .env.example .env
npm install
npm run dev
```

### 3. Subir os dois lados no Windows

```powershell
./scripts/dev/start-all.ps1
```

## Variáveis principais

Backend em `server/.env`:

- `PORT`
- `FRONTEND_URL`
- `DATABASE_URL`
- `JWT_SECRET`
- `MASTER_NAME`
- `MASTER_EMAIL`
- `MASTER_PASSWORD`
- `REWARD_CODE_PREFIX`

Frontend em `web/.env`:

- `VITE_API_BASE_URL`

## Usuário master inicial

- Email padrão: `master@plataforma.local`
- Senha padrão: `master1234`

Altere isso antes de produção.

## Scripts úteis

- `server/npm run migrate`: aplica migrações SQL
- `server/npm run seed`: cria perfis básicos e garante o master padrão
- `server/npm run check`: valida o TypeScript do backend
- `server/npm test`: executa os testes do backend
- `web/npm run check`: valida o TypeScript do frontend
- `web/npm run lint`: executa o ESLint do frontend
- `web/npm test`: executa os testes do frontend
- `scripts/dev/smoke-api.mjs`: smoke test manual da API
- `scripts/ubuntu/install.sh`: instalador idempotente para Ubuntu/VPS

## Estado atual

- backend e frontend compilam com sucesso
- testes unitários atuais estão passando
- a migração `004_default_master_flag.sql` já está aplicada
- o seed do master padrão está idempotente
- QR code e exportações estão centralizados no backend

## Documentação relacionada

- `docs/api/visao-geral.md`
- `docs/deploy/ubuntu-vps.md`
