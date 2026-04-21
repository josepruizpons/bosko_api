# AGENTS.md

## Stack

- Node.js + Express 5, TypeScript (strict, CommonJS, target ES2020)
- Prisma 7 with `@prisma/adapter-pg` driver adapter (not default Prisma connection) — PostgreSQL
- Package manager: npm

## Developer Commands

```sh
npm run dev           # tsx watch src/index.ts (hot reload)
npm run dev:debug     # tsx src/index.ts (no watch)
npm run build         # npx prisma generate && tsc  → dist/
npm run start         # node dist/index.js (production)

npm run db:pull       # prisma db pull (introspect live DB, update schema.prisma)
npm run db:generate   # prisma generate (regenerate client into src/generated/prisma/)
npm run db            # db:pull + db:generate combined
```

There are **no test, lint, typecheck, or format scripts**. To typecheck manually:

```sh
npx tsc --noEmit
```

## Setup: Required Before `npm run dev`

### Self-signed TLS certs (local only)

`src/index.ts` reads `localhost-key.pem` and `localhost.pem` at startup in non-production mode. Generate them before running dev:

```sh
mkcert localhost   # produces localhost.pem and localhost-key.pem
```

### Environment variables (no `.env.example` in repo)

These must be set; several throw at startup if absent:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | express-session — throws if missing |
| `AWS_ID` | throws if missing |
| `AWS_SECRET_KEY` | throws if missing |
| `AWS_BUCKET` | S3 bucket — throws if missing |
| `AWS_REGION` | defaults to `eu-west-3` |
| `AWS_LAMBDA_FUNCTION_NAME` | defaults to `bosko-video` |
| `NODE_ENV` | set `production` on Render; switches to HTTP, changes CORS origins and OAuth callback URL |
| `PORT` | defaults to `3000` |
| `FRONTEND_URL` | used for Google OAuth popup `postMessage` origin |

## Architecture Notes

- **Entrypoint:** `src/index.ts` — starts HTTPS (dev) or HTTP (prod, Render handles TLS)
- **App wiring:** `src/routes/app.ts` — Express app, CORS, session, route mounting
- **DB singleton:** `src/db.ts` — Prisma client using `PrismaPg` adapter (not `new PrismaClient()` directly)
- **Generated client path:** `src/generated/prisma/` — import as `import { PrismaClient } from './generated/prisma/client'`. **Always run `npm run db:generate` after schema changes or on first setup.**
- **No migrations** — schema is managed via `prisma db pull` (introspect existing DB). No `prisma/migrations/` directory.
- **Prisma datasource URL** comes from `prisma.config.ts` via `process.env.DATABASE_URL`, not from `env("DATABASE_URL")` inside `schema.prisma`.
- **AWS Lambda** (`src/aws.ts`): Lambda function `bosko-video` is invoked synchronously to generate video from audio + image S3 keys.
- **Auth:** Session-based (not JWT). Cookie name: `bosko_session`. User ID stored as `req.session.userId` (typed via `types/express.d.ts`).
- **Protected routes:** all under `/api`, gated by `validate_session` middleware. Public: `/health`, `/google/auth_callback`, `/auth/*`.
- **Type augmentation:** `types/express.d.ts` (outside `src/`) adds `id_user`, `sessionId` to `Request` and `userId: number` to `SessionData`. Included via `tsconfig.json`.
- **Error helpers:** `api_error400()` / `api_error500()` in `src/errors.ts`; central `errorHandler` middleware in `src/utils.ts`.

## Conventions

- Code comments are in Spanish.
- Production deployment target: Render. Hardcoded production origins: `*.onrender.com`, `boskofiles.com`.
