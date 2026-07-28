import { Pool, type QueryResultRow } from 'pg'

import { env } from '../config/env.js'

export const pool = new Pool({
  connectionString: env.databaseUrl,
})

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params)
}
