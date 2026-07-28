import { Router } from 'express'

import { query } from '../db/pool.js'
import { requireAuth, requireMaster, type AuthenticatedRequest } from '../middleware/auth.js'
import { createAuditLog } from '../services/audit-log.js'
import { assignPlanToUser, featureKeys } from '../services/feature-access.js'
import { planAssignmentSchema, planSchema } from '../validators/schemas.js'
import { makeId } from '../utils/security.js'

export const plansRouter = Router()

plansRouter.use(requireAuth, requireMaster)

plansRouter.get('/', async (_request, response) => {
  const plansResult = await query<{
    id: string
    code: string
    name: string
    description: string | null
    is_active: boolean
  }>('select id, code, name, description, is_active from plans order by created_at asc')

  const featuresResult = await query<{
    plan_id: string
    feature_key: string
    is_enabled: boolean
  }>('select plan_id, feature_key, is_enabled from plan_features order by feature_key asc')

  const usersResult = await query<{
    id: string
    name: string
    email: string
    role_code: string
    status: string
    plan_id: string | null
    plan_name: string | null
    plan_code: string | null
  }>(
    `select
        users.id,
        users.name,
        users.email,
        roles.code as role_code,
        users.status,
        plans.id as plan_id,
        plans.name as plan_name,
        plans.code as plan_code
      from users
      join roles on roles.id = users.role_id
      left join user_plan_subscriptions
        on user_plan_subscriptions.user_id = users.id
       and user_plan_subscriptions.status = 'active'
       and user_plan_subscriptions.ends_at is null
      left join plans on plans.id = user_plan_subscriptions.plan_id
      where users.deleted_at is null
      order by users.created_at desc`,
  )

  const historyResult = await query<{
    id: string
    created_at: string
    actor_name: string | null
    entity_id: string
    meta_json: {
      userName?: string
      userEmail?: string
      previousPlanName?: string | null
      nextPlanName?: string | null
      previousPlanCode?: string | null
      nextPlanCode?: string | null
    } | null
  }>(
    `select
        audit_logs.id,
        audit_logs.created_at,
        actors.name as actor_name,
        audit_logs.entity_id,
        audit_logs.meta_json
      from audit_logs
      left join users as actors on actors.id = audit_logs.actor_user_id
      where audit_logs.entity_type = 'plan_assignment'
      order by audit_logs.created_at desc
      limit 20`,
  )

  const plans = plansResult.rows.map((plan) => ({
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description ?? '',
    isActive: plan.is_active,
    features: Object.fromEntries(
      featureKeys.map((featureKey) => [
        featureKey,
        featuresResult.rows.find((item) => item.plan_id === plan.id && item.feature_key === featureKey)?.is_enabled ?? false,
      ]),
    ),
  }))

  response.json({
    plans,
    users: usersResult.rows.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      roleCode: user.role_code,
      status: user.status,
      planId: user.plan_id,
      planName: user.plan_name,
      planCode: user.plan_code,
    })),
    history: historyResult.rows.map((entry) => ({
      id: entry.id,
      createdAt: entry.created_at,
      actorName: entry.actor_name ?? 'Sistema',
      userId: entry.entity_id,
      userName: entry.meta_json?.userName ?? 'Usuário',
      userEmail: entry.meta_json?.userEmail ?? '',
      previousPlanName: entry.meta_json?.previousPlanName ?? null,
      nextPlanName: entry.meta_json?.nextPlanName ?? null,
      previousPlanCode: entry.meta_json?.previousPlanCode ?? null,
      nextPlanCode: entry.meta_json?.nextPlanCode ?? null,
    })),
  })
})

plansRouter.post('/', async (request: AuthenticatedRequest, response) => {
  const payload = planSchema.parse(request.body)
  const existingPlan = await query<{ id: string }>('select id from plans where code = $1', [payload.code])

  if (existingPlan.rows[0]) {
    response.status(409).json({ message: 'Já existe um plano com este código.' })
    return
  }

  const planId = `plan_${makeId()}`

  await query(
    `insert into plans (id, code, name, description, is_active)
     values ($1, $2, $3, $4, $5)`,
    [planId, payload.code, payload.name, payload.description || null, payload.isActive],
  )

  for (const featureKey of featureKeys) {
    await query(
      `insert into plan_features (plan_id, feature_key, is_enabled)
       values ($1, $2, $3)`,
      [planId, featureKey, payload.features[featureKey] ?? false],
    )
  }

  await createAuditLog({
    actorUserId: request.auth?.userId,
    action: 'plan.created',
    entityType: 'plan',
    entityId: planId,
    meta: {
      code: payload.code,
      name: payload.name,
      features: payload.features,
    },
  })

  response.status(201).json({ id: planId })
})

plansRouter.patch('/:id', async (request: AuthenticatedRequest, response) => {
  const planId = String(request.params.id)
  const payload = planSchema.parse(request.body)
  const existingPlan = await query<{ id: string }>(
    'select id from plans where code = $1 and id <> $2',
    [payload.code, planId],
  )

  if (existingPlan.rows[0]) {
    response.status(409).json({ message: 'Já existe outro plano com este código.' })
    return
  }

  const result = await query(
    `update plans
     set code = $2,
         name = $3,
         description = $4,
         is_active = $5,
         updated_at = now()
     where id = $1`,
    [planId, payload.code, payload.name, payload.description || null, payload.isActive],
  )

  if (!result.rowCount) {
    response.status(404).json({ message: 'Plano não encontrado.' })
    return
  }

  for (const featureKey of featureKeys) {
    await query(
      `insert into plan_features (plan_id, feature_key, is_enabled)
       values ($1, $2, $3)
       on conflict (plan_id, feature_key)
       do update set is_enabled = excluded.is_enabled, updated_at = now()`,
      [planId, featureKey, payload.features[featureKey] ?? false],
    )
  }

  await createAuditLog({
    actorUserId: request.auth?.userId,
    action: 'plan.updated',
    entityType: 'plan',
    entityId: planId,
    meta: {
      code: payload.code,
      name: payload.name,
      features: payload.features,
      isActive: payload.isActive,
    },
  })

  response.json({ ok: true })
})

plansRouter.patch('/users/:userId', async (request: AuthenticatedRequest, response) => {
  const userId = String(request.params.userId)
  const payload = planAssignmentSchema.parse(request.body)

  const userResult = await query<{
    id: string
    role_code: string
    name: string
    email: string
    current_plan_id: string | null
    current_plan_name: string | null
    current_plan_code: string | null
  }>(
    `select users.id, roles.code as role_code
            , users.name
            , users.email
            , plans.id as current_plan_id
            , plans.name as current_plan_name
            , plans.code as current_plan_code
     from users
     join roles on roles.id = users.role_id
     left join user_plan_subscriptions
       on user_plan_subscriptions.user_id = users.id
      and user_plan_subscriptions.status = 'active'
      and user_plan_subscriptions.ends_at is null
     left join plans on plans.id = user_plan_subscriptions.plan_id
     where users.id = $1 and users.deleted_at is null`,
    [userId],
  )

  if (!userResult.rows[0]) {
    response.status(404).json({ message: 'Usuário não encontrado.' })
    return
  }

  if (userResult.rows[0].role_code === 'master') {
    response.status(400).json({ message: 'Usuários master não dependem de plano para acessar os recursos.' })
    return
  }

  const planResult = await query<{ id: string; name: string; code: string }>(
    'select id, name, code from plans where id = $1',
    [payload.planId],
  )

  if (!planResult.rows[0]) {
    response.status(404).json({ message: 'Plano não encontrado.' })
    return
  }

  await assignPlanToUser(userId, payload.planId)
  await createAuditLog({
    actorUserId: request.auth?.userId,
    action: 'plan.assigned',
    entityType: 'plan_assignment',
    entityId: userId,
    meta: {
      userName: userResult.rows[0].name,
      userEmail: userResult.rows[0].email,
      previousPlanName: userResult.rows[0].current_plan_name,
      previousPlanCode: userResult.rows[0].current_plan_code,
      nextPlanName: planResult.rows[0].name,
      nextPlanCode: planResult.rows[0].code,
    },
  })

  response.json({ ok: true })
})
