import { env } from './config/env.js'
import { pool } from './db/pool.js'
import { app } from './app.js'

const server = app.listen(env.port, () => {
  console.log(`Servidor iniciado em http://localhost:${env.port}`)
})

async function shutdown() {
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
