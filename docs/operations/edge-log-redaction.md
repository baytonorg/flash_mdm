# Edge credential header redaction

The outer Flash proxy has separate access and error log encoders. Both must omit
`X-Api-Key`, `X-Internal-Secret`, `X-Migration-Secret` and `X-Bootstrap-Secret`.
These are accepted authentication headers in the application. Caddy's default
sensitive-header protection covers standard authorisation and cookie headers,
so the application-specific headers need explicit filter rules.

The isolated fixture preserves the complete two encoder bodies, including the
existing query, bearer-route, Referer and Location rules. It uses inert markers,
two loopback ports and disposable files. Its baseline removes only the four
custom-header rules. Both child commands receive isolated HOME/config/data paths,
and synthetic configuration persistence is disabled. The baseline
must expose the original defect in both loggers. The
corrected variant must omit all markers for successful, denied and upstream-error
responses while forwarding both mixed-case duplicate header values unchanged.

Run `python3 scripts/test-edge-log-redaction.py --caddy /path/to/caddy` with Caddy
2.11.4. Add `--production-config /private/path/Caddyfile.candidate` to require exact
encoder-body equivalence before applying a private infrastructure repair. The full
shared proxy config, routes and upstream addresses are not repository fixtures.
The focused PR CI job runs the real runtime; ordinary mocked application tests
alone do not validate edge redaction.

For a host-only repair, record the reviewed complete configuration hashes and
patch, exact private PR head and both CI results, full-config Caddy validation and
adapted-JSON equivalence, independent Astra receipt and hot-reload outcome. Verify
an unauthenticated live route with inert headers after reload and verify health
and forwarding. No credential needs to be created, read, renewed or changed.
If validation fails before reload, retain the original config. If post-reload
validation fails, restore the exact saved config and reload it, then confirm
restoration. Never edit retained logs as part of this repair.

This procedure addresses current active logging. It does not resume retired
historical-log investigation, establish historical exposure, or authorise log
retention/permission changes or credential lifecycle actions.

Primary reference: [Caddy access logging and filter rules](https://caddyserver.com/docs/caddyfile/directives/log).
