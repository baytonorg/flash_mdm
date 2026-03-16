# Reference

This folder contains inventories and reference-style documentation.

Key files:

- `environment-variables.md` — detailed table (inventory + classification + file refs)
- `environment-variables-curated.md` — grouped overview for operators/reviewers
- `endpoints.md` — routing index (from `netlify.toml`)
- `endpoints-detailed.md` — best-effort metadata extracted from handler code
- `tech-stack.md` — dependency overview
- `glossary.md` — definitions for project-specific terms

Generated inventories (read-only, produced by tooling):

- `env-inventory.json` / `env-references.json` — environment variable inventory and code reference map
- `functions-inventory.json` / `routes-inventory.json` — Netlify function list and route map
- `endpoints-metadata.json` — combined endpoint metadata (auth, RBAC, methods) extracted from handler code
