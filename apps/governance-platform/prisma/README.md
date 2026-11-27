# Database Seed Documentation

## Overview
The seed script populates the database with sample data for development and testing purposes.

## Running the Seed

### Local Development
```bash
# Run seed script directly
npm run db:seed

# Or use Prisma's built-in seed command
npx prisma db seed
```

### Docker Environment
The seed script runs automatically during the Docker build process after the database schema is pushed.

## Seeded Data

### Users (4 total)
- **admin@example.com** (ADMIN) - Admin User
- **user1@example.com** (USER) - Alice Johnson
- **user2@example.com** (USER) - Bob Smith
- **user3@example.com** (USER) - Carol Davis

### Projects (5 total)

#### PROPOSED (2 projects)
1. **AI-Powered Code Review Tool** - Automated code review system using ML (4 votes)
2. **Community Event Platform** - Platform for organizing local events (2 votes)

#### BUILDING (1 project)
3. **Personal Finance Tracker** - Expense tracking and budget management (2 votes)

#### DEPLOYED (2 projects)
4. **Recipe Sharing Network** - Social platform for sharing recipes (3 votes)
   - Preview URL: `/deployments/recipe-sharing-network`
5. **Open Source Documentation Hub** - Collaborative documentation platform (1 vote)
   - Preview URL: `/deployments/open-source-documentation-hub`

### Votes (12 total)
Votes are distributed across projects to simulate realistic usage patterns.

## Seed Behavior
- **Clears existing data**: The seed script wipes all existing records before inserting new data
- **Idempotent**: Can be run multiple times safely
- **Creates deployment directories**: For DEPLOYED projects, corresponding directories are created in `/deployments`

## Configuration
The seed configuration is defined in two places:
1. **package.json** - `prisma.seed` field
2. **prisma.config.ts** - `migrations.seed` field

Both point to `tsx prisma/seed.ts` to run the TypeScript seed file.
