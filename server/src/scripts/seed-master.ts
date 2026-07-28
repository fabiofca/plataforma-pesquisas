import { env } from '../config/env.js'
import { query } from '../db/pool.js'
import { ensureDefaultPlanSubscription } from '../services/feature-access.js'
import { hashPassword, makeId } from '../utils/security.js'

async function seed() {
  const roleMasterId = makeId()
  const roleUserId = makeId()

  await query(
    `insert into roles (id, code, name)
     values ($1, 'master', 'Usuário master')
     on conflict (code) do nothing`,
    [roleMasterId],
  )
  await query(
    `insert into roles (id, code, name)
     values ($1, 'user', 'Usuário comum')
     on conflict (code) do nothing`,
    [roleUserId],
  )

  const masterRole = await query<{ id: string }>('select id from roles where code = $1', ['master'])
  const masterRoleId = masterRole.rows[0]?.id

  if (!masterRoleId) {
    throw new Error('Perfil master não encontrado após a inicialização das roles.')
  }

  const nextPasswordHash = await hashPassword(env.masterPassword)

  const existingDefaultMaster = await query<{ id: string; email: string }>(
    'select id, email from users where is_default_master = true and deleted_at is null limit 1',
  )

  const existingUser = await query<{ id: string }>('select id from users where email = $1 and deleted_at is null', [env.masterEmail])

  if (existingDefaultMaster.rows[0]) {
    const defaultMaster = existingDefaultMaster.rows[0]

    if (existingUser.rows[0] && existingUser.rows[0].id !== defaultMaster.id) {
      throw new Error(
        `Já existe outro usuário ativo com o e-mail ${env.masterEmail}. Ajuste o e-mail do master no .env ou remova o conflito antes de continuar.`,
      )
    }

    await query(
      `update users
       set role_id = $2,
           name = $3,
           email = $4,
           password_hash = $5,
           status = 'active',
           is_default_master = true,
           deleted_at = null,
           updated_at = now()
       where id = $1`,
      [defaultMaster.id, masterRoleId, env.masterName, env.masterEmail, nextPasswordHash],
    )
    await ensureDefaultPlanSubscription(defaultMaster.id)
    console.log(`Usuário master padrão sincronizado: ${env.masterEmail}`)
    return
  }

  if (!existingUser.rows[0]) {
    const masterUserId = makeId()

    await query(
      `insert into users (id, role_id, name, email, password_hash, status, is_default_master)
       values ($1, $2, $3, $4, $5, 'active', true)`,
      [masterUserId, masterRoleId, env.masterName, env.masterEmail, nextPasswordHash],
    )
    await ensureDefaultPlanSubscription(masterUserId)

    console.log(`Usuário master criado: ${env.masterEmail}`)
  } else {
    await query(
      `update users
       set role_id = $2,
           name = $3,
           email = $4,
           password_hash = $5,
           status = 'active',
           is_default_master = true,
           deleted_at = null,
           updated_at = now()
       where id = $1`,
      [existingUser.rows[0].id, masterRoleId, env.masterName, env.masterEmail, nextPasswordHash],
    )
    await ensureDefaultPlanSubscription(existingUser.rows[0].id)
    console.log(`Usuário master padrão sincronizado a partir do e-mail informado: ${env.masterEmail}`)
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
