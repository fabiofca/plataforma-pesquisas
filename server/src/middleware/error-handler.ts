import type { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'
import { ZodError } from 'zod'

import { env } from '../config/env.js'

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    response.status(400).json({
      message: 'Dados inválidos.',
      issues: error.issues,
    })
    return
  }

  if (error instanceof MulterError) {
    const translatedMessage =
      error.code === 'LIMIT_FILE_SIZE'
        ? 'Arquivo muito grande. Reduza o tamanho da imagem e tente novamente.'
        : 'Não foi possível processar o upload do arquivo.'

    response.status(400).json({ message: translatedMessage })
    return
  }

  if (error instanceof Error) {
    console.error(error)
    response.status(500).json({
      message: env.isProduction ? 'Erro interno inesperado.' : error.message,
    })
    return
  }

  response.status(500).json({ message: 'Erro interno inesperado.' })
}
