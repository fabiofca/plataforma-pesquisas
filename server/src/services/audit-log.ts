import { query } from '../db/pool.js'
import { makeId } from '../utils/security.js'

type AuditLogInput = {
  actorUserId?: string | null
  surveyId?: string | null
  action: string
  entityType: string
  entityId: string
  meta?: Record<string, unknown>
}

export async function createAuditLog(input: AuditLogInput) {
  await query(
    `insert into audit_logs (id, actor_user_id, survey_id, action, entity_type, entity_id, meta_json)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      makeId(),
      input.actorUserId ?? null,
      input.surveyId ?? null,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.meta ?? {}),
    ],
  )
}
