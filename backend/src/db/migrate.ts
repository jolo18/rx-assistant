import { parseEnv } from '../env.ts'
import { openDb } from './client.ts'

const env = parseEnv()
const handle = openDb({ path: env.DATABASE_PATH, migrate: true })
handle.close()
console.log(`migrations applied to ${env.DATABASE_PATH}`)
