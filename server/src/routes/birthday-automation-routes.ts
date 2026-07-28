import { Router } from 'express'

import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js'
import {
  defaultBirthdayMessageTemplate,
  getBirthdayAutomationSettings,
  getRecentBirthdayDispatches,
  getTodayBirthdayRecipients,
  queueBirthdayDispatchesForUser,
  renderBirthdayMessage,
  upsertBirthdayAutomationSettings,
} from '../services/birthday-automation.js'
import { hasFeatureAccess } from '../services/feature-access.js'
import { birthdayAutomationSchema } from '../validators/schemas.js'

export const birthdayAutomationRouter = Router()

birthdayAutomationRouter.use(requireAuth)

birthdayAutomationRouter.get('/birthday-automation', async (request: AuthenticatedRequest, response) => {
  const userId = request.auth!.userId
  const roleCode = request.auth!.roleCode
  const [settings, recipients, recentDispatches, canSendRealMessages] = await Promise.all([
    getBirthdayAutomationSettings(userId),
    getTodayBirthdayRecipients(userId),
    getRecentBirthdayDispatches(userId),
    hasFeatureAccess(userId, roleCode, 'birthday_whatsapp_automation'),
  ])

  response.json({
    settings: {
      isEnabled: settings?.isEnabled ?? false,
      messageTemplate: settings?.messageTemplate ?? defaultBirthdayMessageTemplate,
    },
    capabilities: {
      canSendRealMessages,
    },
    todayRecipients: recipients.map((recipient) => ({
      ...recipient,
      previewMessage: renderBirthdayMessage(settings?.messageTemplate ?? defaultBirthdayMessageTemplate, {
        name: recipient.name,
        brandName: recipient.brandName,
      }),
    })),
    recentDispatches,
  })
})

birthdayAutomationRouter.patch('/birthday-automation', async (request: AuthenticatedRequest, response) => {
  const payload = birthdayAutomationSchema.parse(request.body)
  const settings = await upsertBirthdayAutomationSettings({
    userId: request.auth!.userId,
    isEnabled: payload.isEnabled,
    messageTemplate: payload.messageTemplate.trim(),
  })

  response.json({
    ok: true,
    settings: {
      isEnabled: settings.isEnabled,
      messageTemplate: settings.messageTemplate,
    },
  })
})

birthdayAutomationRouter.post('/birthday-automation/run', async (request: AuthenticatedRequest, response) => {
  const result = await queueBirthdayDispatchesForUser({
    userId: request.auth!.userId,
    roleCode: request.auth!.roleCode,
    requirePlanAccess: true,
  })

  if (!result.ok) {
    response.status(result.message.includes('plano atual') ? 403 : 409).json({ message: result.message })
    return
  }

  response.json({
    ok: true,
    message: result.message,
    queuedCount: result.queuedCount,
    queued: result.queued,
  })
})
