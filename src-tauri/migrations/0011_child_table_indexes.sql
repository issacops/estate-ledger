-- Indexes on the foreign-key columns the app filters and joins on. Without
-- them every per-row SUM(...) subquery and every cascading delete scans the
-- whole child table. Additive only: no data or behaviour changes.
CREATE INDEX IF NOT EXISTS idx_entry_row_buckets_row ON entry_row_buckets (row_id);
CREATE INDEX IF NOT EXISTS idx_entry_row_barrels_row ON entry_row_barrels (row_id);
CREATE INDEX IF NOT EXISTS idx_entry_row_barrels_barrel ON entry_row_barrels (barrel_id);
CREATE INDEX IF NOT EXISTS idx_invoice_barrels_invoice ON invoice_barrels (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_barrels_barrel ON invoice_barrels (barrel_id);
CREATE INDEX IF NOT EXISTS idx_labour_rows_day ON labour_rows (day_id);
CREATE INDEX IF NOT EXISTS idx_entry_rows_tapper ON entry_rows (tapper_id);
CREATE INDEX IF NOT EXISTS idx_invoices_buyer ON invoices (buyer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_estate_date ON purchases (estate_id, date);
CREATE INDEX IF NOT EXISTS idx_smokehouse_estate_date ON smokehouse_log (estate_id, date);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_vendor ON vendor_payments (estate_id, vendor_id);
