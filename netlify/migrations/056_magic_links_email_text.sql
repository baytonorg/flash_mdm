-- Encrypted MFA-pending password-reset carriers exceed VARCHAR(255).
ALTER TABLE magic_links
  ALTER COLUMN email TYPE TEXT;
