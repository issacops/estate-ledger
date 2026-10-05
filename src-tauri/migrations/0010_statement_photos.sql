-- A photograph of the paper income & expenses register for one week or one
-- month, kept against that period. One photo per estate, kind and period start;
-- replacing it overwrites, removing it deletes the row.
CREATE TABLE statement_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  kind TEXT NOT NULL CHECK (kind IN ('week','month')),
  period_start TEXT NOT NULL,
  photo TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (estate_id, kind, period_start)
);
