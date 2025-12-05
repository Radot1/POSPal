-- QR Menu ownership and publishing table
-- Run with: wrangler d1 execute <database> --file=add-qr-menus.sql --env <env>

CREATE TABLE IF NOT EXISTS qr_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  menu_json TEXT,
  public_base TEXT,
  menu_version INTEGER NOT NULL DEFAULT 1,
  last_published_at TEXT,
  last_published_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qr_menus_slug ON qr_menus(slug);
CREATE INDEX IF NOT EXISTS idx_qr_menus_customer ON qr_menus(customer_id);
