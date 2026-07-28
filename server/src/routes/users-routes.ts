import { Router } from 'express'

import { pool, query } from '../db/pool.js'
import { requireAuth, requireMaster, type AuthenticatedRequest } from '../middleware/auth.js'
import { ensureDefaultPlanSubscription } from '../services/feature-access.js'
import { userSchema } from '../validators/schemas.js'
import { hashPassword, makeId } from '../utils/security.js'

export const usersRouter = Router()

usersRouter.use(requireAuth, requireMaster)

usersRouter.get('/', async (_request, response) => {
  const result = await query<{
    id: string
    name: string
    email: string
    phone: string | null
    status: string
    role_code: string
    created_at: string
    surveys_count: string
    plan_name: string | null
    plan_code: string | null
    is_default_master: boolean
  }>(
    `select
        users.id,
        users.name,
        users.email,
        users.phone,
        users.status,
        roles.code as role_code,
        users.created_at,
        cast(count(surveys.id) as text) as surveys_count,
        plans.name as plan_name,
        plans.code as plan_code,
        users.is_default_master
      from users
      join roles on roles.id = users.role_id
      left join surveys on surveys.owner_user_id = users.id
      left join user_plan_subscriptions
        on user_plan_subscriptions.user_id = users.id
       and user_plan_subscriptions.status = 'active'
       and user_plan_subscriptions.ends_at is null
      left join plans on plans.id = user_plan_subscriptions.plan_id
      where users.deleted_at is null
      group by users.id, roles.code, plans.name, plans.code
      order by users.created_at desc`,
  )

  response.json({ users: result.rows })
})

usersRouter.post('/', async (request: AuthenticatedRequest, response) => {
  const payload = userSchema.parse(request.body)
  const email = payload.email.trim().toLowerCase()
  const role = await query<{ id: string }>('select id from roles where code = $1', [payload.roleCode])

  if (!role.rows[0]) {
    response.status(400).json({ message: 'Perfil inválido.' })
    return
  }

  const existingUser = await query<{ id: string }>(
    'select id from users where lower(email) = $1 and deleted_at is null',
    [email],
  )

  if (existingUser.rows[0]) {
    response.status(409).json({ message: 'Já existe um usuário com este e-mail.' })
    return
  }

  const id = makeId()
  const passwordHash = await hashPassword(payload.password ?? '12345678')

  await query(
    `insert into users (id, role_id, name, email, password_hash, status, phone)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, role.rows[0].id, payload.name.trim(), email, passwordHash, payload.status, payload.phone?.trim() || null],
  )
  await ensureDefaultPlanSubscription(id)

  response.status(201).json({ id })
})

usersRouter.patch('/:id', async (request: AuthenticatedRequest, response) => {
  const userId = String(request.params.id)
  const payload = userSchema.partial().parse(request.body)
  const email = payload.email?.trim().toLowerCase()
  const roleId =
    payload.roleCode
      ? (await query<{ id: string }>('select id from roles where code = $1', [payload.roleCode])).rows[0]?.id
      : null

  if (payload.roleCode && !roleId) {
    response.status(400).json({ message: 'Perfil inválido.' })
    return
  }

  if (request.auth?.userId === userId && payload.status === 'blocked') {
    response.status(400).json({ message: 'Você não pode bloquear o próprio acesso.' })
    return
  }

  const userResult = await query<{ id: string; email: string; role_code: string; is_default_master: boolean }>(
    `select users.id, users.email, roles.code as role_code, users.is_default_master
     from users
     join roles on roles.id = users.role_id
     where users.id = $1 and users.deleted_at is null`,
    [userId],
  )

  const user = userResult.rows[0]

  if (!user) {
    response.status(404).json({ message: 'Usuário não encontrado.' })
    return
  }

  if (
    payload.status === 'blocked' &&
    user.is_default_master
  ) {
    response.status(400).json({ message: 'O usuário master padrão da plataforma não pode ser bloqueado.' })
    return
  }

  if (
    payload.roleCode === 'user' &&
    user.is_default_master
  ) {
    response.status(400).json({ message: 'O usuário master padrão da plataforma não pode ser alterado para usuário comum.' })
    return
  }

  if (email) {
    const existingUser = await query<{ id: string }>(
      'select id from users where lower(email) = $1 and id <> $2 and deleted_at is null',
      [email, userId],
    )

    if (existingUser.rows[0]) {
      response.status(409).json({ message: 'Já existe outro usuário com este e-mail.' })
      return
    }
  }

  await query(
    `update users
     set name = coalesce($2, name),
         email = coalesce($3, email),
         role_id = coalesce($4, role_id),
         status = coalesce($5, status),
         phone = coalesce($6, phone),
         password_hash = coalesce($7, password_hash),
         updated_at = now()
     where id = $1 and deleted_at is null`,
    [
      userId,
      payload.name?.trim(),
      email,
      roleId,
      payload.status,
      payload.phone?.trim() || null,
      payload.password ? await hashPassword(payload.password) : null,
    ],
  )

  response.json({ ok: true })
})

usersRouter.delete('/:id', async (request: AuthenticatedRequest, response) => {
  const userId = String(request.params.id)

  if (request.auth?.userId === userId) {
    response.status(400).json({ message: 'Você não pode remover o próprio acesso.' })
    return
  }

  const userResult = await query<{ id: string; email: string; role_code: string; is_default_master: boolean }>(
    `select users.id, users.email, roles.code as role_code, users.is_default_master
     from users
     join roles on roles.id = users.role_id
     where users.id = $1 and users.deleted_at is null`,
    [userId],
  )

  const user = userResult.rows[0]

  if (!user) {
    response.status(404).json({ message: 'Usuário não encontrado.' })
    return
  }

  if (user.is_default_master) {
    response.status(400).json({ message: 'O usuário master padrão da plataforma não pode ser removido.' })
    return
  }

  const client = await pool.connect()

  try {
    await client.query('begin')
    await client.query('delete from surveys where owner_user_id = $1', [userId])
    await client.query('update users set deleted_at = now(), updated_at = now() where id = $1 and deleted_at is null', [
      userId,
    ])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  response.json({ ok: true })
})
