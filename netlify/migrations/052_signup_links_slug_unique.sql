CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_links_slug_unique
  ON signup_links(slug)
  WHERE slug IS NOT NULL;
