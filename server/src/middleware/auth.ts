import type { NextFunction, Request, Response } from 'express'

import { query } from '../db/pool.js'
import { verifyToken } from '../utils/security.js'

type AuthenticatedRequest = Request & {
  auth?: {
    userId: string
    roleCode: string
  }
  file?: Express.Multer.File
}

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  try {
    const token = request.cookies.pp_session

    if (!token) {
      response.status(401).json({ message: 'Sessão ausente.' })
      return
    }

    const payload = verifyToken(token)
    request.auth = { userId: payload.sub, roleCode: payload.roleCode }
    next()
  } catch {
    response.status(401).json({ message: 'Sessão inválida.' })
  }
}

export function requireMaster(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  if (request.auth?.roleCode !== 'master') {
    response.status(403).json({ message: 'Acesso restrito ao usuário master.' })
    return
  }

  next()
}

export async function attachUser(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  if (!request.auth) {
    next()
    return
  }

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
    [request.auth.userId],
  )

  const user = result.rows[0]

  if (!user || user.status !== 'active') {
    request.auth = undefined
    next()
    return
  }

  request.auth = {
    userId: user.id,
    roleCode: user.role_code,
  }

  next()
}

export type { AuthenticatedRequest }
