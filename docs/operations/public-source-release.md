# Public-source release process

The public repository at `baytonorg/flash_mdm` is an open-source distribution.
The private production repository and its deployment configuration remain the
release authority for `flash-mdm.bayton.org`.

Before publishing a private change:

1. Merge it through the private repository's protected `main` branch and passing
   `validate` check.
2. Compare the public branch against the intended commit. Exclude local tooling,
   credentials, customer data, production-only configuration, and private
   infrastructure details that are not needed by self-hosted users.
3. Open a public-repository pull request. Do not push directly to public `main`.
4. Require the public `validate` check and resolve review discussion before merge.
5. Confirm the public branch contains only the reviewed distribution changes.

The public repository must never be used as the source for the production
auto-deployment webhook. Production deployment credentials and the deployment
repository setting remain private.
