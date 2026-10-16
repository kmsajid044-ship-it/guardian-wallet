# Audit

`AuditLog` stores append-only SQLite entries chained as
`sha256(prevHash + canonicalJSON({timestamp, kind, data}))`. Database triggers reject updates and
deletes; `verify()` independently recomputes every link. The API exposes this result at
`GET /audit/verify`.
