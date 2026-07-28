import fs from 'node:fs/promises'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { query } from '../db/pool.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.resolve(currentDir, '../../database/migrations')

async function run() {
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()

  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf-8')
    await query(sql)
    console.log(`Migração aplicada: ${file}`)
  }

  process.exit(0)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
