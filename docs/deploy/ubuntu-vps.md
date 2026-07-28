# Deploy Ubuntu/VPS

O projeto foi preparado para subir sem Docker e sem interferir em outros sites já instalados na VPS.

## O que o instalador faz

- usa pasta própria para a aplicação
- usa usuário de sistema próprio
- usa processo PM2 com nome exclusivo
- usa arquivo próprio no Nginx
- valida conflito de `SERVER_NAME` antes de alterar o Nginx
- valida conflito de porta antes de iniciar a API
- sugere uma porta livre quando a padrão estiver ocupada
- pede interativamente os dados principais da instalação
- reaproveita automaticamente os valores já definidos em `server/.env`
- mostra um resumo da instalação antes de executar
- detecta instalação anterior e orienta o uso de `update`
- oferece modo `desinstalar` com identificação segura da instalação existente
- grava `server/.env` com os dados informados
- instala SSL automaticamente com Certbot quando o Nginx está habilitado
- mostra uma tela final com URL pública, `.env`, PM2 e comandos úteis
- mostra um bloco final de status com banco, backend, frontend, PM2, Nginx e SSL
- cria backup dos arquivos sensíveis alterados durante a execução
- grava um marcador local para impedir `update` em uma pasta que não pertença a esta aplicação
- pode criar ou atualizar automaticamente o banco PostgreSQL local

## Fluxo recomendado

Suba o projeto para a VPS e rode o instalador a partir da pasta enviada:

```bash
cd /var/www/pesquisa
sudo bash scripts/ubuntu/install.sh
```

O assistente vai pedir:

- modo da instalação
- nome da aplicação
- porta interna da API
- pasta final da aplicação
- usuário de sistema
- domínio ou subdomínio
- URL pública do frontend
- se deve configurar o Nginx
- host, porta, banco, usuário e senha do PostgreSQL
- se deve criar o banco local automaticamente
- nome, e-mail e senha do administrador master

Pressione `Enter` para aceitar os valores sugeridos. No modo da instalação, use:

- `1` para instalar
- `2` para atualizar
- `3` para desinstalar

Se a aplicação já estiver instalada na pasta final, o assistente avisa e você pode rodar novamente com segurança. O modo mais indicado para reaplicar código e ajustes é `update`.

## Modo desinstalar

O modo `3` remove a instalação com segurança usando os próprios marcadores gerados pelo instalador:

- `APP_ROOT`
- arquivo `.deploy-meta`
- `server/.env`
- processo PM2 da aplicação
- arquivos do Nginx ligados ao `APP_NAME`

Ele não sai removendo diretórios por nome parecido. Antes de prosseguir, o instalador:

- confirma que encontrou a instalação correta
- mostra um resumo do que será removido
- exige a digitação de `REMOVER`

No modo `desinstalar`, você pode escolher se deseja:

- remover só a aplicação instalada
- remover também a pasta de origem enviada para a VPS
- remover também os backups gerados
- remover também o banco PostgreSQL local e o usuário do banco

Importante:

- a remoção automática do banco só é oferecida quando o banco apontar para o PostgreSQL local
- o modo `desinstalar` exige que o arquivo `.deploy-meta` exista na pasta final da instalação
- isso evita apagar outras aplicações por engano em VPS com vários sites

## Modo não interativo

Se você quiser automatizar a instalação, ainda é possível passar variáveis de ambiente:

```bash
sudo INTERACTIVE=false \
INSTALL_MODE=install \
APP_NAME=plataforma-pesquisas \
APP_PORT=4310 \
APP_ROOT=/var/www/plataforma-pesquisas \
APP_USER=plataforma-pesquisas \
SERVER_NAME=pesquisas.seudominio.com \
FRONTEND_URL=https://pesquisas.seudominio.com \
DB_HOST=127.0.0.1 \
DB_PORT=5432 \
DB_NAME=plataforma_pesquisas \
DB_USER=plataforma_pesquisas_user \
DB_PASSWORD=ColoqueUmaSenhaForte \
DB_CREATE_LOCAL=true \
MASTER_NAME=Administrador \
MASTER_EMAIL=admin@seudominio.com \
MASTER_PASSWORD=OutraSenhaForte \
bash scripts/ubuntu/install.sh
```

## Variáveis importantes

- `INSTALL_MODE`: `install`, `update` ou `uninstall`
- `APP_NAME`: nome lógico da aplicação
- `APP_PORT`: porta interna da API Express
- `APP_ROOT`: diretório final do projeto na VPS
- `APP_USER`: usuário de sistema dedicado
- `SERVER_NAME`: domínio ou subdomínio usado no Nginx
- `FRONTEND_URL`: URL pública real do frontend
- `DB_HOST`: host do PostgreSQL
- `DB_PORT`: porta do PostgreSQL
- `DB_NAME`: nome do banco
- `DB_USER`: usuário do banco
- `DB_PASSWORD`: senha do banco
- `DB_CREATE_LOCAL`: se `true`, cria ou ajusta o banco PostgreSQL local
- `MASTER_NAME`: nome do administrador principal
- `MASTER_EMAIL`: e-mail do administrador principal
- `MASTER_PASSWORD`: senha do administrador principal
- `SOURCE_DIR`: pasta de origem do código
- `BACKUP_ROOT`: raiz onde os backups da execução serão salvos
- `SYNC_DELETE`: se `true`, permite `rsync --delete` dentro de `APP_ROOT`
- `ENABLE_NGINX`: se `false`, instala a aplicação sem alterar o Nginx
- `INTERACTIVE`: `true`, `false` ou `auto`
- `REMOVE_DATABASE`: se `true`, remove o banco PostgreSQL local e o usuário do banco no modo `uninstall`
- `REMOVE_SOURCE_DIR`: se `true`, remove `SOURCE_DIR` no modo `uninstall`
- `REMOVE_BACKUPS`: se `true`, remove `BACKUP_ROOT` no modo `uninstall`

## Observações

- o Nginx publica o frontend estático de `web/dist`
- a API fica atrás de proxy reverso em `/api`
- quando `ENABLE_NGINX=true`, o instalador também instala o SSL automaticamente via Certbot
- em produção, a API deve rodar com `NODE_ENV=production`
- use `TRUST_PROXY=true` quando a aplicação estiver atrás do Nginx
- use `COOKIE_SECURE=true` quando a aplicação estiver publicada por HTTPS
- o instalador gera `JWT_SECRET` aleatório quando o valor ainda não existe ou está com placeholder inseguro
- os backups da execução ficam em `BACKUP_ROOT/<timestamp>`
- por segurança, `SYNC_DELETE` vem desativado por padrão
- o modo `uninstall` só executa quando encontra `.deploy-meta` dentro de `APP_ROOT`
- use um domínio real apontando para a VPS antes de rodar, ou a emissão do certificado vai falhar
- use um e-mail real em `MASTER_EMAIL`, porque ele será usado no Certbot
- ao final, o instalador mostra um resumo com frontend público, PM2, Nginx e próximos comandos úteis

## Checklist de produção

- garantir domínio apontando para a VPS
- validar que `SERVER_NAME` ainda não está em uso por outro site
- confirmar que a porta sugerida não conflita com outro serviço
- revisar `FRONTEND_URL`
- revisar `MASTER_EMAIL` e `MASTER_PASSWORD`
- validar login, criação de pesquisa, resposta pública e exportações após o deploy
