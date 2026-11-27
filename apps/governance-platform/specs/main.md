# Governance Platform MVP Spec

## Goal
Build a local MVP of the "Governance Platform" where users can propose projects, vote on them, and admins can trigger their deployment.

## Tech Stack
-   **Framework**: Next.js (App Router).
-   **Database**: SQLite (for local MVP simplicity) or Postgres (via Docker). Let's use **SQLite** with **Prisma** for easiest local setup without external deps, or Postgres if preferred. *Decision: SQLite for zero-config local run.*
-   **Auth**: NextAuth.js with Google Provider.
-   **Styling**: TailwindCSS (Standard).
-   **Components**: Shadcn/UI (if available) or raw Tailwind.

## Features

### 1. Authentication & Roles
-   **Login**: "Sign in with Google".
-   **Roles**:
    -   `User`: Can propose, vote, view.
    -   `Admin`: Can managing deployments. (Hardcode specific emails as admins initially, e.g., the user's email).

### 2. Projects & Proposals
-   **Proposal Flow**:
    -   Button: "New Proposal".
    -   Form: Title, Description, Spec Body (Markdown editor preferred).
    -   Status: `PROPOSED` (default).
-   **Voting**:
    -   Upvote button on project cards.
    -   Sort projects by votes.

### 3. Dashboard (Main Page)
-   **Section 1: Active Deployments**
    -   List of projects with status `DEPLOYED` or `BUILDING`.
    -   Show "Preview" link if available.
    -   Preview opens in a Modal/Iframe or new tab.
-   **Section 2: Proposals**
    -   List of projects with status `PROPOSED`.
    -   Voting controls.

### 4. Admin Deployment Trigger
-   Admin sees "Deploy" button on `PROPOSED` projects.
-   **Action**:
    -   Clicking "Deploy" changes status to `BUILDING`.
    -   **Mock Backend Hook**: Simulates deployment by creating a folder: `deployments/<project-slug>`.
    -   Creates a dummy `index.html` in that folder saying "Project <name> deployed!".
    -   Updates status to `DEPLOYED` and sets `previewUrl`.

## Data Model (Schema)

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  role      String   @default("USER") // "ADMIN" | "USER"
  votes     Vote[]
}

model Project {
  id          String   @id @default(cuid())
  title       String
  description String
  spec        String   // Markdown content
  status      String   @default("PROPOSED") // PROPOSED, BUILDING, DEPLOYED
  previewUrl  String?
  createdAt   DateTime @default(now())
  votes       Vote[]
}

model Vote {
  id        String   @id @default(cuid())
  userId    String
  projectId String
  user      User     @relation(fields: [userId], references: [id])
  project   Project  @relation(fields: [projectId], references: [id])

  @@unique([userId, projectId])
}
```

## MVP Implementation Plan
1.  Initialize Next.js app.
2.  Setup Prisma with SQLite.
3.  Setup NextAuth (Google).
4.  Create "Propose" page.
5.  Create Dashboard.
6.  Implement "Deploy" server action (mkdir + status update).

## Configuration
-   Google Client ID/Secret will be needed in `.env`.
