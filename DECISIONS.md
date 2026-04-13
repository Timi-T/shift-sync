# ShiftSync — Design Decisions

Notes on the judgment calls I made while building this. Some of these are resolving explicit ambiguities from the brief; others are decisions that came up during implementation that were worth writing down.

---

## Timezone-aware availability

The platform has locations in two timezones (PT and ET). When a staff member sets their availability to "09:00–17:00", what does that mean?

I went with **wall-clock intent** — the window means "9am wherever I'm working that day." When the constraint engine checks Chris's availability for a shift at The Heights (ET), it converts the UTC shift times into ET and checks whether 09:00–17:00 covers it. Same window, different timezone resolution.

The alternative — storing a UTC offset alongside each window — is technically simpler but wrong in practice. DST means the offset changes. A window set in November (UTC-8) evaluated against a March shift (UTC-7) would be off by an hour. Wall-clock sidesteps this entirely because we always resolve "what time is it at the location right now" using the IANA timezone string, not a fixed offset.

The other alternative was requiring staff to create separate windows per location. That's more accurate for edge cases (travel time, etc.) but adds a lot of friction for the common case where someone's schedule is just "days I'm available, whenever you need me." One window that works everywhere felt right for a restaurant context.

Acknowledged trade-off: this model assumes Chris is equally willing to start at 9am at any location regardless of travel. A real system would probably factor commute into the constraint engine. For now it's out of scope.

---

## Concurrent assignment race conditions

Two managers could try to assign the last open slot on the same shift to two different staff members at the same time. Classic TOCTOU problem.

I put two layers in front of this:

**Layer 1 — Redis distributed lock.** When an assignment request comes in, we acquire a `SET NX PX` lock keyed to `lock:assign:{userId}` with a 5-second TTL before touching the database. If another process holds the lock for that user, the request gets a 409 immediately. The lock is released via a Lua script that checks the token before deleting — this prevents a slow process from accidentally releasing a lock acquired by someone else after its TTL expired.

**Layer 2 — Serializable transaction.** Inside the Prisma transaction we re-check headcount and re-verify the user isn't already assigned. `isolationLevel: "Serializable"` means concurrent reads of the same rows cause one transaction to fail and retry rather than both committing.

The reason for both: Redis catches the common case fast (sub-millisecond, before any DB round-trip). The Serializable transaction is the actual correctness guarantee — it works correctly even if Redis is unavailable, which the API handles gracefully by logging the failure and proceeding.

The lock is per-user rather than per-shift because per-shift would serialize all assignments to a popular shift unnecessarily. We care about preventing the same person being double-assigned; the headcount re-check in the transaction handles the "fully staffed" scenario independently.

---

## What counts as a premium shift

The brief asks for fairness analytics on premium shift distribution without defining "premium."

A shift is premium if it **starts on a Friday or Saturday at or after 17:00 in the location's local timezone.** Friday and Saturday dinner service is the highest-revenue window for a restaurant group — more tips, more cover pressure, more desirable for experienced staff.

`isPremiumShift(utcStartTime, timezone)` does the timezone conversion and checks day-of-week + hour. The result is stored as a boolean on the `Shift` model at creation time. I could derive it at query time but storing it lets the analytics queries filter on an indexed column rather than computing it for every row.

Sunday evenings are busy but not included. Brunch service (Saturday/Sunday daytime) isn't included either. This is a simplification — a real deployment would want this configurable per location — but a single consistent rule applied everywhere is fine for this assessment.

---

## Constraint engine — ordering and failure mode

The engine runs 10 rules in a fixed order and returns as soon as it finds hard violations. The order is:

1. LOCATION_NOT_CERTIFIED
2. SKILL_MISMATCH
3. UNAVAILABLE
4. DOUBLE_BOOKED
5. INSUFFICIENT_REST (< 10 hours between shifts)
6. DAILY_HOURS_WARNING (shift > 8h)
7. DAILY_HOURS_HARD_BLOCK (total day > 12h)
8. WEEKLY_HOURS_WARNING (35–40h or ≥40h/week)
9. SIXTH_CONSECUTIVE_DAY (warning only)
10. SEVENTH_CONSECUTIVE_DAY (hard block, manager override allowed)

Most critical rules come first. Showing a manager DOUBLE_BOOKED + SKILL_MISMATCH + AVAILABILITY_CONFLICT simultaneously is overwhelming and usually means the first issue has to be fixed before the others even matter. Fix the most fundamental problem first, resubmit, see the next issue if any.

Warnings and violations are returned separately. Violations block assignment; warnings show up in the response after a successful assignment so the manager is informed but not blocked. The single exception to "fix the most critical first" approach is SEVENTH_CONSECUTIVE_DAY — it's a hard block but managers can bypass it with an explicit override reason, which gets recorded in the audit log.

---

## Seventh consecutive day — override flow

When the constraint engine detects SEVENTH_CONSECUTIVE_DAY, the frontend shows an input field for the override reason (minimum 5 characters to prevent "yes" being passed through). If the manager fills it in and resubmits, the assignment goes through and a `ManagerOverride` record is created with the reason, the manager's ID, and the timestamp.

The audit log is accessible to admins so there's a paper trail for labor compliance reviews. The requirement to write an explicit reason rather than just clicking "yes, override" is intentional friction — it makes managers think for a second before scheduling someone for their eighth consecutive day.

---

## Swap request state machine

There are two request types that share the same model and most of the same logic: SWAP (swap your shift with someone specific) and DROP (give up your shift to anyone who wants it).

SWAP flow:
```
PENDING_ACCEPTANCE → receiver accepts → PENDING_MANAGER → APPROVED | REJECTED
PENDING_ACCEPTANCE → initiator cancels → CANCELLED
```

DROP flow:
```
PENDING_ACCEPTANCE → someone claims it → PENDING_MANAGER → APPROVED | REJECTED
PENDING_ACCEPTANCE → initiator cancels → CANCELLED
PENDING_ACCEPTANCE → expires unclaimed → EXPIRED (background job)
```

During a swap, the initiator's assignment flips to PENDING_SWAP so it's visible to managers as in-flight. If the swap is rejected or cancelled at any point, it reverts to CONFIRMED. This lets managers see on the schedule that something is in motion without the slot being considered empty.

DROP requests set an `expiresAt` at creation time — whichever is sooner: shift start minus `DROP_REQUEST_EXPIRY_HOURS` (default 24h) or 7 days from now. A background job runs every 5 minutes to find expired DROPs, mark them EXPIRED, restore the initiator's assignment to CONFIRMED, and send a notification. This prevents planning limbo where a manager doesn't know whether a shift is covered.

Each staff member is capped at `MAX_PENDING_SWAP_REQUESTS` (default 3) concurrent pending requests. This prevents gaming the system by opening many swaps simultaneously.

---

## Staff shift pickup

DROP and SWAP handle scenarios where a staff member wants to give up a shift. The pickup flow handles the reverse — a staff member claiming a published shift that has open slots.

Rather than shoehorning this into the existing `SwapRequest` model (which requires an `assignmentId` because it's built around existing assignments), I added a separate `ShiftPickupRequest` model with its own state enum (PENDING → APPROVED | REJECTED). The models are conceptually different enough that sharing one felt like it would make both harder to understand.

The pickup flow:
1. Staff sees open published shifts on their dashboard
2. Requests pickup — checked against location certification and skill match immediately (no point making a request you're not qualified for)
3. Request lands in the manager's queue alongside swap requests
4. Manager approves → assignment is created transactionally, slot count updates
5. Manager rejects with optional note → staff is notified

A staff member can only have one PENDING request per shift. If previously rejected, they can request again (the unique constraint is on shiftId+userId but the upsert path handles re-requests).

---

## Fairness score

I used the **Gini coefficient** inverted to a 0–100 scale where 100 = perfect equity.

The Gini measures how unequally a quantity is distributed across a population. A Gini of 0 means everyone has exactly the same; 1 means one person has everything. `score = (1 - Gini) * 100`.

The reason for Gini over simpler metrics like standard deviation: std is influenced by absolute values. A team averaging 10 premium shifts each shows higher std than one averaging 2, even if both are equally distributed. Gini normalises for this and is comparable across different team sizes and time periods.

Special cases: zero staff, one staff member, or no premium shifts assigned all return a score of 100. There's no distribution to measure, so it's not meaningful to report inequality.

The report also shows `premiumSharePercent` per staff member — their premium shifts as a percentage of total premium shifts assigned in the period. This sits alongside the score so managers can see who the outliers are, not just how bad the overall distribution is.

---

## Authentication

JWT over sessions because the API is stateless and I didn't want to add a session store dependency when Redis is already optional infrastructure. Tokens are HS256-signed, expire in 7 days (configurable via `JWT_EXPIRES_IN`).

The token is accepted two ways: as an httpOnly `token` cookie (set at login, for browser clients) and as an `Authorization: Bearer` header (for API testing and future mobile clients). The middleware checks the header first, falls back to the cookie.

The JWT payload carries `sub` (user ID), `email`, `name`, and `role`. All authorization checks in the API use `req.user.sub` for the user ID, not a separate `id` field.

No refresh token flow — out of scope for this assessment but the architecture supports adding one without changes to the signing mechanism.

---

## EXCEPTION overrides RECURRING availability

The availability system has two window types: RECURRING (a day-of-week pattern, e.g. "every Saturday 10:00–18:00") and EXCEPTION (a specific date override).

EXCEPTION always wins. If a staff member marks a specific Saturday as unavailable, that takes precedence over their normal Saturday RECURRING window. The constraint engine checks EXCEPTION first for the shift's date; if one exists, it uses that and ignores RECURRING entirely for that day.

This matches how every calendar app works and matches user intuition. "I'm normally available Saturdays but not this one" should just work.

---

## Notification system

Notifications are delivered two ways simultaneously: persisted to the `Notification` table (for in-app bell/inbox) and emitted via Socket.io for real-time updates.

On connect, each Socket.io client is authenticated via the JWT from `handshake.auth.token`. The server then joins the socket to rooms based on role:
- ADMIN → all location rooms
- MANAGER → rooms for their managed locations
- STAFF → rooms for their certified locations
- Everyone → a personal `user:{userId}` room for direct notifications

`broadcastToLocation` fires to everyone in a location room. `emitToUsers` targets specific users by personal room. This room model means location-specific events (new shift created, conflict detected) naturally reach the right audience without the server needing to look up who should receive each event.

Email delivery is stubbed — `EMAIL_ENABLED=false` in the default env, and the service logs what it would have sent rather than connecting to SMTP. Setting `EMAIL_ENABLED=true` with valid SMTP credentials enables real delivery.

---

## Shared package

The `@shift-sync/shared` package contains TypeScript interfaces and Zod schemas that are used by both the API and the web app. The API imports schemas for request validation middleware; the web imports the same schemas for client-side form validation. Same rules, same error messages, zero duplication.

The package is built with tsup as both CJS and ESM so it works in the Next.js (ESM) and Express (CJS) contexts without configuration on either side.

---

## CORS

The `CORS_ORIGINS` environment variable (plural — with an S) accepts a comma-separated list of allowed origins. Both the Express `cors()` middleware and the Socket.io CORS config read from the same parsed list. This means you can add staging and production origins in one place:

```
CORS_ORIGINS="https://shift-sync.vercel.app,https://staging.shift-sync.vercel.app"
```

`credentials: true` is set on both so cookies work cross-origin for browser clients.
