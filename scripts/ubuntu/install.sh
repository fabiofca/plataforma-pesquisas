#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-plataforma-pesquisas}"
APP_PORT="${APP_PORT:-}"
APP_ROOT="${APP_ROOT:-}"
APP_USER="${APP_USER:-}"
SERVER_NAME="${SERVER_NAME:-}"
FRONTEND_URL="${FRONTEND_URL:-}"
INSTALL_MODE="${INSTALL_MODE:-install}"
SYNC_DELETE="${SYNC_DELETE:-false}"
ENABLE_NGINX="${ENABLE_NGINX:-true}"
BACKUP_ROOT="${BACKUP_ROOT:-}"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
REMOVE_DATABASE="${REMOVE_DATABASE:-false}"
REMOVE_SOURCE_DIR="${REMOVE_SOURCE_DIR:-false}"
REMOVE_BACKUPS="${REMOVE_BACKUPS:-false}"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"
DB_CREATE_LOCAL="${DB_CREATE_LOCAL:-}"

MASTER_NAME="${MASTER_NAME:-Administrador}"
MASTER_EMAIL="${MASTER_EMAIL:-}"
MASTER_PASSWORD="${MASTER_PASSWORD:-}"

INTERACTIVE="${INTERACTIVE:-auto}"

NGINX_TEMPLATE=""
NGINX_SITE=""
NGINX_ENABLED=""
PM2_APP_NAME=""
APP_MARKER_FILE=""
BACKUP_TIMESTAMP=""
BACKUP_DIR=""
EXISTING_INSTALLATION="false"
CURRENT_STEP_KEY=""
CURRENT_STEP_LABEL=""
INSTALL_FAILED="false"
FAILURE_MESSAGE=""

STATUS_DATABASE="PENDENTE"
STATUS_BACKEND="PENDENTE"
STATUS_FRONTEND="PENDENTE"
STATUS_PM2="PENDENTE"
STATUS_NGINX="PENDENTE"
STATUS_SSL="PENDENTE"

log() {
  echo "[deploy:${APP_NAME}] $*"
}

fail() {
  echo "[deploy:${APP_NAME}] ERRO: $*" >&2
  exit 1
}

print_banner() {
  echo
  echo "============================================================"
  echo " Plataforma de Pesquisas - Instalador Ubuntu/VPS"
  echo "============================================================"
  echo
}

run_step() {
  local step_key="$1"
  local title="$2"
  shift 2

  CURRENT_STEP_KEY="${step_key}"
  CURRENT_STEP_LABEL="${title}"
  log "${title}..."
  "$@"
  mark_step_ok "${step_key}"
  CURRENT_STEP_KEY=""
  CURRENT_STEP_LABEL=""
}

set_step_status() {
  local step_key="$1"
  local value="$2"

  case "${step_key}" in
    database) STATUS_DATABASE="${value}" ;;
    backend) STATUS_BACKEND="${value}" ;;
    frontend) STATUS_FRONTEND="${value}" ;;
    pm2) STATUS_PM2="${value}" ;;
    nginx) STATUS_NGINX="${value}" ;;
    ssl) STATUS_SSL="${value}" ;;
  esac
}

mark_step_ok() {
  set_step_status "$1" "OK"
}

mark_step_failed() {
  set_step_status "$1" "FALHOU"
}

mark_step_skipped() {
  set_step_status "$1" "DESATIVADO"
}

print_status_line() {
  local label="$1"
  local status="$2"

  case "${status}" in
    OK)
      printf '[OK] %s\n' "${label}"
      ;;
    FALHOU)
      printf '[FALHOU] %s\n' "${label}"
      ;;
    DESATIVADO)
      printf '[--] %s\n' "${label}"
      ;;
    *)
      printf '[..] %s\n' "${label}"
      ;;
  esac
}

print_status_block() {
  echo
  echo "Status final"
  echo "------------"
  if [[ "${INSTALL_MODE}" == "uninstall" ]]; then
    print_status_line "Banco PostgreSQL" "${STATUS_DATABASE}"
    print_status_line "Aplicacao instalada" "${STATUS_BACKEND}"
    print_status_line "Pasta de origem" "${STATUS_FRONTEND}"
  else
    print_status_line "Banco PostgreSQL" "${STATUS_DATABASE}"
    print_status_line "Backend" "${STATUS_BACKEND}"
    print_status_line "Frontend" "${STATUS_FRONTEND}"
  fi
  print_status_line "PM2" "${STATUS_PM2}"
  print_status_line "Nginx" "${STATUS_NGINX}"
  print_status_line "SSL" "${STATUS_SSL}"
}

handle_error() {
  local exit_code="$1"
  local line_number="$2"

  INSTALL_FAILED="true"

  if [[ -n "${CURRENT_STEP_KEY}" ]]; then
    mark_step_failed "${CURRENT_STEP_KEY}"
  fi

  FAILURE_MESSAGE="Falha na etapa: ${CURRENT_STEP_LABEL:-execucao interna} (linha ${line_number}, codigo ${exit_code})."

  echo
  echo "============================================================"
  echo " Falha na instalacao"
  echo "============================================================"
  echo
  print_status_block
  echo
  echo "${FAILURE_MESSAGE}"
  echo
  echo "Sugestao: corrija o erro acima, mantenha os arquivos atualizados e rode o instalador novamente."
  exit "${exit_code}"
}

generate_secret() {
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
}

urlencode_component() {
  node -e "console.log(encodeURIComponent(process.argv[1] || ''))" "$1"
}

escape_regex() {
  printf '%s' "$1" | sed 's/[][(){}.^$+*?|\\]/\\&/g'
}

escape_sql_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

slugify_identifier() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9_]/_/g; s/__*/_/g; s/^_//; s/_$//'
}

refresh_runtime_paths() {
  local db_slug
  db_slug="$(slugify_identifier "${APP_NAME}")"
  [[ -n "${db_slug}" ]] || db_slug="plataforma_pesquisas"

  [[ -n "${APP_PORT}" ]] || APP_PORT="$(find_free_port 4310)"
  [[ -n "${APP_ROOT}" ]] || APP_ROOT="/var/www/${APP_NAME}"
  [[ -n "${APP_USER}" ]] || APP_USER="${APP_NAME}"
  [[ -n "${BACKUP_ROOT}" ]] || BACKUP_ROOT="/var/backups/${APP_NAME}"
  [[ -n "${DB_NAME}" ]] || DB_NAME="${db_slug}"
  [[ -n "${DB_USER}" ]] || DB_USER="${db_slug}_user"

  if [[ -z "${SERVER_NAME}" ]]; then
    SERVER_NAME="pesquisas.seudominio.com"
  fi

  if [[ -z "${FRONTEND_URL}" ]]; then
    if [[ "${SERVER_NAME}" == "_" || -z "${SERVER_NAME}" ]]; then
      FRONTEND_URL="http://localhost"
    else
      FRONTEND_URL="https://${SERVER_NAME}"
    fi
  fi

  if [[ -z "${MASTER_EMAIL}" ]]; then
    if [[ "${SERVER_NAME}" == "_" || -z "${SERVER_NAME}" || "${SERVER_NAME}" == "pesquisas.seudominio.com" ]]; then
      MASTER_EMAIL="admin@seudominio.com"
    else
      MASTER_EMAIL="admin@${SERVER_NAME}"
    fi
  fi

  NGINX_TEMPLATE="${SOURCE_DIR}/scripts/ubuntu/nginx.site.conf.template"
  NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}.conf"
  NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}.conf"
  PM2_APP_NAME="${APP_NAME}-server"
  APP_MARKER_FILE="${APP_ROOT}/.deploy-meta"
  BACKUP_TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="${BACKUP_ROOT}/${BACKUP_TIMESTAMP}"
}

is_true() {
  case "${1,,}" in
    1|true|yes|y|sim|s|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

should_prompt() {
  if is_true "${INTERACTIVE}"; then
    return 0
  fi

  if [[ "${INTERACTIVE}" == "auto" && -t 0 ]]; then
    return 0
  fi

  return 1
}

port_in_use() {
  local port="$1"
  ss -ltnH "( sport = :${port} )" 2>/dev/null | grep -q ":${port}"
}

find_free_port() {
  local candidate="${1:-4310}"

  while port_in_use "${candidate}"; do
    candidate=$((candidate + 1))
  done

  echo "${candidate}"
}

extract_env_value() {
  local file="$1"
  local key="$2"

  if [[ -f "${file}" ]]; then
    sed -n "s/^${key}=//p" "${file}" | head -n 1 || true
  fi
}

load_database_parts_from_url() {
  local url="$1"
  [[ -n "${url}" ]] || return 0

  node -e "
const raw = process.argv[1];
if (!raw) process.exit(0);
const parsed = new URL(raw);
const values = [
  parsed.hostname || '',
  parsed.port || '5432',
  parsed.pathname.replace(/^\\//, ''),
  decodeURIComponent(parsed.username || ''),
  decodeURIComponent(parsed.password || ''),
];
console.log(values.join('|'));
" "${url}"
}

extract_host_from_url() {
  local url="$1"
  [[ -n "${url}" ]] || return 0

  node -e "
const raw = process.argv[1];
if (!raw) process.exit(0);
const parsed = new URL(raw);
console.log(parsed.hostname || '');
" "${url}"
}

is_placeholder_value() {
  local value="${1:-}"

  case "${value}" in
    ''|pesquisas.seudominio.com|https://pesquisas.seudominio.com|http://localhost|admin@seudominio.com|master@plataforma.local|master1234|TroquePorUmaSenhaForte123|gere_uma_chave_grande_e_aleatoria_aqui|troque-esta-chave-em-producao|postgresql://usuario:senha@127.0.0.1:5432/plataforma_pesquisas)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

has_meaningful_value() {
  local value="${1:-}"
  [[ -n "${value//[[:space:]]/}" ]]
}

load_env_defaults_from_file() {
  local env_file="$1"
  local database_url=""
  local parsed=""
  local derived_server_name=""

  [[ -f "${env_file}" ]] || return 0

  if ! has_meaningful_value "${APP_PORT}"; then
    APP_PORT="$(extract_env_value "${env_file}" "PORT")"
  fi
  if ! has_meaningful_value "${FRONTEND_URL}"; then
    FRONTEND_URL="$(extract_env_value "${env_file}" "FRONTEND_URL")"
  fi
  if ! has_meaningful_value "${MASTER_NAME}"; then
    MASTER_NAME="$(extract_env_value "${env_file}" "MASTER_NAME")"
  fi
  if ! has_meaningful_value "${MASTER_EMAIL}"; then
    MASTER_EMAIL="$(extract_env_value "${env_file}" "MASTER_EMAIL")"
  fi
  if ! has_meaningful_value "${MASTER_PASSWORD}"; then
    MASTER_PASSWORD="$(extract_env_value "${env_file}" "MASTER_PASSWORD")"
  fi

  if [[ -z "${SERVER_NAME}" && -n "${FRONTEND_URL}" ]] && ! is_placeholder_value "${FRONTEND_URL}"; then
    derived_server_name="$(extract_host_from_url "${FRONTEND_URL}")"
    SERVER_NAME="${SERVER_NAME:-${derived_server_name}}"
  fi

  database_url="$(extract_env_value "${env_file}" "DATABASE_URL")"
  if [[ -n "${database_url}" ]] && ! is_placeholder_value "${database_url}"; then
    parsed="$(load_database_parts_from_url "${database_url}")"
    if [[ -n "${parsed}" ]]; then
      IFS='|' read -r parsed_host parsed_port parsed_name parsed_user parsed_password <<< "${parsed}"
      DB_HOST="${DB_HOST:-${parsed_host}}"
      DB_PORT="${DB_PORT:-${parsed_port}}"
      DB_NAME="${DB_NAME:-${parsed_name}}"
      DB_USER="${DB_USER:-${parsed_user}}"
      DB_PASSWORD="${DB_PASSWORD:-${parsed_password}}"
    fi
  fi
}

load_existing_install_state() {
  local env_file="${APP_ROOT}/server/.env"
  local database_url=""
  local parsed=""

  [[ -f "${env_file}" ]] || return 0

  if ! has_meaningful_value "${APP_PORT}"; then
    APP_PORT="$(extract_env_value "${env_file}" "PORT")"
  fi
  if ! has_meaningful_value "${FRONTEND_URL}"; then
    FRONTEND_URL="$(extract_env_value "${env_file}" "FRONTEND_URL")"
  fi
  if ! has_meaningful_value "${MASTER_NAME}"; then
    MASTER_NAME="$(extract_env_value "${env_file}" "MASTER_NAME")"
  fi
  if ! has_meaningful_value "${MASTER_EMAIL}"; then
    MASTER_EMAIL="$(extract_env_value "${env_file}" "MASTER_EMAIL")"
  fi
  if ! has_meaningful_value "${MASTER_PASSWORD}"; then
    MASTER_PASSWORD="$(extract_env_value "${env_file}" "MASTER_PASSWORD")"
  fi

  database_url="$(extract_env_value "${env_file}" "DATABASE_URL")"
  if [[ -n "${database_url}" ]]; then
    parsed="$(load_database_parts_from_url "${database_url}")"
    if [[ -n "${parsed}" ]]; then
      IFS='|' read -r parsed_host parsed_port parsed_name parsed_user parsed_password <<< "${parsed}"
      DB_HOST="${DB_HOST:-${parsed_host}}"
      DB_PORT="${DB_PORT:-${parsed_port}}"
      DB_NAME="${DB_NAME:-${parsed_name}}"
      DB_USER="${DB_USER:-${parsed_user}}"
      DB_PASSWORD="${DB_PASSWORD:-${parsed_password}}"
    fi
  fi
}

load_existing_marker_state() {
  [[ -f "${APP_MARKER_FILE}" ]] || return 0

  APP_NAME="${APP_NAME:-$(extract_env_value "${APP_MARKER_FILE}" "APP_NAME")}"
  APP_USER="${APP_USER:-$(extract_env_value "${APP_MARKER_FILE}" "APP_USER")}"
  APP_PORT="${APP_PORT:-$(extract_env_value "${APP_MARKER_FILE}" "APP_PORT")}"
  SERVER_NAME="${SERVER_NAME:-$(extract_env_value "${APP_MARKER_FILE}" "SERVER_NAME")}"
  FRONTEND_URL="${FRONTEND_URL:-$(extract_env_value "${APP_MARKER_FILE}" "FRONTEND_URL")}"
}

detect_existing_installation() {
  if [[ -f "${APP_MARKER_FILE}" ]]; then
    EXISTING_INSTALLATION="true"
  else
    EXISTING_INSTALLATION="false"
  fi
}

prompt_value() {
  local message="$1"
  local current_value="$2"
  local answer=""

  if [[ -n "${current_value}" ]]; then
    read -r -p "${message} [${current_value}]: " answer
  else
    read -r -p "${message}: " answer
  fi

  if [[ -n "${answer}" ]]; then
    printf '%s\n' "${answer}"
  else
    printf '%s\n' "${current_value}"
  fi
}

prompt_secret() {
  local message="$1"
  local current_value="$2"
  local answer=""
  local confirmation=""

  while true; do
    if [[ -n "${current_value}" ]]; then
      read -r -s -p "${message} [Enter para manter o valor atual]: " answer
      echo
      if [[ -z "${answer}" ]]; then
        printf '%s\n' "${current_value}"
        return 0
      fi
    else
      read -r -s -p "${message}: " answer
      echo
    fi

    [[ -n "${answer}" ]] || {
      echo "Informe um valor."
      continue
    }

    read -r -s -p "Confirme: " confirmation
    echo

    if [[ "${answer}" == "${confirmation}" ]]; then
      printf '%s\n' "${answer}"
      return 0
    fi

    echo "Os valores não conferem. Tente novamente."
  done
}

prompt_boolean() {
  local message="$1"
  local current_value="$2"
  local default_label="S/n"
  local answer=""

  if ! is_true "${current_value}"; then
    default_label="s/N"
  fi

  while true; do
    read -r -p "${message} [${default_label}]: " answer

    if [[ -z "${answer}" ]]; then
      printf '%s\n' "${current_value}"
      return 0
    fi

    case "${answer,,}" in
      s|sim|y|yes)
        printf 'true\n'
        return 0
        ;;
      n|nao|não|no)
        printf 'false\n'
        return 0
        ;;
      *)
        echo "Responda com s ou n."
        ;;
    esac
  done
}

prompt_install_mode() {
  local answer=""

  while true; do
    echo "Escolha o modo da instalacao:"
    echo "  1) Instalar"
    echo "  2) Atualizar"
    echo "  3) Desinstalar"
    read -r -p "Opcao [1/2/3] [${INSTALL_MODE}]: " answer
    answer="${answer:-${INSTALL_MODE}}"

    case "${answer}" in
      1|install)
        INSTALL_MODE="install"
        return 0
        ;;
      2|update)
        INSTALL_MODE="update"
        return 0
        ;;
      3|uninstall|desinstalar)
        INSTALL_MODE="uninstall"
        return 0
        ;;
      *)
        echo "Digite 1 para instalar, 2 para atualizar ou 3 para desinstalar."
        ;;
    esac
  done
}

print_execution_plan() {
  echo
  if [[ "${INSTALL_MODE}" == "uninstall" ]]; then
    echo "Resumo da desinstalacao"
    echo "----------------------"
    printf 'Modo................: desinstalar\n'
    printf 'Aplicacao...........: %s\n' "${APP_NAME}"
    printf 'Pasta final.........: %s\n' "${APP_ROOT}"
    printf 'Usuario do sistema..: %s\n' "${APP_USER}"
    if [[ -n "${SERVER_NAME}" && "${SERVER_NAME}" != "_" ]]; then
      printf 'Dominio.............: %s\n' "${SERVER_NAME}"
    fi
    if [[ -n "${FRONTEND_URL}" ]]; then
      printf 'Frontend publico....: %s\n' "${FRONTEND_URL}"
    fi
    printf 'Remover banco.......: %s\n' "${REMOVE_DATABASE}"
    printf 'Remover origem......: %s\n' "${REMOVE_SOURCE_DIR}"
    printf 'Remover backups.....: %s\n' "${REMOVE_BACKUPS}"
    if [[ "${EXISTING_INSTALLATION}" == "true" ]]; then
      printf 'Instalacao existente: sim\n'
    else
      printf 'Instalacao existente: nao\n'
    fi
    echo
    return 0
  fi

  echo "Resumo da instalacao"
  echo "-------------------"
  printf 'Modo................: %s\n' "${INSTALL_MODE}"
  printf 'Aplicacao...........: %s\n' "${APP_NAME}"
  printf 'Pasta final.........: %s\n' "${APP_ROOT}"
  printf 'Usuario do sistema..: %s\n' "${APP_USER}"
  printf 'Porta interna.......: %s\n' "${APP_PORT}"
  printf 'Frontend publico....: %s\n' "${FRONTEND_URL}"
  if [[ "${ENABLE_NGINX}" == "true" ]]; then
    printf 'Dominio.............: %s\n' "${SERVER_NAME}"
    printf 'Nginx/SSL...........: automatico\n'
  else
    printf 'Nginx/SSL...........: desativado\n'
  fi
  printf 'Banco...............: %s (%s@%s:%s)\n' "${DB_NAME}" "${DB_USER}" "${DB_HOST}" "${DB_PORT}"
  printf 'Criar banco local...: %s\n' "${DB_CREATE_LOCAL}"
  printf 'Administrador.......: %s\n' "${MASTER_EMAIL}"
  if [[ "${EXISTING_INSTALLATION}" == "true" ]]; then
    printf 'Instalacao existente: sim\n'
  else
    printf 'Instalacao existente: nao\n'
  fi
  echo
}

confirm_execution_plan() {
  local answer=""

  if [[ "${INSTALL_MODE}" == "uninstall" ]]; then
    read -r -p "Digite REMOVER para confirmar a desinstalacao: " answer
    [[ "${answer}" == "REMOVER" ]] || fail "Desinstalacao cancelada pelo usuario."
    return 0
  fi

  while true; do
    read -r -p "Continuar com esta instalacao? [S/n]: " answer
    answer="${answer:-s}"
    case "${answer,,}" in
      s|sim|y|yes)
        return 0
        ;;
      n|nao|não|no)
        fail "Instalacao cancelada pelo usuario."
        ;;
      *)
        echo "Responda com s ou n."
        ;;
    esac
  done
}

prompt_port() {
  local suggested_port="$1"
  local answer=""

  while true; do
    read -r -p "Porta interna da API [${suggested_port}]: " answer
    answer="${answer:-${suggested_port}}"

    if [[ "${answer}" =~ ^[0-9]+$ ]] && (( answer >= 1 && answer <= 65535 )); then
      APP_PORT="${answer}"
      return 0
    fi

    echo "Informe uma porta válida entre 1 e 65535."
  done
}

validate_mode() {
  case "${INSTALL_MODE}" in
    install|update|uninstall)
      ;;
    *)
      fail "INSTALL_MODE inválido. Use install, update ou uninstall."
      ;;
  esac
}

validate_paths() {
  [[ "${APP_ROOT}" == /* ]] || fail "APP_ROOT deve ser absoluto."

  if [[ "${INSTALL_MODE}" != "uninstall" ]]; then
    [[ "${BACKUP_ROOT}" == /* ]] || fail "BACKUP_ROOT deve ser absoluto."
    [[ -d "${SOURCE_DIR}" ]] || fail "SOURCE_DIR não encontrado: ${SOURCE_DIR}"
    [[ -f "${NGINX_TEMPLATE}" ]] || fail "Template do Nginx não encontrado: ${NGINX_TEMPLATE}"
  fi

  case "${APP_ROOT}" in
    /|/etc|/bin|/sbin|/usr|/var|/home|/root)
      fail "APP_ROOT inseguro. Escolha uma subpasta dedicada, por exemplo /var/www/${APP_NAME}."
      ;;
  esac
}

validate_database_identifiers() {
  [[ "${DB_NAME}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail "DB_NAME inválido. Use apenas letras, números e underscore."
  [[ "${DB_USER}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || fail "DB_USER inválido. Use apenas letras, números e underscore."
}

ensure_required_values() {
  if [[ "${INSTALL_MODE}" == "uninstall" ]]; then
    [[ -n "${APP_NAME}" ]] || fail "APP_NAME não pode ficar vazio."
    [[ -n "${APP_ROOT}" ]] || fail "APP_ROOT não pode ficar vazio."
    return 0
  fi

  [[ -n "${APP_NAME}" ]] || fail "APP_NAME não pode ficar vazio."
  [[ -n "${APP_PORT}" ]] || fail "APP_PORT não pode ficar vazio."
  [[ -n "${APP_ROOT}" ]] || fail "APP_ROOT não pode ficar vazio."
  [[ -n "${APP_USER}" ]] || fail "APP_USER não pode ficar vazio."
  [[ -n "${FRONTEND_URL}" ]] || fail "FRONTEND_URL não pode ficar vazio."
  [[ -n "${DB_HOST}" ]] || fail "DB_HOST não pode ficar vazio."
  [[ -n "${DB_PORT}" ]] || fail "DB_PORT não pode ficar vazio."
  [[ -n "${DB_NAME}" ]] || fail "DB_NAME não pode ficar vazio."
  [[ -n "${DB_USER}" ]] || fail "DB_USER não pode ficar vazio."
  [[ -n "${DB_PASSWORD}" ]] || fail "DB_PASSWORD não pode ficar vazio."
  [[ -n "${MASTER_EMAIL}" ]] || fail "MASTER_EMAIL não pode ficar vazio."
  [[ -n "${MASTER_PASSWORD}" ]] || fail "MASTER_PASSWORD não pode ficar vazio."
  [[ ${#MASTER_PASSWORD} -ge 6 ]] || fail "MASTER_PASSWORD precisa ter pelo menos 6 caracteres."

  if is_true "${ENABLE_NGINX}" && { [[ -z "${SERVER_NAME}" ]] || [[ "${SERVER_NAME}" == "_" ]]; }; then
    fail "Informe SERVER_NAME quando ENABLE_NGINX=true."
  fi

  if is_true "${ENABLE_NGINX}" && [[ "${SERVER_NAME}" == *"seudominio.com"* ]]; then
    fail "Troque SERVER_NAME por um domínio real antes de continuar, pois o SSL será instalado automaticamente."
  fi

  if is_true "${ENABLE_NGINX}" && [[ "${MASTER_EMAIL}" == *"seudominio.com"* ]]; then
    fail "Troque MASTER_EMAIL por um e-mail real antes de continuar, pois ele será usado para emitir o SSL."
  fi
}

ensure_uninstall_target_is_safe() {
  [[ -f "${APP_MARKER_FILE}" ]] || fail "Nao foi possivel confirmar a instalacao em ${APP_ROOT}. O arquivo .deploy-meta nao foi encontrado."
}

ensure_base_commands() {
  local base_commands=(rsync sed grep find ss npm node)
  local cmd=""

  for cmd in "${base_commands[@]}"; do
    command -v "${cmd}" >/dev/null 2>&1 || fail "Comando obrigatório ausente: ${cmd}"
  done

  if is_true "${ENABLE_NGINX}"; then
    command -v nginx >/dev/null 2>&1 || fail "Nginx não encontrado. Instale-o antes de continuar ou use ENABLE_NGINX=false."
    command -v apt-get >/dev/null 2>&1 || fail "apt-get não encontrado. A instalação automática do SSL exige Ubuntu/Debian com apt-get."
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    log "PM2 não encontrado. Instalando globalmente..."
    npm install -g pm2
  fi
}

ensure_system_user() {
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    log "Criando usuário de sistema ${APP_USER}"
    useradd --system --create-home --shell /bin/bash "${APP_USER}"
  fi
}

ensure_app_root_is_safe() {
  if [[ "${INSTALL_MODE}" == "install" ]]; then
    if [[ -d "${APP_ROOT}" ]] && find "${APP_ROOT}" -mindepth 1 -maxdepth 1 | read -r _; then
      [[ -f "${APP_MARKER_FILE}" ]] || fail "APP_ROOT já contém arquivos que não pertencem a esta aplicação: ${APP_ROOT}"
    fi
    return
  fi

  [[ -f "${APP_MARKER_FILE}" ]] || fail "Modo update exige um APP_ROOT já provisionado por este instalador."
}

ensure_server_name_is_safe() {
  local escaped_server_name=""
  local conflict=""

  if ! is_true "${ENABLE_NGINX}"; then
    return
  fi

  escaped_server_name="$(escape_regex "${SERVER_NAME}")"
  conflict="$(
    grep -R -l -E "server_name[[:space:]]+([^;]*[[:space:]])?${escaped_server_name}([[:space:]]|;)" /etc/nginx/sites-available /etc/nginx/sites-enabled 2>/dev/null \
      | grep -v -F "${NGINX_SITE}" \
      | grep -v -F "${NGINX_ENABLED}" \
      | head -n 1 || true
  )"

  [[ -z "${conflict}" ]] || fail "SERVER_NAME já está em uso no Nginx: ${SERVER_NAME} (${conflict})"
}

ensure_port_free() {
  local port="$1"
  local existing_app_port=""

  if [[ -f "${APP_ROOT}/server/.env" ]]; then
    existing_app_port="$(extract_env_value "${APP_ROOT}/server/.env" "PORT")"
  fi

  if port_in_use "${port}"; then
    if [[ -n "${existing_app_port}" && "${existing_app_port}" == "${port}" ]]; then
      return
    fi

    fail "A porta ${port} já está em uso. Escolha outra porta."
  fi
}

prepare_directories() {
  install -d -m 755 -o "${APP_USER}" -g "${APP_USER}" "${APP_ROOT}"
  install -d -m 755 "${BACKUP_DIR}"
}

backup_existing_files() {
  if [[ -f "${APP_ROOT}/server/.env" ]]; then
    cp "${APP_ROOT}/server/.env" "${BACKUP_DIR}/server.env.bak"
  fi

  if [[ -f "${NGINX_SITE}" ]]; then
    cp "${NGINX_SITE}" "${BACKUP_DIR}/nginx-site.conf.bak"
  fi

  if [[ -f "${APP_MARKER_FILE}" ]]; then
    cp "${APP_MARKER_FILE}" "${BACKUP_DIR}/deploy-meta.bak"
  fi
}

sync_project() {
  local rsync_delete_flag=()

  if is_true "${SYNC_DELETE}"; then
    rsync_delete_flag=(--delete --delete-delay)
  fi

  rsync -a "${rsync_delete_flag[@]}" \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.env' \
    --exclude 'server/uploads' \
    "${SOURCE_DIR}/" "${APP_ROOT}/"

  chown -R "${APP_USER}:${APP_USER}" "${APP_ROOT}"
}

write_deploy_marker() {
  cat > "${APP_MARKER_FILE}" <<EOF
APP_NAME=${APP_NAME}
APP_USER=${APP_USER}
APP_PORT=${APP_PORT}
SERVER_NAME=${SERVER_NAME}
FRONTEND_URL=${FRONTEND_URL}
INSTALLED_AT=$(date -Iseconds)
EOF

  chown "${APP_USER}:${APP_USER}" "${APP_MARKER_FILE}"
}

replace_or_append_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local temp_file=""

  temp_file="$(mktemp)"

  awk -v key="${key}" -v value="${value}" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) {
        print key "=" value
      }
    }
  ' "${file}" > "${temp_file}"

  mv "${temp_file}" "${file}"
}

build_database_url() {
  local encoded_user encoded_password
  encoded_user="$(urlencode_component "${DB_USER}")"
  encoded_password="$(urlencode_component "${DB_PASSWORD}")"
  printf 'postgresql://%s:%s@%s:%s/%s\n' "${encoded_user}" "${encoded_password}" "${DB_HOST}" "${DB_PORT}" "${DB_NAME}"
}

ensure_env_files() {
  local database_url=""

  if [[ ! -f "${APP_ROOT}/server/.env" ]]; then
    cp "${APP_ROOT}/server/.env.example" "${APP_ROOT}/server/.env"
  fi

  database_url="$(build_database_url)"

  replace_or_append_env "${APP_ROOT}/server/.env" "PORT" "${APP_PORT}"
  replace_or_append_env "${APP_ROOT}/server/.env" "NODE_ENV" "production"
  replace_or_append_env "${APP_ROOT}/server/.env" "FRONTEND_URL" "${FRONTEND_URL}"
  replace_or_append_env "${APP_ROOT}/server/.env" "DATABASE_URL" "${database_url}"
  replace_or_append_env "${APP_ROOT}/server/.env" "TRUST_PROXY" "true"
  replace_or_append_env "${APP_ROOT}/server/.env" "COOKIE_SECURE" "true"
  replace_or_append_env "${APP_ROOT}/server/.env" "MASTER_NAME" "${MASTER_NAME}"
  replace_or_append_env "${APP_ROOT}/server/.env" "MASTER_EMAIL" "${MASTER_EMAIL}"
  replace_or_append_env "${APP_ROOT}/server/.env" "MASTER_PASSWORD" "${MASTER_PASSWORD}"

  if ! grep -q '^JWT_SECRET=' "${APP_ROOT}/server/.env" \
    || grep -q '^JWT_SECRET=dev-' "${APP_ROOT}/server/.env" \
    || grep -q '^JWT_SECRET=plataforma-pesquisas-secret$' "${APP_ROOT}/server/.env" \
    || grep -q '^JWT_SECRET=troque-esta-chave-em-producao$' "${APP_ROOT}/server/.env" \
    || grep -q '^JWT_SECRET=gere_uma_chave_grande_e_aleatoria_aqui$' "${APP_ROOT}/server/.env"; then
    replace_or_append_env "${APP_ROOT}/server/.env" "JWT_SECRET" "$(generate_secret)"
  fi

  chown "${APP_USER}:${APP_USER}" "${APP_ROOT}/server/.env"
}

is_local_database_host() {
  case "${DB_HOST}" in
    127.0.0.1|localhost|::1)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_local_database() {
  local escaped_password=""
  local role_exists=""
  local database_exists=""

  if ! is_true "${DB_CREATE_LOCAL}"; then
    mark_step_skipped "database"
    return
  fi

  command -v psql >/dev/null 2>&1 || fail "psql não encontrado. Instale o cliente PostgreSQL ou use DB_CREATE_LOCAL=false."
  id -u postgres >/dev/null 2>&1 || fail "Usuário postgres não encontrado para criar o banco local automaticamente."

  validate_database_identifiers
  escaped_password="$(escape_sql_literal "${DB_PASSWORD}")"
  role_exists="$(sudo -u postgres psql postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | tr -d '[:space:]' || true)"
  database_exists="$(sudo -u postgres psql postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | tr -d '[:space:]' || true)"

  log "Garantindo usuário e banco PostgreSQL locais..."
  if [[ "${role_exists}" == "1" ]]; then
    sudo -u postgres psql postgres -c "ALTER ROLE \"${DB_USER}\" WITH LOGIN PASSWORD '${escaped_password}';"
  else
    sudo -u postgres psql postgres -c "CREATE ROLE \"${DB_USER}\" LOGIN PASSWORD '${escaped_password}';"
  fi

  if [[ "${database_exists}" != "1" ]]; then
    sudo -u postgres psql postgres -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"
  fi

  sudo -u postgres psql postgres -c "ALTER DATABASE \"${DB_NAME}\" OWNER TO \"${DB_USER}\";"
  sudo -u postgres psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE \"${DB_NAME}\" TO \"${DB_USER}\";"
}

safe_remove_dir() {
  local target="$1"

  [[ -n "${target}" ]] || fail "Diretorio vazio informado para remocao."
  [[ "${target}" == /* ]] || fail "Diretorio inseguro para remocao: ${target}"

  case "${target}" in
    /|/etc|/bin|/sbin|/usr|/var|/var/www|/home|/root)
      fail "Diretorio bloqueado para remocao: ${target}"
      ;;
  esac

  rm -rf "${target}"
}

remove_pm2_process() {
  if ! command -v pm2 >/dev/null 2>&1; then
    mark_step_skipped "pm2"
    return
  fi

  if id -u "${APP_USER}" >/dev/null 2>&1; then
    sudo -u "${APP_USER}" bash -lc "pm2 delete '${PM2_APP_NAME}' >/dev/null 2>&1 || true; pm2 save >/dev/null 2>&1 || true"
  else
    pm2 delete "${PM2_APP_NAME}" >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
  fi
}

remove_nginx_configuration() {
  if [[ -L "${NGINX_ENABLED}" || -f "${NGINX_ENABLED}" ]]; then
    rm -f "${NGINX_ENABLED}"
  fi

  if [[ -f "${NGINX_SITE}" ]]; then
    rm -f "${NGINX_SITE}"
  fi

  if command -v nginx >/dev/null 2>&1; then
    nginx -t
    systemctl reload nginx
  else
    mark_step_skipped "nginx"
  fi
}

remove_ssl_certificate() {
  if [[ -z "${SERVER_NAME}" || "${SERVER_NAME}" == "_" ]]; then
    mark_step_skipped "ssl"
    return
  fi

  if ! command -v certbot >/dev/null 2>&1; then
    mark_step_skipped "ssl"
    return
  fi

  if certbot certificates 2>/dev/null | grep -q "Certificate Name: ${SERVER_NAME}"; then
    certbot delete --non-interactive --cert-name "${SERVER_NAME}"
  else
    mark_step_skipped "ssl"
  fi
}

remove_application_root() {
  if [[ -d "${APP_ROOT}" ]]; then
    safe_remove_dir "${APP_ROOT}"
  else
    mark_step_skipped "backend"
  fi
}

remove_source_directory() {
  if ! is_true "${REMOVE_SOURCE_DIR}"; then
    mark_step_skipped "frontend"
    return
  fi

  if [[ "${SOURCE_DIR}" == "${APP_ROOT}" ]]; then
    mark_step_skipped "frontend"
    return
  fi

  if [[ -d "${SOURCE_DIR}" ]]; then
    safe_remove_dir "${SOURCE_DIR}"
  else
    mark_step_skipped "frontend"
  fi
}

remove_backups_directory() {
  if ! is_true "${REMOVE_BACKUPS}"; then
    return
  fi

  if [[ -d "${BACKUP_ROOT}" ]]; then
    safe_remove_dir "${BACKUP_ROOT}"
  fi
}

remove_local_database() {
  if ! is_true "${REMOVE_DATABASE}"; then
    mark_step_skipped "database"
    return
  fi

  if ! is_local_database_host; then
    fail "A remocao automatica do banco so e suportada quando DB_HOST aponta para o PostgreSQL local."
  fi

  command -v psql >/dev/null 2>&1 || fail "psql nao encontrado para remover o banco."
  id -u postgres >/dev/null 2>&1 || fail "Usuario postgres nao encontrado para remover o banco."

  sudo -u postgres psql postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  sudo -u postgres psql postgres -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
  sudo -u postgres psql postgres -c "DROP ROLE IF EXISTS \"${DB_USER}\";"
}

install_dependencies_and_build() {
  sudo -u "${APP_USER}" bash -lc "cd '${APP_ROOT}/server' && npm install && npm run migrate && npm run seed && npm run build"
}

install_frontend_and_build() {
  sudo -u "${APP_USER}" bash -lc "cd '${APP_ROOT}/web' && npm install && npm run build"
}

configure_pm2() {
  local ecosystem="${APP_ROOT}/scripts/ubuntu/ecosystem.config.cjs"
  cat > "${ecosystem}" <<EOF
module.exports = {
  apps: [
    {
      name: "${PM2_APP_NAME}",
      cwd: "${APP_ROOT}/server",
      script: "dist/server.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
}
EOF

  chown "${APP_USER}:${APP_USER}" "${ecosystem}"
  sudo -u "${APP_USER}" bash -lc "cd '${APP_ROOT}' && pm2 startOrReload '${ecosystem}' && pm2 save"
}

configure_nginx() {
  if [[ "${ENABLE_NGINX}" != "true" ]]; then
    mark_step_skipped "nginx"
    return
  fi

  sed \
    -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    -e "s|__APP_DIR__|${APP_ROOT}|g" \
    -e "s|__APP_PORT__|${APP_PORT}|g" \
    "${NGINX_TEMPLATE}" > "${NGINX_SITE}"

  ln -sfn "${NGINX_SITE}" "${NGINX_ENABLED}"
  nginx -t
  systemctl reload nginx
}

ensure_certbot() {
  [[ "${ENABLE_NGINX}" == "true" ]] || return

  if command -v certbot >/dev/null 2>&1 && dpkg -s python3-certbot-nginx >/dev/null 2>&1; then
    return
  fi

  log "Instalando Certbot e plugin do Nginx para configurar SSL..."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
}

configure_ssl() {
  if [[ "${ENABLE_NGINX}" != "true" ]]; then
    mark_step_skipped "ssl"
    return
  fi

  if [[ -z "${SERVER_NAME}" || "${SERVER_NAME}" == "_" ]]; then
    mark_step_skipped "ssl"
    return
  fi

  ensure_certbot

  log "Emitindo certificado SSL para ${SERVER_NAME}..."
  certbot --nginx \
    --non-interactive \
    --agree-tos \
    --redirect \
    --email "${MASTER_EMAIL}" \
    -d "${SERVER_NAME}"

  systemctl reload nginx
}

print_summary() {
  local env_file="${APP_ROOT}/server/.env"

  log "Instalação concluída com sucesso."
  log "Modo: ${INSTALL_MODE}"
  log "Aplicação: ${APP_ROOT}"
  log "API interna: 127.0.0.1:${APP_PORT}"
  log "Frontend público: ${FRONTEND_URL}"
  log "Banco: ${DB_NAME} (${DB_USER}@${DB_HOST}:${DB_PORT})"
  log "Usuário de sistema: ${APP_USER}"
  log "Backup desta execução: ${BACKUP_DIR}"

  if [[ "${ENABLE_NGINX}" == "true" ]]; then
    log "Site Nginx: ${NGINX_SITE}"
    log "SSL: configurado para ${SERVER_NAME}"
  else
    log "Nginx não foi alterado porque ENABLE_NGINX=false"
  fi

  log "Processo PM2: ${PM2_APP_NAME}"
  log "Arquivo .env: ${env_file}"
  log "Status esperado do PM2: online"

  print_status_block
  echo
  echo "Resumo operacional"
  echo "------------------"
  printf 'URL publica..............: %s\n' "${FRONTEND_URL}"
  printf 'API interna..............: http://127.0.0.1:%s\n' "${APP_PORT}"
  printf 'Arquivo .env.............: %s\n' "${env_file}"
  printf 'Processo PM2.............: %s\n' "${PM2_APP_NAME}"
  printf 'Status esperado do PM2...: online\n'
  if [[ "${ENABLE_NGINX}" == "true" ]]; then
    printf 'Arquivo do Nginx.........: %s\n' "${NGINX_SITE}"
    printf 'SSL......................: ativo para %s\n' "${SERVER_NAME}"
  else
    printf 'Arquivo do Nginx.........: nao configurado\n'
    printf 'SSL......................: nao configurado\n'
  fi

  echo
  echo "Comandos uteis"
  echo "--------------"
  printf 'pm2 status\n'
  printf 'pm2 logs %s\n' "${PM2_APP_NAME}"
  printf 'pm2 restart %s\n' "${PM2_APP_NAME}"
  printf 'cat %s\n' "${env_file}"
  printf 'nano %s\n' "${env_file}"
  if [[ "${ENABLE_NGINX}" == "true" ]]; then
    printf 'nginx -t\n'
    printf 'systemctl status nginx\n'
    printf 'systemctl reload nginx\n'
  fi
}

run_interactive_setup() {
  local suggested_port=""

  print_banner
  echo "Assistente de instalação da Plataforma de Pesquisas"
  echo "Pressione Enter para aceitar os valores sugeridos."
  echo

  load_env_defaults_from_file "${SOURCE_DIR}/server/.env"
  prompt_install_mode

  refresh_runtime_paths
  APP_NAME="$(prompt_value "Nome da aplicação" "${APP_NAME}")"
  refresh_runtime_paths

  APP_ROOT="$(prompt_value "Pasta final da aplicação" "${APP_ROOT}")"
  APP_USER="$(prompt_value "Usuário de sistema da aplicação" "${APP_USER}")"

  load_existing_marker_state
  load_env_defaults_from_file "${SOURCE_DIR}/server/.env"
  load_existing_install_state
  refresh_runtime_paths
  detect_existing_installation

  if [[ "${EXISTING_INSTALLATION}" == "true" ]]; then
    echo
    echo "Instalacao existente detectada em ${APP_ROOT}."
    echo "Voce pode rodar novamente sem perder a estrutura criada."
    echo "Para reaplicar codigo e configuracoes, o modo recomendado e update."
    echo
  fi

  if [[ "${INSTALL_MODE}" == "uninstall" ]]; then
    REMOVE_DATABASE="false"
    REMOVE_SOURCE_DIR="false"
    REMOVE_BACKUPS="false"

    if [[ "${EXISTING_INSTALLATION}" == "true" ]] && is_local_database_host && [[ -n "${DB_NAME}" && -n "${DB_USER}" ]]; then
      REMOVE_DATABASE="$(prompt_boolean "Remover tambem o banco PostgreSQL local e o usuario do banco?" "${REMOVE_DATABASE}")"
    fi

    REMOVE_SOURCE_DIR="$(prompt_boolean "Remover tambem a pasta de origem enviada (${SOURCE_DIR})?" "${REMOVE_SOURCE_DIR}")"
    REMOVE_BACKUPS="$(prompt_boolean "Remover tambem a pasta de backups (${BACKUP_ROOT})?" "${REMOVE_BACKUPS}")"

    print_execution_plan
    confirm_execution_plan
    echo
    return 0
  fi

  if [[ -z "${APP_PORT}" ]] || is_placeholder_value "${APP_PORT}"; then
    suggested_port="${APP_PORT:-4310}"
    if [[ "${INSTALL_MODE}" == "install" ]] || ! [[ -f "${APP_ROOT}/server/.env" ]]; then
      suggested_port="$(find_free_port "${suggested_port}")"
    fi
    prompt_port "${suggested_port}"
  fi

  if [[ -z "${SERVER_NAME}" ]] || is_placeholder_value "${SERVER_NAME}"; then
    SERVER_NAME="$(prompt_value "Domínio ou subdomínio do frontend" "${SERVER_NAME}")"
    if [[ -z "${SERVER_NAME}" ]]; then
      SERVER_NAME="_"
    fi
  fi

  if [[ -z "${FRONTEND_URL}" || "${FRONTEND_URL}" == "https://pesquisas.seudominio.com" || "${FRONTEND_URL}" == "http://localhost" ]]; then
    if [[ "${SERVER_NAME}" == "_" ]]; then
      FRONTEND_URL="http://localhost"
    else
      FRONTEND_URL="https://${SERVER_NAME}"
    fi
  fi

  if [[ -z "${MASTER_EMAIL}" || "${MASTER_EMAIL}" == "admin@seudominio.com" ]]; then
    if [[ "${SERVER_NAME}" == "_" ]]; then
      MASTER_EMAIL="admin@seudominio.com"
    else
      MASTER_EMAIL="admin@${SERVER_NAME}"
    fi
  fi

  refresh_runtime_paths
  if [[ -z "${FRONTEND_URL}" ]] || is_placeholder_value "${FRONTEND_URL}"; then
    FRONTEND_URL="$(prompt_value "URL pública do frontend" "${FRONTEND_URL}")"
  fi
  ENABLE_NGINX="$(prompt_boolean "Deseja configurar o Nginx automaticamente?" "${ENABLE_NGINX}")"

  if [[ -z "${DB_HOST}" ]]; then
    DB_HOST="$(prompt_value "Host do PostgreSQL" "${DB_HOST}")"
  fi
  if [[ -z "${DB_PORT}" ]]; then
    DB_PORT="$(prompt_value "Porta do PostgreSQL" "${DB_PORT}")"
  fi
  if [[ -z "${DB_NAME}" ]]; then
    DB_NAME="$(prompt_value "Nome do banco de dados" "${DB_NAME}")"
  fi
  if [[ -z "${DB_USER}" ]]; then
    DB_USER="$(prompt_value "Usuário do banco de dados" "${DB_USER}")"
  fi
  if [[ -z "${DB_PASSWORD}" ]] || is_placeholder_value "${DB_PASSWORD}"; then
    DB_PASSWORD="$(prompt_secret "Senha do banco de dados" "${DB_PASSWORD}")"
  fi

  if is_local_database_host; then
    DB_CREATE_LOCAL="${DB_CREATE_LOCAL:-true}"
    DB_CREATE_LOCAL="$(prompt_boolean "Criar ou atualizar o banco local automaticamente?" "${DB_CREATE_LOCAL}")"
  else
    DB_CREATE_LOCAL="false"
  fi

  if [[ -z "${MASTER_NAME}" ]]; then
    MASTER_NAME="$(prompt_value "Nome do administrador master" "${MASTER_NAME}")"
  fi
  if [[ -z "${MASTER_EMAIL}" ]] || is_placeholder_value "${MASTER_EMAIL}"; then
    MASTER_EMAIL="$(prompt_value "E-mail do administrador master" "${MASTER_EMAIL}")"
  fi
  if [[ -z "${MASTER_PASSWORD}" ]] || is_placeholder_value "${MASTER_PASSWORD}"; then
    MASTER_PASSWORD="$(prompt_secret "Senha do administrador master" "${MASTER_PASSWORD}")"
  fi

  print_execution_plan
  confirm_execution_plan
  echo
}

main() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Execute como root: sudo bash scripts/ubuntu/install.sh"
  fi

  trap 'handle_error $? ${LINENO}' ERR

  print_banner
  refresh_runtime_paths

  if should_prompt; then
    run_interactive_setup
  fi

  refresh_runtime_paths
  detect_existing_installation
  validate_mode
  ensure_required_values

  if [[ "${INSTALL_MODE}" == "uninstall" ]]; then
    run_step "backend" "Validando caminhos e arquivos base" validate_paths
    run_step "backend" "Confirmando instalacao existente" ensure_uninstall_target_is_safe
    run_step "ssl" "Removendo SSL" remove_ssl_certificate
    run_step "nginx" "Removendo configuracao do Nginx" remove_nginx_configuration
    run_step "pm2" "Removendo processo PM2" remove_pm2_process
    run_step "backend" "Removendo aplicacao instalada" remove_application_root
    run_step "frontend" "Removendo pasta de origem" remove_source_directory
    run_step "database" "Removendo banco PostgreSQL local" remove_local_database
    remove_backups_directory
    print_summary
    return 0
  fi

  run_step "database" "Validando caminhos e arquivos base" validate_paths
  set_step_status "database" "PENDENTE"
  run_step "database" "Verificando comandos obrigatorios" ensure_base_commands
  set_step_status "database" "PENDENTE"
  run_step "database" "Garantindo usuario de sistema" ensure_system_user
  set_step_status "database" "PENDENTE"
  run_step "database" "Validando pasta final da aplicacao" ensure_app_root_is_safe
  set_step_status "database" "PENDENTE"
  run_step "database" "Validando dominio configurado" ensure_server_name_is_safe
  set_step_status "database" "PENDENTE"
  run_step "database" "Validando porta da API" ensure_port_free "${APP_PORT}"
  set_step_status "database" "PENDENTE"
  run_step "database" "Preparando diretorios" prepare_directories
  set_step_status "database" "PENDENTE"
  run_step "database" "Criando backup de seguranca" backup_existing_files
  set_step_status "database" "PENDENTE"
  run_step "database" "Sincronizando arquivos do projeto" sync_project
  set_step_status "database" "PENDENTE"
  run_step "database" "Gravando identificacao da instalacao" write_deploy_marker
  set_step_status "database" "PENDENTE"
  run_step "database" "Atualizando arquivo de ambiente" ensure_env_files
  run_step "database" "Garantindo banco PostgreSQL local" ensure_local_database
  run_step "backend" "Instalando dependencias e gerando build do backend" install_dependencies_and_build
  run_step "frontend" "Instalando dependencias e gerando build do frontend" install_frontend_and_build
  run_step "pm2" "Configurando processo PM2" configure_pm2
  run_step "nginx" "Configurando Nginx" configure_nginx
  run_step "ssl" "Configurando SSL" configure_ssl
  print_summary
}

main "$@"
