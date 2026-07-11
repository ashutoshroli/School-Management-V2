# School ERP - Complete Management System

A full-featured, multi-branch School ERP system built for schools with 15,000+ student strength. Covers academics, fees, accounting, HR/payroll, attendance (RFID card-tap), library, transport, hostel, communication, and more.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router, TypeScript, Tailwind CSS) |
| Backend | Express.js (TypeScript) |
| Database | PostgreSQL (Neon for dev, Hostinger VPS for production) |
| ORM | Prisma |
| Auth | JWT + Google OAuth 2.0 + Passport.js |
| State | Zustand |
| Validation | Zod |
| Payments | Razorpay / PayU |
| Documents | DOCX templates -> PDF (docxtemplater + LibreOffice) |

## Project Structure

```
School_Management-/
├── db/                    # Database layer
│   ├── prisma/
│   │   ├── schema.prisma  # Full schema (60+ models)
│   │   └── seed.ts        # Seed data script
│   └── package.json
├── backend/               # Express.js API server
│   ├── src/
│   │   ├── config/        # DB, passport, env config
│   │   ├── middleware/    # auth, validate, errorHandler
│   │   ├── controllers/   # Route handlers
│   │   ├── routes/        # API routes
│   │   ├── services/      # Business logic
│   │   ├── validators/    # Zod schemas
│   │   ├── utils/         # JWT, response helpers
│   │   ├── types/         # TypeScript interfaces
│   │   ├── app.ts         # Express app config
│   │   └── server.ts      # Server entry point
│   └── package.json
├── frontend/              # Next.js frontend
│   ├── src/
│   │   ├── app/           # App Router pages
│   │   ├── components/    # UI components
│   │   ├── hooks/         # Custom hooks (auth store)
│   │   ├── lib/           # API client, utils, navigation
│   │   ├── types/         # TypeScript types
│   │   └── styles/        # Global CSS
│   └── package.json
├── .env.example           # Environment variables template
├── .gitignore
└── package.json           # Root monorepo scripts
```

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL (or Neon account for free cloud DB)
- Google Cloud Console project (for OAuth)

### 1. Clone & Install

```bash
git clone https://github.com/ashutoshroli/School_Management-.git
cd School_Management-

# Install root dependencies
npm install

# Install each folder's dependencies
cd db && npm install && cd ..
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Environment Setup

```bash
# Copy example env file
cp .env.example .env

# Edit .env with your values:
# - DATABASE_URL (Neon connection string)
# - GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET
# - JWT_SECRET (generate a strong random string)
#
# Optional (communication integrations - the app runs fine without
# these, sends will just fail with a clear "not configured" error):
# - SMS_API_KEY / SMS_TEMPLATE_ID (MSG91 - https://msg91.com)
# - WHATSAPP_API_KEY (Interakt - https://www.interakt.shop)
# - FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY (Firebase
#   service account JSON, for push notifications)
```

### 3. Database Setup

```bash
# Generate Prisma client
cd db
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# Seed database with sample data
npm run seed
```

### 4. Run Development Servers

```bash
# From root directory - runs both backend & frontend
npm run dev

# Or separately:
npm run dev:backend   # Express API on http://localhost:5000
npm run dev:frontend  # Next.js on http://localhost:3000
```

### 5. Login

After seeding:
- **Super Admin:** `superadmin@abcschool.edu.in` / `Admin@123`
- **Branch Admin:** `branchadmin@abcschool.edu.in` / `Admin@123`

## Modules (Phase-wise)

| Phase | Modules | Status |
|-------|---------|--------|
| 0 | Foundation (Schema, Auth, Layout) | Done |
| 1 | Students, Staff, Classes, Sections | Done |
| 2 | Fees + Full Accounting (Ledger) | Done |
| 3 | HR: Attendance, Leave, Payroll (PF/ESI/TDS) | Done |
| 4 | Student Attendance (Card-tap + Manual), Exams, Timetable | Done |
| 5 | Library, Inventory, Transport, Hostel | Done |
| 6 | Communication (Notices, Messages), Certificates | Done |
| 6b | SMS/WhatsApp/Email delivery integrations | Done |
| 7 | Reports, Analytics, Multi-branch Dashboard | Done |
| 8 | Production Deployment (Hostinger VPS) | Pending |

| 9 | Online payments (Razorpay checkout + webhook), PDF receipts/ID cards/report cards | Done |
| 10 | File uploads (student/staff documents, avatars) | Done |
| 11 | Parent/Student self-service portal (fees, attendance, homework, exams) | Done |
| 12 | Notifications (real email, SMS/WhatsApp, push, in-app) | Done |
| 13 | Automated tests (Jest) + CI (GitHub Actions) | Done |
| 14 | Public online admission form + inquiry pipeline, Audit log viewer | Done |
| 15 | Fee reminder automation (defaulter Email/SMS blast) | Done |
| 16 | Real certificate generation (TC/Bonafide/Character PDFs), staff & batch ID cards, public certificate verification | Done |

> Note: "Done" means the backend API and a corresponding frontend page
> exist and are functional for local/dev use. It does not imply the
> module has been through a full production-readiness review beyond
> what's covered by the automated tests described below - see "Known
> limitations" for gaps that are intentionally out of scope for now.

### Known limitations / stubs (by design)

- **SMS/WhatsApp/Push notifications** are real integrations (MSG91,
  Interakt, and Firebase Cloud Messaging respectively - see
  `backend/src/services/notification/{sms,whatsapp,push}Provider.ts`)
  but require your own gateway credentials in `.env` to actually send
  anything; with no credentials set, sends fail fast with a clear
  "not configured" error and the corresponding `Notification` row is
  marked `FAILED` (the triggering action, e.g. a fee payment, still
  succeeds either way). Email (SMTP) is real and unaffected. Swapping
  to a different SMS/WhatsApp gateway only requires editing those
  provider files - `notification.service.ts` only depends on each
  provider's function signature.
- **Fee reminders** (`POST /api/fees/reminders/send`, exposed via a
  "Send Reminders" button on Dashboard > Fees > Reports > Defaulters)
  are triggered manually or by an external scheduler hitting that same
  endpoint on a cron - no in-process scheduler (e.g. node-cron) is
  bundled, since that requires the server process to never scale to
  zero/restart, which doesn't hold on typical PaaS free tiers.
- **Notification "read" state** isn't tracked server-side (the schema's
  `Notification.status` field tracks delivery, not read/unread) - the
  frontend bell approximates "unread" via a client-side last-seen
  timestamp.
- **Certificate generation** (Transfer Certificate, Bonafide, Character
  via `certificate.controller.ts` +
  `services/certificateGenerator.service.ts`) now renders and persists
  real PDFs (PDFKit, same approach as the fee-receipt/ID-card/
  report-card generators - no DOCX template/LibreOffice dependency).
  The `ID_CARD` and `CUSTOM` `CertificateType`s are **not** handled by
  this generator: `ID_CARD` has its own dedicated endpoints
  (`GET /students/:id/id-card`, `GET /staff/:id/id-card`,
  `GET /students/id-cards/batch`), and `CUSTOM` has no generic renderer
  yet - generating either via `POST /communication/certificates/generate`
  returns a 400 with a clear message rather than a fake PDF.
- File uploads are stored on local disk by default (see
  `backend/src/services/storage.service.ts`'s `StorageProvider`
  interface) - swap in an S3/GCS-backed implementation for production
  multi-instance deployments.

## Public Pages

- `/admission` - public "Apply for Admission" inquiry form (no login
  required). Submissions land in Dashboard > Admissions for staff
  follow-up; converting an inquiry into an actual enrolled student is
  still done via the regular (staff-only) admission flow under
  Dashboard > Students.

## Roles

- Super Admin (all branches)
- Branch Admin
- Teacher
- Accountant
- Librarian
- Transport Manager
- Warden
- Staff (other)
- Student (Google OAuth login)
- Parent - Father/Mother (Google OAuth login, separate accounts)

## Key Features

- Multi-branch architecture (single codebase, data isolated per branch)
- RFID/NFC card-tap attendance with generic hardware adapter
- Full double-entry accounting (Tally-type: vouchers, ledger, trial balance, P&L, balance sheet)
- Statutory payroll compliance (PF 12%, ESI 0.75%/3.25%, TDS with old/new regime)
- DOCX template -> PDF generation (receipts, payslips, TC, ID cards, report cards)
- Online payment gateway (Razorpay/PayU) for fee collection
- Role-based access control with dynamic permissions
- Multi-channel notifications: Email (SMTP, rich HTML templates), SMS
  (MSG91), WhatsApp (Interakt), and Push (Firebase Cloud Messaging) -
  all driven through one `notify()`/`notifyParentsOfStudent()` service
  so every module (fee payments, admissions, reminders) gets delivery
  tracking and graceful per-channel failure handling for free
- Automated fee-defaulter reminders (Email + SMS) triggerable on-demand
  from Dashboard > Fees > Reports, or via an external cron hitting the
  same API endpoint
- Real PDF certificate generation (Transfer/Bonafide/Character) with a
  public, no-login verification page/endpoint by serial number, plus
  staff ID cards and one-click batch ID-card printing for an entire
  class/section

## API Endpoints

Base URL: `http://localhost:5000/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Health check |
| POST | /auth/login | Login (email + password) |
| GET | /auth/google | Google OAuth redirect |
| GET | /auth/google/callback | Google OAuth callback |
| GET | /auth/profile | Get current user (protected) |
| PUT | /auth/change-password | Change password (protected) |

Additional route groups are mounted for the modules below - see
`backend/src/routes/index.ts` for the full mount list and each
`*.routes.ts` file for the exact endpoints:

| Prefix | Covers |
|--------|--------|
| /branches | Branch (campus) management |
| /academic-years | Academic year/session management |
| /classes | Classes, sections, subjects |
| /students | Student admissions & profiles |
| /staff | Staff (HR) records |
| /fees | Fee categories, structures, collection, refunds, discounts |
| /accounting | Chart of accounts, vouchers, ledger, trial balance, P&L, balance sheet |
| /hr | Staff attendance, leave, payroll |
| /academics | Student attendance, timetable, exams, homework, promotion |
| /facilities | Library, inventory, transport, hostel |
| /communication | Notices, messages, certificates, notifications, push device registration |
| /reports | Dashboards, multi-branch summary, analytics, audit log |
| /parent | Parent/student self-service (linked children, dashboard summary) |
| /admission | Public admission inquiry form (no auth) + staff review |

Notable additions under `/fees` and `/communication` for the
communication integrations (Phase 1):

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /fees/reminders/send | Send Email+SMS fee reminders to every parent of every defaulting student in the branch |
| POST | /communication/notifications/devices/register | Register (or re-link) an FCM push token for the current user |
| DELETE | /communication/notifications/devices/:token | Unregister a push token (e.g. on logout) |

Notable additions for real certificate/ID-card generation (Phase 2):

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /communication/certificates/generate | Generate a real PDF (TC/Bonafide/Character), persisted + a `GeneratedCertificate` row created |
| GET | /communication/certificates/verify/:serialNo | **Public, no auth** - verify a certificate's authenticity by serial number |
| GET | /staff/:id/id-card | Streams a printable staff ID card PDF (own card, or any card if branch-admin staff) |
| GET | /students/id-cards/batch?classId=&sectionId= | Streams a multi-page PDF with one ID card per active student in a class/section |

The frontend's `/verify-certificate/[serialNo]` page (also public, no
login) is the human-facing counterpart to the verify endpoint above -
it's the URL printed on every generated certificate's footer.

## Testing & CI

```bash
cd backend
npm test              # run the Jest suite once
npm run test:coverage # with coverage report
```

Tests cover the security-critical branch/student access-control helpers
(`utils/branchScope.ts`, `utils/studentAccess.ts`), the fee-payment
validators, the core atomic payment-recording logic in
`services/feePayment.service.ts`, the communication providers
(`services/notification/{sms,whatsapp,push}Provider.ts` and the shared
`utils/httpClient.ts`), the fee-reminder defaulter logic
(`services/feeReminder.service.ts`), the HTML email templates
(`services/notification/emailTemplates.ts`), the certificate PDF
generators (`services/certificateGenerator.service.ts` - these render
real PDFs via pdfkit rather than mocking it, verifying well-formed
output), the certificate/ID-card controllers' branch-access rules
(`controllers/{certificate,document}.controller.ts`), and a handful of
HTTP-level smoke tests against the real Express app.

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to
`main`:
- **backend job**: generates the Prisma client, typechecks, runs the
  Jest suite, and builds.
- **frontend job**: typechecks and runs `next build`.

No live database is required for CI - the tests either mock Prisma
directly or exercise routes that fail before any DB query happens
(e.g. authentication checks).

## License

Private - All rights reserved.
