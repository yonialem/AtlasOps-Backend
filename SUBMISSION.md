# Submission Instructions

Submit the assignment within **72 hours** of receiving it.

## Required Submission Links

1. **Git Repository URLs:**
   - **Frontend Repository:** [https://github.com/yonialem/AtlasOps-Frontend](https://github.com/yonialem/AtlasOps-Frontend) (Branch: `develop` / `main`)
   - **Backend Repository:** [https://github.com/yonialem/AtlasOps-Backend](https://github.com/yonialem/AtlasOps-Backend) (Branch: `develop` / `main`)
2. **Working Deployment URL:**
   - **Live Frontend Application (Vercel):** [https://atlasops-frontend-git-develop-yonialem3s-projects.vercel.app](https://atlasops-frontend-git-develop-yonialem3s-projects.vercel.app)
3. **Working API / Mock API Reference:**
   - **Live Backend API (Render):** [https://atlasops-backend.onrender.com](https://atlasops-backend.onrender.com)
   - **Health Check Probe:** [https://atlasops-backend.onrender.com/api/health](https://atlasops-backend.onrender.com/api/health)
   - **API Specification (Backend Git):** [https://github.com/yonialem/AtlasOps-Backend/blob/main/docs/api_spec.md](https://github.com/yonialem/AtlasOps-Backend/blob/main/docs/api_spec.md)
   - **Mock API Specification (Backend Git):** [https://github.com/yonialem/AtlasOps-Backend/blob/main/docs/MOCK_API.md](https://github.com/yonialem/AtlasOps-Backend/blob/main/docs/MOCK_API.md)
4. **CI/CD Pipeline:**
   - **Frontend CI/CD Workflow (GitHub Actions):** [https://github.com/yonialem/AtlasOps-Frontend/blob/main/.github/workflows/ci.yml](https://github.com/yonialem/AtlasOps-Frontend/blob/main/.github/workflows/ci.yml) (179 frontend tests, typecheck, production build)
   - **Backend CI/CD Workflow (GitHub Actions):** [https://github.com/yonialem/AtlasOps-Backend/blob/main/.github/workflows/ci.yml](https://github.com/yonialem/AtlasOps-Backend/blob/main/.github/workflows/ci.yml) (181 backend tests, typecheck, production build)

The deployed application must be usable without access to private infrastructure.

## Repository Requirements

The repository must include:

- Source code.
- Setup instructions.
- Development command.
- Test command.
- Production build command.
- Environment variable documentation.
- Architecture notes.
- Known limitations.
- License information for copied assets, when applicable.
- A `.gitignore` that excludes secrets and generated dependencies.

## Candidate README

Your project README should include the following sections.

### 1. Overview

Briefly explain:

- What you built.
- The main user workflows.
- The selected technology stack.

### 2. Setup

Provide exact commands for:

```bash
install
run development server
run tests
run production build
start production build
```

The commands should work from a clean checkout.

### 3. Architecture

Explain:

- Project structure.
- Component boundaries.
- Data-fetching strategy.
- State ownership.
- URL state handling.
- Form architecture.
- Error handling.
- Testing strategy.
- Styling approach.

### 4. Important Decisions

Document at least three important trade-offs.

Examples:

- Why a particular framework was selected.
- Why a state library was or was not used.
- Why a table or card layout was selected.
- Why optimistic updates were implemented in a particular way.
- Why a dependency was introduced.
- Why a feature was intentionally excluded.

### 5. Performance

Describe:

- The dataset size used for testing.
- Any performance issue identified.
- Any optimization implemented.
- Any optimization intentionally avoided.

### 6. Accessibility

Describe:

- Keyboard behavior.
- Focus management.
- Form error handling.
- Any accessibility tooling used.
- Known accessibility limitations.

### 7. Testing

List:

- What is covered.
- What is not covered.
- Why those test levels were selected.

### 8. Incomplete Work

Clearly list:

- Missing requirements.
- Known bugs.
- Shortcuts.
- What you would implement next.

An honest incomplete section is better than hiding unfinished work.

## Commit History

We expect a readable Git history that shows how the solution evolved.

The history does not need to be perfect, but avoid submitting one unexplained commit containing the entire project.

## Deployment

The deployment must:

- Load without authentication.
- Avoid exposing secrets.
- Support the required workflows.
- Display a useful error if the mock API is unavailable.
- Work on a modern desktop browser.
- Be reasonably usable on a mobile viewport.

## Optional Submission Note

- **Focused Time Spent:** ~16 hours across architecture planning, contract-first API schema definition, full-fidelity mock engine, test-driven frontend/backend implementation, accessibility audits, and cloud deployment pipelines.
- **Proudest Area:** The resilient optimistic concurrency engine with bidirectional URL state synchronization and instant dual-cache updates. Concurrency conflicts (HTTP 409) and network drops are handled gracefully without losing operator drafts or corrupting cache state, while retaining a deterministic 1,048-incident test dataset and complete offline mutation FIFO queuing.
- **Largest Compromise:** Keeping the backend data store strictly in-memory with deterministic Mulberry32 PRNG seed rather than attaching an external PostgreSQL/SQLite database instance. This guaranteed zero external infrastructure friction and 100% reproducible test runs, but means data mutations reset on server restart.
- **Improvement With More Time:** Implement Server-Sent Events (SSE) or WebSockets (`GET /api/incidents/events`) for true multi-operator real-time collaboration with broadcasted live push updates and visual notifications when peer responders change incident status.

## Follow-Up Technical Review

Candidates may be asked to:

- Explain the architecture.
- Trace a user interaction through the code.
- Debug a failing request.
- Modify a component.
- Add a small feature.
- Explain a test.
- Identify a performance issue.
- Discuss accessibility behavior.
- Defend or reconsider a trade-off.

Submit only code you understand and can maintain.
