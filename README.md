# StaySphere — Backend API

REST API for StaySphere, a role-based rental marketplace for affordable
accommodation in tier-2 and tier-3 Indian cities.

Built with Node.js, Express 5, MongoDB and Mongoose. Authentication uses JWT
with bcrypt-hashed passwords.

> **Build status:** authentication and roles, property CRUD and search
> (filters, pagination, geospatial nearby), the booking state machine,
> **Razorpay payments** (order, signature verification, signed webhooks),
> favourites, profile and password reset, **content-based recommendations**
> (TF-IDF + cosine similarity), reports, the landlord dashboard and the full
> **admin console API** (moderation with an audit trail, analytics) are
> implemented and tested (118 tests).
>
> **Optional integrations:** Razorpay needs keys in `.env` (payments are
> disabled with a clear message until then); Resend email is optional;
> property images are stored on this server under `uploads/`.

---

## Getting started

You need Node.js 20+ and a MongoDB database — either a local server on port
27017 or a MongoDB Atlas cluster. The test suites additionally need a local
server (see [Testing](#testing)).

```bash
cd backend
npm install
cp .env.example .env      # then edit the values
npm run seed:admin        # creates the one admin account
npm run seed:demo         # optional: the demo accounts the UI advertises
npm run dev               # starts on http://localhost:5000
```

Check it is alive:

```bash
curl http://localhost:5000/health
```

```json
{ "success": true, "status": "ok", "database": "connected", ... }
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` / `production`. Controls error detail and rate limits. |
| `PORT` | HTTP port. Defaults to `5000`, which is what the frontend expects. |
| `MONGODB_URI` | Connection string. Local: `mongodb://127.0.0.1:27017/staysphere`. Atlas: `mongodb+srv://user:pass@cluster.mongodb.net/staysphere`. With Atlas, allowlist your IP under Network Access. |
| `JWT_SECRET` | Signing secret. Use a long random string outside development. |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d`. |
| `CLIENT_ORIGINS` | Comma-separated browser origins allowed through CORS. |
| `SEED_ADMIN_*` | Values used by `npm run seed:admin`. |

`.env` is git-ignored. Only `.env.example` is committed, and it holds no real
secrets.

---

## Project structure

```
backend/
  src/
    config/       env.js (validated config), db.js (single connection)
    controllers/  thin request/response handlers
    middleware/   auth, roles, validation, rate limits, central errors
    models/       User, Property, Booking, Payment, Notification (+ barrel)
    routes/       route tables, mounted through routes/index.js
    services/     business rules — the part worth reading
    validators/   express-validator rules per module
    utils/        AppError, generateToken
    scripts/      seedAdmin, seedDemo, seedProperties, syncIndexes
    app.js        builds the Express app (no side effects)
    server.js     connects the DB, then starts listening
  tests/          Node built-in test runner
```

The request path is deliberately boring and always the same:

```
route → validators → middleware (auth, role) → controller → service → model
```

Errors are never handled in controllers. Anything thrown lands in
`errorMiddleware.js`, which is the only place that formats an error response.
Express 5 forwards rejected promises automatically, so controllers need no
`try/catch` wrapper.

---

## Response shape

Every endpoint answers in one of two shapes, so the frontend never has to
guess.

Success:

```json
{ "success": true, "message": "Logged in successfully.", "data": { "...": "..." } }
```

Failure:

```json
{
  "success": false,
  "message": "Some fields need your attention.",
  "code": "VALIDATION_FAILED",
  "errors": { "email": "Enter a valid email address." }
}
```

`code` is a stable, machine-readable identifier (`INVALID_BOOKING_STATE`,
`NOT_OWNER`, `DUPLICATE_REQUEST`, …) so the frontend can branch on it without
matching message text. `errors` is present only for validation failures, keyed
by field name, which is what the React forms need to show messages inline.

---

## Implemented endpoints

### `GET /health`

Liveness plus database state. No authentication.

### `POST /api/auth/register`

Creates a tenant or landlord account and returns the user with a token.

```json
{
  "name": "Arjun Sharma",
  "email": "arjun@example.com",
  "phone": "9876543210",
  "password": "Password123",
  "role": "tenant"
}
```

- `role` is optional and may only be `tenant` or `landlord`. `admin` is
  rejected — admins exist only via `npm run seed:admin`.
- Password must be at least 8 characters with a letter and a number.
- `phone` must be a 10-digit Indian mobile number.
- Returns `201`, or `409` if the email is taken.

### `POST /api/auth/login`

```json
{ "email": "arjun@example.com", "password": "Password123" }
```

Returns `200` with the user and a token. A wrong password and an unknown email
both return the same `401` message, so the endpoint cannot be used to discover
which emails are registered.

### `GET /api/auth/me`

Requires `Authorization: Bearer <token>`. Returns the caller's own record.
Returns `401` for a missing, malformed or expired token, and `403` if the
account has since been suspended.

---

### `GET /api/properties`

Search, filter, sort and paginate listings. No authentication required —
but the results widen if the caller happens to be the owner or an admin.

| Query parameter | Example | Notes |
| --- | --- | --- |
| `q` | `q=hostel` | Matches title, city, address or type |
| `city` | `city=Gorakhpur` | Exact city, case-insensitive |
| `type` | `type=PG,Hostel` | One or more of PG, Flat, Hostel, Room, Studio |
| `gender` | `gender=Female` | Listings marked `Any` always match too |
| `occupancy` | `occupancy=Single,Shared` | Single, Double, Triple, Shared |
| `furnishing` | `furnishing=Fully-furnished` | |
| `amenities` | `amenities=AC,Gym` | **All** listed amenities must be present |
| `minRent` / `maxRent` | `maxRent=8000` | Matches if *any* occupancy price is in range |
| `status` | `status=available` | Availability state |
| `sort` | `sort=price-asc` | `default`, `price-asc`, `price-desc`, `rating`, `newest`, `rooms` |
| `page` / `limit` | `page=2&limit=9` | `limit` caps at 50 |

```json
{
  "success": true,
  "data": {
    "properties": [ { "id": "…", "title": "…", "rent": { "single": 7500 }, "…": "…" } ],
    "pagination": { "page": 1, "limit": 9, "total": 9, "totalPages": 1, "hasMore": false }
  }
}
```

### `GET /api/properties/nearby`

Radius search, nearest first. Requires `lat` and `lng`; `radiusKm`
defaults to 5 and is capped at 100. Each result carries a `distanceKm`
computed by MongoDB against the 2dsphere index.

```
GET /api/properties/nearby?lat=26.7606&lng=83.3732&radiusKm=15
```

### `GET /api/properties/:id`

One listing. Returns `404` — not `403` — for a listing the caller is not
allowed to see, so hidden listings cannot be probed by id.

### `GET /api/properties/my-properties`

Landlord only. Every listing the caller owns, whatever its verification
or availability state.

### `POST /api/properties`

Landlord only. Creates a listing owned by the authenticated landlord.

```json
{
  "title": "Sunrise PG for Girls near DDU University",
  "description": "At least 30 characters describing the place…",
  "type": "PG",
  "gender": "Female",
  "occupancy": ["Single", "Double"],
  "rent": { "single": 7500, "double": 5200 },
  "deposit": 15000,
  "totalRooms": 12,
  "availableRooms": 3,
  "furnishing": "Fully-furnished",
  "amenities": ["WiFi", "Mess/Food"],
  "landmarks": ["700m from DDU University"],
  "images": ["https://…"],
  "location": {
    "address": "Betiahata, near Civil Lines",
    "city": "Gorakhpur",
    "state": "Uttar Pradesh",
    "pincode": "273001",
    "lat": 26.7606,
    "lng": 83.3732
  }
}
```

`landlord`, `verificationStatus`, `featured` and `availabilityStatus` are
**ignored** if sent: ownership comes from the token, moderation from an
admin, and availability from the booking workflow. A new listing starts
`pending`, so it is not publicly discoverable until verified.

### `PUT /api/properties/:id` · `DELETE /api/properties/:id`

Landlord only, and only for listings they own — another landlord gets
`403`. Accepts a partial body. Editing a listing that was already
verified sends it back to `pending`, so approved content cannot be
quietly swapped afterwards.

---

---

## Bookings

The booking lifecycle is enforced entirely on the server. **No endpoint
accepts a status** — a client calls an action and the server decides the
resulting state.

```
pending ──approve──> accepted ──server──> payment_pending ──payment──> paid ──> booked ──> occupied
   │                                              │
   ├──reject──> rejected                          └──cancel──> cancelled
   └──cancel──> cancelled
```

`BOOKING_TRANSITIONS` in `models/Booking.js` is the only definition of
what may follow what, and every change goes through it. Each booking also
keeps a `history` array recording who changed the state, when and why.

### `POST /api/bookings` — tenant

```json
{
  "propertyId": "…",
  "occupancyType": "Single",
  "moveInDate": "2026-10-01",
  "durationMonths": 11,
  "message": "Could I visit this weekend?"
}
```

The rent and deposit are read from the property, never from the request,
and are frozen onto the booking so a later rent edit cannot change what
was agreed. Rejected with a clear `code` when the property is unverified
(`PROPERTY_NOT_VERIFIED`), full (`NO_ROOMS_AVAILABLE`), does not offer
that tier (`OCCUPANCY_NOT_OFFERED`), or the tenant already has an open
request for it (`DUPLICATE_REQUEST`).

### `GET /api/bookings/my-bookings` · `GET /api/bookings/landlord`

A tenant's own bookings, and the requests for a landlord's properties.
Both paginate and accept `?status=`.

### `GET /api/bookings/:id`

Readable by the tenant, the landlord, or an admin. Anyone else gets `404`
rather than `403`, so bookings cannot be enumerated.

### `PATCH /api/bookings/:id/approve` — owning landlord

Moves the request through `accepted` to `payment_pending` and claims a
room. The claim is a conditional update (`availableRooms >= 1` in the
filter), so when two approvals race for the last room, **one wins with
`200` and the other gets `409 INVALID_BOOKING_STATE` / `NO_ROOMS_AVAILABLE`** —
rooms can never go negative. Taking the last room flips the listing to
`booked`.

### `PATCH /api/bookings/:id/reject` — owning landlord

Optional `reason`, stored and shown to the tenant. Does not consume a room.

### `PATCH /api/bookings/:id/cancel` — tenant who made it, or admin

Releases a room if one had been claimed, and returns the listing to
`available` if it had been marked `booked`.

---

## Notifications

Created by the backend whenever a booking event happens — never by a
client. Read state is a timestamp, so marking as read keeps history.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/notifications` | Own feed, newest first, with `unreadCount`. `?unread=true` filters. |
| `PATCH /api/notifications/:id/read` | Mark one read (owner only). |
| `PATCH /api/notifications/read-all` | Mark the whole feed read. |

A notification creation failure is logged and swallowed: it must never
roll back the booking action that triggered it.

## Discoverability rules

A listing appears in public results only when `verificationStatus` is
`verified` and it is not `inactive`. Beyond that:

| Viewer | Sees |
| --- | --- |
| Anonymous / tenant | Verified, active listings only |
| Landlord | The above, plus every listing they own |
| Admin | Everything, including suspended and rejected |

Occupied listings stay visible — a tenant can still find and inspect
them — they are simply not available to book.

---

## Roles and permissions

Roles are `tenant`, `landlord` and `admin`.

Authentication and authorization are two separate middlewares, and routes
compose them:

```js
router.get('/dashboard', protect, authorize('admin'), getDashboard)
```

- `protect` answers *who are you?* — verifies the token and loads the user
  fresh from the database on every request, so a suspended account stops
  working immediately rather than when its token expires.
- `authorize(...roles)` answers *what may you do?* — and reads the role from
  the database record, never from the request body or a query parameter.

---

## Database models

All four schemas are defined and indexed, so later phases only add endpoints,
not migrations.

- **User** — name, email (unique), phone, `passwordHash` (`select: false`),
  role, status, favorites. Hashing lives in the model, so no controller can
  save a plain-text password.
- **Property** — landlord ref, type, gender preference, occupancy tiers,
  per-occupancy `rent`, deposit, room counts, furnishing, amenities,
  landmarks, images, and a `location` holding both the postal address and
  a GeoJSON point with a **2dsphere index** for the radius search. A
  `pre('save')` hook keeps indexed `rentMin`/`rentMax` in step with the
  per-occupancy prices, which is what makes rent filtering and sorting a
  plain indexed query. Also a compound `city + type + rentMin` index and a
  text index.

  Two vocabularies meet in this model on purpose: storage follows the
  specification (GeoJSON coordinates, separate `verificationStatus` and
  `availabilityStatus`), while `toPublicJSON()` emits what the React app
  already reads (`location.lat`/`lng`, `status`, a `verified` boolean, a
  landlord object). That one method is the only place the translation
  happens, so neither side had to be rewritten.
- **Booking** — tenant, landlord and property refs, plus the status machine.
  `BOOKING_TRANSITIONS` in `models/Booking.js` is the single source of truth
  for which status may follow which:

  ```
  pending ──accept──> payment_pending ──pay──> paid ──> booked ──> occupied
     └──────reject───> rejected
     └──────cancel───> cancelled
  ```

  Rent is copied onto the booking at request time, so a later rent edit cannot
  change what the tenant agreed to.
- **Payment** — booking/tenant/property refs, server-derived amount, and a
  partial unique index allowing only one *successful* payment per booking
  while still permitting repeated failed attempts.

`provider` on a payment is `demo`. **This project has no real payment gateway
integrated** — the field records that honestly.

---

## Security

- Passwords hashed with bcrypt (10 rounds); the hash is never selected or
  returned.
- Secrets live in `.env`, which is git-ignored; `env.js` fails at startup if a
  required one is missing.
- Helmet security headers; CORS restricted to `CLIENT_ORIGINS`.
- Rate limiting on the auth endpoints (relaxed in development so Postman
  testing does not lock you out).
- JSON body capped at 1 MB.
- Validation on every input via express-validator.
- Central error handling; stack traces and driver messages never reach
  clients in production.
- Identity is always taken from `req.user`, never from the request body.

---

## Testing

```bash
npm test
```

Runs the Node built-in test runner — no extra dependencies. Each test file
uses its own throwaway database (`staysphere_test_auth`,
`staysphere_test_properties`), dropped afterwards, so the files can run in
parallel without fighting over the same records.

The suites **never** use `MONGODB_URI`. They resolve their own connection
through `tests/testDatabase.js`, which defaults to a local server and
refuses any database whose name does not contain `test` — because these
tests call `dropDatabase()`, and the application database is now a shared
Atlas cluster. Point them at a different server with `MONGODB_TEST_URI`
if you need to; the database name is still forced to a test one.

So running the tests needs a local MongoDB even when the app itself is on
Atlas.

**94 tests**, covering:

- *Auth and roles (23)* — health route, JSON 404s, registration including
  duplicate email, weak password, bad phone and blocked admin
  self-registration, bcrypt hashing, login, `/me` with
  missing/malformed/expired tokens, suspended accounts, and every
  tenant/landlord/admin route combination.
- *Bookings and notifications (30)* — request creation with server-derived
  rent, duplicate-request and unverified-property rejection, approve/reject
  ownership, double approval, the **two-approvals-race for the last room**
  (one wins, one conflicts, rooms never go negative), cancellation
  releasing a claimed room, feed isolation and unread counts.
- *Properties (41)* — creation and validation, the owner being taken from
  the token rather than the body, a landlord being unable to self-verify
  or self-feature, ownership on update and delete, re-verification after
  an edit, every search filter (city, type, gender, occupancy, amenities,
  rent range, free text, combinations), sorting, pagination without
  overlap, moderation visibility from four viewpoints, and the nearby
  radius query including distance ordering and exclusions.

---

## Payments with Razorpay

1. Create a free Razorpay account, switch the dashboard to **Test Mode**,
   then **Account & Settings -> API Keys -> Generate Test Key**.
2. Put the keys in `.env` and restart the API:

   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
   ```
3. Optional but recommended once deployed: **Webhooks -> Add New Webhook**,
   URL `https://<your-api>/api/payments/webhook`, events `payment.captured`,
   `payment.failed`, `order.paid`, and put its secret in
   `RAZORPAY_WEBHOOK_SECRET`. (Webhooks cannot reach `localhost`; the
   checkout signature check alone confirms payments during local testing.)

Flow: the landlord approves -> booking is `payment_pending` -> the tenant
clicks **Pay** -> `POST /api/payments/create-order` creates a Razorpay order
for first month's rent + deposit (computed on the server) -> Razorpay
Checkout opens -> `POST /api/payments/verify` checks the HMAC signature ->
booking moves `paid -> booked`. The webhook confirms the same payment
idempotently; whichever arrives first wins and the other is a no-op.

In Test Mode use Razorpay's domestic test card `4100 2800 0000 1007` (any future
expiry, any CVV) or UPI id `success@razorpay`. No real money moves.

| Endpoint | Who | Purpose |
| --- | --- | --- |
| `GET /api/payments/config` | Public | Whether payments are enabled, test/live mode, public key id |
| `POST /api/payments/create-order` | Tenant | Razorpay order for a `payment_pending` booking |
| `POST /api/payments/verify` | Tenant | Verify checkout signature, confirm booking |
| `POST /api/payments/failed` | Tenant | Record a failed/closed checkout so it can be retried |
| `POST /api/payments/webhook` | Razorpay | Signed async confirmation (raw body) |
| `GET /api/payments/my` · `GET /api/payments/booking/:id` | Tenant / landlord / admin | Payment history |

## Other APIs added

| Area | Endpoints |
| --- | --- |
| Users | `GET/POST/DELETE /api/users/favorites[/:id]`, `PATCH /api/users/profile`, `PATCH /api/users/password` |
| Password reset | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` (emailed link via Resend; in development without email the link is returned to the UI) |
| Uploads | `POST /api/uploads/property-images` (landlord, multipart `images`, up to 6 JPG/PNG/WebP of 5 MB) |
| Recommendations | `GET/PUT /api/recommendations/preferences`, `GET /api/recommendations`, `GET /api/recommendations/similar/:propertyId` |
| Reports | `POST /api/reports`, `GET /api/reports/mine` |
| Landlord | `GET /api/landlord/dashboard` |
| Admin | `GET /api/admin/stats`, `/activity`, `/analytics`, `/users`, `/properties`, `/bookings`, `/payments`, `/reports`; `PATCH /api/admin/users/:id/suspend`·`unsuspend`, `/properties/:id/approve`·`reject`·`suspend`, `/reports/:id` |

Every admin state change is recorded in the `adminactions` collection
(who, what, target, before, after, note).

## Roadmap

Following the project's phase plan:

| Phase | Status |
| --- | --- |
| 1. Foundation — Express, MongoDB, config, health, errors | Done |
| 2. Database models — User, Property, Booking, Payment | Done |
| 3. Authentication — register, login, `/me`, JWT, bcrypt | Done |
| 4. Authorization — role middleware | Done |
| 5. Property CRUD | Done |
| 6. Search, filters, pagination, nearby | Done |
| 7. Booking workflow | Done |
| 8. Payment and confirmation (Razorpay) | Done |
| 9. Profile, favourites, password reset | Done |
| 10. Landlord APIs | Done |
| 11. Admin APIs, reports, analytics, audit trail | Done |
| 12. Security, validation and error hardening | Done |
| 13. Frontend integration | Done |
| 14. Final testing and API docs | Done (118 tests) |

Recommendations run in `services/recommendationService.js` (TF-IDF feature
vectors + cosine similarity). It sits behind its own endpoints so it can be
swapped for a separate Python service later without changing the frontend.

### Note for frontend integration (phase 13)

The API uses `tenant` for the renter role, matching the project brief. The
current frontend uses `user` for the same role. One side needs to adopt the
other's name during phase 13 — decide before wiring the auth calls up.

---

## Frontend integration

The React app talks to this API through one Axios instance
(`src/services/apiClient.js`), which attaches the token, unwraps the
`data` envelope and normalises errors. Pages never call axios directly.

Every screen (tenant, landlord and admin) now runs on these endpoints;
nothing in the app uses mock data.

Two things to know:

- **Role names.** This API calls the renter `tenant`; the frontend calls
  the same role `user` throughout its routes and guards. The translation
  happens in one place — `toApiRole` / `toAppRole` in the frontend's
  `authService.js`. Neither side had to be renamed.
- **Demo accounts.** `npm run seed:demo` creates `user@test.com`,
  `landlord@test.com` and `admin@test.com`, all with the password
  `Password123`. The login screen's hint box lists exactly these. They are
  development fixtures — never seed them in production.

---

## Test accounts

One command sets up every role, the listings and a spread of booking
requests to look at:

```bash
npm run seed
```

It runs `seed:demo`, `seed:properties` and `seed:bookings` in order, and
is safe to re-run — it resets the seeded records rather than duplicating
them.

| Role | Email | Password | What you can check |
| --- | --- | --- | --- |
| Tenant | `user@test.com` | `Password123` | Search and filters, property detail, a pending request, one awaiting payment, one rejected with a reason, notifications |
| Tenant | `tenant2@test.com` | `Password123` | A second tenant, so you can confirm one tenant cannot see another's bookings |
| Landlord | `landlord@test.com` | `Password123` | 5 listings, a request queue with 2 pending to approve/reject, plus approved and rejected history |
| Landlord | `landlord2@test.com` | `Password123` | 5 further listings — use it to confirm a landlord cannot touch another's property |
| Admin | `admin@test.com` | `Password123` | Sees all 10 listings through the API including the unverified one; blocked from landlord-only routes |

After seeding you get:

- 10 listings across Gorakhpur, Lucknow, Varanasi, Indore, Jaipur and
  Prayagraj. Nine are verified and public; one is deliberately left
  `pending` so moderation has something to act on, and one is `occupied`.
- 4 booking requests: 2 pending, 1 at `payment_pending`, 1 rejected.
- Notifications for both the tenant and the landlord.

### Worth knowing while testing

- A listing a landlord creates starts as `pending` verification, so it
  will **not** appear in public search until an admin approves it under
  **Admin -> Properties**.
- Payments need Razorpay test keys (see [Payments with Razorpay](#payments-with-razorpay)).
  Without them the Pay button explains that payments are not configured
  instead of faking a successful transaction.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with file watching |
| `npm start` | Start once |
| `npm test` | Run the test suite (each file uses its own test database) |
| `npm run seed:admin` | Create/update the admin account from `.env` |
| `npm run seed` | Everything below, in order — the usual way to set up |
| `npm run seed:demo` | Create/update the three demo accounts |
| `npm run seed:properties` | Create/update the demo listings and their two landlords |
| `npm run seed:bookings` | Create booking requests in every state, plus a second tenant |
| `npm run db:sync-indexes` | Drop obsolete indexes and build missing ones after a schema change |
