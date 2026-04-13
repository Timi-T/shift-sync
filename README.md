# ShiftSync — Coastal Eats Scheduling Platform

A production-quality, full-stack staff scheduling system for a multi-location restaurant group.

---

## Run in 60 seconds

```bash
# 1. Start PostgreSQL + Redis
docker compose up -d

# 2. Install dependencies
npm install

# 3. Copy env (Docker credentials match .env.example — only JWT_SECRET needs changing)
cp .env.example .env

# 4. Run migrations and seed evaluation scenarios
cd apps/api && npx prisma migrate deploy && npx prisma db seed && cd ../..

# 5. Start both services
npm run dev
# API  → http://localhost:4000
# Web  → http://localhost:3000
```

---

## Demo Login Credentials

| Role | Email | Password | Access |
|---|---|---|---|
| Admin | `admin@coastaleats.com` | `Admin123!` | Full platform — users, all locations, audit log |
| Manager (West) | `tom.garcia@coastaleats.com` | `Manager123!` | Marina + Boardwalk locations |
| Manager (East) | `lisa.chen@coastaleats.com` | `Manager123!` | Heights + Garden locations |
| Staff | `sarah.chen@coastaleats.com` | `Staff123!` | Server · The Marina |
| Staff | `ryan.wilson@coastaleats.com` | `Staff123!` | Line cook · near overtime limit |
| Staff | `chris.lee@coastaleats.com` | `Staff123!` | Server · cross-timezone location |

> All accounts are pre-filled on the login page — click any row, then press **Sign in**.

---

## Architecture Overview

```
shift-sync/
├── apps/
│   ├── api/          Express.js REST API + Socket.io (port 4000)
│   └── web/          Next.js 14 App Router frontend (port 3000)
└── packages/
    └── shared/       TypeScript types + Zod schemas (no runtime deps)
```

**Stack choices:**
| Layer | Technology | Reason |
|---|---|---|
| API | Express.js + TypeScript | Explicit routing, familiar, great ecosystem |
| ORM | Prisma + PostgreSQL | Type-safe queries, migrations, excellent DX |
| Auth | JWT (HS256) | httpOnly cookie + Bearer header, no third-party |
| Real-time | Socket.io | Room-based pub/sub; degrades to polling |
| Locking | Redis SET NX PX | Prevent concurrent assignment race conditions |
| Frontend | Next.js 14 App Router | SSR shell, file-based routing |
| State | TanStack Query v5 | Server state + cache invalidation on socket events |
| UI | Tailwind + shadcn/ui Radix primitives | Accessible, composable |
| Validation | Zod (shared package) | Single schema used client and server side |
| Tests | Vitest + Supertest | Fast, ESM-native, no config overhead |

---

## Prerequisites

- Node.js 20+ (tested on v20 and v22; v24 works but requires a clean install — see note below)
- Docker Desktop (for PostgreSQL + Redis) **or** local installs of PostgreSQL 15+ and Redis 7+

> **npm + esbuild on Apple Silicon / Node 24:** If you see `@esbuild/darwin-arm64 could not be found` after installing, run a clean reinstall:
> ```bash
> rm -rf node_modules package-lock.json apps/*/node_modules packages/*/node_modules
> npm install
> ```
> This is an npm workspaces quirk where platform-specific optional deps are occasionally skipped on the first hoist.

---

## Quick Start (Local)

### 1. Start the databases (Docker — recommended)

```bash
docker compose up -d
```

This starts PostgreSQL on `localhost:5432` and Redis on `localhost:6379` with persistent named volumes. The credentials already match `.env.example` — no changes needed.

```bash
# Optional: Redis Commander UI at http://localhost:8081
docker compose --profile tools up -d
```

To stop (data is preserved in Docker volumes):

```bash
docker compose down
```

To stop **and wipe all data** (useful for a clean re-seed):

```bash
docker compose down -v
```

### 2. Install dependencies

```bash
npm install          # installs all workspaces
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET`. Everything else matches the Docker defaults.

| Variable | Default | Required |
|---|---|---|
| `DATABASE_URL` | — | ✅ |
| `JWT_SECRET` | — | ✅ |
| `REDIS_URL` | `redis://localhost:6379` | No (locking disabled if absent) |
| `PORT` | `4000` | No |
| `CORS_ORIGIN` | `http://localhost:3000` | No |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | No |
| `NEXT_PUBLIC_SOCKET_URL` | `http://localhost:4000` | No |

### 4. Set up the database

```bash
cd apps/api
npx prisma migrate deploy    # applies all migrations
npx prisma db seed           # seeds all evaluation scenarios
cd ../..
```

> **Re-seeding after a wipe:** Run `docker compose down -v && docker compose up -d` first, then repeat the migrate + seed commands above.

### 5. Run in development

```bash
# From repo root — starts both services concurrently
npm run dev
```

Or run individually:

```bash
# API (port 4000)
cd apps/api && npm run dev

# Web (port 3000)
cd apps/web && npm run dev
```

---

## Evaluation Scenarios (pre-seeded)

| # | Scenario | How to trigger |
|---|---|---|
| 1 | **Sunday Night Chaos** | Manager view → The Marina → this Sunday → shift is understaffed; open slots show in amber |
| 2 | **Overtime Trap** | Log in as Ryan Wilson (near 40h); manager assigning him to another shift triggers the OT constraint block |
| 3 | **Timezone Tangle** | Log in as Chris Lee (cross-timezone); availability is wall-clock intent, resolved per location's IANA timezone |
| 4 | **Simultaneous Assignment** | Open two browser tabs and assign the same staff member concurrently — Redis lock + DB serializable transaction prevents double-booking |
| 5 | **Fairness Complaint** | Manager → Analytics → Fairness Report shows unequal premium shift distribution |
| 6 | **Regret Swap** | Log in as Sarah Chen → Swap Requests → find a PENDING_MANAGER swap → "Regret / Cancel" restores the CONFIRMED assignment |
| 7 | **Staff Pickup** | Log in as any staff member → see open shifts available to pick up → request one → switch to manager account to approve/decline |

---

## Running Tests

```bash
# API — unit + integration tests
cd apps/api
npm test

# API — watch mode
npm run test:watch

# Web — component tests
cd apps/web
npm test
```

---

## Project Structure

```
apps/api/src/
├── features/           Feature-scoped controllers + routes
│   ├── auth/
│   ├── shifts/         shifts, assignments, swaps, pickup requests
│   ├── users/
│   └── locations/
├── services/
│   ├── scheduling/
│   │   ├── constraints.service.ts   10-rule constraint engine
│   │   ├── overtime.service.ts      OT projection + consecutive days
│   │   └── fairness.service.ts      Gini coefficient fairness score
│   ├── notification.service.ts      Persist + emit socket events
│   ├── socket.service.ts            Socket.io broadcast helpers
│   └── timezone.service.ts          DST-safe wall-clock operations
├── middleware/
│   ├── authenticate.ts   JWT extraction → req.user
│   ├── authorize.ts      Role guard factory
│   ├── validate.ts       Zod parse middleware
│   └── error-handler.ts  Maps typed errors → JSON
├── lib/
│   ├── prisma.ts   Singleton client
│   ├── redis.ts    Distributed locking (SET NX PX + Lua)
│   ├── jwt.ts      signToken / verifyToken
│   ├── errors.ts   Typed error classes
│   └── response.ts ok() / created() / apiError() helpers
├── app.ts          createApp() — middleware stack
├── socket.ts       createSocketServer() — JWT auth on connect
└── index.ts        bootstrap() — start HTTP + Socket

apps/web/src/
├── app/
│   ├── (auth)/login/       Public login page
│   ├── (app)/              Protected routes (AppShell wraps all)
│   │   ├── admin/          Admin overview + users + audit
│   │   ├── manager/        Schedule, staff, analytics
│   │   └── staff/          Shifts, availability, swaps
│   ├── layout.tsx          Root layout with Providers
│   └── providers.tsx       QueryClient + Auth + Socket + Toaster
├── components/
│   ├── layout/             AppShell, Sidebar, Header, NotificationBell
│   ├── scheduling/         WeekCalendar, ShiftCard, CreateShiftModal,
│   │                       AssignStaffModal, ConstraintViolationAlert, OnDutyDashboard
│   ├── swaps/              SwapRequestCard, RejectSwapModal
│   ├── analytics/          OvertimeDashboard, FairnessReport
│   ├── availability/       AvailabilityEditor
│   └── ui/                 shadcn/ui primitives (Button, Dialog, Badge…)
├── contexts/
│   ├── AuthContext.tsx     useAuth — login/logout/refresh + JWT rehydration
│   └── SocketContext.tsx   useSocket — typed event subscription
├── lib/
│   ├── api.ts              Typed axios wrappers for all endpoints
│   ├── socket.ts           Socket.io client singleton
│   └── utils.ts            cn(), formatLocalTime(), formatDuration()…
└── hooks/
    └── use-toast.ts        Module-state toast queue
```

---

## Key Design Decisions

See [DECISIONS.md](./DECISIONS.md) for full rationale on the 5 intentional ambiguities from the assessment brief.
