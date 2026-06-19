# ⚡ Swift Backend Engine

Welcome to the backend engine for **Swift**, an AI-driven service marketplace web app designed to connect individuals and businesses with verified experts, artisans, and tech specialists across Nigeria. 

This repository houses the production-grade REST API and WebSocket architecture built using **NestJS** and **MongoDB**.

---

## 🚀 Core Features Implemented

The backend is structured around the three core pillars of the Swift platform:

1. **AI-Powered Smart Matching Engine**
   - Implements geospatial queries (`2dsphere` indexes) to fetch local and remote providers.
   - Filters and ranks professionals based on budget, skills, availability, and user ratings.

2. **Secure Escrow Payment System**
   - Handles multi-state transaction flows: `Funded (In Escrow) ➔ Released (On Completion) ➔ Refunded (On Dispute)`.
   - Built with strict database transactions to protect both service seekers and professionals from fraud.

3. **Integrated Communication Suite**
   - Real-time chat messaging, file sharing, and typing indicators powered by WebSockets.
   - Signaling backend architecture to support in-app voice and video collaboration.

---

## 🛠️ Tech Stack & Architecture

- **Framework:** NestJS (Progressive Node.js framework)
- **Database:** MongoDB via Mongoose ODM (NoSQL database for flexible data schemas)
- **Real-Time:** Socket.io / WebSockets (For instant messaging and call signaling)
- **Security:** JWT (JSON Web Tokens), Multi-Factor Auth support, and bcrypt password hashing
- **Validation:** Class-validator & Class-transformer (Strict request/DTO vetting)

---

## 📈 Platform Target Metrics (Backend KPIs)
- **Time to Match:** Under 2 minutes via automated query routing.
- **Payment Success Rate:** 95%+ transactional stability.
- **Support Response Routing:** Under 30 minutes for live dispute management.
