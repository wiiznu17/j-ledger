# J-Ledger

![Java](https://img.shields.io/badge/Java-ED8B00?style=flat-square&logo=openjdk&logoColor=white)
![Spring Boot](https://img.shields.io/badge/Spring_Boot-6DB33F?style=flat-square&logo=spring-boot&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=flat-square&logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Apache_Kafka-231F20?style=flat-square&logo=apache-kafka&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)

J-Ledger is a high-performance, production-ready financial ledger system designed for consistency and scalability. The ecosystem uses a pragmatic monolithic architecture with two core services, simplifying deployment while allowing for faster development and strict domain isolation.

## System Architecture

The project is structured into two main components to ensure a clear separation of concerns between core financial operations and user-facing features:

1. **Finance Service (j-ledger-core)**
   - **Role:** The core ledger engine.
   - **Stack:** Java 21, Spring Boot
   - **Responsibilities:** Handles all critical financial logic including ledger entries, wallet management, transfers, transaction limits, settlements, fraud rules, and fee calculations. Only this service can mutate the state of money.

2. **Portal Service (j-ledger-portal)**
   - **Role:** The monolithic gateway and user-facing API.
   - **Stack:** Node.js, NestJS
   - **Responsibilities:** Manages identity, KYC processes, admin workflows, third-party integrations, audit logging, and reporting. It acts as a proxy, calling the Finance Service via HTTP REST APIs for any financial operations.

Additionally, the repository contains:
- `notification-worker`: A NestJS worker that consumes Kafka events for push notifications, emails, and SMS.
- `admin-web`: A React/Next.js dashboard for administrative management.
- `wallet-app`: A React Native/Expo application for end customers.

## Technology Stack

- **Backend:** Java 21 (Spring Boot), Node.js (NestJS)
- **Frontend:** React (Next.js), React Native (Expo)
- **Database:** PostgreSQL (with logical schemas for finance, identity, kyc, admin, integration)
- **Cache & Message Broker:** Redis, Apache Kafka, Zookeeper
- **Infrastructure:** Docker, Docker Compose, Nginx (for production routing)

## Prerequisites

To run this project locally, you will need:
- Docker and Docker Compose
- Node.js (v18+)
- Java 21 (for running the finance service locally outside of Docker)
- Maven (optional, wrapper provided)

## Getting Started (Local Development)

The recommended workflow for active development is the Hybrid Mode, where the infrastructure runs in Docker while the application code runs locally on your machine.

### 1. Start the Infrastructure

Bring up the databases, message broker, and cache:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis kafka zookeeper pgadmin
```

### 2. Configure the Environment

Copy the example environment file and populate it with your local values:
```bash
cp .env.example .env
```

### 3. Run the Services

Open separate terminal instances for each service.

**Finance Service (Java):**
```bash
cd j-ledger-core/finance-service
./mvnw spring-boot:run
```
*Note: Flyway database migrations run automatically on startup.*

**Portal Service (Node.js):**
```bash
cd j-ledger-portal/apps/portal-service
npm install
npm run dev
```

**Notification Worker (Node.js):**
```bash
cd j-ledger-portal/apps/notification-worker
npm install
npm run start:dev
```

## Documentation

Detailed architectural and technical guides can be found in the [`docs/`](docs/) directory:
- [`ABOUT_PROJECT.md`](docs/ABOUT_PROJECT.md): Project overview, scope, and services guide.
- [`DATABASE_DIAGRAM.md`](docs/DATABASE_DIAGRAM.md): Database schemas, relationships, and ERD.
- [`JAVA_CORE.md`](docs/JAVA_CORE.md): Java 21, Spring Boot, and Kafka core guide.
- [`KEY_SYSTEM_FLOWS.md`](docs/KEY_SYSTEM_FLOWS.md): Distributed locks, idempotency, and outbox flows.
- [`deployment-guide.md`](docs/deployment-guide.md): Deployment, Docker stack, and server configuration.
