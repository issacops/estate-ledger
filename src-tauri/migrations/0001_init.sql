CREATE TABLE estates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  profile_json TEXT NOT NULL,
  letterhead_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin','Staff')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tappers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Employee',
  tap_days INTEGER NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'Active',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  trees INTEGER NOT NULL DEFAULT 0,
  tapper_id INTEGER REFERENCES tappers(id),
  arrangement TEXT NOT NULL DEFAULT 'Direct',
  lease_rate REAL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (estate_id, code)
);

CREATE TABLE barrels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  code TEXT NOT NULL,
  capacity REAL NOT NULL DEFAULT 200,
  tare_weight REAL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (estate_id, code)
);

CREATE TABLE entry_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  date TEXT NOT NULL,
  weather TEXT NOT NULL DEFAULT '',
  supervisor TEXT NOT NULL DEFAULT '',
  page_no TEXT NOT NULL DEFAULT '',
  remarks TEXT NOT NULL DEFAULT '',
  photo TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (estate_id, date)
);

CREATE TABLE entry_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES entry_days(id) ON DELETE CASCADE,
  block_id INTEGER NOT NULL REFERENCES blocks(id),
  tapper_id INTEGER REFERENCES tappers(id),
  product_mode TEXT NOT NULL DEFAULT 'Latex' CHECK (product_mode IN ('Latex','Sheet')),
  status TEXT NOT NULL DEFAULT 'Completed' CHECK (status IN ('Completed','Not Done')),
  reason TEXT NOT NULL DEFAULT '',
  tapped_despite_rain INTEGER NOT NULL DEFAULT 0,
  trees_scheduled INTEGER NOT NULL DEFAULT 0,
  trees_tapped INTEGER NOT NULL DEFAULT 0,
  wet_sheets INTEGER NOT NULL DEFAULT 0,
  scrap_kg REAL NOT NULL DEFAULT 0,
  tare_kg REAL NOT NULL DEFAULT 0,
  sale_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (day_id, block_id)
);

CREATE TABLE entry_row_buckets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER NOT NULL REFERENCES entry_rows(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  kg REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE entry_row_barrels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id INTEGER NOT NULL REFERENCES entry_rows(id) ON DELETE CASCADE,
  barrel_id INTEGER NOT NULL REFERENCES barrels(id),
  kg REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE labour_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id INTEGER NOT NULL REFERENCES entry_days(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL DEFAULT '',
  men INTEGER NOT NULL DEFAULT 0,
  women INTEGER NOT NULL DEFAULT 0,
  work_type TEXT NOT NULL DEFAULT '',
  who TEXT NOT NULL DEFAULT '',
  where_ TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE smokehouse_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  date TEXT NOT NULL,
  wet_in INTEGER NOT NULL DEFAULT 0,
  dry_out INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  hub TEXT NOT NULL,
  date TEXT NOT NULL,
  qty_delta REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ref_table TEXT NOT NULL DEFAULT '',
  ref_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE buyers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  invoice_no TEXT NOT NULL,
  date TEXT NOT NULL,
  buyer_id INTEGER REFERENCES buyers(id),
  grade TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  paper_rate REAL,
  drc REAL,
  advance REAL NOT NULL DEFAULT 0,
  value REAL,
  status TEXT NOT NULL DEFAULT 'Final' CHECK (status IN ('Final','Pending DRC','Cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (estate_id, invoice_no)
);

CREATE TABLE invoice_barrels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  barrel_id INTEGER NOT NULL REFERENCES barrels(id),
  kg REAL NOT NULL DEFAULT 0
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  buyer_id INTEGER REFERENCES buyers(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'Settlement',
  note TEXT NOT NULL DEFAULT '',
  cashbook_id INTEGER,
  invoice_id INTEGER
);

CREATE TABLE cashbook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  date TEXT NOT NULL,
  particulars TEXT NOT NULL DEFAULT '',
  category_code TEXT NOT NULL DEFAULT '',
  sub TEXT NOT NULL DEFAULT '',
  income REAL NOT NULL DEFAULT 0,
  expense REAL NOT NULL DEFAULT 0,
  advance TEXT NOT NULL DEFAULT 'No',
  photo TEXT,
  source_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  bill_no TEXT NOT NULL,
  date TEXT NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id),
  item TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  rate REAL NOT NULL DEFAULT 0,
  value REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (estate_id, bill_no)
);

CREATE TABLE vendor_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  vendor_id INTEGER REFERENCES vendors(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  cashbook_id INTEGER
);

CREATE TABLE stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE config_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (estate_id, kind, code)
);

CREATE TABLE sequences (
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  name TEXT NOT NULL,
  next_val INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (estate_id, name)
);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estates(id),
  kind TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Committed',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_entry_days_estate_date ON entry_days (estate_id, date);
CREATE INDEX idx_entry_rows_day ON entry_rows (day_id);
CREATE INDEX idx_entry_rows_block ON entry_rows (block_id);
CREATE INDEX idx_stock_ledger_hub ON stock_ledger (estate_id, hub, date);
CREATE INDEX idx_invoices_estate_date ON invoices (estate_id, date);
CREATE INDEX idx_cashbook_estate_date ON cashbook (estate_id, date);
CREATE INDEX idx_cashbook_category ON cashbook (estate_id, category_code);
CREATE INDEX idx_payments_buyer ON payments (estate_id, buyer_id);
CREATE INDEX idx_blocks_estate ON blocks (estate_id);
CREATE INDEX idx_tappers_estate ON tappers (estate_id);
