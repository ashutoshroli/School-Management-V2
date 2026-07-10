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
| 1 | Students, Staff, Classes, Sections | Pending |
| 2 | Fees + Full Accounting (Ledger) | Pending |
| 3 | HR: Attendance, Leave, Payroll (PF/ESI/TDS) | Pending |
| 4 | Student Attendance (Card-tap + Manual), Exams, Timetable | Pending |
| 5 | Library, Inventory, Transport, Hostel | Pending |
| 6 | Communication (SMS/WhatsApp/Email), Certificates | Pending |
| 7 | Reports, Analytics, Multi-branch Dashboard | Pending |
| 8 | Production Deployment (Hostinger VPS) | Pending |

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

*More endpoints will be added per phase.*

## License

Private - All rights reserved.
