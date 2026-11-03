# ZeroDue

> **Track every rupee. Clear every loan.**

ZeroDue is a personal, mobile-first expense and loan tracker for India (INR only, `₹1,29,300` grouping, `DD MMM YYYY` dates, IST). It tracks income, expenses, loans, recurring bills and a monthly cash waterfall, and captures bank/UPI payment SMS on Android for one-tap categorisation.

| App               | Stack                                                     | Role                                                                          |
| ----------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web`        | Next.js (App Router), TypeScript, Tailwind, PWA, Web Push | UI only — all data goes through the API                                       |
| `apps/api`        | NestJS, TypeScript, PostgreSQL + Prisma, JWT, scheduler   | REST API, auth, reminders, push, SMS ingest                                   |
| `apps/mobile`     | Flutter (Android)                                         | SMS capture, forwards to `POST /ingest/sms`, category quick-pick notification |
| `packages/shared` | TypeScript                                                | Types, DTOs, categories, INR formatting, loan/amortisation math               |
| `packages/config` | ESLint, Prettier, tsconfig                                | Shared tooling config                                                         |

## Repository layout

```
zerodue/
├── apps/
│   ├── web/        Next.js PWA
│   ├── api/        NestJS service ("ZeroDue API")
│   └── mobile/     Flutter Android companion (own pubspec; not in pnpm workspace)
├── packages/
│   ├── shared/     @zerodue/shared
│   └── config/     @zerodue/config
├── docker-compose.yml   PostgreSQL for local dev
├── .env.example         all env vars, grouped per app
├── turbo.json           Turborepo pipeline
└── pnpm-workspace.yaml  web, api, packages/* (mobile excluded)
```

## Prerequisites

- Node.js ≥ 20 (`.nvmrc` pins 22) and pnpm 10 (`corepack enable`)
- Docker (for local PostgreSQL)
- Flutter stable + Android SDK (only for `apps/mobile`)

## Setup

```bash
pnpm install
cp .env.example .env
cp .env.example apps/web/.env.local   # keep only the NEXT_PUBLIC_* lines you need
pnpm db:up                            # starts PostgreSQL via Docker Compose
```

Generate secrets and VAPID keys:

```bash
openssl rand -base64 48               # JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
npx web-push generate-vapid-keys      # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

## Scripts

| Command                       | What it does                                                           |
| ----------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                    | Runs web (`:3000`) and api (`:4000`) together; `shared` is built first |
| `pnpm build`                  | Builds shared, api and web                                             |
| `pnpm test`                   | Runs all tests (vitest for shared/web, jest for api)                   |
| `pnpm lint`                   | ESLint across all packages                                             |
| `pnpm format`                 | Prettier write                                                         |
| `pnpm db:up` / `pnpm db:down` | Start / stop local PostgreSQL                                          |

## Running each app

**API** — `pnpm --filter @zerodue/api dev`, then `curl localhost:4000/health`.

**Web** — `pnpm --filter @zerodue/web dev`, open <http://localhost:3000>.

**Mobile** — Flutter is managed separately from pnpm.

```bash
cd apps/mobile
bash tool/bootstrap_android.sh   # once: generates android/, sets label "ZeroDue" and package com.ashwin.zerodue
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000   # emulator; use your LAN IP on a device
flutter analyze && flutter test
```

## Deploy

**API (self-hosted VPS)** — run PostgreSQL (managed or Compose), set the env vars from `.env.example` (production secrets, `WEB_ORIGIN` = your PWA origin), then `pnpm --filter @zerodue/api build` and `pnpm --filter @zerodue/api start` behind HTTPS (Caddy/nginx). Dockerfiles and Prisma migration steps land in M8.

**Web** — set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, then `pnpm --filter @zerodue/web build && pnpm --filter @zerodue/web start`, or deploy to any Node/Next host. The PWA requires HTTPS.

**Mobile** — personal use, **sideloaded APK**: `flutter build apk --release --dart-define=API_BASE_URL=https://api.your-domain`. The signed-build guide arrives in M6/M8. Google Play restricts `READ_SMS`/`RECEIVE_SMS`, so Play Store distribution is out of scope.

## Conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint + husky. Scopes: `web`, `api`, `mobile`, `shared`, `config`, `ci`, `deps`, `docs`, `repo` — e.g. `feat(api): add device pairing`.
- **Money**: integer paise only, never floats. Display with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`. All money logic lives in `packages/shared`.
- **Dates**: `DD MMM YYYY`, timezone `Asia/Kolkata`.

## CI

`.github/workflows/ci.yml`: **web-api** job runs `pnpm lint`, `pnpm test`, `pnpm build`; **mobile** job runs `flutter analyze` and `flutter test`.

## Milestones

| #   | Milestone                                                                |
| --- | ------------------------------------------------------------------------ |
| M0  | Assumptions & design (architecture, Prisma schema, API spec, wireframes) |
| M1  | Foundations (auth, Prisma, Swagger, PWA shell, INR utils)                |
| M2  | Finance engine in `packages/shared` + golden tests                       |
| M3  | Core tracking (transactions, categories, recurring, offline sync)        |
| M4  | Loans, planner, dashboard, seed data                                     |
| M5  | Reminders & web push                                                     |
| M6  | Automatic SMS capture (Flutter + `/ingest/sms`)                          |
| M7  | Import/export & privacy                                                  |
| M8  | Hardening, CI APK build, deployment                                      |

## Privacy

Your data stays on infrastructure you control: self-hosted API and database, no third-party analytics, sensitive values redacted from logs.
