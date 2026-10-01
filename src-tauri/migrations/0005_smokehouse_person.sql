-- Fix list #6 — the smokehouse can be shared (e.g. with John), so each
-- movement records whose sheets it is. The three stage totals are shown per
-- person instead of one merged number. Old rows count as the estate's own.
ALTER TABLE smokehouse_log ADD COLUMN person TEXT NOT NULL DEFAULT 'Estate';
