# Swift / Artiz Backend — API Reference for Frontend

Derived directly from the source of `TheAshMonarch/Swift` (branch `backend-fixes`, NestJS 11 + Mongoose 9). If the backend changes, re-check the controllers in `swift/src/modules/*/*.controller.ts`.

---

## 1. Basics

| Item | Value |
|---|---|
| Base URL | `http://<host>:<PORT>` — default port **8080** (note: root `compose.yaml` maps `3000:3000`, which is wrong) |
| Global prefix | none (routes start at `/auth`, `/users`, …) |
| Auth | `Authorization: Bearer <accessToken>` (JWT, expires in **7 days**, no refresh endpoint) |
| JWT payload | `{ sub: userId, email, role }` |
| Content type | `application/json` (except KYC and avatar uploads: `multipart/form-data`) |
| CORS | only the origin in `FRONTEND_URL` is allowed; credentials enabled |
| Validation | unknown body fields are **rejected** (`forbidNonWhitelisted`) → 400. Send only documented fields. |
| IDs | MongoDB ObjectId strings. Every document has `_id`, `__v`, `createdAt`, `updatedAt` (ISO strings). |
| Coordinates | Always `[longitude, latitude]` (GeoJSON order — **not** lat/lng) |
| Money | Bookings store **kobo** (₦1 = 100 kobo). You *send* naira (`agreedAmountNaira`) but *receive* kobo (`agreedAmount`, `commissionAmount`, `professionalPayout`). `proProfile.totalEarnings` is in **naira**. |

### Error format (all HTTP errors)

```json
{
  "statusCode": 400,
  "timestamp": "2026-09-26T10:00:00.000Z",
  "path": "/auth/login",
  "message": ["email must be an email"]
}
```

`message` is **always an array of strings**. Unknown server errors return 500 with `["Internal server error"]`. An invalid ObjectId in a URL param (`:id`) returns **400** (`"Invalid ObjectId: '…' is not a valid MongoDB ObjectId"`). Exception: `GET /chat/:userId` returns `[]`.

### Rate limits (per IP) → `429 Too Many Requests`

| Route | Limit |
|---|---|
| Default (all routes) | 60 / min |
| `POST /auth/login` | 10 / min |
| `POST /auth/verify-otp` | 5 / min |
| `POST /auth/resend-otp` | 3 / min |
| `POST /auth/forgot-password` | 3 / min |
| `POST /auth/reset-password` | 5 / min |

---

## 2. Data Structures

TypeScript shapes as the frontend receives them (JSON). `?` = may be absent.

```ts
type Role = 'seeker' | 'professional' | 'admin';

interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

interface ProfessionalProfile {
  category: string;
  skills: string[];
  hourlyRate: number;       // naira, no min enforced on update
  averageRating: number;    // 0–5, 2 decimals
  isBadgeVerified: boolean; // true after admin approves KYC
  reviewCount: number;
  completedJobs: number;
  totalEarnings: number;    // naira
}

interface BankDetails {
  accountNumber: string;
  bankCode: string;         // Paystack bank code
  bankName: string;
  recipientCode?: string;   // internal Paystack cache — ignore
}

interface WorkPhoto {
  _id: string;              // use for DELETE /users/me/work-photos/:photoId
  url: string;              // public image URL (Cloudinary, max 1600px)
  publicId?: string;        // only on your own user; omitted for others
}

interface User {
  _id: string;
  name: string;
  email: string;
  phone: string;            // Google users get a placeholder like "google-1727340000000"
  role: Role;
  isVerified: boolean;      // email verified via OTP (or Google)
  isActive: boolean;
  location: GeoPoint;
  proProfile?: ProfessionalProfile; // only professionals (Google-created pros have none!)
  bankDetails?: BankDetails;
  avatar?: string;          // public image URL (upload via POST /users/me/avatar; Google users get their Google photo)
  workPhotos?: WorkPhoto[]; // professionals' public portfolio, max 8; the first is the marketplace cover
  googleId?: string;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

// Any user other than the caller (profiles, search, populated bookings, chat partners)
// never includes phone or bankDetails. Only GET /users/me and PUT /users/me return a full User.
type PublicUser = Omit<User, 'phone' | 'bankDetails'>;

// search results add `distance` (METERS) when coordinates were sent
type ProviderSearchResult = PublicUser & { distance?: number };

type BookingStatus =
  | 'pending' | 'accepted' | 'funded' | 'in_progress' | 'completed'
  | 'released' | 'disputed' | 'refunded' | 'cancelled';

interface Booking {
  _id: string;
  seekerId: string | PublicUser;        // populated in GET /bookings/my-bookings (professional view)
  professionalId: string | PublicUser;  // populated in GET /bookings/my-bookings (seeker view)
  serviceDescription: string;
  agreedAmount: number;           // KOBO
  commissionAmount: number;       // KOBO (10%)
  professionalPayout: number;     // KOBO (90%)
  status: BookingStatus;
  paystackReference?: string;
  paystackAuthorizationUrl?: string; // checkout URL; same value returned by every /fund call
  paystackTransferCode?: string;
  disputeReason?: string;
  fundedAt?: string;
  completedAt?: string;
  releasedAt?: string;
  rating?: number;                // 1–5, set once via POST /bookings/:id/rating
  ratedAt?: string;
  cancelledBy?: 'seeker' | 'professional';
  cancellationReason?: string;
  cancelledAt?: string;
  disputeResolution?: 'refund' | 'release'; // set by an admin via PUT /bookings/:id/resolve
  resolvedBy?: string;            // admin user id
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

interface Message {
  _id: string;
  senderId: string | { _id: string; name: string; avatar?: string }; // populated in GET /chat/:userId only
  receiverId: string;
  bookingId?: string;
  content: string;          // 1–2000 chars, trimmed
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

interface Conversation {       // GET /chat/conversations
  _id: string;                 // the PARTNER's user id
  lastMessage: Message;        // senderId/receiverId are plain ids here
  partner: PublicUser;
}

type KycStatus = 'none' | 'pending' | 'verified' | 'rejected'; // 'none' is never actually stored
type IdType = 'nin' | 'voters_card' | 'passport' | 'drivers_license';

interface KycSubmission {
  _id: string;
  userId: string | Omit<User, 'bankDetails'>; // populated in admin lists
  status: KycStatus;
  idType: IdType;
  idImageUrl: string;       // SIGNED, EXPIRES ~15 min after the response — never store it
  selfieUrl: string;        // SIGNED, same
  portfolioUrls: string[];  // SIGNED, same
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}
```

---

## 3. REST Endpoints

Legend: 🔓 public · 🔒 requires Bearer token · 👑 admin only

### 3.1 Auth — `/auth`

#### 🔓 `POST /auth/register` → `201`
```ts
// body
{
  name: string;                 // non-empty
  email: string;                // valid email (case-sensitive in DB — lowercase it client-side)
  password: string;             // min 6
  phone: string;                // non-empty, unique
  role: 'seeker' | 'professional';
  location: { coordinates: [number, number] }; // [lng, lat]
  proProfile?: { category: string; skills: string[]; hourlyRate: number };
}
// response: User (no passwordHash). NO token — user must verify OTP, then log in.
```
Side effect: sends a 6-digit OTP email (5-minute expiry). If email sending fails you get **400** but the user **was still created** → send them to the OTP screen and offer "resend".
Errors: `409` email/phone taken, `400` validation / email delivery failure.

#### 🔓 `POST /auth/verify-otp` → `200`
```ts
{ phoneOrEmail: string; code: string }   // note field name: phoneOrEmail
// response: { message: "Account verified successfully." }
```
Errors: `400` invalid/expired code or no account.

#### 🔓 `POST /auth/resend-otp` → `200`
```ts
{ email: string }
// response: { message: "Verification OTP code dispatched successfully." }
```

#### 🔓 `POST /auth/login` → `200`
```ts
{ email: string; password: string }  // password min 6
// response
{ message: "Login successful"; accessToken: string; user: User }
```
Errors: `401` "Invalid email or password", `401` "Please verify your email address before logging in." (route to OTP screen on this message).

#### 🔓 `POST /auth/google` → `200`
```ts
{
  token: string;                         // Google ID token (not access token)
  location?: { coordinates: [number, number] }; // defaults to Uyo if omitted
  role?: 'seeker' | 'professional';      // only used when creating a NEW account
}
// response
{ message: "google login successful"; accessToken: string; user: User }
```
Google-created users are auto-verified. They get a placeholder `phone` and their Google profile photo as `avatar`, and professionals have **no `proProfile`**, so prompt them to complete their profile via `PUT /users/me`. Google users have no password. They can set one through the forgot/reset password flow.

#### 🔓 `POST /auth/forgot-password` → `200`
```ts
{ email: string }
// response (ALWAYS the same, whether or not the account exists)
{ message: "If an account exists for this email, a password reset code has been sent." }
```
Emails a 6-digit code valid for **15 minutes**. Requesting again replaces the previous code. `400` only if email delivery fails.

#### 🔓 `POST /auth/reset-password` → `200`
```ts
{ email: string; code: string /* exactly 6 digits */; newPassword: string /* min 6 */ }
// response
{ message: "Password has been reset. You can now log in." }
```
Errors: `400` "Invalid or expired reset code." (wrong, expired, already used, or more than 5 wrong attempts). After 5 wrong attempts the code is destroyed and the user must request a new one. A successful reset also marks the account verified. It does **not** log the user in, so call `/auth/login` afterwards. Existing tokens stay valid until they expire.

### 3.1a Health — `/health`

#### 🔓 `GET /health` → `200 { status: "ok", db: "up", uptime: number }`
`uptime` is in seconds. Returns `503` when the database is disconnected. Not rate-limited.

### 3.2 Users — `/users` (all 🔒)

#### `GET /users/me` → `User`

#### `PUT /users/me` → `User` (updated)
All fields optional; nested objects are merged field-by-field.
```ts
{
  name?: string;
  phone?: string;
  location?: { coordinates: [number, number] };
  proProfile?: { category?: string; skills?: string[]; hourlyRate?: number };
  bankDetails?: { accountNumber: string; bankCode: string; bankName: string }; // all 3 required if sent
}
```
Get valid `bankCode`/`bankName` values from `GET /payments/banks`.

#### `POST /users/me/avatar` → `User` (updated)
`multipart/form-data` with one file field **`avatar`**: JPEG / PNG / WebP, ≤ 5 MB. The server crops it to 512×512 (face-centred). The new `avatar` URL changes on every upload, so caches refresh. Errors: `400` wrong type / missing file / too large.

#### 🧰 `POST /users/me/work-photos` → `User` (updated) · professionals only
`multipart/form-data` with 1–8 files in the field **`photos`**: JPEG / PNG / WebP, ≤ 5 MB each. They're appended in order, and a professional can have at most **8** in total. Errors: `400` wrong type, no file, "Too many files", or "You can have up to 8 work photos. You have N." · `403` not a professional · `413` a file is too large.

#### 🧰 `DELETE /users/me/work-photos/:photoId` → `User` (updated) · professionals only
`404` if the photo isn't yours. The image is also deleted from storage.

#### `POST /users/search/providers` → `ProviderSearchResult[]`
Only returns professionals with `isVerified && isActive`, sorted by `averageRating` desc.
```ts
{
  coordinates?: [number, number]; // enables distance filter + `distance` (meters) in results
  radiusKm?: number;              // 1–200, default 50 (only with coordinates)
  category?: string;              // exact match
  skills?: string[];              // matches ANY
  minRating?: number;             // 0–5
  minRate?: number;               // hourlyRate lower bound
  maxRate?: number;
  limit?: number;                 // 1–100, default 20
}
```
No pagination.

#### `GET /users/:id` → `PublicUser` (404 if missing)

~~`POST /users/:id/rating`~~ **removed**. Ratings are now given on the booking: see `POST /bookings/:id/rating`.

#### `GET /users/:id/stats` → 
```ts
{ averageRating: number; completedJobs: number; totalEarnings: number; isBadgeVerified: boolean }
```
404 if the user has no `proProfile`.

### 3.3 Bookings — `/bookings` (all 🔒)

#### `POST /bookings` → `201 Booking` (status `pending`)
```ts
{
  professionalId: string;     // Mongo id of a user with role professional
  serviceDescription: string; // non-empty
  agreedAmountNaira: number;  // min 100 (NAIRA — response amounts are KOBO)
}
```

#### `GET /bookings/my-bookings` → `Booking[]` (newest first)
- Professional token → bookings where they're the pro, `seekerId` populated with `PublicUser`.
- Anyone else → bookings where they're the seeker, `professionalId` populated with `PublicUser`.

#### `GET /bookings/:id` → `Booking`
Both `seekerId` and `professionalId` are populated with `PublicUser`. Only the booking's seeker, its professional or an admin can read it; anyone else gets `403`. Admins also see `phone`.

#### 👑 `GET /bookings/disputed` → `Booking[]`
All `disputed` bookings, oldest first, with both parties populated (including `phone`, never `bankDetails`).

#### State transitions

| Endpoint | Method | Actor | Required status → new status | Response |
|---|---|---|---|---|
| `/bookings/:id/accept` | PUT | professional on booking | `pending` → `accepted` | `Booking` |
| `/bookings/:id/fund` | **POST** | seeker on booking | must be `accepted` (status unchanged) | `201 { paymentUrl: string; reference: string }` |
| *(Paystack webhook)* | — | Paystack | `accepted` → `funded` | — |
| `/bookings/:id/start` | PUT | professional | `funded` → `in_progress` | `Booking` |
| `/bookings/:id/complete` | PUT | professional | `funded` \| `in_progress` → `completed` | `Booking` |
| `/bookings/:id/release` | PUT | seeker | `completed` → `released` (triggers payout) | `Booking` |
| `/bookings/:id/dispute` | PUT | seeker | `funded` \| `in_progress` \| `completed` → `disputed` | `Booking` |
| `/bookings/:id/cancel` | PUT | seeker | `pending` \| `accepted` → `cancelled` | `Booking` |
| `/bookings/:id/decline` | PUT | professional | `pending` \| `accepted` → `cancelled` | `Booking` |
| `/bookings/:id/resolve` | PUT | 👑 admin | `disputed` → `refunded` \| `released` | `Booking` |
| `/bookings/:id/rating` | **POST** | seeker | must be `completed` \| `released`, not yet rated (status unchanged) | `201 Booking` (with `rating`) |

`dispute` body: `{ reason: string }` (not validated server-side — validate client-side).

`cancel` / `decline` body (optional): `{ reason?: string }` (max 500 chars). Once a booking is funded it can't be cancelled; the seeker has to raise a dispute instead. If the seeker pays an old checkout link after cancelling, the payment is **refunded automatically** and the booking ends up `refunded`.

`resolve` body: `{ outcome: 'refund' | 'release' }`. `refund` returns the full `agreedAmount` to the seeker. `release` pays `professionalPayout` to the professional, who needs `bankDetails` on file. If Paystack fails, the booking stays `disputed` so the admin can retry.

`rating` body: `{ rating: number }` (1–5). One rating per booking. It updates the professional's `averageRating`/`reviewCount`. A second attempt returns `400` "This booking has already been rated".

`fund` is idempotent: repeat calls return the same `paymentUrl` and `reference`. It returns `409` if another `/fund` call for the same booking is still in progress, so retry after a moment.

Errors: `403` "Not your booking", `400` wrong state (e.g. "Booking is not pending", "Job must be marked complete first", "Professional has no bank details on file"), `404` not found.

```
pending ──accept──► accepted ──(pay via paymentUrl, webhook)──► funded ──start──► in_progress
                                                                   │                  │
                                                                   └──────complete────┴──► completed ──release──► released
                          funded / in_progress / completed ──dispute──► disputed ──resolve (admin)──► refunded | released
pending / accepted ──cancel (seeker) | decline (pro)──► cancelled ──(late payment auto-refunded)──► refunded
```

**Payment flow for the frontend:**
1. `POST /bookings/:id/fund` → open `paymentUrl` (browser / WebView).
2. Paystack redirects to `PAYSTACK_CALLBACK_URL` (backend env var — point it at a frontend route).
3. Funding is confirmed **only** by the webhook, asynchronously. On the callback page, poll `GET /bookings/:id` (every 2–3 s, give up after ~1 min and show "payment processing") until the status is `funded`.
4. Calling `/fund` again (e.g. the user closed the checkout tab) safely returns the same `paymentUrl`.

Not implemented: auto-release after a timeout, and partial refunds or splits.

### 3.4 Payments — `/payments`

#### 🔒 `GET /payments/banks` → `{ name: string; code: string }[]`
Nigerian banks sorted by name, for the payout form. Send the chosen `code` and `name` as `bankDetails.bankCode` and `bankDetails.bankName` in `PUT /users/me`. The server caches this for 24 h.

`POST /payments/webhook` — **Paystack only**, signature-verified. Never call from the frontend.

### 3.5 Chat REST — `/chat` (all 🔒)

#### `GET /chat/unread/count` → `number` (raw number, not an object)

#### `GET /chat/conversations` → `Conversation[]`
One entry per partner with the latest message. Not sorted by recency, no unread count per conversation, no pagination.

#### `GET /chat/:userId?limit=50&before=<ms timestamp>` → `Message[]`
- Returns the page **in chronological order** (oldest → newest).
- `limit` 1–100 (default 50). `before` = epoch **milliseconds**; to load older messages pass `new Date(oldest.createdAt).getTime()`.
- `senderId` is **populated** here (`{ _id, name, avatar }`) — compare `msg.senderId._id` to your id.
- Invalid `userId` returns `[]`.

### 3.6 KYC — `/kyc` (all 🔒)

#### `POST /kyc/submit` → `201 KycSubmission` (professionals only)
`multipart/form-data`:

| Field | Type | Required |
|---|---|---|
| `idImage` | file (1) | yes |
| `selfie` | file (1) | yes |
| `portfolio` | files (≤5) | no |
| `idType` | text: `nin` \| `voters_card` \| `passport` \| `drivers_license` | yes |

Files: JPEG / PNG / WebP / PDF, ≤5 MB each. Errors: `403` not a professional, `400` already pending/verified, bad type, missing file.

**KYC files are private.** `idImageUrl`, `selfieUrl` and `portfolioUrls` in every KYC response are signed links that **expire about 15 minutes** after the response. Don't store or cache them. Re-fetch (`/kyc/status`, `/kyc/pending`, `/kyc/all`) when you need fresh links, e.g. when an admin opens a submission.

#### `GET /kyc/status` → `KycSubmission` or **empty body** (never submitted) — treat empty as `'none'`.

#### 👑 `GET /kyc/pending` → `KycSubmission[]` (oldest first, `userId` populated)
#### 👑 `GET /kyc/all` → `KycSubmission[]` (newest first, `userId` populated)
#### 👑 `PUT /kyc/:id/approve` → `KycSubmission` (also sets user `isBadgeVerified` + `isVerified`)
#### 👑 `PUT /kyc/:id/reject` → `KycSubmission`
```ts
{ reason: string } // non-empty
```

---

## 4. WebSocket (Socket.IO) — Chat

```ts
import { io } from 'socket.io-client';
const socket = io(`${BASE_URL}/chat`, { auth: { token: accessToken } });
```

- Namespace: **`/chat`**. Token goes in `auth.token` (**not** a header, no `Bearer ` prefix).
- Invalid/missing token → server silently disconnects (you get `disconnect`, no error event). Re-auth and reconnect.
- One user can have many sockets (tabs/devices); all receive messages.

### Client → Server

| Event | Payload | Notes |
|---|---|---|
| `send_message` | `{ receiverId: string; content: string; bookingId?: string }` | content 1–2000 chars; can't message yourself |
| `typing` | `{ receiverId: string }` | no "stopped typing" event exists — debounce/timeout client-side |
| `mark_read` | `{ senderId: string }` | marks all messages from `senderId` to you as read; no ack, no event to the sender |

### Server → Client

| Event | Payload | When |
|---|---|---|
| `new_message` | `Message` (senderId is a **plain id string**) | to all receiver sockets |
| `message_sent` | `Message` | ack to the sending socket only (use for optimistic-UI reconciliation) |
| `message_error` | `{ error: 'Invalid message payload' \| 'Invalid bookingId' }` | validation failure |
| `user_typing` | `{ senderId: string }` | partner is typing |

Messages to offline users are saved and appear via REST; there's no push notification.

---

## 5. Frontend Gotchas (quick list)

1. Register returns **no token** → OTP screen → login.
2. Login `401` can mean "unverified" — check the message text.
3. `[lng, lat]` everywhere.
4. Send naira, receive kobo (divide by 100 for display).
5. `senderId` shape differs between REST history (object) and socket events (string).
6. Funding confirmation is async (webhook) — poll.
7. `GET /kyc/status` may return an empty body.
8. Google-registered professionals have no `proProfile`; Google users have a fake phone.
9. Emails are case-sensitive server-side — normalize to lowercase before sending.
10. `phone` and `bankDetails` are only returned for the caller's own user (`/users/me`). Other users (search, bookings, chat partners, profiles) never include them.
11. Ratings are per booking (`POST /bookings/:id/rating`), not per user.
12. KYC file URLs expire after about 15 minutes, so re-fetch rather than cache them. Avatar URLs are public and permanent.
13. Forgot password always returns the same success message. Don't read it as proof that the account exists.
14. There is no admin sign-up. Admin accounts are created by setting `role: "admin"` directly in the database.

## 6. Missing endpoints the frontend will likely need

Admin user management (list/deactivate users), avatar removal, per-conversation unread counts, a refresh-token/logout endpoint, and pagination for bookings, conversations and search. Plan UI around their absence or add them to the backend first.
