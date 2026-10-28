-- Existing accounts keep their full names and receive a changeable handle.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
UPDATE users SET username = 'member' || id::text WHERE username IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
