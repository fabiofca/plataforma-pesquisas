import { Router } from 'express'

import { env } from '../config/env.js'
import { query } from '../db/pool.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import { ensureDefaultPlanSubscription, resolveFeatureAccess } from '../services/feature-access.js'
import { loginSchema, registerSchema } from '../validators/schemas.js'
import { comparePassword, hashPassword, makeId, signToken } from '../utils/security.js'

export const authRouter = Router()

function buildSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.cookieSecure,
    path: '/',
    maxAge: 1000 * 60 * 60 * 8,
  }
}

authRouter.post('/login', async (request, response) => {
  const payload = loginSchema.parse(request.body)
  const email = payload.email.trim().toLowerCase()

  const result = await query<{
    id: string
    name: string
    email: string
    status: string
    password_hash: string
    role_code: string
  }>(
    `select users.id, users.name, users.email, users.status, users.password_hash, roles.code as role_code
     from users
     join roles on roles.id = users.role_id
     where lower(users.email) = $1 and users.deleted_at is null`,
    [email],
  )

  const user = result.rows[0]

  if (!user || user.status !== 'active') {
    response.status(401).json({ message: 'Credenciais inválidas.' })
    return
  }

  const passwordValid = await comparePassword(payload.password, user.password_hash)

  if (!passwordValid) {
    response.status(401).json({ message: 'Credenciais inválidas.' })
    return
  }

  const token = signToken(user.id, user.role_code)
  response.cookie('pp_session', token, buildSessionCookieOptions())

  await query('update users set last_login_at = now() where id = $1', [user.id])
  const featureAccess = await resolveFeatureAccess(user.id, user.role_code)

  response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      roleCode: user.role_code,
      featureAccess,
    },
  })
})

authRouter.post('/register', async (request, response) => {
  const payload = registerSchema.parse(request.body)
  const email = payload.email.trim().toLowerCase()

  const existingUser = await query<{ id: string }>(
    'select id from users where lower(email) = $1 and deleted_at is null',
    [email],
  )

  if (existingUser.rows[0]) {
    response.status(409).json({ message: 'Já existe uma conta com este email.' })
    return
  }

  const roleResult = await query<{ id: string }>('select id from roles where code = $1', ['user'])
  const userRole = roleResult.rows[0]

  if (!userRole) {
    response.status(500).json({ message: 'Perfil padrão não configurado no sistema.' })
    return
  }

  const userId = makeId()

  await query(
    `insert into users (id, role_id, name, email, password_hash, status, phone, last_login_at)
     values ($1, $2, $3, $4, $5, 'active', $6, now())`,
    [
      userId,
      userRole.id,
      payload.name.trim(),
      email,
      await hashPassword(payload.password),
      payload.phone?.trim() || null,
    ],
  )
  await ensureDefaultPlanSubscription(userId)

  const token = signToken(userId, 'user')
  response.cookie('pp_session', token, buildSessionCookieOptions())
  const featureAccess = await resolveFeatureAccess(userId, 'user')

  response.status(201).json({
    user: {
      id: userId,
      name: payload.name.trim(),
      email,
      roleCode: 'user',
      featureAccess,
    },
  })
})

authRouter.post('/refresh', requireAuth, async (request: AuthenticatedRequest, response) => {
  const token = signToken(request.auth!.userId, request.auth!.roleCode)

  response.cookie('pp_session', token, buildSessionCookieOptions())

  response.json({ ok: true })
})

authRouter.post('/logout', async (_request, response) => {
  response.clearCookie('pp_session', buildSessionCookieOptions())
  response.json({ ok: true })
})

authRouter.get('/me', requireAuth, async (request: AuthenticatedRequest, response) => {
  const result = await query<{
    id: string
    name: string
    email: string
    status: string
    role_code: string
  }>(
    `select users.id, users.name, users.email, users.status, roles.code as role_code
     from users
     join roles on roles.id = users.role_id
     where users.id = $1 and users.deleted_at is null`,
    [request.auth!.userId],
  )

  const user = result.rows[0]

  if (!user || user.status !== 'active') {
    response.status(404).json({ message: 'Usuário não encontrado.' })
    return
  }

  const featureAccess = await resolveFeatureAccess(user.id, user.role_code)

  response.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      roleCode: user.role_code,
      featureAccess,
    },
  })
})
