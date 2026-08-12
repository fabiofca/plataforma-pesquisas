import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import path from 'node:path'

import { env } from './config/env.js'
import { attachUser } from './middleware/auth.js'
import { errorHandler } from './middleware/error-handler.js'
import { authRouter } from './routes/auth-routes.js'
import { birthdayAutomationRouter } from './routes/birthday-automation-routes.js'
import { plansRouter } from './routes/plans-routes.js'
import { publicRouter } from './routes/public-routes.js'
import { reportsRouter } from './routes/reports-routes.js'
import { rewardsRouter } from './routes/rewards-routes.js'
import { settingsRouter } from './routes/settings-routes.js'
import { surveysRouter } from './routes/surveys-routes.js'
import { usersRouter } from './routes/users-routes.js'

export const app = express()

if (env.trustProxy) {
  app.set('trust proxy', 1)
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.frontendUrls.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('Origem não permitida pelo CORS.'))
    },
    credentials: true,
  }),
)
app.use(helmet())
app.use(morgan('dev'))
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')))
app.use(attachUser)

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.use('/api/auth', authRouter)
app.use('/api/system-settings', settingsRouter)
app.use('/api/users', usersRouter)
app.use('/api/plans', plansRouter)
app.use('/api/surveys', surveysRouter)
app.use('/api/public', publicRouter)
app.use('/api', birthdayAutomationRouter)
app.use('/api', reportsRouter)
app.use('/api', rewardsRouter)

app.use(errorHandler)
