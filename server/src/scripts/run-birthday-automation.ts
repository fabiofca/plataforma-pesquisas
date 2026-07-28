import 'dotenv/config'

import { query } from '../db/pool.js'
import { queueBirthdayDispatchesForUser } from '../services/birthday-automation.js'

async function main() {
  const usersResult = await query<{
    id: string
    role_code: string
  }>(
    `select users.id, roles.code as role_code
     from birthday_automation_settings
     join users on users.id = birthday_automation_settings.owner_user_id
     join roles on roles.id = users.role_id
     where birthday_automation_settings.is_enabled = true
       and users.deleted_at is null
       and users.status = 'active'`,
  )

  let totalQueued = 0

  for (const user of usersResult.rows) {
    const result = await queueBirthdayDispatchesForUser({
      userId: user.id,
      roleCode: user.role_code,
      requirePlanAccess: true,
    })

    if (result.ok) {
      totalQueued += result.queuedCount
    }
  }

  console.log(`Automação de aniversário finalizada. ${totalQueued} mensagem(ns) ficaram na fila.`)
}

void main().catch((error) => {
  console.error('Falha ao executar a automação de aniversário.', error)
  process.exitCode = 1
})
