-- The slip, cheque counterfoil or transfer screenshot for a payment to a
-- vendor, kept against the payment the same way an invoice or a purchase bill
-- keeps its own photo (a compressed JPEG data URL).
ALTER TABLE vendor_payments ADD COLUMN photo TEXT;
