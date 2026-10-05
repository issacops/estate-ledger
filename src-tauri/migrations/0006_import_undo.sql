-- An import can now be undone. `undo_json` records the id ranges each batch
-- created, per table, so removing a batch takes out exactly what it added and
-- nothing else. Batches imported before this column exists simply cannot be
-- undone — the app says so rather than guessing.
ALTER TABLE import_batches ADD COLUMN undo_json TEXT;
