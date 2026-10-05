-- A block left untapped is not always a failure. On a rotation estate most
-- blocks simply are not due that day, and the register needs to say so rather
-- than borrowing a reason that means something went wrong.
--
-- sort_order -1 puts it first in the dropdown: it is the commonest reason of
-- all, six of nine blocks on a Kulashekaram day.
INSERT INTO config_lists (estate_id, kind, code, label, locked, sort_order)
SELECT e.id, 'reason', 'R7', 'Not scheduled', 0, -1
  FROM estates e
 WHERE NOT EXISTS (
   SELECT 1 FROM config_lists c
    WHERE c.estate_id = e.id AND c.kind = 'reason' AND c.code = 'R7'
 );
