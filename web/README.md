# Frontend da Plataforma Pesquisas

Aplicação administrativa e pública construída com React, Vite e Tailwind CSS.

## Responsabilidades deste pacote

- autenticação e bootstrap de sessão
- painel administrativo para `master` e `user`
- cadastro público de conta
- editor de pesquisas
- compartilhamento público por slug
- relatórios, filtros por período e exportações
- gestão de prêmios, planos e configurações

## Scripts

- `npm run dev`: inicia o Vite em desenvolvimento
- `npm run build`: gera o build de produção
- `npm run preview`: sobe o build localmente
- `npm run check`: valida o TypeScript
- `npm run lint`: executa o ESLint
- `npm test`: executa os testes com Vitest

## Variáveis de ambiente

Crie `web/.env` com:

```bash
VITE_API_BASE_URL=/api
```

Em desenvolvimento local, o frontend espera que a API esteja disponível no mesmo host via proxy reverso ou configuração equivalente.

## Observações

- o frontend utiliza `credentials: include` para manter a sessão por cookie
- QR code e exportações CSV/PDF são baixados a partir do backend
- a visibilidade de alguns recursos depende do plano atribuído ao usuário
