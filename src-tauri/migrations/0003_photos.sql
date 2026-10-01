-- Fix list #4 — invoices and purchase bills carry their own photo, stored
-- the same way `entry_days.photo` and `cashbook.photo` are (a compressed
-- JPEG data URL).
ALTER TABLE invoices ADD COLUMN photo TEXT;
ALTER TABLE purchases ADD COLUMN photo TEXT;
