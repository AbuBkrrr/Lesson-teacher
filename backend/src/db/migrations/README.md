# Migrations

`../schema.postgres.sql` is the idempotent baseline — plain additions
(new tables, `ADD COLUMN IF NOT EXISTS`) can still go there.

Anything else (rename, drop, type change, data backfill) is a numbered file
here. Scaffold one with `npm run migrate:new -- add_something`. Files run once,
in order, each in its own transaction, at server start (and via
`npm run migrate`). Never edit a migration after it has shipped — add a new one.
