-- Fix list #1 and #11 — a sale now records two more weights next to the
-- estate's own scale reading:
--   formalin_kg  the formalin mixed into the latex before it left the estate
--   buyer_qty    what the buyer's own scale read at handover (nullable)
-- `qty` keeps meaning the estate's recorded weight, so stock, dispatch and the
-- barrel guard are untouched; money is derived from the billed weight.
ALTER TABLE invoices ADD COLUMN buyer_qty REAL;
ALTER TABLE invoices ADD COLUMN formalin_kg REAL;
