CREATE TABLE IF NOT EXISTS platform_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  invite_only_registration BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id, invite_only_registration)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;
