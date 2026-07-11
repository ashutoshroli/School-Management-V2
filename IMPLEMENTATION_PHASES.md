# School ERP - Phase-wise Implementation Plan

## 📋 Overview

This document breaks down the complete School ERP implementation into **manageable phases**, each with clear deliverables, timeline, and success criteria.

**Total Timeline**: 9-12 months  
**Team Size**: 2-3 developers (1 backend, 1 frontend, 1 mobile)  
**Current Completion**: 70% base foundation

---

## 🎯 Phase Strategy

### Phase Prioritization Criteria
1. **Business Impact** - Direct revenue/efficiency gain
2. **User Demand** - What parents/teachers need most
3. **Dependencies** - What blocks other features
4. **Technical Risk** - Complexity & unknowns

### Success Metrics (Overall)
- 📈 Fee collection rate > 95%
- 📱 Parent app adoption > 80%
- ⚡ API response time < 200ms
- ✅ Test coverage > 80%
- 🔒 Zero security incidents
- 💯 99.9% uptime

---


## 🚀 PHASE 1: Communication & Notifications (CRITICAL)

**Duration**: 3-4 weeks  
**Priority**: 🔴 HIGHEST - Direct impact on fee collection  
**Team**: 1 backend developer  
**Dependencies**: None - can start immediately

### 1.1 SMS Integration (Week 1)

#### Deliverables
- [ ] MSG91 Integration
  - Files: `backend/src/services/notification/smsProvider.ts`
  - Features: Send OTP, Fee reminders, Attendance alerts
  - DLT template registration
  - Delivery report webhook
  
- [ ] Twilio Integration (Alternative/Fallback)
  - Same interface as MSG91
  - Config-based provider switching

#### Implementation Steps
```typescript
// backend/src/services/notification/smsProvider.ts
1. Add axios for HTTP calls
2. Implement MSG91 API v5 (Flow API)
3. Add delivery tracking
4. Rate limiting & retry logic
5. Cost tracking per SMS
```

#### Success Criteria
- ✅ Send real SMS to test number
- ✅ Delivery report logged in database
- ✅ Fee reminder automation working
- ✅ Cost < Rs 0.20 per SMS

---

### 1.2 WhatsApp Business Integration (Week 2)

#### Deliverables
- [ ] WhatsApp Business API (Interakt/WATI/Gupshup)
- [ ] Template message system (pre-approved)
- [ ] Rich media support (PDF attachments)
- [ ] Interactive buttons for fee payment

#### Templates Needed
1. **Fee Reminder**: "Dear {parent}, {student}'s {fee_type} of Rs {amount} is due. Pay now: {link}"
2. **Payment Confirmation**: "Payment of Rs {amount} received. Receipt: {pdf_link}"
3. **Attendance Alert**: "{student} arrived at {time}. Have a great day!"
4. **Exam Result**: "{student}'s {exam} result is out. View: {link}"

#### Implementation Steps
```typescript
// backend/src/services/notification/whatsappProvider.ts
1. Choose provider (Interakt recommended for India)
2. Register templates with WhatsApp
3. Implement template variable replacement
4. File upload for PDF attachments
5. Webhook for delivery status
```

#### Success Criteria
- ✅ Send templated WhatsApp to test number
- ✅ PDF attachment working
- ✅ Interactive button click tracking
- ✅ 95%+ delivery rate

---

### 1.3 Email Enhancement (Week 3)

#### Deliverables
- [ ] Rich HTML email templates
- [ ] SendGrid integration (better deliverability than SMTP)
- [ ] Email queue system (Bull)
- [ ] Attachment handling
- [ ] Unsubscribe management

#### Templates to Create
1. Fee receipt (with PDF)
2. Report card distribution
3. Welcome email (new admission)
4. Newsletter template
5. Event invitation

#### Implementation Steps
```typescript
// backend/src/services/notification/emailProvider.ts
1. Add SendGrid SDK
2. Design HTML templates (Handlebars/EJS)
3. Implement Bull queue for async sending
4. Add retry mechanism (3 attempts)
5. Track open/click rates
```

#### Success Criteria
- ✅ HTML emails render perfectly in Gmail/Outlook
- ✅ Attachments < 10MB working
- ✅ Queue processes 1000+ emails/hour
- ✅ Bounce rate < 2%

---

### 1.4 Push Notifications (Week 4)

#### Deliverables
- [ ] Firebase Cloud Messaging (FCM) integration
- [ ] Device token management
- [ ] Push notification service
- [ ] In-app notification center

#### Implementation Steps
```typescript
// backend/src/services/notification/pushProvider.ts
1. Set up Firebase project
2. Add FCM admin SDK
3. Store device tokens in User table
4. Implement batch push sending
5. Handle token refresh
```

#### Success Criteria
- ✅ Push reaches mobile devices instantly
- ✅ Click-through rate > 20%
- ✅ Token refresh automated

---

### Phase 1 Testing Checklist
- [ ] Integration tests for all providers
- [ ] Load test: 10,000 SMS in 1 hour
- [ ] Failure scenarios (provider down, invalid number)
- [ ] Cost tracking accurate
- [ ] Logs & monitoring set up

### Phase 1 Deployment
- [ ] Environment variables configured
- [ ] Provider API keys secured (AWS Secrets Manager)
- [ ] Rate limits set per provider
- [ ] Monitoring alerts (failed delivery > 5%)

### Phase 1 Success Metrics
- 📊 **90%+ notification delivery rate**
- 💰 **Fee collection improves by 30%** (within 2 months)
- ⏱️ **Avg delivery time < 5 seconds**
- 📈 **Parent satisfaction score +2 points**

---


## 📄 PHASE 2: Document & Certificate Generation (HIGH PRIORITY)

**Duration**: 3-4 weeks  
**Priority**: 🔴 HIGH - Reduces manual paperwork by 80%  
**Team**: 1 backend developer  
**Dependencies**: Phase 1 (for email/WhatsApp distribution)

### 2.1 Transfer Certificate (TC) Generation (Week 1)

#### Deliverables
- [ ] DOCX template system
- [ ] Student data merge
- [ ] DOCX → PDF conversion
- [ ] QR code for verification
- [ ] Serial number auto-increment

#### Technical Approach
```bash
# Option 1: docxtemplater + LibreOffice (recommended)
npm install docxtemplater pizzip qrcode
# System: apt-get install libreoffice

# Option 2: Gotenberg API (Docker-based)
docker run -p 3000:3000 gotenberg/gotenberg
```

#### Implementation Steps
```typescript
// backend/src/services/documentGenerator.service.ts

1. Create DOCX template with placeholders:
   - {studentName}, {admissionNo}, {class}, {dateOfBirth}
   - {fatherName}, {tcNumber}, {issueDate}

2. Implement merge function:
   async function generateTC(studentId: string): Promise<Buffer> {
     const student = await prisma.student.findUnique(...)
     const template = fs.readFileSync('templates/tc.docx')
     const zip = new PizZip(template)
     const doc = new Docxtemplater(zip)
     doc.setData({ studentName: student.name, ... })
     doc.render()
     const docxBuffer = doc.getZip().generate({ type: 'nodebuffer' })
     
     // Convert to PDF
     const pdfBuffer = await convertToPDF(docxBuffer)
     return pdfBuffer
   }

3. QR code generation:
   const qrCode = await QRCode.toDataURL(
     `https://school.com/verify/tc/${tcNumber}`
   )

4. Serial number management:
   const counter = await prisma.certificateCounter.upsert(...)
```

#### Files to Create/Modify
- `backend/src/services/documentGenerator.service.ts` (new)
- `backend/src/controllers/certificate.controller.ts` (update)
- `backend/templates/tc.docx` (template file)
- Add `CertificateCounter` model to Prisma

#### Success Criteria
- ✅ TC generated in < 3 seconds
- ✅ QR code verification works
- ✅ Serial numbers never duplicate
- ✅ Bilingual support (English + Hindi)

---

### 2.2 ID Card Generation (Week 2)

#### Deliverables
- [ ] Student ID card (front + back)
- [ ] Staff ID card
- [ ] Photo + barcode/QR
- [ ] RFID card number printing
- [ ] Batch generation for entire class

#### Template Design
```
FRONT:
┌─────────────────────┐
│  SCHOOL LOGO        │
│  [PHOTO]  ABC SCHOOL│
│           Student   │
│  Name: John Doe     │
│  Class: 5-A         │
│  Roll: 12345        │
│  [BARCODE]          │
└─────────────────────┘

BACK:
┌─────────────────────┐
│ Address: XYZ Street │
│ Phone: 9876543210   │
│ Blood Group: B+     │
│ Valid Till: 2026    │
│ [SIGNATURE]         │
└─────────────────────┘
```

#### Implementation Steps
```typescript
// backend/src/services/idCardGenerator.service.ts

1. Use PDFKit for custom layout:
   const doc = new PDFDocument({ size: [243, 153] }) // CR80 card size
   doc.image(schoolLogo, 10, 10, { width: 50 })
   doc.image(studentPhoto, 70, 40, { width: 60, height: 80 })
   doc.text(student.name, 140, 50)
   
2. Barcode generation:
   npm install bwip-js
   const barcode = await bwipjs.toBuffer({
     bcid: 'code128',
     text: student.admissionNo,
   })
   doc.image(barcode, 20, 120)

3. Batch generation:
   async function generateClassIDCards(classId: string) {
     const students = await prisma.student.findMany({ where: { classId } })
     const zip = new JSZip()
     for (const student of students) {
       const pdfBuffer = await generateIDCard(student.id)
       zip.file(`${student.admissionNo}.pdf`, pdfBuffer)
     }
     return zip.generateAsync({ type: 'nodebuffer' })
   }
```

#### Success Criteria
- ✅ ID card printable at 300 DPI
- ✅ Barcode scannable
- ✅ Batch generate 100 cards in < 1 minute
- ✅ Multiple design templates

---

### 2.3 Report Card Generation (Week 3)

#### Deliverables
- [ ] CBSE format report card
- [ ] State board format
- [ ] Marks + grades
- [ ] Skills assessment section
- [ ] Attendance summary
- [ ] Teacher remarks

#### Implementation Steps
```typescript
// backend/src/services/reportCardGenerator.service.ts

1. Fetch exam data:
   const marks = await prisma.mark.findMany({
     where: { studentId, examId },
     include: { subject: true, exam: true }
   })

2. Calculate:
   - Total marks
   - Percentage
   - Grade (A+, A, B, C...)
   - Rank in class

3. Generate PDF with charts:
   npm install chart.js canvas
   const chart = new Chart(canvas, {
     type: 'bar',
     data: { labels: subjects, datasets: [marks] }
   })
   doc.image(canvas.toBuffer(), 50, 200)

4. Bulk generation + email:
   const students = await prisma.student.findMany({ where: { classId } })
   for (const student of students) {
     const pdf = await generateReportCard(student.id, examId)
     await emailProvider.send({
       to: student.parent.email,
       subject: 'Report Card',
       attachments: [{ filename: 'report.pdf', content: pdf }]
     })
   }
```

#### Success Criteria
- ✅ Matches school's existing format
- ✅ Charts render correctly
- ✅ Bulk email 500 report cards in < 30 minutes
- ✅ Principal digital signature

---

### 2.4 Other Certificates (Week 4)

#### Deliverables
- [ ] Bonafide Certificate
- [ ] Character Certificate
- [ ] Leaving Certificate
- [ ] Course Completion Certificate
- [ ] Merit Certificate

#### Template Approach
All follow same pattern as TC:
1. Create DOCX template
2. Merge student data
3. Convert to PDF
4. Add QR verification
5. Store in `GeneratedCertificate` table

#### Files Structure
```
backend/
  templates/
    tc.docx
    bonafide.docx
    character.docx
    leaving.docx
    merit.docx
  src/
    services/
      documentGenerator.service.ts  # Main service
      idCardGenerator.service.ts
      reportCardGenerator.service.ts
```

---

### Phase 2 Testing Checklist
- [ ] TC generation test (50 samples)
- [ ] QR verification test
- [ ] ID card printing test (actual printout)
- [ ] Report card accuracy test
- [ ] Bulk generation stress test (1000 documents)
- [ ] Template customization test (school logo, colors)

### Phase 2 Deployment
- [ ] Upload templates to server
- [ ] LibreOffice installed on production
- [ ] S3 bucket for generated PDFs
- [ ] CloudFront CDN for fast delivery

### Phase 2 Success Metrics
- 📄 **80% reduction in manual paperwork**
- ⏱️ **TC issued in < 5 minutes** (vs 2-3 days)
- 💰 **Save Rs 50,000/year** (printing costs)
- 😊 **Parent satisfaction +3 points**

---


## 📱 PHASE 3: Mobile Applications (CRITICAL FOR 2025)

**Duration**: 10-12 weeks  
**Priority**: 🔴 CRITICAL - Parents expect mobile apps  
**Team**: 1 mobile developer (React Native/Flutter)  
**Dependencies**: Phase 1 (push notifications), Phase 2 (PDF viewing)

### Technology Choice

| Framework | Pros | Cons | Recommendation |
|-----------|------|------|----------------|
| **React Native** | - Same team as web<br>- Large ecosystem<br>- Hot reload | - Bridge overhead<br>- Some native code needed | ✅ **Recommended** (your team knows React) |
| **Flutter** | - Better performance<br>- Beautiful UI<br>- Single codebase | - Dart learning curve<br>- Smaller ecosystem | ⚠️ Good but slower start |
| **Native (Swift+Kotlin)** | - Best performance<br>- Platform features | - 2x development time<br>- 2 codebases | ❌ Too expensive |

**Decision**: **React Native** (Expo for faster development)

---

### 3.1 Parent Mobile App (Week 1-6)

#### Tech Stack
```json
{
  "framework": "React Native (Expo)",
  "navigation": "@react-navigation/native",
  "state": "Zustand (same as web)",
  "api": "Axios",
  "ui": "React Native Paper",
  "notifications": "expo-notifications + FCM",
  "auth": "expo-secure-store",
  "offline": "@tanstack/react-query"
}
```

#### Features Priority

**WEEK 1: Setup & Authentication**
- [ ] Project setup with Expo
- [ ] Splash screen & onboarding
- [ ] Login (email/password + Google OAuth)
- [ ] Biometric login (fingerprint/face)
- [ ] Token storage (secure)

**WEEK 2: Dashboard & Fees**
- [ ] Multi-child switcher
- [ ] Dashboard overview
  - Pending fees
  - Last payment
  - Attendance %
  - Latest notice
- [ ] Fee payment
  - View all pending fees
  - Razorpay integration
  - Payment history
  - Download receipt PDF

**WEEK 3: Attendance & Bus Tracking**
- [ ] Attendance calendar view
- [ ] Daily attendance notifications
- [ ] Bus tracking (real-time map)
- [ ] Estimated arrival time
- [ ] Driver contact

**WEEK 4: Homework & Exams**
- [ ] Homework list
- [ ] Submit homework (photo/file upload)
- [ ] Exam schedule
- [ ] View marks & report cards
- [ ] Performance graphs

**WEEK 5: Communication**
- [ ] Notice board
- [ ] Announcements
- [ ] Chat with teacher
- [ ] Leave application
- [ ] Parent-teacher meeting booking

**WEEK 6: Polish & Testing**
- [ ] Offline mode (cache data)
- [ ] Push notification handling
- [ ] Dark mode
- [ ] Localization (English + Hindi)
- [ ] Beta testing (50 parents)

#### Key Screens

```typescript
// src/screens/parent/
- SplashScreen.tsx
- OnboardingScreen.tsx
- LoginScreen.tsx
- DashboardScreen.tsx
- ChildSwitcherScreen.tsx
- FeeListScreen.tsx
- FeePaymentScreen.tsx
- AttendanceScreen.tsx
- BusTrackingScreen.tsx
- HomeworkScreen.tsx
- ExamMarksScreen.tsx
- ReportCardScreen.tsx
- NoticeScreen.tsx
- ChatScreen.tsx
- LeaveApplicationScreen.tsx
- ProfileScreen.tsx
```

#### API Integration
```typescript
// src/services/api.ts
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const api = axios.create({
  baseURL: 'https://api.school.com',
  timeout: 10000,
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync('token');
      // Navigate to login
    }
    return Promise.reject(error);
  }
);
```

#### Push Notifications Setup
```typescript
// src/services/notificationService.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export async function registerForPushNotifications() {
  if (!Device.isDevice) return;

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  
  // Send token to backend
  await api.post('/notifications/register-device', {
    token,
    platform: Platform.OS,
  });

  return token;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});
```

---

### 3.2 Teacher Mobile App (Week 7-9)

#### Features Priority

**WEEK 7: Attendance Marking**
- [ ] Class-wise student list
- [ ] Quick mark (swipe Present/Absent)
- [ ] Bulk mark (all present, all absent)
- [ ] Face recognition (camera-based)
- [ ] Period-wise attendance
- [ ] Absent SMS trigger

**WEEK 8: Homework & Marks**
- [ ] Create homework
- [ ] Upload attachments
- [ ] View submissions
- [ ] Grade submissions
- [ ] Enter exam marks (offline-first)
- [ ] Sync when online

**WEEK 9: Communication & Schedule**
- [ ] View timetable
- [ ] Substitution requests
- [ ] Send notices to class
- [ ] Chat with parents (1-on-1)
- [ ] Leave application

#### Key Screens
```typescript
// src/screens/teacher/
- TeacherDashboardScreen.tsx
- ClassListScreen.tsx
- AttendanceMarkingScreen.tsx
- FaceAttendanceScreen.tsx
- TimetableScreen.tsx
- HomeworkCreateScreen.tsx
- HomeworkSubmissionsScreen.tsx
- MarksEntryScreen.tsx
- NoticeCreateScreen.tsx
- ChatScreen.tsx
```

#### Offline-First Strategy
```typescript
// Using React Query for automatic sync
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Mark attendance offline
const { mutate: markAttendance } = useMutation({
  mutationFn: (data) => api.post('/attendance/mark', data),
  onSuccess: () => {
    queryClient.invalidateQueries(['attendance']);
  },
  // Auto-retry when online
  retry: true,
  retryDelay: 5000,
});
```

---

### 3.3 Student App (Week 10) - Optional

#### Features (Basic)
- [ ] View timetable
- [ ] Check homework
- [ ] Submit assignments
- [ ] View marks
- [ ] Library book search

---

### Phase 3 Deliverables

#### Parent App
- [ ] iOS app (App Store)
- [ ] Android app (Play Store)
- [ ] Push notifications working
- [ ] Offline mode
- [ ] 80%+ parent adoption target

#### Teacher App
- [ ] Android app (Play Store)
- [ ] Attendance marking
- [ ] Homework upload
- [ ] Marks entry (offline-first)

---

### Phase 3 Testing Checklist
- [ ] Unit tests (Jest)
- [ ] E2E tests (Detox)
- [ ] Device testing (iOS 14+, Android 10+)
- [ ] Performance testing (low-end devices)
- [ ] Battery consumption test
- [ ] Network failure scenarios
- [ ] Security audit (token storage, API security)

### Phase 3 Deployment

#### App Store Submission
```bash
# iOS (App Store Connect)
1. Create App Store listing
2. Screenshots (iPhone + iPad)
3. App description
4. Privacy policy URL
5. Submit for review (7-14 days)

# Android (Google Play Console)
1. Create Play Store listing
2. Screenshots (phone + tablet)
3. Content rating questionnaire
4. Upload APK/AAB
5. Submit for review (1-3 days)
```

#### Backend Changes
- [ ] Add device token management endpoints
- [ ] FCM server key configuration
- [ ] API versioning (/api/v1, /api/v2)
- [ ] Mobile-specific rate limits

---

### Phase 3 Success Metrics
- 📱 **80%+ parent app adoption** (within 3 months)
- ⭐ **4.5+ rating** on Play Store/App Store
- 📈 **Fee payment via app > 60%**
- ⏱️ **Avg session time > 3 minutes**
- 🔄 **Daily active users > 40%**

---


## 🔐 PHASE 4: Security & Performance (CRITICAL)

**Duration**: 3-4 weeks  
**Priority**: 🔴 CRITICAL - Production readiness  
**Team**: 1 backend + 1 DevOps  
**Dependencies**: None (can run parallel with Phase 3)

### 4.1 Performance Optimization (Week 1-2)

#### Redis Caching Layer

**Why Redis?**
- Session management (replace JWT in localStorage)
- API response caching
- Rate limiting (sliding window)
- Real-time features (WebSocket rooms)

**Implementation Steps**

```typescript
// backend/src/config/redis.ts
import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

// Caching middleware
export const cacheMiddleware = (ttl: number) => {
  return async (req, res, next) => {
    const key = `cache:${req.originalUrl}`;
    const cached = await redis.get(key);
    
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    res.sendResponse = res.json;
    res.json = async (body) => {
      await redis.setex(key, ttl, JSON.stringify(body));
      res.sendResponse(body);
    };
    next();
  };
};

// Usage
router.get('/students', cacheMiddleware(60), getStudents);
```

#### Database Optimization

```sql
-- Add missing indexes (analyze slow queries first)
CREATE INDEX idx_student_branch_class ON "Student"("branchId", "classId", "isActive");
CREATE INDEX idx_payment_student_date ON "Payment"("studentId", "paidAt" DESC);
CREATE INDEX idx_attendance_student_date ON "StudentAttendance"("studentId", "date" DESC);
CREATE INDEX idx_feeassignment_status ON "FeeAssignment"("status", "studentId");

-- Partial indexes for active records only
CREATE INDEX idx_active_students ON "Student"("branchId") WHERE "isActive" = true;
CREATE INDEX idx_active_staff ON "Staff"("branchId") WHERE "isActive" = true;

-- Composite indexes for common queries
CREATE INDEX idx_mark_exam_student ON "Mark"("examId", "studentId", "subjectId");
```

**N+1 Query Fixes**

```typescript
// BEFORE (N+1 problem)
const students = await prisma.student.findMany({ where: { classId } });
for (const student of students) {
  const fees = await prisma.feeAssignment.findMany({ 
    where: { studentId: student.id } 
  }); // N queries!
}

// AFTER (single query with include)
const students = await prisma.student.findMany({
  where: { classId },
  include: {
    feeAssignments: {
      include: { feeStructure: { include: { feeCategory: true } } }
    },
    attendances: { where: { date: { gte: lastMonth } } }
  }
});
```

#### Background Job Queue

```typescript
// backend/src/services/queue.service.ts
import Bull from 'bull';

export const emailQueue = new Bull('email', {
  redis: { host: 'localhost', port: 6379 },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
});

// Producer
export async function queueEmail(data: EmailData) {
  await emailQueue.add('send-email', data);
}

// Consumer (separate worker process)
emailQueue.process('send-email', async (job) => {
  await emailProvider.send(job.data);
});

// Bull dashboard (monitoring)
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullAdapter(emailQueue)],
  serverAdapter,
});
app.use('/admin/queues', serverAdapter.getRouter());
```

**Jobs to Queue**
- [ ] Email sending (bulk report cards)
- [ ] SMS sending (fee reminders)
- [ ] PDF generation (certificates)
- [ ] Data export (Excel reports)
- [ ] Attendance calculations
- [ ] Late fee calculations

---

### 4.2 Security Hardening (Week 3)

#### Two-Factor Authentication (2FA)

```typescript
// backend/src/services/twoFactor.service.ts
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

export async function enable2FA(userId: string) {
  const secret = speakeasy.generateSecret({
    name: `School ERP (${user.email})`,
  });
  
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret.base32, twoFactorEnabled: false },
  });

  const qrCode = await QRCode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, qrCode };
}

export function verify2FA(userId: string, token: string): boolean {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token,
  });
}

// Login flow with 2FA
router.post('/auth/login', async (req, res) => {
  const user = await verifyCredentials(req.body.email, req.body.password);
  
  if (user.twoFactorEnabled) {
    // Don't issue JWT yet - store in temporary session
    const tempToken = generateTempToken(user.id);
    return res.json({ require2FA: true, tempToken });
  }
  
  const token = generateJWT(user);
  res.json({ token, user });
});

router.post('/auth/verify-2fa', async (req, res) => {
  const { tempToken, otpCode } = req.body;
  const userId = verifyTempToken(tempToken);
  
  if (verify2FA(userId, otpCode)) {
    const token = generateJWT(userId);
    return res.json({ token, user });
  }
  
  res.status(401).json({ error: 'Invalid OTP' });
});
```

#### SQL Injection Prevention (Already handled by Prisma)
```typescript
// Prisma automatically parameterizes queries - SAFE
await prisma.user.findMany({
  where: { email: userInput }, // SQL injection impossible
});

// But beware of raw queries
await prisma.$queryRaw`SELECT * FROM User WHERE email = ${userInput}`; // UNSAFE
// Use $queryRaw only when absolutely necessary, with proper escaping
```

#### XSS Prevention (Frontend)
```typescript
// NEVER use dangerouslySetInnerHTML without sanitization
import DOMPurify from 'dompurify';

function NoticeDetail({ notice }) {
  const clean = DOMPurify.sanitize(notice.body);
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

#### API Rate Limiting (Enhanced)
```typescript
// backend/src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

const createLimiter = (windowMs: number, max: number) => {
  return rateLimit({
    store: new RedisStore({ client: redis }),
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });
};

// Apply different limits to different endpoints
app.use('/api/auth/login', createLimiter(15 * 60 * 1000, 5)); // 5 attempts per 15 min
app.use('/api/fees/payment', createLimiter(60 * 1000, 10)); // 10 payments per minute
app.use('/api/', createLimiter(60 * 1000, 100)); // 100 requests per minute (general)
```

#### Secrets Management
```typescript
// backend/src/config/secrets.ts
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const secretsManager = new SecretsManager({ region: 'us-east-1' });

export async function getSecret(name: string): Promise<string> {
  const data = await secretsManager.getSecretValue({ SecretId: name });
  return data.SecretString;
}

// Load secrets on startup
async function loadSecrets() {
  if (process.env.NODE_ENV === 'production') {
    config.jwt.secret = await getSecret('school-erp/jwt-secret');
    config.razorpay.keySecret = await getSecret('school-erp/razorpay-secret');
  }
}
```

---

### 4.3 Monitoring & Logging (Week 4)

#### Application Performance Monitoring (APM)

**Option 1: New Relic (Recommended)**
```bash
npm install newrelic
```

```javascript
// newrelic.js (root of project)
exports.config = {
  app_name: ['School ERP'],
  license_key: process.env.NEW_RELIC_LICENSE_KEY,
  logging: { level: 'info' },
  distributed_tracing: { enabled: true },
};

// server.ts (first import)
import 'newrelic';
import app from './app';
```

**Option 2: Datadog**
```bash
npm install dd-trace
```

```typescript
// server.ts
import tracer from 'dd-trace';
tracer.init({
  service: 'school-erp-backend',
  env: process.env.NODE_ENV,
});
```

#### Error Tracking (Sentry)
```typescript
// backend/src/config/sentry.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
  beforeSend(event) {
    // Don't send 404s or validation errors
    if (event.exception?.values?.[0]?.type === 'NotFoundError') return null;
    return event;
  },
});

// app.ts
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

#### Structured Logging (Winston)
```typescript
// backend/src/utils/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Usage
logger.info('Fee payment received', {
  studentId,
  amount,
  paymentMode,
});

logger.error('Payment gateway error', {
  error: err.message,
  stack: err.stack,
  context: { orderId, studentId },
});
```

#### Health Check Endpoint (Enhanced)
```typescript
// backend/src/routes/health.routes.ts
router.get('/health', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    razorpay: await checkRazorpay(),
    sms: await checkSMS(),
  };

  const allHealthy = Object.values(checks).every((c) => c.healthy);

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks,
  });
});

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}
```

---

### Phase 4 Deliverables
- [ ] Redis caching implemented
- [ ] Database indexes added (10+ slow queries optimized)
- [ ] Background job queue (Bull) working
- [ ] 2FA optional for admins
- [ ] Rate limiting on all endpoints
- [ ] Secrets in AWS Secrets Manager (production)
- [ ] New Relic/Datadog APM configured
- [ ] Sentry error tracking
- [ ] Winston structured logging
- [ ] Health check endpoint

### Phase 4 Testing Checklist
- [ ] Load test: 1000 concurrent users
- [ ] Database query time < 100ms (p95)
- [ ] API response time < 200ms (p95)
- [ ] Redis failover test
- [ ] Penetration testing (OWASP Top 10)
- [ ] SSL/TLS configuration (A+ rating)

### Phase 4 Success Metrics
- ⚡ **API response time < 200ms (p95)**
- 📊 **Database query time < 100ms (p95)**
- 🚀 **Cache hit rate > 70%**
- 🔒 **Zero critical security vulnerabilities**
- 📈 **Apdex score > 0.95** (New Relic)

---


## 🎓 PHASE 5: RFID Attendance & Hardware Integration

**Duration**: 3-4 weeks  
**Priority**: 🟡 HIGH - Improves safety & reduces proxy attendance  
**Team**: 1 backend developer  
**Dependencies**: Phase 1 (SMS notifications)

### 5.1 RFID Card Reader Integration (Week 1-2)

#### Supported Devices
- **ZKTeco** (most popular in India)
- **ESSL** (COSEC series)
- **HID** (ProxPoint Plus)
- **Generic Wiegand** protocol readers

#### Architecture

```
┌─────────────┐      WebSocket      ┌──────────────┐
│ RFID Reader │ ◄──────────────────► │ Node.js      │
│  (ZKTeco)   │                      │ Server       │
└─────────────┘                      └──────────────┘
       │                                     │
       │ Card Tap                            │ HTTP API
       │ (Card ID)                           │
       ▼                                     ▼
┌─────────────┐                      ┌──────────────┐
│ Card: 12345 │                      │ Attendance   │
│ Time: 09:05 │                      │ Record       │
└─────────────┘                      │ SMS to Parent│
                                     └──────────────┘
```

#### Implementation Steps

**Step 1: Device Communication Layer**

```typescript
// backend/src/services/cardReader/zktecoAdapter.ts
import ZKLib from 'node-zklib';

export class ZKTecoAdapter {
  private client: any;
  
  async connect(ip: string, port: number = 4370): Promise<void> {
    this.client = new ZKLib(ip, port, 10000, 4000);
    await this.client.createSocket();
  }

  async getAttendanceLogs(): Promise<AttendanceLog[]> {
    const logs = await this.client.getAttendances();
    return logs.map((log: any) => ({
      cardId: log.cardno,
      timestamp: log.recordTime,
      deviceId: this.deviceId,
    }));
  }

  async listenRealTime(callback: (log: AttendanceLog) => void): Promise<void> {
    this.client.on('attendance', (data: any) => {
      callback({
        cardId: data.cardno,
        timestamp: new Date(data.recordTime),
        deviceId: this.deviceId,
      });
    });
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }
}
```

**Step 2: Generic Card Reader Service**

```typescript
// backend/src/services/cardReader/cardReaderService.ts
import { ZKTecoAdapter } from './zktecoAdapter';
import { ESSLAdapter } from './esslAdapter';
import { HIDAdapter } from './hidAdapter';

export class CardReaderService {
  private adapters: Map<string, any> = new Map();

  async registerDevice(device: AttendanceDevice): Promise<void> {
    let adapter;
    
    switch (device.type) {
      case 'ZKTECO':
        adapter = new ZKTecoAdapter(device.deviceId);
        break;
      case 'ESSL':
        adapter = new ESSLAdapter(device.deviceId);
        break;
      case 'HID':
        adapter = new HIDAdapter(device.deviceId);
        break;
      default:
        throw new Error(`Unsupported device type: ${device.type}`);
    }

    await adapter.connect(device.ipAddress, device.port);
    this.adapters.set(device.deviceId, adapter);

    // Listen for real-time card taps
    adapter.listenRealTime(async (log) => {
      await this.processAttendance(log, device);
    });
  }

  private async processAttendance(
    log: AttendanceLog,
    device: AttendanceDevice
  ): Promise<void> {
    // Find student by card ID
    const student = await prisma.student.findUnique({
      where: { cardId: log.cardId, branchId: device.branchId },
      include: { 
        parents: { include: { parent: { include: { user: true } } } },
        section: true,
      },
    });

    if (!student) {
      logger.warn('Unknown card tapped', { cardId: log.cardId, deviceId: device.deviceId });
      return;
    }

    // Check if already marked today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.studentAttendance.findFirst({
      where: {
        studentId: student.id,
        date: { gte: today },
      },
    });

    if (existing) {
      // Update out-time if this is exit tap
      if (device.location === 'EXIT' && !existing.outTime) {
        await prisma.studentAttendance.update({
          where: { id: existing.id },
          data: { outTime: log.timestamp },
        });

        // Send exit SMS
        await this.sendParentSMS(student, 'exit', log.timestamp);
      }
      return;
    }

    // Create attendance record
    await prisma.studentAttendance.create({
      data: {
        studentId: student.id,
        sectionId: student.sectionId,
        date: today,
        status: 'PRESENT',
        inTime: log.timestamp,
        source: 'CARD_TAP',
        deviceId: device.deviceId,
      },
    });

    // Send entry SMS to parents
    await this.sendParentSMS(student, 'entry', log.timestamp);
  }

  private async sendParentSMS(
    student: any,
    type: 'entry' | 'exit',
    time: Date
  ): Promise<void> {
    const message = type === 'entry'
      ? `${student.user.name} arrived at school at ${formatTime(time)}. Have a great day!`
      : `${student.user.name} left school at ${formatTime(time)}. See you tomorrow!`;

    for (const sp of student.parents) {
      if (sp.parent.user.phone) {
        await smsProvider.send({
          to: sp.parent.user.phone,
          body: message,
        });
      }
    }
  }
}

export const cardReaderService = new CardReaderService();
```

**Step 3: WebSocket for Real-time Updates**

```typescript
// backend/src/services/websocket.ts
import { Server } from 'socket.io';
import { verifyToken } from '../utils/jwt';

export function setupWebSocket(httpServer: any) {
  const io = new Server(httpServer, {
    cors: { origin: config.frontendUrl, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try {
      const decoded = verifyToken(token);
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    // Join room based on branchId
    socket.join(`branch:${socket.data.user.branchId}`);

    logger.info('Client connected', { userId: socket.data.user.userId });

    socket.on('disconnect', () => {
      logger.info('Client disconnected', { userId: socket.data.user.userId });
    });
  });

  return io;
}

// Emit attendance event to all connected clients in the branch
export function emitAttendance(branchId: string, data: any) {
  io.to(`branch:${branchId}`).emit('attendance', data);
}
```

**Step 4: Admin Panel for Device Management**

```typescript
// backend/src/controllers/attendanceDevice.controller.ts
export const registerDevice = async (req: AuthRequest, res: Response) => {
  const { name, type, ipAddress, port, location, branchId } = req.body;

  const device = await prisma.attendanceDevice.create({
    data: {
      deviceId: crypto.randomUUID(),
      name,
      type,
      ipAddress,
      port,
      location,
      branchId,
      apiKey: crypto.randomBytes(32).toString('hex'),
      isActive: true,
    },
  });

  // Register with card reader service
  await cardReaderService.registerDevice(device);

  sendSuccess(res, device, 'Device registered');
};

export const syncDeviceLogs = async (req: AuthRequest, res: Response) => {
  const { deviceId } = req.params;

  const device = await prisma.attendanceDevice.findUnique({ where: { id: deviceId } });
  if (!device) { sendError(res, 'Device not found', 404); return; }

  const adapter = cardReaderService.getAdapter(device.deviceId);
  const logs = await adapter.getAttendanceLogs();

  // Process all logs
  for (const log of logs) {
    await cardReaderService.processAttendance(log, device);
  }

  sendSuccess(res, { count: logs.length }, 'Logs synced');
};
```

---

### 5.2 Face Recognition Attendance (Week 3) - Optional Advanced Feature

#### Tech Stack
- **Python Service** (FastAPI + OpenCV + face_recognition)
- **Node.js** calls Python API

#### Architecture
```
┌─────────────┐      HTTP       ┌──────────────┐      HTTP      ┌─────────────┐
│   Camera    │ ───────────────►│  Python      │───────────────►│  Node.js    │
│  (Webcam)   │                 │  Face API    │                │  Backend    │
└─────────────┘                 └──────────────┘                └─────────────┘
                                       │
                                       ▼
                                ┌──────────────┐
                                │ Face Models  │
                                │ (embeddings) │
                                └──────────────┘
```

#### Python Face Recognition Service

```python
# face-api/main.py
from fastapi import FastAPI, UploadFile
import face_recognition
import numpy as np
import cv2

app = FastAPI()

# Load known faces from database
known_faces = {}  # {studentId: face_encoding}

@app.post("/recognize")
async def recognize_face(file: UploadFile):
    image = face_recognition.load_image_file(file.file)
    face_encodings = face_recognition.face_encodings(image)
    
    if len(face_encodings) == 0:
        return {"error": "No face detected"}
    
    face_encoding = face_encodings[0]
    
    # Compare with known faces
    for student_id, known_encoding in known_faces.items():
        match = face_recognition.compare_faces([known_encoding], face_encoding)
        if match[0]:
            distance = face_recognition.face_distance([known_encoding], face_encoding)[0]
            confidence = (1 - distance) * 100
            return {"studentId": student_id, "confidence": confidence}
    
    return {"error": "Face not recognized"}

@app.post("/register-face")
async def register_face(student_id: str, file: UploadFile):
    image = face_recognition.load_image_file(file.file)
    face_encodings = face_recognition.face_encodings(image)
    
    if len(face_encodings) > 0:
        known_faces[student_id] = face_encodings[0]
        return {"success": True}
    
    return {"error": "No face detected"}
```

```typescript
// backend/src/services/faceRecognition.service.ts
import axios from 'axios';
import FormData from 'form-data';

export async function recognizeFace(imageBuffer: Buffer): Promise<string | null> {
  const form = new FormData();
  form.append('file', imageBuffer, 'photo.jpg');

  const response = await axios.post('http://localhost:8000/recognize', form, {
    headers: form.getHeaders(),
  });

  if (response.data.studentId) {
    return response.data.studentId;
  }

  return null;
}
```

---

### Phase 5 Deliverables
- [ ] RFID card reader integration (ZKTeco + ESSL)
- [ ] Real-time WebSocket for attendance updates
- [ ] SMS on entry/exit to parents
- [ ] Device management admin panel
- [ ] Duplicate tap prevention
- [ ] Face recognition (optional)

### Phase 5 Testing Checklist
- [ ] Card tap test (100 students)
- [ ] Duplicate tap handling
- [ ] SMS delivery (entry + exit)
- [ ] WebSocket real-time updates
- [ ] Device failover test
- [ ] Performance: 1000 taps/hour

### Phase 5 Success Metrics
- ⚡ **Tap-to-SMS < 5 seconds**
- 📊 **Proxy attendance reduced by 90%+**
- 📱 **SMS delivery rate > 95%**
- 😊 **Parent satisfaction +4 points** (safety)

---


## 📊 PHASE 6: Advanced Analytics & Reports

**Duration**: 3-4 weeks  
**Priority**: 🟡 MEDIUM - Data-driven decision making  
**Team**: 1 backend + 1 frontend developer  
**Dependencies**: Phase 4 (Redis caching)

### 6.1 Executive Dashboard (Week 1)

#### Real-time KPI Cards

```typescript
// backend/src/controllers/reports.controller.ts
export const getExecutiveDashboard = async (req: AuthRequest, res: Response) => {
  const { branchId } = req.params;
  const cacheKey = `dashboard:${branchId}`;

  // Check Redis cache
  const cached = await redis.get(cacheKey);
  if (cached) return sendSuccess(res, JSON.parse(cached));

  const [
    totalStudents,
    totalStaff,
    monthlyFeeCollection,
    todayAttendance,
    pendingFees,
  ] = await Promise.all([
    prisma.student.count({ where: { branchId, isActive: true } }),
    prisma.staff.count({ where: { branchId, isActive: true } }),
    getMonthlyFeeCollection(branchId),
    getTodayAttendance(branchId),
    getPendingFees(branchId),
  ]);

  const data = {
    totalStudents,
    totalStaff,
    monthlyFeeCollection,
    todayAttendance,
    pendingFees,
    timestamp: new Date(),
  };

  // Cache for 10 minutes
  await redis.setex(cacheKey, 600, JSON.stringify(data));

  sendSuccess(res, data);
};

async function getMonthlyFeeCollection(branchId: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const result = await prisma.payment.aggregate({
    where: {
      branchId,
      paidAt: { gte: startOfMonth },
      status: 'SUCCESS',
    },
    _sum: { amount: true },
  });

  return Number(result._sum.amount || 0);
}

async function getTodayAttendance(branchId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [present, total] = await Promise.all([
    prisma.studentAttendance.count({
      where: {
        date: today,
        status: 'PRESENT',
        student: { branchId },
      },
    }),
    prisma.student.count({ where: { branchId, isActive: true } }),
  ]);

  return total > 0 ? (present / total) * 100 : 0;
}
```

#### Frontend Dashboard with Charts

```typescript
// frontend/src/app/dashboard/admin/page.tsx
'use client';
import { Line, Bar, Pie } from 'react-chartjs-2';
import { useEffect, useState } from 'react';
import api from '@/lib/api';

export default function AdminDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [feeChart, setFeeChart] = useState<any>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    const [statsRes, chartRes] = await Promise.all([
      api.get('/reports/dashboard'),
      api.get('/reports/fee-collection-trend'),
    ]);

    setStats(statsRes.data.data);
    setFeeChart({
      labels: chartRes.data.data.labels,
      datasets: [{
        label: 'Fee Collection (Rs)',
        data: chartRes.data.data.values,
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
      }],
    });
  }

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <KPICard
          title="Total Students"
          value={stats?.totalStudents}
          icon={GraduationCap}
          color="blue"
        />
        <KPICard
          title="Monthly Collection"
          value={formatCurrency(stats?.monthlyFeeCollection)}
          icon={IndianRupee}
          color="green"
        />
        <KPICard
          title="Attendance Today"
          value={`${stats?.todayAttendance?.toFixed(1)}%`}
          icon={ClipboardCheck}
          color="purple"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Fee Collection Trend</h3>
          {feeChart && <Line data={feeChart} />}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Class-wise Strength</h3>
          {/* Bar chart */}
        </div>
      </div>
    </div>
  );
}
```

---

### 6.2 Fee Reports (Week 2)

#### Comprehensive Fee Analytics

```typescript
// backend/src/controllers/feeReports.controller.ts

export const getFeeDefaulters = async (req: AuthRequest, res: Response) => {
  const { branchId, days = 30 } = req.query;

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() - Number(days));

  const defaulters = await prisma.student.findMany({
    where: {
      branchId: branchId as string,
      isActive: true,
      feeAssignments: {
        some: {
          status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
          createdAt: { lt: dueDate },
        },
      },
    },
    include: {
      user: { select: { name: true, phone: true, email: true } },
      class: { select: { name: true } },
      section: { select: { name: true } },
      feeAssignments: {
        where: { status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] } },
        include: {
          feeStructure: {
            include: { feeCategory: { select: { name: true } } },
          },
        },
      },
    },
  });

  const enriched = defaulters.map((student) => {
    const totalPending = student.feeAssignments.reduce((sum, fa) => {
      return sum + (Number(fa.totalAmount) - Number(fa.paidAmount));
    }, 0);

    return {
      studentId: student.id,
      name: student.user.name,
      class: `${student.class.name}-${student.section.name}`,
      phone: student.user.phone,
      email: student.user.email,
      totalPending,
      pendingFees: student.feeAssignments.map((fa) => ({
        category: fa.feeStructure.feeCategory.name,
        amount: Number(fa.totalAmount) - Number(fa.paidAmount),
      })),
    };
  });

  sendSuccess(res, enriched);
};

export const getDailyCollectionReport = async (req: AuthRequest, res: Response) => {
  const { branchId, startDate, endDate } = req.query;

  const payments = await prisma.payment.groupBy({
    by: ['paidAt'],
    where: {
      branchId: branchId as string,
      status: 'SUCCESS',
      paidAt: {
        gte: new Date(startDate as string),
        lte: new Date(endDate as string),
      },
    },
    _sum: { amount: true },
    _count: true,
    orderBy: { paidAt: 'asc' },
  });

  const report = payments.map((p) => ({
    date: p.paidAt,
    totalAmount: Number(p._sum.amount),
    transactionCount: p._count,
  }));

  sendSuccess(res, report);
};

export const getPaymentModeBreakdown = async (req: AuthRequest, res: Response) => {
  const { branchId, month } = req.query;

  const breakdown = await prisma.payment.groupBy({
    by: ['paymentMode'],
    where: {
      branchId: branchId as string,
      status: 'SUCCESS',
      paidAt: {
        gte: new Date(month as string),
        lte: new Date(month as string),
      },
    },
    _sum: { amount: true },
    _count: true,
  });

  sendSuccess(res, breakdown);
};
```

#### Excel Export

```typescript
// backend/src/services/excelExport.service.ts
import ExcelJS from 'exceljs';

export async function exportFeeDefaulters(data: any[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Fee Defaulters');

  worksheet.columns = [
    { header: 'Student Name', key: 'name', width: 25 },
    { header: 'Class', key: 'class', width: 10 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Total Pending (Rs)', key: 'totalPending', width: 15 },
  ];

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  data.forEach((row) => {
    worksheet.addRow(row);
  });

  return workbook.xlsx.writeBuffer() as Promise<Buffer>;
}

// Controller
export const downloadFeeDefaultersExcel = async (req: AuthRequest, res: Response) => {
  const data = await getFeeDefaultersData(req.query.branchId);
  const buffer = await exportFeeDefaulters(data);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=fee-defaulters.xlsx');
  res.send(buffer);
};
```

---

### 6.3 Attendance Reports (Week 3)

```typescript
// backend/src/controllers/attendanceReports.controller.ts

export const getMonthlyAttendanceReport = async (req: AuthRequest, res: Response) => {
  const { classId, month } = req.query;

  const startDate = new Date(month as string);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);

  const students = await prisma.student.findMany({
    where: { classId: classId as string, isActive: true },
    include: {
      user: { select: { name: true } },
      attendances: {
        where: { date: { gte: startDate, lt: endDate } },
      },
    },
  });

  const workingDays = getWorkingDays(startDate, endDate);

  const report = students.map((student) => {
    const presentDays = student.attendances.filter((a) => a.status === 'PRESENT').length;
    const percentage = (presentDays / workingDays) * 100;

    return {
      studentId: student.id,
      name: student.user.name,
      presentDays,
      absentDays: workingDays - presentDays,
      percentage: percentage.toFixed(2),
      status: percentage >= 75 ? 'Good' : percentage >= 60 ? 'Warning' : 'Critical',
    };
  });

  sendSuccess(res, report);
};

export const getBelowThresholdStudents = async (req: AuthRequest, res: Response) => {
  const { branchId, threshold = 75 } = req.query;

  // Students with attendance < threshold in current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);

  const students = await prisma.student.findMany({
    where: { branchId: branchId as string, isActive: true },
    include: {
      user: { select: { name: true, phone: true } },
      class: { select: { name: true } },
      section: { select: { name: true } },
      attendances: {
        where: { date: { gte: startOfMonth } },
      },
    },
  });

  const workingDays = getWorkingDays(startOfMonth, new Date());

  const filtered = students
    .map((student) => {
      const presentDays = student.attendances.filter((a) => a.status === 'PRESENT').length;
      const percentage = (presentDays / workingDays) * 100;

      return { ...student, presentDays, percentage };
    })
    .filter((s) => s.percentage < Number(threshold))
    .sort((a, b) => a.percentage - b.percentage);

  sendSuccess(res, filtered);
};
```

---

### 6.4 Custom Report Builder (Week 4) - Advanced

#### Drag-and-Drop Query Builder UI

```typescript
// frontend/src/app/dashboard/reports/builder/page.tsx
'use client';
import { useState } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';

export default function ReportBuilder() {
  const [selectedFields, setSelectedFields] = useState([]);
  const [filters, setFilters] = useState([]);

  const availableFields = [
    { id: 'student.name', label: 'Student Name', table: 'Student' },
    { id: 'student.admissionNo', label: 'Admission No', table: 'Student' },
    { id: 'class.name', label: 'Class', table: 'Class' },
    { id: 'payment.amount', label: 'Fee Amount', table: 'Payment' },
    { id: 'attendance.date', label: 'Attendance Date', table: 'Attendance' },
  ];

  async function generateReport() {
    const query = {
      fields: selectedFields,
      filters,
      groupBy: [],
      orderBy: [],
    };

    const response = await api.post('/reports/custom', query);
    downloadExcel(response.data);
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Available Fields */}
      <div className="card">
        <h3 className="font-semibold mb-4">Available Fields</h3>
        {availableFields.map((field) => (
          <div key={field.id} draggable className="p-2 border mb-2 cursor-move">
            {field.label}
          </div>
        ))}
      </div>

      {/* Selected Fields */}
      <div className="card">
        <h3 className="font-semibold mb-4">Selected Fields</h3>
        {selectedFields.map((field) => (
          <div key={field.id} className="p-2 bg-blue-50 mb-2">
            {field.label}
          </div>
        ))}
      </div>

      {/* Filters & Actions */}
      <div className="card">
        <h3 className="font-semibold mb-4">Filters</h3>
        {/* Filter UI */}
        <button onClick={generateReport} className="btn btn-primary mt-4">
          Generate Report
        </button>
      </div>
    </div>
  );
}
```

---

### Phase 6 Deliverables
- [ ] Executive dashboard with real-time KPIs
- [ ] Fee collection analytics (trends, defaulters, mode breakdown)
- [ ] Attendance reports (monthly, below-threshold)
- [ ] Performance reports (class-wise, subject-wise)
- [ ] Excel export for all reports
- [ ] Scheduled reports (email delivery)
- [ ] Custom report builder (basic)

### Phase 6 Success Metrics
- 📊 **80% of decisions data-driven**
- ⏱️ **Report generation < 5 seconds**
- 📈 **Report usage > 500/month**
- 💡 **Identify 20+ at-risk students early**

---


## 🚀 PHASE 7: Production Deployment & DevOps

**Duration**: 2-3 weeks  
**Priority**: 🔴 CRITICAL - Go live!  
**Team**: 1 DevOps engineer  
**Dependencies**: All previous phases (or at least Phase 1-4)

### 7.1 Infrastructure Setup (Week 1)

#### Option A: Hostinger VPS (As per README)

**Specifications Required**
- **VPS Plan**: Business or higher
- **RAM**: 8 GB minimum (for 15k students)
- **CPU**: 4 cores
- **Storage**: 100 GB SSD
- **Bandwidth**: Unmetered
- **OS**: Ubuntu 22.04 LTS

**Initial Server Setup**

```bash
# SSH into server
ssh root@your-server-ip

# Create non-root user
adduser schoolerp
usermod -aG sudo schoolerp
su - schoolerp

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PostgreSQL 15
sudo apt install -y postgresql postgresql-contrib

# Install Redis
sudo apt install -y redis-server

# Install Nginx
sudo apt install -y nginx

# Install PM2 (process manager)
sudo npm install -g pm2

# Install LibreOffice (for PDF conversion)
sudo apt install -y libreoffice
```

**Database Setup**

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE school_erp;
CREATE USER schoolerp_user WITH PASSWORD 'your-strong-password';
GRANT ALL PRIVILEGES ON DATABASE school_erp TO schoolerp_user;
\q
```

**Application Deployment**

```bash
# Clone repository
cd /var/www
sudo git clone https://github.com/ashutoshroli/School-Management-V2.git
sudo chown -R schoolerp:schoolerp School-Management-V2
cd School-Management-V2

# Install dependencies
npm install
cd db && npm install && cd ..
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Set up environment
cp .env.example .env
nano .env  # Edit with production values

# Generate Prisma client
cd db
npx prisma generate
npx prisma migrate deploy  # Run migrations
cd ..

# Build backend
cd backend
npm run build
cd ..

# Build frontend
cd frontend
npm run build
cd ..

# Start with PM2
pm2 start backend/dist/server.js --name school-erp-backend
pm2 start frontend --name school-erp-frontend -- start

# Save PM2 config
pm2 save
pm2 startup
```

**Nginx Configuration**

```nginx
# /etc/nginx/sites-available/schoolerp
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket for real-time features
    location /socket.io {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Static files (uploads)
    location /uploads {
        alias /var/www/School-Management-V2/backend/uploads;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Frontend (Next.js)
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json;
}
```

```bash
# Enable site and restart Nginx
sudo ln -s /etc/nginx/sites-available/schoolerp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

**SSL Certificate (Let's Encrypt)**

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

---

#### Option B: AWS (Scalable, Production-grade)

**Infrastructure as Code (Terraform)**

```hcl
# infrastructure/main.tf
provider "aws" {
  region = "us-east-1"
}

# VPC
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  tags = { Name = "school-erp-vpc" }
}

# RDS (PostgreSQL)
resource "aws_db_instance" "postgres" {
  identifier           = "school-erp-db"
  engine               = "postgres"
  engine_version       = "15.3"
  instance_class       = "db.t3.medium"
  allocated_storage    = 100
  storage_encrypted    = true
  db_name              = "school_erp"
  username             = "schoolerp"
  password             = var.db_password
  vpc_security_group_ids = [aws_security_group.db.id]
  multi_az             = true
  backup_retention_period = 7
  skip_final_snapshot  = false
}

# ElastiCache (Redis)
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "school-erp-redis"
  engine               = "redis"
  node_type            = "cache.t3.medium"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
}

# ECS Fargate (Backend)
resource "aws_ecs_cluster" "main" {
  name = "school-erp-cluster"
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "school-erp-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "2048"

  container_definitions = jsonencode([{
    name  = "backend"
    image = "your-ecr-repo/school-erp-backend:latest"
    portMappings = [{
      containerPort = 5000
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "DATABASE_URL", value = "postgresql://..." },
    ]
  }])
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "school-erp-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

# S3 (File storage)
resource "aws_s3_bucket" "uploads" {
  bucket = "school-erp-uploads"
}

# CloudFront (CDN)
resource "aws_cloudfront_distribution" "frontend" {
  origin {
    domain_name = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id   = "frontend"
  }
  enabled             = true
  default_root_object = "index.html"
  # ... more config
}
```

---

### 7.2 CI/CD Pipeline Enhancement (Week 2)

**GitHub Actions (Enhanced)**

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install & Test
        run: |
          npm install
          cd backend && npm test -- --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  build-backend:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Login to Docker Hub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}
      
      - name: Build and push
        run: |
          docker build -t schoolerp/backend:${{ github.sha }} ./backend
          docker push schoolerp/backend:${{ github.sha }}
          docker tag schoolerp/backend:${{ github.sha }} schoolerp/backend:latest
          docker push schoolerp/backend:latest

  deploy-production:
    needs: [build-backend]
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /var/www/School-Management-V2
            git pull origin main
            cd backend && npm install
            npm run build
            pm2 restart school-erp-backend
```

**Docker Setup**

```dockerfile
# backend/Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY db/package*.json ./db/
RUN npm install

# Copy source
COPY . .

# Generate Prisma client
WORKDIR /app/db
RUN npx prisma generate

# Build
WORKDIR /app/backend
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy built assets
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/db/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/db/node_modules/.prisma ./node_modules/.prisma

EXPOSE 5000

CMD ["node", "dist/server.js"]
```

---

### 7.3 Monitoring & Alerting (Week 2-3)

**Uptime Monitoring (UptimeRobot)**

```bash
# Set up health check endpoint
GET https://your-domain.com/api/health

# UptimeRobot monitors every 5 minutes
# Alerts via email/SMS if down
```

**Log Aggregation (ELK Stack - Optional)**

```yaml
# docker-compose.yml (on separate monitoring server)
version: '3'
services:
  elasticsearch:
    image: elasticsearch:8.7.0
    environment:
      - discovery.type=single-node
    ports:
      - "9200:9200"

  logstash:
    image: logstash:8.7.0
    volumes:
      - ./logstash.conf:/usr/share/logstash/pipeline/logstash.conf
    ports:
      - "5044:5044"

  kibana:
    image: kibana:8.7.0
    ports:
      - "5601:5601"
```

**Alerting (Slack/Email)**

```typescript
// backend/src/services/alerting.service.ts
import axios from 'axios';

export async function sendSlackAlert(message: string, severity: 'info' | 'warning' | 'error') {
  const color = severity === 'error' ? '#FF0000' : severity === 'warning' ? '#FFA500' : '#00FF00';

  await axios.post(process.env.SLACK_WEBHOOK_URL, {
    attachments: [{
      color,
      title: `School ERP - ${severity.toUpperCase()}`,
      text: message,
      footer: 'School ERP Monitoring',
      ts: Math.floor(Date.now() / 1000),
    }],
  });
}

// Usage in error handler
if (error.statusCode >= 500) {
  await sendSlackAlert(`Server error: ${error.message}`, 'error');
}
```

**Database Backup Automation**

```bash
# /var/www/scripts/backup-db.sh
#!/bin/bash

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/school-erp"
DB_NAME="school_erp"

# Create backup
pg_dump -U schoolerp_user $DB_NAME | gzip > $BACKUP_DIR/$DB_NAME-$TIMESTAMP.sql.gz

# Upload to S3
aws s3 cp $BACKUP_DIR/$DB_NAME-$TIMESTAMP.sql.gz s3://school-erp-backups/

# Keep only last 30 days locally
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

# Send success notification
curl -X POST $SLACK_WEBHOOK_URL -d '{"text":"Database backup completed: '$TIMESTAMP'"}'
```

```bash
# Cron job (daily at 2 AM)
crontab -e
# Add:
0 2 * * * /var/www/scripts/backup-db.sh
```

---

### Phase 7 Deliverables
- [ ] Production server configured (Hostinger/AWS)
- [ ] SSL certificate installed
- [ ] PM2/Docker running applications
- [ ] Nginx reverse proxy
- [ ] Database backups automated
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Monitoring (New Relic/Datadog + UptimeRobot)
- [ ] Error tracking (Sentry)
- [ ] Log aggregation (optional ELK)
- [ ] Alerting (Slack/Email)

### Phase 7 Testing Checklist
- [ ] Load test: 1000 concurrent users
- [ ] Failover test (database, Redis)
- [ ] Backup restore test
- [ ] SSL configuration test (ssllabs.com)
- [ ] Performance test (GTmetrix/PageSpeed)
- [ ] Security scan (OWASP ZAP)

### Phase 7 Success Metrics
- 🔒 **99.9% uptime**
- ⚡ **Page load < 2 seconds**
- 🔐 **A+ SSL rating**
- 📊 **Error rate < 0.1%**
- 💾 **Zero data loss**

---


## 📝 PHASE 8: Testing & Quality Assurance (ONGOING)

**Duration**: 2-3 weeks (parallel with other phases)  
**Priority**: 🔴 CRITICAL - Quality cannot be compromised  
**Team**: 1 QA engineer + developers  
**Dependencies**: Runs parallel with development

### 8.1 Unit Testing (Target: 80% Coverage)

#### Backend Testing Strategy

```typescript
// backend/src/__tests__/services/feePayment.service.test.ts
import { recordFeePayment } from '../../services/feePayment.service';
import prisma from '../../config/database';

jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    feeAssignment: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      create: jest.fn(),
    },
  },
}));

describe('Fee Payment Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should record payment successfully', async () => {
    const mockAssignment = {
      id: 'fa-1',
      studentId: 'student-1',
      totalAmount: 10000,
      paidAmount: 0,
      discount: 0,
      lateFee: 0,
    };

    (prisma.feeAssignment.findUnique as jest.Mock).mockResolvedValue(mockAssignment);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      return callback(prisma);
    });

    const result = await recordFeePayment({
      feeAssignmentId: 'fa-1',
      studentId: 'student-1',
      branchId: 'branch-1',
      amount: 5000,
      paymentMode: 'CASH',
      receiptNo: 'RCP-001',
    });

    expect(result.payment).toBeDefined();
    expect(prisma.payment.create).toHaveBeenCalled();
    expect(prisma.feeAssignment.update).toHaveBeenCalledWith({
      where: { id: 'fa-1' },
      data: expect.objectContaining({
        paidAmount: 5000,
        status: 'PARTIAL',
      }),
    });
  });

  it('should reject overpayment', async () => {
    const mockAssignment = {
      id: 'fa-1',
      totalAmount: 10000,
      paidAmount: 8000,
      discount: 0,
      lateFee: 0,
    };

    (prisma.feeAssignment.findUnique as jest.Mock).mockResolvedValue(mockAssignment);

    await expect(
      recordFeePayment({
        feeAssignmentId: 'fa-1',
        studentId: 'student-1',
        branchId: 'branch-1',
        amount: 5000,
        paymentMode: 'CASH',
        receiptNo: 'RCP-002',
      })
    ).rejects.toThrow('Payment amount exceeds pending balance');
  });

  it('should update status to PAID when fully paid', async () => {
    const mockAssignment = {
      id: 'fa-1',
      totalAmount: 10000,
      paidAmount: 8000,
      discount: 0,
      lateFee: 0,
    };

    (prisma.feeAssignment.findUnique as jest.Mock).mockResolvedValue(mockAssignment);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      return callback(prisma);
    });

    await recordFeePayment({
      feeAssignmentId: 'fa-1',
      studentId: 'student-1',
      branchId: 'branch-1',
      amount: 2000,
      paymentMode: 'CASH',
      receiptNo: 'RCP-003',
    });

    expect(prisma.feeAssignment.update).toHaveBeenCalledWith({
      where: { id: 'fa-1' },
      data: expect.objectContaining({
        paidAmount: 10000,
        status: 'PAID',
      }),
    });
  });
});
```

**Coverage Report**

```bash
# Run tests with coverage
cd backend
npm test -- --coverage

# Output:
# --------------------------|---------|----------|---------|---------|
# File                      | % Stmts | % Branch | % Funcs | % Lines |
# --------------------------|---------|----------|---------|---------|
# All files                 |   78.23 |    71.45 |   82.91 |   78.12 |
#  controllers/             |   65.12 |    58.32 |   70.45 |   65.34 |
#  services/                |   89.45 |    84.21 |   92.67 |   89.32 |
#  utils/                   |   91.23 |    87.65 |   95.12 |   91.11 |
# --------------------------|---------|----------|---------|---------|
```

---

### 8.2 Integration Testing

```typescript
// backend/src/__tests__/integration/feePayment.integration.test.ts
import request from 'supertest';
import app from '../../app';
import prisma from '../../config/database';
import { generateJWT } from '../../utils/jwt';

describe('Fee Payment API Integration', () => {
  let authToken: string;
  let testBranch: any;
  let testStudent: any;
  let testFeeAssignment: any;

  beforeAll(async () => {
    // Set up test data
    testBranch = await prisma.branch.create({
      data: {
        organizationId: 'test-org',
        name: 'Test Branch',
        code: 'TB001',
      },
    });

    const user = await prisma.user.create({
      data: {
        email: 'test@school.com',
        name: 'Test Admin',
        role: 'BRANCH_ADMIN',
        organizationId: 'test-org',
      },
    });

    authToken = generateJWT({
      userId: user.id,
      role: user.role,
      branchId: testBranch.id,
    });

    // Create test student with fee assignment
    // ... (setup code)
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.payment.deleteMany({ where: { branchId: testBranch.id } });
    await prisma.feeAssignment.deleteMany({});
    await prisma.student.deleteMany({ where: { branchId: testBranch.id } });
    await prisma.branch.delete({ where: { id: testBranch.id } });
    await prisma.$disconnect();
  });

  it('POST /api/fees/collect - should record payment', async () => {
    const response = await request(app)
      .post('/api/fees/collect')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        feeAssignmentId: testFeeAssignment.id,
        studentId: testStudent.id,
        branchId: testBranch.id,
        amount: 5000,
        paymentMode: 'CASH',
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.payment).toBeDefined();
    expect(response.body.data.receiptUrl).toMatch(/\/uploads\/receipts\/.+\.pdf/);
  });

  it('POST /api/fees/collect - should reject without auth', async () => {
    await request(app)
      .post('/api/fees/collect')
      .send({
        feeAssignmentId: testFeeAssignment.id,
        amount: 5000,
      })
      .expect(401);
  });
});
```

---

### 8.3 E2E Testing (Playwright)

```typescript
// e2e/tests/feePayment.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Fee Payment Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('http://localhost:3000/auth/login');
    await page.fill('input[name="email"]', 'parent@test.com');
    await page.fill('input[name="password"]', 'Test@123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test('Parent can view pending fees', async ({ page }) => {
    await page.goto('/dashboard/fees');
    
    // Check fee list is visible
    await expect(page.locator('h2:has-text("Pending Fees")')).toBeVisible();
    
    // Check at least one fee is displayed
    const feeItems = page.locator('[data-testid="fee-item"]');
    await expect(feeItems.first()).toBeVisible();
  });

  test('Parent can pay fee online', async ({ page }) => {
    await page.goto('/dashboard/fees');
    
    // Click "Pay Now" on first fee
    await page.click('[data-testid="fee-item"]:first-child button:has-text("Pay Now")');
    
    // Razorpay modal should open (in test mode, we mock it)
    await page.waitForSelector('[data-testid="payment-confirmation"]');
    
    // Verify payment success message
    await expect(page.locator('text=Payment Successful')).toBeVisible();
    
    // Verify receipt download button
    await expect(page.locator('button:has-text("Download Receipt")')).toBeVisible();
  });

  test('Parent can download receipt', async ({ page }) => {
    await page.goto('/dashboard/fees/history');
    
    // Click download on first payment
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="download-receipt"]:first-child'),
    ]);
    
    // Verify file is PDF
    expect(download.suggestedFilename()).toMatch(/^receipt-.+\.pdf$/);
  });
});
```

**Run E2E Tests**

```bash
# Install Playwright
npm install -D @playwright/test
npx playwright install

# Run tests
npx playwright test

# Run with UI
npx playwright test --ui

# Generate report
npx playwright show-report
```

---

### 8.4 Load Testing (k6)

```javascript
// load-tests/fee-payment.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 500 },  // Ramp up to 500 users
    { duration: '5m', target: 500 },  // Stay at 500 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.01'],    // Error rate < 1%
  },
};

const BASE_URL = 'https://your-domain.com/api';
const AUTH_TOKEN = 'your-test-token';

export default function () {
  const headers = { Authorization: `Bearer ${AUTH_TOKEN}` };

  // 1. Get pending fees
  let res = http.get(`${BASE_URL}/fees/student/student-1/pending`, { headers });
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });

  sleep(1);

  // 2. Record payment
  const payload = JSON.stringify({
    feeAssignmentId: 'fa-1',
    studentId: 'student-1',
    branchId: 'branch-1',
    amount: 5000,
    paymentMode: 'CASH',
  });

  res = http.post(`${BASE_URL}/fees/collect`, payload, { headers });
  check(res, {
    'payment recorded': (r) => r.status === 200,
    'receipt generated': (r) => r.json('data.receiptUrl') !== '',
  });

  sleep(2);
}
```

**Run Load Test**

```bash
# Install k6
# macOS: brew install k6
# Linux: sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
#        echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
#        sudo apt-get update && sudo apt-get install k6

# Run test
k6 run load-tests/fee-payment.js

# Output:
#   ✓ status is 200
#   ✓ response time < 200ms
#   ✓ payment recorded
#   
#   checks.........................: 99.87% ✓ 14981  ✗ 19
#   http_req_duration..............: avg=124ms p(95)=287ms
#   http_reqs......................: 15000  250/s
```

---

### 8.5 Security Testing

#### OWASP ZAP (Automated Scan)

```bash
# Install OWASP ZAP
docker pull owasp/zap2docker-stable

# Run baseline scan
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t https://your-domain.com \
  -r security-report.html

# Run full scan
docker run -t owasp/zap2docker-stable zap-full-scan.py \
  -t https://your-domain.com \
  -r full-report.html
```

#### Manual Penetration Testing Checklist

- [ ] **SQL Injection**: Try `' OR '1'='1` in all input fields
- [ ] **XSS**: Try `<script>alert('XSS')</script>` in text fields
- [ ] **CSRF**: Test without CSRF tokens
- [ ] **IDOR**: Try accessing other students' fees with different IDs
- [ ] **Authentication bypass**: Test JWT expiration, invalid tokens
- [ ] **File upload**: Try uploading PHP/executable files
- [ ] **Rate limiting**: Send 1000 requests/second
- [ ] **SSL/TLS**: Test with ssllabs.com (aim for A+ rating)

---

### Phase 8 Deliverables
- [ ] Unit tests: 80%+ coverage (backend + frontend)
- [ ] Integration tests: All critical API flows
- [ ] E2E tests: 20+ user scenarios (Playwright)
- [ ] Load test: 1000 concurrent users (k6)
- [ ] Security scan: Zero critical vulnerabilities (OWASP ZAP)
- [ ] Manual penetration test report
- [ ] Performance test: All pages < 2s load time

### Phase 8 Success Metrics
- 🧪 **80%+ test coverage**
- ✅ **All tests passing**
- ⚡ **API p95 < 200ms under load**
- 🔒 **Zero critical security issues**
- 🚀 **Page load < 2 seconds**

---


## 📊 OVERALL TIMELINE & RESOURCE ALLOCATION

### Timeline Summary (Optimistic vs Realistic)

| Phase | Features | Optimistic | Realistic | Priority |
|-------|----------|------------|-----------|----------|
| **Phase 1** | Communication (SMS/WhatsApp/Email) | 3 weeks | 4 weeks | 🔴 CRITICAL |
| **Phase 2** | Certificates & Documents | 3 weeks | 4 weeks | 🔴 HIGH |
| **Phase 3** | Mobile Apps (Parent + Teacher) | 10 weeks | 12 weeks | 🔴 CRITICAL |
| **Phase 4** | Security & Performance | 3 weeks | 4 weeks | 🔴 CRITICAL |
| **Phase 5** | RFID Attendance | 3 weeks | 4 weeks | 🟡 HIGH |
| **Phase 6** | Analytics & Reports | 3 weeks | 4 weeks | 🟡 MEDIUM |
| **Phase 7** | Production Deployment | 2 weeks | 3 weeks | 🔴 CRITICAL |
| **Phase 8** | Testing & QA (Parallel) | 2 weeks | 3 weeks | 🔴 CRITICAL |
| **Total** | | **29 weeks (7 months)** | **38 weeks (9-10 months)** | |

### Team Allocation

#### Minimum Viable Team (Aggressive Timeline)
- **1 Full-stack Developer** (Backend + Frontend)
- **1 Mobile Developer** (React Native)
- **1 DevOps Engineer** (Part-time, last 2 months)

**Timeline**: 10-12 months

---

#### Recommended Team (Balanced)
- **1 Backend Developer** (Node.js + Prisma)
- **1 Frontend Developer** (Next.js + React)
- **1 Mobile Developer** (React Native)
- **1 DevOps Engineer** (Part-time)
- **1 QA Engineer** (Part-time, last 3 months)

**Timeline**: 7-9 months

---

#### Optimal Team (Fast Delivery)
- **2 Backend Developers**
- **1 Frontend Developer**
- **1 Mobile Developer**
- **1 DevOps Engineer** (Full-time)
- **1 QA Engineer** (Full-time)
- **1 UI/UX Designer** (Part-time)

**Timeline**: 5-6 months

---

## 💰 Cost Estimation

### Development Costs (India)

| Role | Rate (per month) | Duration | Total |
|------|------------------|----------|-------|
| Backend Developer | Rs 80,000 | 8 months | Rs 6,40,000 |
| Frontend Developer | Rs 75,000 | 7 months | Rs 5,25,000 |
| Mobile Developer | Rs 90,000 | 12 weeks | Rs 2,70,000 |
| DevOps Engineer | Rs 1,00,000 | 3 months | Rs 3,00,000 |
| QA Engineer | Rs 60,000 | 3 months | Rs 1,80,000 |
| **Total Development** | | | **Rs 19,15,000** |

### Infrastructure Costs (Monthly)

#### Option A: Hostinger VPS
| Item | Cost (per month) |
|------|------------------|
| VPS Business Plan (8GB RAM, 4 CPU) | Rs 800 |
| Domain (.com) | Rs 100 |
| SSL Certificate | Free (Let's Encrypt) |
| **Total** | **Rs 900/month** |

#### Option B: AWS Cloud
| Item | Cost (per month) |
|------|------------------|
| RDS PostgreSQL (db.t3.medium) | Rs 4,500 |
| ECS Fargate (2 tasks) | Rs 6,000 |
| ElastiCache Redis | Rs 2,500 |
| S3 Storage (100GB) | Rs 200 |
| CloudFront CDN | Rs 1,000 |
| Load Balancer | Rs 2,000 |
| **Total** | **Rs 16,200/month** |

### Third-party Services (Monthly)

| Service | Cost (per month) |
|---------|------------------|
| SMS Gateway (MSG91) - 10,000 SMS | Rs 1,500 |
| WhatsApp Business API (Interakt) | Rs 3,000 |
| SendGrid Email - 100k emails | Rs 1,200 |
| Razorpay (Transaction fee 2%) | Variable (Rs 20k for Rs 10L) |
| Google Maps API (Transport tracking) | Rs 2,000 |
| New Relic/Datadog APM | Rs 5,000 |
| Sentry (Error tracking) | Rs 1,500 |
| **Total** | **Rs 14,200/month** |

### One-time Costs

| Item | Cost |
|------|------|
| RFID Readers (10 devices) | Rs 1,50,000 |
| RFID Cards (5000 cards) | Rs 50,000 |
| App Store Developer Account | $99/year (Rs 8,000) |
| Google Play Developer Account | $25 (Rs 2,000) |
| SSL Wildcard Certificate (optional) | Rs 5,000/year |
| **Total** | **Rs 2,15,000** |

### Grand Total

| Category | Amount |
|----------|--------|
| Development (8 months) | Rs 19,15,000 |
| Infrastructure (8 months) | Rs 1,13,600 (AWS) / Rs 7,200 (Hostinger) |
| Third-party Services (8 months) | Rs 1,13,600 |
| One-time Costs | Rs 2,15,000 |
| **TOTAL** | **Rs 22,57,200 (AWS)** / **Rs 21,50,800 (Hostinger)** |

---

## 🎯 Phase Execution Strategy

### Strategy 1: Sequential (Safe)
```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
               ↓ (parallel after Phase 4)
             Phase 8 (Testing)
```
**Timeline**: 10 months  
**Risk**: Low  
**Best for**: Small team (1-2 developers)

---

### Strategy 2: Parallel (Fast) - RECOMMENDED
```
Phase 1 ─┐
Phase 2 ─┼─→ Phase 3 (Mobile) ─┐
Phase 4 ─┘                     ├─→ Phase 7 (Deploy)
Phase 5 ─┐                     │
Phase 6 ─┘                     │
Phase 8 (Testing) ─────────────┘ (parallel throughout)
```
**Timeline**: 6-7 months  
**Risk**: Medium  
**Best for**: Team of 3-4 developers

---

### Strategy 3: MVP First (Recommended for Budget Constraints)

**Stage 1: Core MVP (3-4 months)**
- Phase 1: Communication (SMS/WhatsApp) ✅
- Phase 2: Basic certificates (TC only) ✅
- Phase 4: Security & Performance ✅
- Phase 7: Production deployment ✅

**Launch MVP** → Get user feedback → Iterate

**Stage 2: Mobile Apps (3 months)**
- Phase 3: Parent app only

**Stage 3: Advanced Features (2-3 months)**
- Phase 5: RFID Attendance
- Phase 6: Analytics

**Total**: 8-10 months (with breathing room between stages)

---

## 🚦 Go/No-Go Decision Points

### Checkpoint 1: After Phase 1 (Week 4)
**Criteria**:
- ✅ SMS delivery rate > 95%
- ✅ WhatsApp template approval received
- ✅ Email deliverability > 98%
- ✅ Fee collection improves by 10%+ (early indicator)

**Decision**: Proceed to Phase 2 or re-prioritize

---

### Checkpoint 2: After Phase 4 (Week 14)
**Criteria**:
- ✅ API response time < 200ms (p95)
- ✅ Zero critical security vulnerabilities
- ✅ Test coverage > 70%
- ✅ Redis caching working

**Decision**: Proceed to production deployment or fix issues

---

### Checkpoint 3: Mobile App Beta (Week 22)
**Criteria**:
- ✅ 50+ parents testing beta
- ✅ App rating > 4.0
- ✅ Crash rate < 1%
- ✅ Core features working (fees, attendance)

**Decision**: Public launch or iterate based on feedback

---

## 📈 Success Metrics (Post-Launch)

### Month 1 (Post-Launch)
- 📱 Parent app downloads: 1000+
- 💰 Fee collection rate: +15% improvement
- 📊 API uptime: > 99.5%
- 🐛 Critical bugs: < 10

### Month 3
- 📱 Parent app adoption: > 60%
- 💰 Fee collection rate: +30% improvement
- 📊 API uptime: > 99.9%
- ⭐ App rating: > 4.5
- 🚀 Page load time: < 2 seconds

### Month 6
- 📱 Parent app adoption: > 80%
- 💰 Fee collection rate: +40% improvement
- 📊 100% feature adoption by staff
- 🏆 Zero security incidents
- 💼 Paying customers: 5+ schools

---

## 🛠️ Development Best Practices

### Code Review Checklist
- [ ] **Security**: No SQL injection, XSS, CSRF vulnerabilities
- [ ] **Performance**: No N+1 queries, proper indexing
- [ ] **Testing**: Unit tests added for new features
- [ ] **Documentation**: API endpoints documented
- [ ] **Error handling**: All errors caught and logged
- [ ] **Validation**: Input validation on both frontend and backend
- [ ] **Accessibility**: WCAG 2.1 AA compliance
- [ ] **Mobile responsive**: Works on all screen sizes

### Git Workflow
```bash
main (production)
  ↓
develop (staging)
  ↓
feature/sms-integration
feature/certificate-generation
fix/payment-bug
```

**Branch naming**:
- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `test/` - Adding tests
- `docs/` - Documentation updates

**Commit message format**:
```
type(scope): subject

body (optional)

footer (optional)
```

Example:
```
feat(fees): add WhatsApp payment reminders

- Integrate Interakt WhatsApp API
- Add template for fee reminder
- Queue WhatsApp messages via Bull

Closes #123
```

---

## 📚 Documentation Required

### Technical Documentation
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Database schema documentation
- [ ] Architecture diagrams
- [ ] Deployment guide
- [ ] Troubleshooting guide
- [ ] Security policies

### User Documentation
- [ ] Admin user guide
- [ ] Teacher manual
- [ ] Parent app guide
- [ ] Video tutorials (5-10 minutes each)
- [ ] FAQ section

---

## 🎓 Training Plan

### Admin Training (2 days)
**Day 1**:
- System overview
- Student admission process
- Fee structure setup
- Staff management
- Report generation

**Day 2**:
- Accounting module
- Certificate generation
- Device management (RFID)
- Troubleshooting common issues

### Teacher Training (1 day)
- Attendance marking (manual + RFID)
- Homework creation
- Marks entry
- Communication with parents
- Mobile app usage

### Parent Orientation (1 hour webinar)
- App installation
- Fee payment
- Viewing attendance & marks
- Chatting with teachers

---

## 🔄 Maintenance & Support Plan

### Post-Launch Support (First 3 months)
- **24/7 Critical bug fixes** (< 2 hours response)
- **Daily monitoring** (uptime, performance)
- **Weekly feature updates** (based on feedback)
- **Bi-weekly training sessions**

### Ongoing Maintenance
- **Monthly security updates**
- **Quarterly feature releases**
- **Annual infrastructure review**
- **Continuous monitoring & optimization**

### Support Tiers
1. **Critical** (P0): System down, payment failures - Fix within 2 hours
2. **High** (P1): Major feature broken - Fix within 24 hours
3. **Medium** (P2): Minor bugs - Fix within 3 days
4. **Low** (P3): Feature requests - Plan for next release

---

## 🎉 Final Recommendation

### For Immediate Start (Next 2 Weeks)
**PHASE 1: Communication Integrations**
- Week 1: SMS (MSG91)
- Week 2: WhatsApp (Interakt)
- Week 3: Email enhancement (SendGrid)
- Week 4: Push notifications (FCM)

**Why Start Here?**
- ✅ Highest ROI (30-40% fee collection improvement)
- ✅ Immediate business impact
- ✅ Low technical risk
- ✅ No hardware dependencies
- ✅ Can be done by 1 backend developer

**Expected Outcome**: Within 1 month, you'll have real-time communication with parents, automated fee reminders, and significantly improved fee collection.

---

## 📞 Next Steps

1. **Review this document** with your team
2. **Choose a phase strategy** (Sequential/Parallel/MVP-first)
3. **Allocate team resources**
4. **Set up project management** (Jira/Linear/GitHub Projects)
5. **Kick off Phase 1** 🚀

**Ready to start implementation?** Let me know which phase you want to begin with, and I can help you:
- Write detailed technical specifications
- Set up the development environment
- Implement the features step-by-step
- Review code and provide feedback

---

**Document Version**: 1.0  
**Last Updated**: January 2025  
**Maintained by**: School ERP Development Team

