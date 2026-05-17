import 'dotenv/config'
import { readFileSync } from 'fs'
import { Client } from 'pg'

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: tsx prisma/sql_migrations/apply.ts <path-to-sql>')
    process.exit(1)
  }

  const sql = readFileSync(file, 'utf-8')
  const client = new Client({ connectionString: process.env.DATABASE_URL })

  await client.connect()
  try {
    await client.query(sql)
    console.log(`✔ Applied ${file}`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
