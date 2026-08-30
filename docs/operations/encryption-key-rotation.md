# Encryption master-key rotation

Flash MDM encrypts database-held credentials, TOTP material, API tokens, billing secrets, workspace OpenAI overrides, and short-lived MFA password-reset state with `ENCRYPTION_MASTER_KEY`. Changing the environment value alone makes that state unreadable. Use the transactional rekey tool whenever the key changes.

## Safety boundary

- Take a matching PostgreSQL and blob recovery point and record the active release before starting.
- Keep the old key in protected secret storage until post-rotation verification and the rollback window are complete.
- Stop the web service, queue worker, and every scheduled/background writer. The tool takes exclusive table locks and `--execute` requires an explicit maintenance confirmation.
- Apply all schema migrations first. Migration `056_magic_links_email_text` is required.
- Load old and new 32-byte keys into `OLD_ENCRYPTION_MASTER_KEY` and `NEW_ENCRYPTION_MASTER_KEY` only at runtime from protected storage. Do not put them in shell history, process arguments, logs, or the repository.

## Procedure

1. With the current key still active, validate a recent database/blob backup and stop all Flash writers.
2. Run `npm run maintenance:rekey` without `--execute`. This decrypts every supported carrier with the old key, creates and verifies a replacement envelope with the new key, then rolls the transaction back.
3. Run `npm run maintenance:rekey -- --execute --maintenance-confirmed`. Any failure rolls back the complete database transaction; output contains counts only.
4. Replace `ENCRYPTION_MASTER_KEY` in the deployment's protected environment atomically with the new key, retaining the old protected value for rollback. Do not use an installer rerun to generate it.
5. Start the web service, worker, and scheduled jobs. Check `/api/health`, then exercise Google credentials, TOTP/backup login, an API key, configured billing, and Flashi workspace override paths that exist in the deployment.
6. After the rollback window, retire the old key according to the secret-storage policy.

## Rollback

Before traffic resumes, the database transaction is the rollback boundary: a failed run leaves all old envelopes intact. After commit, either run the same tool in reverse while the old key is still retained, or restore the recorded database recovery point. The application environment and database envelopes must always use the same key generation.
