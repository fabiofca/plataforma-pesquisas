import 'dotenv/config'

function required(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback

  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${name}`)
  }

  return value
}

function parseBoolean(name: string, fallback: boolean) {
  const rawValue = process.env[name]

  if (rawValue === undefined) {
    return fallback
  }

  const normalized = rawValue.trim().toLowerCase()

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  throw new Error(`Valor booleano inválido para ${name}: ${rawValue}`)
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const isProduction = nodeEnv === 'production'
const frontendUrls = required('FRONTEND_URL', 'http://localhost:4173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

if (!frontendUrls.length) {
  throw new Error('É necessário informar ao menos uma origem válida em FRONTEND_URL.')
}

export const env = {
  nodeEnv,
  isProduction,
  port: Number(process.env.PORT ?? 4310),
  frontendUrl: frontendUrls[0],
  frontendUrls,
  databaseUrl: required('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/plataforma_pesquisas'),
  jwtSecret: required('JWT_SECRET', 'plataforma-pesquisas-secret'),
  masterName: process.env.MASTER_NAME ?? 'Administrador Master',
  masterEmail: process.env.MASTER_EMAIL ?? 'master@plataforma.local',
  masterPassword: process.env.MASTER_PASSWORD ?? 'master1234',
  rewardCodePrefix: process.env.REWARD_CODE_PREFIX ?? 'RADAR',
  trustProxy: parseBoolean('TRUST_PROXY', isProduction),
  cookieSecure: parseBoolean('COOKIE_SECURE', isProduction),
}

if (env.isProduction) {
  if (['plataforma-pesquisas-secret', 'troque-esta-chave-em-producao'].includes(env.jwtSecret)) {
    throw new Error('JWT_SECRET precisa ser alterado para um valor seguro em produção.')
  }

  if (!env.masterPassword || env.masterPassword.trim().length < 6) {
    throw new Error('MASTER_PASSWORD precisa estar preenchida com pelo menos 6 caracteres antes de subir em produção.')
  }

  if (env.masterPassword === 'master1234') {
    throw new Error('MASTER_PASSWORD precisa ser alterada antes de subir em produção.')
  }
}
