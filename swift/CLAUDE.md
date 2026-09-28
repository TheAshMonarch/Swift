# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Swift (also branded "Artiz" in payment strings) is the NestJS 11 + Mongoose 9 backend for a Nigerian service marketplace. Seekers find, book and pay verified professionals, with the money held in escrow. The git root is the parent directory (`swifty/`). This `swift/` directory is the whole app.

`API_REFERENCE.md` is the contract the frontend is built against. It documents request and response shapes, the booking state machine, the WebSocket events and known gaps. **When you change a controller, DTO, schema or response shape, update that file in the same change.** Section 6 of the reference lists the missing endpoints that are planned. `roadmap.txt` holds the original 4-week plan, which includes a matching module, Winston logging and a `@nestjs/terminus` health check.

## Commands

```bash
npm run start:dev                 # watch mode; needs .env with MONGODB_URI + JWT_SECRET at minimum
npm run build                     # nest build → dist/ (tsconfig.build.json excludes test/, scripts/, *.spec.ts)
npm run lint                      # eslint --fix over src/ and test/
npm run format                    # prettier
npm test                          # unit tests: src/**/*.spec.ts
npx jest src/modules/kyc/kyc.service.spec.ts      # single unit test file
npx jest -t "name of test"                        # single test by name
npm run test:e2e                  # test/*.e2e-spec.ts — boots the full AppModule against the real MONGODB_URI and deletes users
npx ts-node scripts/seed.ts       # wipes and reseeds users; refuses URIs matching prod|atlas|cluster unless ALLOW_PROD_SEED=true
docker compose up -d              # local MongoDB only (swift/docker-compose.yml)
```

The app listens on `PORT` (default 8080, which is also what the Dockerfile exposes). The parent directory's `compose.yaml` maps 3000, and its debug variant runs a nonexistent `index.js`. Neither works as written.

## Environment

The app reads these env vars: `MONGODB_URI`, `JWT_SECRET` (the app refuses to boot without it), `FRONTEND_URL` (the single allowed CORS origin for HTTP and Socket.IO; when it's unset, CORS is closed), `PORT`, `GOOGLE_CLIENT_ID`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_CALLBACK_URL`, `BREVO_API_KEY` + `OTP_SENDER_EMAIL` (OTP email; delivery is skipped with a warning if either is missing), `CLOUDINARY_CLOUD_NAME`/`_API_KEY`/`_API_SECRET` (KYC uploads), and `SEED_BASE_LAT`/`SEED_BASE_LNG` (seed script only).

## Architecture

**Bootstrap (`src/main.ts`).** It sets up helmet, a global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`, so any body field without a DTO decorator gets a 400), a global `HttpExceptionFilter`, and `rawBody: true` for Paystack webhook signature checks. The filter always responds with `{ statusCode, timestamp, path, message: string[] }` and hides non-HTTP errors behind a generic 500. Any change to global setup must also be mirrored in `test/auth.e2e-spec.ts`, which recreates these settings by hand.

**Rate limiting.** `ThrottlerGuard` is registered globally through `APP_GUARD` (60/min per IP). Individual routes override it with `@Throttle` (the auth routes) or `@SkipThrottle` (the Paystack webhook).

**Auth.** JWT payload `{ sub, email, role }`, 7-day expiry, no refresh token. `JwtStrategy.validate` maps the payload to `req.user = { userId, email, role }`, so controllers read `@GetUser('userId')` (not `sub` and not `_id`). Role checks go `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin')`. `RolesGuard` needs `JwtAuthGuard` to run first. Registration creates an unverified user and emails a 6-digit OTP, stored in `otp.schema.ts` with a TTL index. Login is refused until the user is verified. Google login (`google-auth-library`) auto-creates verified users with a placeholder phone and no `proProfile`.

**Users.** A single `User` collection holds all roles (`seeker | professional | admin`). Professionals have an embedded `proProfile` (rating, earnings, badge) and optional `bankDetails` (which caches a Paystack `recipientCode`). `location` is a GeoJSON Point `[lng, lat]` with a `2dsphere` index, and provider search runs as a `$geoNear` aggregation. `UsersModule` exports both `UsersService` and `MongooseModule`, which gives other modules the `User` model.

**Bookings ↔ Payments (escrow).** These two modules import each other through `forwardRef`. `PaymentsService` is a thin axios wrapper over the Paystack REST API. `BookingsService` owns the state machine: `pending → accepted → funded → in_progress → completed → released`, with `disputed`/`refunded` as side branches. Money is stored as integer **kobo** with a 10% commission split at creation, but clients send naira. Conventions to keep:
- Every state transition is an atomic `findOneAndUpdate` filtered on the expected current status. There are no read-then-save transitions and no Mongo transactions.
- `releaseFunds` claims the `released` status *before* calling Paystack and rolls it back to `completed` if the transfer fails. Payout references are deterministic (`payout_<bookingId>`), which makes retries idempotent.
- The move to `funded` happens only in the webhook (`POST /payments/webhook` → `confirmFunding`). That path verifies the HMAC signature, re-verifies the transaction with Paystack, and checks that the amount paid equals `agreedAmount`.
- Every payout (a seeker's release, or an admin's `resolve` with `release`) goes through `payOutProfessional(booking, rollback)`. The caller claims `released` first, and the helper applies the rollback update on any failure before the transfer succeeds.
- If a payment arrives for a `cancelled` booking, `confirmFunding` refunds it automatically. Cancel and decline are only allowed from `pending` or `accepted`.

**Chat.** A Socket.IO gateway on namespace `/chat` authenticates from `handshake.auth.token` (raw JWT, no `Bearer`) and silently disconnects clients whose token fails. It keeps an in-memory `userId → Set<socketId>` map, which means it only works on a single instance. Messages are persisted through `ChatService` and are also served over REST (`/chat/...`). `ChatModule` registers its own `JwtModule`.

**Files (Cloudinary).** `CloudinaryService` in `src/common/cloudinary` handles every upload, and Multer keeps uploads in memory. Avatars are public: one per user, `public_id` = userId, overwritten on each upload. Work photos are public too (`swift/work/<userId>`), stored as `workPhotos: {_id, url, publicId}[]` on professionals, max 8. `addWorkPhotos` checks the limit up front and again atomically (a `$push` guarded by `$size`), and deletes the uploaded files if they aren't saved. `publicId` is excluded from every public projection. KYC documents are uploaded as `type: 'authenticated'` and stored as `{ publicId, resourceType, format }` refs, never URLs. `KycService.toResponse()` turns those refs into signed download links that expire after 15 minutes, so every KYC response must go through it. Older submissions may still have public `idImageUrl`/`selfieUrl` values stored, and those pass through unchanged. Admin approval sets the user's `isBadgeVerified` and `isVerified`.

**OTP codes.** One `Otp` collection serves both purposes. `purpose: 'verify'` holds email-verification codes in plain text with a 5-minute expiry. `purpose: 'reset'` holds password-reset codes as a SHA-256 hash, with a 15-minute expiry and an attempt count that's incremented atomically before comparing; the code is destroyed after 5 wrong guesses. `/auth/verify-otp` must never accept a `reset` code. All email goes through `AuthService.sendEmail`, which calls Brevo's HTTP API and needs `BREVO_API_KEY` plus `OTP_SENDER_EMAIL`.

## Gotchas

- `AppController`/`AppService` are not registered in `AppModule`, so they're dead code. The health check is `GET /health` (`modules/health`).
- The tsconfig declares the path aliases `@common/*`, `@modules/*` and `@core/*`, but nothing uses them and `src/core` doesn't exist. Use relative imports.
- Declare reference fields as `@Prop({ type: MongooseSchema.Types.ObjectId, ref: ... })` (with `Schema as MongooseSchema` imported from `mongoose`), never `type: Types.ObjectId`. The `Types.ObjectId` class makes the path `Mixed`, which silently disables casting, so string ids in queries match nothing. `src/common/schema-types.spec.ts` guards this.
- Every Paystack call goes through `PaymentsService.paystack()`, which turns failures into a 502 carrying Paystack's reason. Transfers held for an OTP are treated as failures.
- Put `IsObjectIdPipe` (from `@nestjs/mongoose`) on every `:id` route param. As a fallback, the exception filter maps any Mongoose `CastError` to a 400.
- `scripts/seed.ts` redefines the Mongoose schemas instead of importing them. If you change `users.schema.ts`, keep the seed script in sync.
