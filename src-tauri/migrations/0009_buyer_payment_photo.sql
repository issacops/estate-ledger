-- The slip, cheque or transfer screenshot for a payment received from a buyer,
-- kept against the payment the same way an invoice keeps its own photo.
ALTER TABLE payments ADD COLUMN photo TEXT;
