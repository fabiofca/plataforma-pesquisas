import crypto from 'node:crypto'

import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

import { env } from '../config/env.js'

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10)
}

export async function comparePassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash)
}

export function signToken(userId: string, roleCode: string) {
  return jwt.sign({ sub: userId, roleCode }, env.jwtSecret, { expiresIn: '8h' })
}

export function verifyToken(token: string) {
  return jwt.verify(token, env.jwtSecret) as { sub: string; roleCode: string }
}

export function signSurveyPreviewToken(surveyId: string) {
  return jwt.sign({ kind: 'survey-preview', surveyId }, env.jwtSecret)
}

export function verifySurveyPreviewToken(token: string) {
  const payload = jwt.verify(token, env.jwtSecret) as { kind?: string; surveyId?: string }

  if (payload.kind !== 'survey-preview' || !payload.surveyId) {
    throw new Error('Token de preview inválido.')
  }

  return {
    surveyId: payload.surveyId,
  }
}

export function makeId() {
  return crypto.randomUUID()
}

export function hashValue(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function generateCouponCode(_prefix: string) {
  const timestamp = Date.now().toString()
  const randomSuffix = crypto.randomInt(100, 1000).toString()
  return `${timestamp}${randomSuffix}`
}
