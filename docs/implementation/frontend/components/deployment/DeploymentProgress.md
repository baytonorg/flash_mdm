# `src/components/deployment/DeploymentProgress.tsx`

> Displays the progress of a policy deployment job with status, progress bar, error log, cancel/rollback actions, and timestamps.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeploymentProgress` | `default function` | Deployment job status widget with action buttons |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `jobId` | `string \| null` | No | ID of an existing deployment job to display |
| `policyId` | `string` | No | Policy ID for creating a new deployment |
| `environmentId` | `string` | No | Environment ID for creating a new deployment |
| `onJobCreated` | `(jobId: string) => void` | No | Callback when a new job is successfully created |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleDeploy` | 59-72 | Creates a new deployment job via `createMutation` and sets the active job ID |
| `handleCancel` | 74-77 | Cancels the active deployment job |
| `handleRollback` | 79-82 | Initiates a rollback on the active deployment job |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useDeploymentJob`, `useCreateDeployment`, `useCancelDeployment`, `useRollbackDeployment`, `DeploymentJob` | `@/api/queries/deployments` | Query and mutation hooks for deployment jobs |

## Key Logic

The component has three render states:

1. **No active job** -- if `policyId` and `environmentId` are provided, renders a "Deploy to Devices" button that creates a new job.
2. **Loading** -- shows a spinner while fetching job data.
3. **Active/completed job** -- renders a card with:

**Status header**: icon and label for eight statuses: `pending`, `running`, `completed`, `failed`, `cancelled`, `rolling_back`, `rolled_back`, `rollback_failed`. Icons animate (spin) for active statuses.

**Action buttons**: "Cancel" appears for pending/running jobs; "Rollback" appears for completed/failed jobs.

**Progress bar**: colour-coded (green for success-only, amber for mixed, red for failure-only). Shows completed/failed/skipped device counts and percentage.

**Error log**: expandable section with a toggle button showing error count. Each entry shows a truncated device ID and the error message.

**Timestamps**: started, completed, and cancelled times displayed at the bottom.
