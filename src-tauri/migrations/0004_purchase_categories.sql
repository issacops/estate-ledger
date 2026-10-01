-- Fix list #5 — a purchase is categorised (Fertiliser / Weedicide / Tools /
-- Other, plus whatever Ninan adds), the same way a cashbook entry is.
ALTER TABLE purchases ADD COLUMN category_code TEXT NOT NULL DEFAULT '';
