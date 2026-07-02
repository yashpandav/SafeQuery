CREATE TABLE customers (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  price_cents INT  NOT NULL,
  stock_qty   INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
  id            SERIAL PRIMARY KEY,
  customer_id   INT  NOT NULL REFERENCES customers(id),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','shipped','delivered','cancelled')),
  total_cents   INT  NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shipped_at    TIMESTAMPTZ
);

CREATE TABLE order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id),
  product_id  INT NOT NULL REFERENCES products(id),
  quantity    INT NOT NULL,
  unit_price_cents INT NOT NULL
);

CREATE TABLE support_tickets (
  id          SERIAL PRIMARY KEY,
  customer_id INT  NOT NULL REFERENCES customers(id),
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'normal'
                CHECK (priority IN ('low','normal','high','urgent')),
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Seed data ────────────────────────────────────────────────────────────────

INSERT INTO customers (email, full_name, phone) VALUES
  ('alice@example.com',   'Alice Johnson',  '+1-555-0101'),
  ('bob@example.com',     'Bob Smith',      '+1-555-0102'),
  ('carol@example.com',   'Carol Williams', '+1-555-0103'),
  ('dave@example.com',    'Dave Brown',     NULL),
  ('eve@example.com',     'Eve Davis',      '+1-555-0105'),
  ('frank@example.com',   'Frank Miller',   '+1-555-0106'),
  ('grace@example.com',   'Grace Wilson',   NULL),
  ('henry@example.com',   'Henry Moore',    '+1-555-0108'),
  ('iris@example.com',    'Iris Taylor',    '+1-555-0109'),
  ('jack@example.com',    'Jack Anderson',  '+1-555-0110');

INSERT INTO products (name, category, price_cents, stock_qty) VALUES
  ('Wireless Headphones',   'Electronics',  7999,  42),
  ('Mechanical Keyboard',   'Electronics', 12999,  18),
  ('USB-C Hub',             'Electronics',  3499,  75),
  ('Standing Desk Mat',     'Office',       4999,  30),
  ('Ergonomic Chair',       'Office',      89900,   5),
  ('Coffee Mug (16 oz)',    'Kitchen',       1299, 200),
  ('Notebook (A5)',         'Stationery',    899,  150),
  ('Blue Light Glasses',    'Accessories',  2499,  60),
  ('Desk Lamp (LED)',       'Electronics',  3999,  25),
  ('Cable Management Box',  'Office',       1999,  88);

INSERT INTO orders (customer_id, status, total_cents, created_at, shipped_at) VALUES
  (1, 'delivered',  7999, NOW() - INTERVAL '30 days', NOW() - INTERVAL '28 days'),
  (2, 'shipped',   16498, NOW() - INTERVAL '5 days',  NOW() - INTERVAL '3 days'),
  (3, 'processing', 4999, NOW() - INTERVAL '1 day',   NULL),
  (4, 'pending',   12999, NOW() - INTERVAL '2 hours', NULL),
  (5, 'delivered', 89900, NOW() - INTERVAL '60 days', NOW() - INTERVAL '57 days'),
  (1, 'cancelled',  3499, NOW() - INTERVAL '10 days', NULL),
  (6, 'shipped',    2198, NOW() - INTERVAL '4 days',  NOW() - INTERVAL '2 days'),
  (7, 'delivered',  3999, NOW() - INTERVAL '14 days', NOW() - INTERVAL '11 days'),
  (8, 'processing', 1999, NOW() - INTERVAL '6 hours', NULL),
  (9, 'pending',    2499, NOW() - INTERVAL '1 hour',  NULL);

INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES
  (1,  1, 1,  7999),
  (2,  2, 1, 12999),
  (2,  6, 3,  1166),
  (3,  4, 1,  4999),
  (4,  2, 1, 12999),
  (5,  5, 1, 89900),
  (6,  3, 1,  3499),
  (7,  9, 1,  3999),
  (8, 10, 1,  1999),
  (9,  8, 1,  2499);

INSERT INTO support_tickets (customer_id, subject, body, priority, resolved) VALUES
  (1, 'Order arrived damaged',        'My headphones arrived with a cracked ear cup.',      'high',   TRUE),
  (2, 'Wrong item shipped',           'I received a USB hub instead of the keyboard.',      'urgent', FALSE),
  (3, 'Delivery estimate?',           'When will my standing mat arrive?',                  'normal', FALSE),
  (5, 'Return request',               'Chair is not as described, want to return.',          'high',   FALSE),
  (6, 'Discount code not applied',    'My promo code SAVE10 was not deducted at checkout.', 'normal', TRUE),
  (8, 'Item out of stock follow-up',  'Is the cable box back in stock yet?',                'low',    FALSE);
