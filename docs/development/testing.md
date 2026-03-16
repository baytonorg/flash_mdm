# Testing

## Unit/integration tests
- Test runner: Vitest
- Frontend component tests use `@testing-library/react` with jsdom
- Test setup file: `src/test/setup.ts` (imports `@testing-library/jest-dom/vitest`)

Common commands:
```bash
npm test                 # vitest run (single pass)
npm run test:watch       # vitest (watch mode)
npm run test:coverage    # vitest run --coverage (text + lcov reporters)
```

## Where tests live

- `netlify/functions/__tests__/` — function handler integration tests
- `netlify/functions/_lib/__tests__/` — shared lib unit tests
- `src/**/__tests__/` — frontend component and page tests

The Vitest config (`vitest.config.ts`) includes:
- `src/**/*.test.ts` and `src/**/*.test.tsx`
- `netlify/**/*.test.ts`

Coverage is collected from `src/**/*.{ts,tsx}`, `netlify/functions/_lib/**/*.ts`, and `netlify/functions/*.ts` (excluding test files).

## What the test suite covers (high level)
- Auth and MFA flows (password, TOTP, magic link, backup codes)
- RBAC and tenant isolation checks
- Function handler behaviour (API endpoints, webhooks, scheduled jobs)
- Background processing logic
- Frontend components (common UI, policy fields, pages, stores)
