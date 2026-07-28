import { z } from 'zod'

function normalizePhone(value: string) {
  return value.replace(/\D/g, '')
}

function normalizeOptionalEmail(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? ''
  return normalized || undefined
}

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
})

export const registerSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().min(8).max(20).optional().or(z.literal('')),
})

export const userSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6).optional(),
  roleCode: z.enum(['master', 'user']).default('user'),
  status: z.enum(['active', 'blocked']).default('active'),
  phone: z.string().optional(),
})

export const surveyQuestionSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(3),
  description: z.string().optional(),
  type: z.enum([
    'short_text',
    'long_text',
    'single_choice',
    'multiple_choice',
    'yes_no',
    'rating_1_5',
    'nps',
  ]),
  isRequired: z.boolean().default(false),
  position: z.number().int().nonnegative(),
  options: z.array(z.string().min(1)).optional(),
  flowRules: z
    .array(
      z.object({
        value: z.string().min(1),
        nextQuestionId: z.string().min(1),
      }),
    )
    .optional(),
})

export const surveySchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  participationMode: z.enum(['anonymous', 'identified']).default('identified'),
  slug: z.string().min(3).regex(/^[a-z0-9-]+$/),
  brandName: z.string().min(2),
  logoUrl: z.string().url().optional().or(z.literal('')),
  primaryColor: z.string().min(4).max(20),
  bannerUrl: z.string().url().optional().or(z.literal('')),
  closingMessage: z.string().optional(),
  rewardEnabled: z.boolean().default(false),
  preventDuplicateResponses: z.boolean().default(false),
  questions: z.array(surveyQuestionSchema).min(1),
})

export const surveyParticipantSchema = z.object({
  name: z.string().min(3, 'Informe o nome completo.'),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine((value) => /^\d{10,11}$/.test(value), 'Informe um telefone válido no formato 21996336092.'),
  email: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform(normalizeOptionalEmail)
    .refine((value) => !value || z.string().email().safeParse(value).success, 'Informe um email válido.'),
  birthDay: z.number().int().min(1, 'Informe o dia do aniversário.').max(31, 'Informe um dia válido.'),
  birthMonth: z.number().int().min(1, 'Informe o mês do aniversário.').max(12, 'Informe um mês válido.'),
})

export const responseSchema = z.object({
  participant: surveyParticipantSchema,
  answers: z.array(
    z.object({
      questionId: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
    }),
  ),
  browserCookieId: z.string().optional(),
  fingerprint: z.string().optional(),
})

export const rewardEligibilitySchema = z.object({
  participant: z.object({
    phone: z
      .string()
      .transform(normalizePhone)
      .refine((value) => /^\d{10,11}$/.test(value), 'Informe um telefone válido no formato 21996336092.'),
    email: z
      .string()
      .optional()
      .or(z.literal(''))
      .transform(normalizeOptionalEmail)
      .refine((value) => !value || z.string().email().safeParse(value).success, 'Informe um email válido.'),
  }),
  browserCookieId: z.string().optional(),
  fingerprint: z.string().optional(),
})

export const rewardRetryTaskSchema = z.object({
  id: z.string().min(2).max(60),
  type: z.enum(['google_review', 'instagram_follow', 'custom_link']),
  title: z.string().min(3).max(120),
  url: z.string().url('Informe um link válido para a tarefa.'),
})

export const rewardRetryTaskClickSchema = z.object({
  responseId: z.string().min(1),
  taskId: z.string().min(2).max(60),
})

export const birthdayAutomationSchema = z.object({
  isEnabled: z.boolean().default(false),
  messageTemplate: z
    .string()
    .min(12, 'Escreva uma mensagem de aniversário mais completa.')
    .max(1000, 'A mensagem de aniversário está muito longa.'),
})

export const publicVisitSchema = z.object({
  source: z.enum(['link', 'qr']),
})

export const reportPeriodSchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (value) => {
      if (!value.startDate && !value.endDate) {
        return true
      }

      return Boolean(value.startDate && value.endDate && value.startDate <= value.endDate)
    },
    {
      message: 'Período inválido para o relatório.',
      path: ['endDate'],
    },
  )

export const planSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_-]+$/),
  name: z.string().min(3).max(120),
  description: z.string().max(400).optional().or(z.literal('')),
  isActive: z.boolean().default(true),
  features: z.record(z.boolean()),
})

export const planAssignmentSchema = z.object({
  planId: z.string().min(2),
})

export const rewardCampaignSchema = z.object({
  status: z.enum(['active', 'paused', 'ended']).default('active'),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  pickupAddress: z.string().max(500).optional().or(z.literal('')),
  retryUnlockEnabled: z.boolean().default(false),
  retryUnlockTasks: z.array(rewardRetryTaskSchema).max(2, 'Cadastre no máximo 2 tarefas para liberar mais uma chance.').default([]),
}).superRefine((value, context) => {
  if (value.retryUnlockEnabled && value.retryUnlockTasks.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['retryUnlockTasks'],
      message: 'Cadastre pelo menos uma tarefa para liberar a chance extra.',
    })
  }
})

const rewardItemBaseSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  quantityTotal: z.number().int().positive(),
  isActive: z.boolean().default(true),
  frequencyMode: z.enum(['frequent', 'balanced', 'rare', 'custom']).default('balanced'),
  customFrequencyTarget: z.number().int().min(2).max(100000).optional(),
})

function validateRewardFrequency(
  value: { frequencyMode?: 'frequent' | 'balanced' | 'rare' | 'custom'; customFrequencyTarget?: number },
  context: z.RefinementCtx,
) {
  if (value.frequencyMode === 'custom' && !value.customFrequencyTarget) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customFrequencyTarget'],
      message: 'Informe a frequência personalizada, por exemplo 100 para 1 prêmio a cada 100 participações.',
    })
  }
}

export const rewardItemSchema = rewardItemBaseSchema.superRefine(validateRewardFrequency)
export const rewardItemPatchSchema = rewardItemBaseSchema.partial().superRefine(validateRewardFrequency)

export const rewardWinRedemptionSchema = z.object({
  status: z.enum(['pending', 'delivered', 'cancelled']),
  redemptionNotes: z.string().max(500).optional().or(z.literal('')),
})

export const systemSettingSchema = z.array(
  z.object({
    key: z.string().min(2),
    value: z.unknown(),
  }),
)
