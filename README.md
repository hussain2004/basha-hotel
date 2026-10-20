# Basha Hotel — Digital Menu & Order Management

A full-stack web application for a local hotel, designed to display menu items in Telugu and English and support online pickup orders and order management.

## Project Goals

- Provide a simple, mobile-friendly digital menu.
- Support Telugu and English language selection.
- Allow customers to place pickup orders.
- Enable order tracking through a secure order token.
- Provide protected staff and owner operations for managing orders.

## Technology Stack

### Frontend
- React
- TypeScript
- Vite
- HTML and CSS

### Backend
- Node.js
- Express.js
- REST APIs
- Express Session

### Database
- SQLite
- better-sqlite3

### Security
- Environment-based configuration for sensitive values
- Password-hash verification
- Session-based authentication for protected operations
- Token-based customer order tracking

## Current Features

- Digital menu with Telugu and English language support
- Customer order creation
- Order status tracking using an order-specific token
- Protected order-management endpoints
- SQLite database for persistent application data

## Run Locally

### 1. Install dependencies

Install the frontend dependencies:

```bash
npm install
```

Install backend dependencies if the server has its own package.json:

```bash
cd server
npm install
```

### 2. Configure environment variables

Create the required local environment configuration based on the variables expected by the server. Keep secrets out of Git.

Required variables include:
- `SESSION_SECRET`
- `OWNER_PASSWORD_HASH`

Use the project's existing configuration and startup instructions to determine any additional required values.

### 3. Start the application

Start the backend and frontend using the scripts configured in their respective package.json files.

## Project Status

Under development. Features, security checks, testing, and deployment preparation are ongoing.

## Developer

Shaik Mahaboob Hussain  
B.E. Computer Science and Engineering | 2026 Graduate

## Notes

This project is being developed as a practical portfolio project to demonstrate web development, REST API design, database integration, authentication, and order-management concepts.
