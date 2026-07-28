import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import multer, { type FileFilterCallback } from 'multer'
import { Router, type Request } from 'express'

import { query } from '../db/pool.js'
import { requireAuth, requireMaster, type AuthenticatedRequest } from '../middleware/auth.js'
import { systemSettingSchema } from '../validators/schemas.js'
import { makeId } from '../utils/security.js'

export const settingsRouter = Router()

const publicSettingKeys = [
  'platform_name',
  'default_primary_color',
  'sidebar_color',
  'support_email',
  'favicon_url',
  'brand_logo_url',
] as const
const uploadSettingKeys = new Set(['favicon_url', 'brand_logo_url'])
const brandingUploadDir = path.resolve(process.cwd(), 'uploads', 'branding')

mkdirSync(brandingUploadDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request: Request, _file: Express.Multer.File, callback: (error: Error | null, destination: string) => void) => {
      callback(null, brandingUploadDir)
    },
    filename: (_request: Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => {
      const extension = path.extname(file.originalname || '').toLowerCase() || '.bin'
      callback(null, `${makeId()}${extension}`)
    },
  }),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (_request: Request, file: Express.Multer.File, callback: FileFilterCallback) => {
    const allowedMimeTypes = new Set([
      'image/png',
      'image/jpeg',
      'image/svg+xml',
      'image/webp',
      'image/x-icon',
      'image/vnd.microsoft.icon',
    ])

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error('Envie um arquivo PNG, JPG, SVG, WEBP ou ICO.'))
      return
    }

    callback(null, true)
  },
})

async function getCurrentSettingValue(key: string) {
  const result = await query<{ setting_value: unknown }>(
    'select setting_value from system_settings where setting_key = $1 limit 1',
    [key],
  )

  return result.rows[0]?.setting_value
}

function removeManagedBrandingFile(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/uploads/branding/')) {
    return
  }

  const fileName = path.basename(value)
  const filePath = path.join(brandingUploadDir, fileName)
  rmSync(filePath, { force: true })
}

async function upsertSettingValue(key: string, value: unknown, userId: string) {
  await query(
    `insert into system_settings (id, setting_key, setting_value, updated_by)
     values ($1, $2, $3, $4)
     on conflict (setting_key)
     do update set setting_value = excluded.setting_value, updated_by = excluded.updated_by, updated_at = now()`,
    [makeId(), key, JSON.stringify(value), userId],
  )
}

settingsRouter.get('/public', async (_request, response) => {
  const result = await query<{ setting_key: string; setting_value: unknown }>(
    'select setting_key, setting_value from system_settings where setting_key = any($1::text[]) order by setting_key asc',
    [publicSettingKeys],
  )

  response.json({ settings: result.rows })
})

settingsRouter.use(requireAuth, requireMaster)

settingsRouter.post('/uploads/:key', upload.single('file'), async (request: AuthenticatedRequest, response) => {
  const key = typeof request.params.key === 'string' ? request.params.key : ''

  if (!uploadSettingKeys.has(key)) {
    response.status(400).json({ message: 'Tipo de upload não permitido.' })
    return
  }

  if (!request.file) {
    response.status(400).json({ message: 'Selecione um arquivo para enviar.' })
    return
  }

  const publicPath = `/uploads/branding/${request.file.filename}`
  const previousValue = await getCurrentSettingValue(key)

  removeManagedBrandingFile(previousValue)
  await upsertSettingValue(key, publicPath, request.auth!.userId)

  response.json({ ok: true, key, value: publicPath })
})

settingsRouter.delete('/uploads/:key', async (request: AuthenticatedRequest, response) => {
  const key = typeof request.params.key === 'string' ? request.params.key : ''

  if (!uploadSettingKeys.has(key)) {
    response.status(400).json({ message: 'Tipo de arquivo não permitido.' })
    return
  }

  const previousValue = await getCurrentSettingValue(key)
  removeManagedBrandingFile(previousValue)
  await upsertSettingValue(key, '', request.auth!.userId)

  response.json({ ok: true, key, value: '' })
})

settingsRouter.get('/', async (_request, response) => {
  const result = await query<{ id: string; setting_key: string; setting_value: unknown }>(
    'select id, setting_key, setting_value from system_settings order by setting_key asc',
  )

  response.json({ settings: result.rows })
})

settingsRouter.patch('/', async (request: AuthenticatedRequest, response) => {
  const payload = systemSettingSchema.parse(request.body)

  for (const item of payload) {
    await upsertSettingValue(item.key, item.value, request.auth!.userId)
  }

  response.json({ ok: true })
})
