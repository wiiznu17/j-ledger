# J-Ledger Portal – TODO / Code Health Checklist

> สแกนเมื่อ: 2026-06-03 (อัปเดตล่าสุด: 2026-09-15)
> สแกนโดย: Antigravity AI Pair Programmer

---

## 🔴 Critical — Security Issues (ต้องแก้ก่อน Production)

### SEC-01: Hardcoded Fallback Secrets
- [x] `apps/admin-web/src/lib/auth/jwt.ts:16` — JWT secret fallback `'jledger-admin-super-secret-2024-dev-key-32chars'` อยู่ใน source code ถ้าลืมตั้ง env variable ก็จะใช้ key นี้ใน production ได้
  - **Fix**: ให้ throw error ถ้า `ADMIN_JWT_SECRET` ไม่มี (เหมือนที่ proxy.ts ทำแล้ว)
- [x] `apps/portal-service/src/core/common/guards/internal-auth.guard.ts:15` — fallback secret `'jledger_ecosystem_secret_2024'` hardcoded ถ้าไม่ตั้ง env จะใช้ค่านี้
  - **Fix**: throw error เมื่อ `JLEDGER_INTERNAL_SECRET` ไม่มี
- [x] `apps/portal-service/src/modules/reporting/reporting.service.ts:22` — fallback `'default_internal_secret'` hardcoded
  - **Fix**: ให้ ConfigService throw error เมื่อไม่มีค่า
- [x] `apps/portal-service/prisma/seed.ts:562` — fallback `'default_internal_secret'` hardcoded ใน seed script → หาก seed ถูกรันใน production โดยไม่ตั้ง env จะใช้ค่านี้
  - **Fix**: throw error เมื่อ `JLEDGER_INTERNAL_SECRET` ไม่มี

### SEC-02: OTP/Token ถูก Log ใน Production
- [x] `apps/portal-service/src/modules/identity/services/user-security.service.ts:302` — เปลี่ยนเป็น `this.logger.warn` + เพิ่ม comment warning (เก็บ OTP ไว้ชั่วคราวเพราะยังไม่มีระบบส่งจริง)
- [x] `apps/portal-service/src/modules/identity/services/user-security.service.ts:535` — เปลี่ยนเป็น log masked token `PAY-XXXX...`
- [x] `apps/portal-service/src/modules/kyc/services/kyc-process.service.ts:145` — ลบ console.log เลขบัตรประชาชนเรียบร้อย
- [x] `apps/portal-service/src/modules/kyc/services/kyc-process.service.ts:192` — ลบ console.log ข้อมูล KYC และเปลี่ยนเป็น debug log ข้อความระบุสิทธิ์โดยไม่มี PII

### SEC-03: Insecure Random สำหรับ Security-Critical Operations
- [x] `apps/portal-service/src/modules/identity/services/user-security.service.ts:281` — ใช้ `Math.random()` สร้าง OTP → เปลี่ยนเป็น `crypto.randomInt()` เรียบร้อย
- [x] `apps/portal-service/src/modules/identity/services/user-profile.service.ts:191` — ใช้ `Math.random()` สร้าง OTP → เปลี่ยนเป็น `crypto.randomInt()` เรียบร้อย
- [x] `apps/portal-service/src/modules/identity/services/user-registration.service.ts:698` — ใช้ `Math.random()` สร้าง OTP → เปลี่ยนเป็น `crypto.randomInt()` เรียบร้อย
- [x] `apps/admin-web/src/lib/auth/csrf.ts:10` — ใช้ `Math.random()` สร้าง CSRF token → เปลี่ยนเป็น `crypto.randomBytes(16)` พร้อม HMAC-SHA256 เรียบร้อย
- [x] `apps/portal-service/src/modules/billing/billing.service.ts:54` — ใช้ `Math.random()` สร้าง Invoice number random part → เปลี่ยนเป็น `crypto.randomBytes(2).toString('hex').toUpperCase()` เรียบร้อย
- [x] `apps/portal-service/src/core/finance/finance.service.ts:379` — ใช้ `Math.random()` สร้าง Top-up reference ID → เปลี่ยนเป็น `crypto.randomUUID()` เรียบร้อย
- [x] `apps/portal-service/src/app.module.ts:44` — fallback Trace ID ใช้ `Math.random().toString(36).slice(2, 9)` → เปลี่ยนเป็น `crypto.randomUUID()` เรียบร้อย

### SEC-04: Cookie sameSite ไม่ได้ตั้งทั้งระบบ
- [x] `apps/admin-web/src/app/actions/auth.ts` — cookies ทั้งหมด (admin_session, refresh_token, user_id, user_role, user_permissions) และ `csrf.ts` (csrf_token) ตั้ง `sameSite: 'lax'` เรียบร้อยสอดคล้องกับ proxy.ts

### SEC-05: CSRF Token ไม่ปลอดภัย
- [x] `apps/admin-web/src/lib/auth/csrf.ts` — ปรับปรุงเป็น HMAC-SHA256 signing พร้อม `crypto.timingSafeEqual()` และ secure random bytes เรียบร้อย

### SEC-06: KYC ID Card Deduplication Bypass
- [x] `apps/portal-service/src/modules/kyc/services/kyc-process.service.ts:195,316-317` — ปรับให้ hash เฉพาะ clean idCardNumber ใน production เพื่อบังคับใช้ global deduplication และตรวจสอบความซ้ำซ้อนใน updateIdCardData

### SEC-07: CSRF Validation มี Destructuring Bug ⚠️ (ค้นพบเพิ่ม 2026-06-24)
- [x] `apps/admin-web/src/lib/auth/csrf.ts:24` — แก้ destructuring bug เป็น `const [timestampStr, random, signature] = parts` และตรวจ HMAC signature อย่างถูกต้อง

### SEC-08: Webhook & Settlement Simulation ใช้ Hardcoded Signature ('mock_signature_verified') ⚠️ (ค้นพบเพิ่ม 2026-09-15)
- [x] `apps/portal-service/src/core/finance/finance.service.ts:401,457` — คำนวณ HMAC-SHA256 signature จริงจาก request payload ด้วย secret key ระหว่าง service (`FINANCE_WEBHOOK_SECRET` / `JLEDGER_INTERNAL_SECRET`) แทน mock signature เรียบร้อย

---

## 🟠 High — Code Quality & Correctness

### CQ-00: Idempotency Key ใน Mobile App ถูกสุ่มใหม่ทุกครั้งที่กดปุ่ม
- [x] `apps/wallet-app/src/app/transfer/review.tsx:217` — ย้ายการสร้าง `idempotencyKey` ไปไว้ที่ `useState` เพื่อให้ Key ถูกสุ่มแค่ครั้งเดียวตอนเปิดหน้าจอ ป้องกันการหักเงินซ้ำเมื่อกด retry หรือเน็ตหลุดเรียบร้อย


### CQ-01: proxy.ts ตรวจ JWT ซ้ำซ้อน
- [ ] `apps/admin-web/src/proxy.ts:40-92` — เรียก `verifyToken()` (jose) แล้ว ก็ยังเรียก `jwtVerify()` อีกครั้งด้วย SECRET แยก → ซ้ำซ้อน ควรใช้ verifyToken ครั้งเดียว

### CQ-02: `any` Type ใช้มากเกินไป (~438 แห่ง)
- [ ] `apps/admin-web/src/lib/admin-api.ts` — หลาย function return `any` แทน typed response เช่น `findAll: (query: any)`, `apiClient.get<any>()`
- [ ] `apps/portal-service/src/modules/reporting/reporting.service.ts` — ใช้ `any` ในหลาย method
- [ ] Controllers หลายตัวใช้ `@Req() req: any` แทน typed request
- [ ] **Scope**: 438 instances ทั่วทั้ง project → ค่อยๆ fix เป็น sprint

### CQ-03: Console.log Debug Statements ต้องลบ
- [ ] `apps/portal-service/src/admin/finance/admin-finance.controller.ts:93,96` — `console.log(account)`, `console.log(error)` 
- [ ] `apps/portal-service/src/user/identity/identity.controller.ts:158-171` — log phone number และ login response
- [ ] `apps/portal-service/src/modules/admin/admin.service.ts:403` — `console.log('roleName', roleName)`
- [ ] `apps/admin-web/src/app/actions/auth.ts:41-96` — login flow มี console.log 8 บรรทัด
- [ ] `apps/admin-web/src/app/actions/system.ts:9` — `console.log('System Settings: ', response)`
- [ ] `apps/admin-web/src/app/(dashboard)/dashboard/page.tsx:177` — `console.log('Liquidity Stats:', liquidityStats)`
- [ ] `apps/admin-web/src/app/(dashboard)/system/admins/page.tsx:108` — `console.log('staffList', staffList)`
- [ ] `apps/portal-service/src/admin/strategies/admin-jwt.strategy.ts:20,25,36,43,48` — log cookies, JWT payload, staff validation — **5 จุด** (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/modules/identity/jwt.strategy.ts:21-23` — log JWT payload sub/typ (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/core/finance/finance.service.ts:512` — `console.log('transferByPhone', response.data)` — log transfer data (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/modules/merchant/services/merchant-settlement.service.ts:20,81` — `console.log('🌅 Starting daily merchant settlement...')`, `console.log('✅ Settlement completed.')` (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/admin-web/src/proxy.ts:48,60` — log token refresh attempts with userId (ค้นพบเพิ่ม 2026-06-24)
- [ ] **Action**: ทั้งหมดควรใช้ structured logger (Pino) แทน console.log, หรือลบออกถ้าเป็น debug

### CQ-04: Error Console Suppression (Anti-pattern)
- [ ] `apps/admin-web/src/app/(dashboard)/dashboard/page.tsx:42-56` — Override `console.error` และ `console.warn` เพื่อซ่อน error → ซ่อน bug จริง ควรแก้ที่ต้นเหตุ

### CQ-05: Swallowed Errors (Empty Catch Blocks)
- [ ] `apps/portal-service/src/modules/integration/services/transaction-history.service.ts:224,286,297` — `catch {}` ว่างเปล่า (3 จุด)
- [ ] `apps/portal-service/src/modules/integration/services/p2p-transfer.service.ts:520,531` — `catch {}` ว่างเปล่า (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/modules/merchant/services/merchant-application.service.ts:478` — `catch {}` ว่างเปล่า (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/modules/merchant/services/merchant-partner.service.ts:350` — `catch {}` ว่างเปล่า (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/admin/dashboard/admin-dashboard.controller.ts:105` — `catch {}` ว่างเปล่า (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/admin-web/src/app/(dashboard)/system/admins/page.tsx:116,201,220` — `catch {}` ไม่แสดง error
- [ ] `apps/admin-web/src/app/(dashboard)/system/roles/page.tsx:78` — `catch {}` ไม่ handle
- [ ] `apps/admin-web/src/app/(dashboard)/transactions/[id]/page.tsx:106` — `catch {}` ไม่ handle
- [ ] `apps/admin-web/src/components/dashboard/TransactionDetailDrawer.tsx:142` — `catch {}` ว่างเปล่า (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/wallet-app/src/lib/device.utils.ts:116` — `catch {}` ว่างเปล่า (ค้นพบเพิ่ม 2026-06-24)

### CQ-06: Incomplete Feature Implementations (TODO Comments)
- [ ] `apps/portal-service/src/modules/identity/services/user-admin.service.ts:210` — "TODO: Implement get suspicious activities logic"
- [ ] `apps/portal-service/src/modules/identity/services/user-admin.service.ts:215` — "TODO: Implement AMLO reporting logic"
- [ ] `apps/portal-service/src/modules/identity/services/user-security.service.ts:118` — "TODO: Implement device verification logic" → returns `{ success: true }` always
- [ ] `apps/portal-service/src/modules/identity/services/user-security.service.ts:346` — "TODO: Implement biometric challenge generation"
- [ ] `apps/portal-service/src/modules/identity/services/user-security.service.ts:351` — "TODO: Implement biometric verification logic" → returns `{ success: true }` always ⚠️ ปล่อยทุกคนผ่าน
- [ ] `apps/portal-service/src/modules/reporting/reporting.service.ts:158` — "TODO: Get all users from identity module" → return placeholder data
- [ ] `apps/admin-web/src/lib/auth/audit.ts:18` — "TODO: Send to admin-api for persistent storage" → audit log เขียนแค่ console.log

### CQ-07: DTO ที่ยัง TODO อยู่
- [ ] `apps/portal-service/src/user/merchant/dto/apply-merchant.dto.ts:27` — `@IsOptional() // TODO: Make optional temporarily, should be required in production`

### CQ-08: Fraud Rule Engine มี Logic ไม่สมบูรณ์ (Stub / Bypassed Rules) ⚠️ (ค้นพบเพิ่ม 2026-09-15)
- [x] `apps/portal-service/src/modules/fraud/fraud.service.ts` — เชื่อมต่อ Redis time-window counter สำหรับ Velocity check และเปรียบเทียบ deviceId กับฐานข้อมูล UserDevice เรียบร้อย
  - **Fix**: เชื่อมต่อกับ Redis / Database เพื่อทำ sliding window rate counter สำหรับ Velocity check และเปรียบเทียบ deviceId กับฐานข้อมูล `UserDevice`

### CQ-09: Admin Finance Sweep Stripe Balance ใช้ Mock Payout ID (ค้นพบเพิ่ม 2026-09-15)
- [ ] `apps/portal-service/src/admin/finance/admin-finance.controller.ts:434` — endpoint `POST /admin/finance/treasury/sweep-stripe` สร้าง `stripePayoutId = po_mock_${...}` สุ่มขึ้นมาเอง แล้วส่งยืนยันไปที่ finance gateway โดยไม่ได้เรียก `stripe.payouts.create()` จริงกับ Stripe API
  - **Fix**: เรียก Stripe API เพื่อสั่งจ่ายเงิน payout จริงไปยังบัญชีธนาคารของระบบก่อนนำ payout id มาบันทึกลงระบบ

### CQ-10: Local File S3 Service คืน Mock Buffer เมื่อไม่พบไฟล์ (ค้นพบเพิ่ม 2026-09-15)
- [x] `apps/portal-service/src/modules/kyc/services/s3.service.ts` — throw `NotFoundException` แทนการคืน mock buffer เมื่อไม่พบไฟล์ เรียบร้อย
  - **Fix**: throw `NotFoundException(`File ${key} not found`)` เมื่อไม่พบไฟล์ในดิสก์

### CQ-11: Wallet App Scheduled Transfer Date Picker ใช้ Mock UI (+1 Day Button) (ค้นพบเพิ่ม 2026-09-15)
- [x] `apps/wallet-app/src/app/transfer/index.tsx` — ติดตั้งและเชื่อมต่อ `@react-native-community/datetimepicker` เพื่อเลือกวันโอนเงินตามกำหนดเวลาได้จริงทั้ง iOS/Android แทนปุ่ม mock `+1 Day` เรียบร้อย
  - **Fix**: เชื่อมต่อ DatePicker Component จริง (เช่น `@react-native-community/datetimepicker` หรือ Calendar Modal)

### CQ-12: Wallet App My QR Silent Fallback to Mock User (ค้นพบเพิ่ม 2026-09-15)
- [x] `apps/wallet-app/src/app/my-qr.tsx` — ลบ silent fallback ไปหา MOCK_USER โดยใช้ข้อมูลจริงจาก user profile / email / account และ default logo เรียบร้อย
  - **Fix**: แสดง Loading spinner หรือ error screen เมื่อไม่พบข้อมูลผู้ใช้ แทนการแสดง QR ของ Mock User

---

## 🟡 Medium — Architecture & Readability

### ARCH-01: Audit Log ไม่ Persistent
- [ ] `apps/admin-web/src/lib/auth/audit.ts` — `logAuditEvent()` เขียนแค่ `console.log('[AUDIT]', ...)` ไม่ได้ส่งไป backend → ข้อมูล audit หายเมื่อ restart
  - **Fix**: ส่งไป `/api/admin/audit` endpoint

### ARCH-02: Rate Limit ฝั่ง Admin-Web เป็น In-Memory
- [ ] `apps/admin-web/src/lib/auth/rate-limit.ts` — ใช้ `Map` in-memory + `setInterval` cleanup → stateless, รีเซ็ตทุกครั้งที่ restart, ไม่ shared ข้าม instances
  - **Fix**: ควรใช้ Redis-backed rate limiting (backend มีอยู่แล้วใน ThrottlerModule)

### ARCH-03: Mock/Simple KYC Mode ยังเปิดอยู่
- [ ] `apps/portal-service/src/modules/kyc/services/kyc-process.service.ts:155-297` — `uploadIdCardSimple()` ใส่ hardcoded mock data (idCardNumber: '1234567890123', ชื่อ: สมชาย เข็มกลัด) → production ต้องมีวิธีปิด mock mode

### ARCH-04: Reporting Revenue Calculation Hardcoded
- [ ] `apps/portal-service/src/modules/reporting/reporting.service.ts:151` — `revenue: totalAmount * 0.01` // Assuming 1% fee → hardcoded
- [ ] `apps/portal-service/src/modules/reporting/reporting.service.ts:229` — `fallbackMdrYield = networkVolume * 0.03` hardcoded 3% MDR

### ARCH-05: `@ts-ignore` / `as any` Overuse (~161 instances)
- [ ] 161 instances ของ `as any`, `@ts-ignore`, `eslint-disable` → ลด type safety
- [ ] ควรค่อยๆ แก้เป็น proper types เป็น sprint

### ARCH-06: Inconsistent Error Patterns in Services
- [ ] `apps/portal-service/src/modules/kyc/services/kyc-admin.service.ts:37,156,162` — ใช้ `throw new Error(...)` แทน NestJS HttpException → GlobalExceptionFilter จะ return 500 แทน 400/409
- [ ] `apps/portal-service/src/modules/admin/admin.service.ts:206,244,275,428,538,549,562,575` — ใช้ `throw new Error(...)` 8 จุด (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/modules/loyalty/loyalty.service.ts:150,200,204` — ใช้ `throw new Error(...)` 3 จุด (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/modules/integration/services/stripe-integration.service.ts:107,179,241` — ใช้ `throw new Error(...)` 3 จุด (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/modules/merchant/services/merchant-application.service.ts:246,255` — ใช้ `throw new Error(...)` 2 จุด (ค้นพบเพิ่ม 2026-06-24)
- [ ] `apps/portal-service/src/modules/identity/identity.service.ts:386,409` — ใช้ `throw new Error(...)` 2 จุด (ค้นพบเพิ่ม 2026-06-24)
  - **Fix**: เปลี่ยนทั้งหมดเป็น `throw new BadRequestException(...)`, `ConflictException`, `NotFoundException` ตามบริบท
  - **Scope**: ~27 จุดทั่วทั้ง modules → ค่อยๆ fix เป็น sprint

### ARCH-07: Statement Export ส่งเป็น Plain Text ใน Kafka Event แทนไฟล์ PDF จริง (ค้นพบเพิ่ม 2026-09-15)
- [ ] `apps/portal-service/src/modules/admin/admin-approval.service.ts:166-178` — คอมเมนต์ระบุ `// Generate mock PDF attachment` แต่แท้จริงแล้วแปลงธุรกรรมเป็น string `txText` แล้วส่งลง `metadata.statementText` ผ่าน Kafka ไปยัง notification-worker โดยยังไม่มี PDF generation library (เช่น PDFKit / Puppeteer) และไม่ได้บันทึกไฟล์ขึ้น S3 เพื่อส่ง attachment จริง
  - **Fix**: สร้าง PDF generator service เพื่อสร้างไฟล์ PDF บัญชีรายการจริง อัปโหลดเข้า S3/Storage และส่งอีเมลพร้อม attachment หรือ pre-signed download URL

### ARCH-08: Notification Worker Email Service ขาด Retry & Error Tracking (ค้นพบเพิ่ม 2026-09-15)
- [ ] `apps/notification-worker/src/email/email.service.ts:35` — เมื่อ `nodemailer.sendMail()` ล้มเหลว มีเพียง `console.error` แล้ว throw ออกไปตรงๆ ขาดระบบ Dead Letter Queue (DLQ), exponential backoff retry และ structured error logging
  - **Fix**: ย้ายไปใช้ NestJS `Logger`, จัดการ retry หรือส่งเข้า Dead Letter Queue (Kafka) เพื่อป้องกันข้อความแจ้งเตือนสำคัญของลูกค้าสูญหาย

---

## 🟢 Low — Cleanup & Polish

### CLN-01: ลบ scratch/lint files
- [ ] `lint_output.txt` ใน project root → ควรอยู่ใน .gitignore
- [ ] `scratch/` directory ใน project root → ถ้าเป็น temp file ควร gitignore

### CLN-02: Unused Imports / Dead Code
- [ ] `apps/admin-web/src/proxy.ts:2` — import `{ jwtVerify } from 'jose'` ถูกใช้ซ้ำกับ `verifyToken` → ลบ direct import ได้
- [ ] สแกนด้วย `eslint --fix` เพื่อหา unused imports

### CLN-03: Missing Test Coverage
ส่วนที่ไม่มี test:
- [ ] Admin auth controller (login, refresh, logout, reset-password flows)
- [ ] Admin dashboard controller
- [ ] Admin merchant controller
- [ ] All admin-web server actions (auth.ts, transfer.ts, system.ts)
- [ ] Fraud service (fraud.service.ts)
- [ ] Scheduled transfer service
- [ ] User security service (PIN, biometric, device, pay-token flows)

### CLN-04: Hardcoded Dev URLs
- [ ] `apps/portal-service/src/modules/reporting/reporting.service.ts:18` — default `'http://localhost:8081'`
- [ ] `apps/admin-web/src/lib/api-config.ts:14-16` — default localhost/docker URLs
  - ไม่ใช่ bug แต่ควรมี validation ว่าต้องตั้ง env ใน production

### CLN-05: Pino Logger ถูกตั้งแต่ Console.log ยังใช้อยู่
- [ ] Backend ตั้ง `nestjs-pino` เป็น global logger แต่หลาย service/controller ยังใช้ `console.log` → ควร migrate ทั้งหมดให้ใช้ `this.logger.log()` / `this.logger.debug()`

### CLN-06: Inconsistent Thai/English Error Messages
- [ ] `apps/portal-service/src/modules/identity/services/user-security.service.ts:236` — `'รหัส PIN เดิมไม่ถูกต้อง'` (Thai)
- [ ] `apps/portal-service/src/modules/identity/services/user-security.service.ts:141` — `'User not found'` (English)
  - ควรใช้ error code + i18n message mapping ไม่ hardcode ภาษาใน service layer

---

## 🔵 Migrated from Root TODO (ย้ายมาจาก Root TODO.md — งานที่ยังไม่ทำ)

> ย้ายเมื่อ: 2026-07-10

### MIG-01: E2E Tests
- [ ] เขียน E2E tests สำหรับ critical API flows (Registration → Login → Transfer → Notification ครบ loop)

### MIG-02: Wallet App — ฟีเจอร์ที่ขาด

#### Bill Payment (จ่ายบิล)
- [ ] สร้างหน้า bill payment (ค่าน้ำ, ค่าไฟ, อินเทอร์เน็ต, มือถือ)
- [ ] Implement bill barcode scanning
- [ ] สร้าง biller directory
- [ ] Implement saved billers

#### Transfer Request (ขอเงิน)
- [ ] สร้าง `TransferRequest` model
- [ ] สร้าง request money flow (ส่ง request → ผู้รับเห็น notification → อนุมัติ/ปฏิเสธ)
- [ ] สร้าง UI screens

#### Merchant Nearby / Search
- [ ] สร้างหน้าค้นหาร้านค้าใกล้ตัว (Map view)
- [ ] Integrate location services
- [ ] แสดง merchant list + category filter

### MIG-03: Security Hardening
- [ ] เพิ่ม request logging middleware (automatic audit trail)
- [ ] ย้ายจาก `.env` files → secrets manager (AWS Secrets Manager / Vault)
- [ ] ตรวจสอบ JWT refresh token rotation implementation
- [ ] เพิ่ม CSRF protection สำหรับ admin-web

### MIG-04: DevOps & Observability
- [ ] ตั้งค่า Prometheus metrics endpoint (NestJS ฝั่ง Portal)
  - [ ] HTTP request duration
  - [ ] Active connections
  - [ ] Error rates
  - [ ] Business metrics (transactions/sec, active users)
- [ ] ตั้งค่า Sentry error tracking
- [ ] ตั้งค่า database backup automation (pg_dump cron)
- [ ] ตั้งค่า SSL cert auto-renewal (Let's Encrypt / cert-bot)
- [ ] สร้าง Grafana dashboards

### MIG-05: Performance & Scalability
- [ ] Tune Prisma connection pooling (connection_limit, pool_timeout)
- [ ] เพิ่ม Redis caching layer สำหรับ frequently read data
  - [ ] User profile cache
  - [ ] Deal catalog cache
  - [ ] Banner cache
  - [ ] Loyalty rules cache
- [ ] เพิ่ม database query optimization (EXPLAIN ANALYZE สำหรับ slow queries)
- [ ] เตรียม horizontal scaling config
  - [ ] Kubernetes / ECS manifest
  - [ ] Load balancer config
  - [ ] Sticky session / stateless design verification
- [ ] เพิ่ม CDN สำหรับ static assets (images, logos)
- [ ] Implement image optimization pipeline (resize, compress on upload)

### MIG-06: Admin Dashboard Optimization (Redis vs Read Replica)
- [x] **ปัญหา:** `AdminDashboardController` ทำงานหนักมาก คิวรีสด วนลูป LedgerEntries แบบ N+1 และสแกนรายการธุรกรรมสูงสุด 500 แถวมาคำนวณในแรมใหม่ทุกครั้งที่กดโหลดหน้า Dashboard
- [x] **แนวทางแก้ไข (Dual-Tier Strategy):**
  - [x] **1. เพิ่ม Redis caching สำหรับ Real-time Stat Cards (KPIs):**
    - [x] เก็บสะสมตัวเลขยอดเงินกองกลาง (Total System Balance), รายได้สะสม (Total Revenue), ภาษีคงค้าง (VAT Payable) และ Active Users ลง Redis
    - [x] ใช้ Event-driven update ผ่านการรับ Event จาก Kafka หรือใช้ Cron/Scheduled refresh ดึงจากฐานข้อมูลทุกๆ 1-5 นาที
  - [x] **2. ใช้ Read Replica สำหรับข้อมูลขนาดใหญ่และตารางกรองข้อมูล:**
    - [x] แยก Connection สำหรับคิวรีตารางธุรกรรมล่าสุด (Recent Transactions), กราฟยอดธุรกรรมย้อนหลัง 30 วัน (Historical charts) และคำขออนุมัติ KYC (KYC queue) ไปที่ Read Replica
    - [x] ใช้ `@Transactional(readOnly = true)` ใน Java Core หรือแบ่ง Read Pool ใน NestJS

---

## ℹ️ Notes

### สิ่งที่ทำได้ดีแล้ว ✅
- ✅ GlobalExceptionFilter มี standardized error envelope (`ApiErrorResponse`)
- ✅ Throttle/Rate limiting ครอบคลุม sensitive endpoints (login, OTP, PIN, biometric, account deletion)
- ✅ Helmet + CORS configured properly
- ✅ JWT refresh token hashing (bcrypt) stored in DB
- ✅ Swagger ปิดใน production
- ✅ CORS origin validation required in production
- ✅ PII encryption (idCardNumber, thaiName) ด้วย AES-256
- ✅ `ValidationPipe` with `whitelist: true` + `forbidNonWhitelisted: true`
- ✅ Admin JWT secret length validation (≥32 chars)
- ✅ Trust proxy configured
- ✅ Trace ID middleware for request tracking
- ✅ No `dangerouslySetInnerHTML` / `innerHTML` usage (XSS safe)
- ✅ `.env` files properly gitignored

