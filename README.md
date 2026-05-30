# Bosko API — Backend

The backend of **Bosko Files**, an automation platform that publishes beatmakers' tracks to **BeatStars** and **YouTube** in one click.

This repo is the **orchestration layer**: authentication, the Postgres data model, third-party account connections, S3 media handling, and the real-time job pipeline that drives the two rendering/publishing Lambdas.

## ✨ What it does

- **Auth & sessions** — email/password (bcrypt) + `express-session`.
- **Account connections** — BeatStars and YouTube via Google OAuth (`googleapis`).
- **Media handling** — uploads to S3 (`@aws-sdk`), image processing with `sharp`, audio/video probing with `ffmpeg`.
- **Publish orchestration** — `POST /api/tracks/:id/publish` invokes the [`bosko-publish`](https://github.com/josepruizpons/bosko-publish) Lambda asynchronously (`InvocationType=Event`).
- **Real-time events** — receives HMAC-signed callbacks from the Lambda at `/webhooks/lambda-event` and relays progress to the web app over `socket.io`.
- **Waitlist** — `POST /api/waitlist`, the endpoint the [landing page](https://github.com/josepruizpons/bosko-landing) posts to.

## 🛠️ Stack

- **Express 5** + TypeScript (`tsx` in dev)
- **PostgreSQL** + **Prisma 7** (`@prisma/adapter-pg`)
- `socket.io` for real-time updates
- AWS SDK v3 (S3 + Lambda), `sharp`, `fluent-ffmpeg`
- `googleapis` for YouTube/OAuth

## 🧩 Data model (Prisma)

`users`, `track`, `asset`, `profiles`, `profile_connections`, `oauth`, `waitlist` and supporting enums. The same database is shared with the publish Lambda.

## ▶️ Run

```bash
npm install
npm run db          # prisma db pull && generate
npm run dev         # tsx watch src/index.ts
npm run dev:local   # local mode with mkcert CA + local bosko-publish + ffmpeg
npm run build       # prisma generate && tsc
npm start           # node dist/index.js
```

Requires a `.env` with at least `DATABASE_URL`, `LAMBDA_WEBHOOK_SECRET`, AWS credentials/region, and Google OAuth client config. See `.env.example`.

## 📁 Routes

```
src/routes/
├── auth.routes.ts        # login / sessions
├── user.routes.ts
├── profiles.router.ts    # BeatStars/YouTube profiles
├── beatstars.routes.ts
├── google.routes.ts      # OAuth
├── tracks.router.ts      # build + publish tracks
├── assets.router.ts      # media uploads
├── webhooks.routes.ts    # HMAC callbacks from bosko-publish
└── waitlist.routes.ts    # landing-page signups
```

---

## 🗺️ The Bosko Files ecosystem

A portfolio project split into five repositories:

| Repo | Role |
|------|------|
| [bosko-landing](https://github.com/josepruizpons/bosko-landing) | Marketing landing page + waitlist capture |
| [bosko](https://github.com/josepruizpons/bosko) | Web app (SPA) where beatmakers manage & publish tracks |
| **bosko-api** ← *you are here* | Backend API — auth, DB, orchestration, real-time events |
| [bosko-publish](https://github.com/josepruizpons/bosko-publish) | AWS Lambda — full publish pipeline (BeatStars → **video** → YouTube) |

```
  visitors ─► bosko-landing ──(waitlist)──► bosko-api
                                               ▲
  users ─────► bosko (web app) ◄──REST + socket.io──┘
                                               │ async invoke
                                               ▼
                                         bosko-publish
                                 (BeatStars → video → YouTube → S3)
```

> 🧪 **Development history:** [bosko-video](https://github.com/josepruizpons/bosko-video) was the original *standalone* video-rendering Lambda. Its ffmpeg logic now lives inside `bosko-publish`, which renders the video inline as part of the publish pipeline — so `bosko-video` is legacy and no longer part of the live flow. It's kept as a snapshot of how the project evolved.
