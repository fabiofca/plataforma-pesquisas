# Visão Geral da API

API Express com autenticação por cookie HTTP-only, validação com Zod e persistência em PostgreSQL.

## Saúde

- `GET /api/health`

## Autenticação

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/auth/me`

## Usuários

Rotas restritas ao perfil `master`.

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`

Regra importante:

- o usuário com `is_default_master = true` pode ser editado
- esse usuário não pode ser bloqueado, removido ou rebaixado para `user`
- a proteção não depende do email atual do master

## Planos e recursos

Rotas restritas ao perfil `master`.

- `GET /api/plans`
- `POST /api/plans`
- `PATCH /api/plans/:id`
- `PATCH /api/plans/users/:userId`

Os recursos liberados por plano já afetam QR code, rastreio de compartilhamento e exportações.

## Pesquisas administrativas

Rotas autenticadas.

- `GET /api/surveys`
- `POST /api/surveys`
- `GET /api/surveys/:id`
- `PATCH /api/surveys/:id`
- `POST /api/surveys/:id/publish`
- `GET /api/surveys/:id/share/qr`

## Pesquisas públicas

- `GET /api/public/surveys/:slug`
- `POST /api/public/surveys/:slug/visit`
- `POST /api/public/surveys/:slug/eligibility`
- `POST /api/public/surveys/:slug/respond`
- `POST /api/public/surveys/:slug/spin`

## Relatórios

- `GET /api/surveys/:id/reports/summary`
- `GET /api/surveys/:id/reports/questions`
- `GET /api/reports/global`
- `GET /api/surveys/:id/reports/export/csv`
- `GET /api/surveys/:id/reports/export/pdf`

## Prêmios

- `GET /api/surveys/:id/rewards`
- `POST /api/surveys/:id/rewards`
- `POST /api/surveys/:id/rewards/items`
- `PATCH /api/rewards/items/:id`

## Configurações globais

Rotas restritas ao perfil `master`.

- `GET /api/system-settings`
- `PATCH /api/system-settings`

## Observações

- as exportações CSV e PDF são geradas no backend
- o QR code também é gerado no backend
- o frontend consome a API via cookie de sessão e `credentials: include`
