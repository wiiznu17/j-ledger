# 📋 J-Ledger Core — Architecture Review & Improvement Roadmap (Remaining Tasks)

> **วันที่อัปเดตล่าสุด:** 10 กรกฎาคม 2026  
> **ขอบเขต:** `j-ledger-core/finance-service` (Java Spring Boot)  
> **จุดประสงค์:** รายการงานที่ยังต้องดำเนินการต่อเพื่อเพิ่มเสถียรภาพ ประสิทธิภาพ และสถาปัตยกรรมระดับ Production-grade

---

## 📊 สรุปจำนวนงานคงเหลือ

| Priority | จำนวนงานคงเหลือ | สถานะ |
|----------|:-----:|:-----:|
| 🔴 Critical (Priority 1) | 0 | ✅ สำเร็จทั้งหมด |
| 🟡 High (Priority 2) | 0 | ✅ สำเร็จทั้งหมด (Financial Precision) |
| 🟢 Medium (Priority 3) | 1 | `[ ]` รอทำ |
| 🔵 Nice-to-Have (Priority 4) | 5 | `[ ]` รอทำ |
| **รวมคงเหลือ** | **6** | |

---

## 🟡 Priority 2 — High (Financial Precision & Multi-leg Ledger Integrity)

### 2.1 เพิ่ม Banker's Rounding (HALF_EVEN) และ Rounding Difference Ledger
- [x] **ปัญหา:** 
  1. ปัจจุบันการคำนวณค่าธรรมเนียม (`P2PTransferService.java`) ใช้ `RoundingMode.HALF_UP` ซึ่งในการทำธุรกรรมปริมาณมาก (Scale ใหญ่) จะเกิดความเอนเอียงทางสถิติ (Statistical Bias) ปัดขึ้นมากกว่าปัดลง ทำให้ยอดเงินรวมทั้งระบบค่อยๆ บวมขึ้น
  2. การคำนวณทศนิยม 4 ตำแหน่งระดับ Sub-cent เมื่อถูกปัดเศษเหลือ 2 ตำแหน่ง หรือกรณีแบ่งจ่าย จะเกิดผลต่างเศษสตางค์ ($\pm 0.01$ บาท) ที่ทำให้ $\sum \text{Debit} \neq \sum \text{Credit}$ ส่งผลให้กระทบยอดบัญชี (Reconciliation) ปลายวันไม่ลงตัว
  3. บัญชี `AccountType.FEE` ถูกประกาศไว้แล้วแต่ยังไม่ได้ตัด Multi-leg (3 ขา) บันทึกรายได้ค่าธรรมเนียมแยกออกมาจากยอดโอนหลักอย่างสมบูรณ์
- [x] **แนวทางแก้ไข:**
  - [x] เปลี่ยนโหมดปัดเศษใน `P2PTransferService` และ `TreasuryServiceImpl` เป็น `RoundingMode.HALF_EVEN` (Banker's Rounding) ผ่าน `MonetaryRounding` utility
  - [x] เพิ่มประเภทบัญชีกองกลาง `AccountType.ROUNDING_DIFFERENCE` (ระบบ Asset/Liability พิเศษ) มารองรับเศษสตางค์ผลต่างจากการปัดเศษในระดับ Journal Entry (พร้อม migration `V10__add_system_fee_and_rounding_accounts.sql`)
  - [x] ปรับกลไก Double-entry ให้รองรับ Multi-leg Entry ผ่าน `recordMultiLegEntry()` ใน `WalletCommonService` เมื่อมี Fee หรือ Rounding Adjustment:
    - **DEBIT:** บัญชีผู้โอน (ยอดรวมทั้งสิ้น)
    - **CREDIT:** บัญชีผู้รับ/ระบบเคลียริ่ง (ยอดเงินโอนสุทธิ)
    - **CREDIT:** บัญชีค่าธรรมเนียม (`AccountType.FEE`)
    - **CREDIT / DEBIT:** บัญชีเศษสตางค์ปัดเศษ (`AccountType.ROUNDING_DIFFERENCE`)
  - [x] เพิ่ม Unit / Integration Test ตรวจสอบว่าทุก Entry $\sum \text{Debit} == \sum \text{Credit}$ เป็น 0 เสมอ แม้เจอเศษทศนิยมไม่รู้จบ (`MonetaryRoundingTest`, `MultiLegLedgerTest`, `WalletServiceTest$BillPaymentMultiLegTests`)

---

## 🟢 Priority 3 — Medium (ความถูกต้องและการทดสอบระดับระบบ)

### 3.2 เพิ่ม Integration Test ด้วย Testcontainers
- [ ] **ปัญหา:** ตอนนี้มี dependency `testcontainers` อยู่ใน `pom.xml` แล้ว แต่ยังไม่มี Integration Test จริงๆ มีแค่ Unit Tests
- [ ] **แนวทาง:** เขียน Integration Test สำหรับ Flow สำคัญ
  - `TransferIntegrationTest` — ทดสอบ Lock → Transfer → Outbox → Kafka ครบ Loop
  - `IdempotencyIntegrationTest` — ทดสอบ Duplicate Request ถูก Reject จริง
  - `ReconciliationIntegrationTest` — ทดสอบ Nightly Reconciliation ได้ผลลัพธ์ MATCHED

---

## 🔵 Priority 4 — Nice-to-Have (ทำให้เทียบเท่าระบบใหญ่ได้)

### 4.1 ปรับ Architecture เป็น Hexagonal (Ports & Adapters)
- [ ] **ปัญหา:** ปัจจุบันเป็น Layered Architecture แบบคลาสสิก (Controller → Service → Repository) ซึ่งทำให้ Business logic ผูกติด Framework
- [ ] **แนวทาง:** แยกเป็น Hexagonal Architecture
```text
src/main/java/com/jledger/finance/
├── domain/              ← Business Logic ล้วนๆ (ไม่ import Spring เลย)
│   ├── model/           ← Entity, Value Objects
│   ├── port/            ← Interface (Use Cases, Repository Ports)
│   └── service/         ← Domain Services (Pure Java)
├── application/         ← Use Case Orchestration
│   └── usecase/         ← TransferUseCase, TopUpUseCase
├── adapter/
│   ├── in/web/          ← Controllers (REST adapters)
│   ├── out/persistence/ ← JPA Repositories (DB adapters)
│   ├── out/messaging/   ← Kafka adapters
│   └── out/cache/       ← Redis adapters
└── config/              ← Spring Configuration
```

### 4.2 เพิ่ม Event Sourcing สำหรับ Audit Trail
- [ ] **ปัญหา:** ตอนนี้ใช้ `AuditLogService` เก็บ Log แต่ไม่สามารถ "Replay" เหตุการณ์ย้อนหลังได้
- [ ] **แนวทาง:** เก็บ Domain Events (TransferInitiated, TransferCompleted, BalanceChanged) เป็น Immutable Event Stream

### 4.3 เพิ่ม Prometheus Metrics + Grafana Dashboard
- [ ] **ปัญหา:** มี Actuator แล้ว แต่ยังไม่มี Custom Metrics
- [ ] **แนวทาง:** เพิ่ม `micrometer-registry-prometheus` แล้วสร้าง Custom Metrics:
  - `transfer_total` (Counter) — จำนวนการโอนเงินทั้งหมด
  - `transfer_duration_seconds` (Histogram) — เวลาที่ใช้ในการโอน
  - `lock_acquisition_failures_total` — จำนวนครั้งที่ขอ Lock ไม่ได้
  - `outbox_pending_events` (Gauge) — จำนวน Events ที่ค้างอยู่ใน Outbox

### 4.4 เพิ่ม Circuit Breaker สำหรับ External Dependencies
- [ ] **ปัญหา:** ป้องกันกรณี Redis/Kafka ล่มแล้วทำให้ทั้งระบบค้าง (Cascading Failure)
- [ ] **แนวทาง:** ใช้ Resilience4j เพื่อทำ Circuit Breaker ระหว่าง Core ↔ Redis, Core ↔ Kafka (ต้องคำนึงถึง Consistency ความถูกต้องของบัญชีเป็นหลัก)

### 4.5 Dockerfile Optimization
- [ ] **ปัญหา:** ปัจจุบัน Multi-stage แต่ไม่มี Layer caching และรัน App ด้วย Root user
- [ ] **แนวทาง:**
  - แยก `COPY pom.xml` → `RUN mvn dependency:go-offline` ก่อน COPY src (เพิ่ม Cache layer)
  - เพิ่ม Non-root user สำหรับ Runtime
  - ใส่ JVM Tuning flags (`-XX:+UseContainerSupport`, `-XX:MaxRAMPercentage=75`)
```dockerfile
# ✅ ปรับ Dockerfile ตัวอย่าง
FROM eclipse-temurin:21-jre AS runtime
RUN addgroup --system app && adduser --system --ingroup app app
USER app
COPY --from=build /app/target/finance-service-*.jar app.jar
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
```

### 4.6 เพิ่ม OpenAPI Documentation
- [x] **ปัญหา:** มี `springdoc-openapi` แต่ Controller ไม่มี `@Operation`, `@ApiResponse` annotations
- [x] **แนวทาง:** เพิ่ม Swagger annotations เพื่อให้ API Docs สมบูรณ์
