# Data model (high level)

This page explains the major domains and where state lives.

## Core domains
- Workspaces, environments, users, memberships
- Devices (including lifecycle state)
- Policies and derivatives
- Groups
- Jobs / background processing
- Audit log

## Billing/licensing domains (if enabled)
- Plans, grants, entitlements
- Overage cases / enforcement actions
- Stripe linkage and webhook event deduplication

## AI assistant domains
- Chat messages (`flashagent_chat_messages`) scoped per environment+user
- Platform toggle (`platform_settings.assistant_enabled`)
- Per-environment toggle (`environments.enterprise_features` JSONB)

## Where to find details
- Migration SQL sources: `netlify/migrations/*.sql`
- Migration runner (inlined SQL, canonical): `netlify/functions/migrate.ts`
- Functions: `netlify/functions/*`
- Frontend pages: `src/pages/*`


## Table reference

- [Data model reference](./data-model-reference.md)
