# `policy-derivative-cleanup.ts`

> Safely deletes obsolete AMAPI policy derivatives without losing the local retry record.

## Export

`deletePolicyDerivativeWhenUnused()` resolves the active devices in the derivative's former environment, group, or device scope. It reads each device from AMAPI and refuses deletion while `policyName` or `appliedPolicyName` still identifies the derivative.

After all authoritative reads are clear, it deletes the remote policy with safe idempotent retries. A definite 404 counts as complete. Any other read or delete uncertainty returns a deferred result, allowing callers to retain the local `policy_derivatives` row.

## Callers

- `policy-assign.ts` uses it after unassignment and device reassignment.
- `policy-crud.ts` uses it before single or bulk policy deletion.
