-- Unified login (Facebook Login for Business, graph.facebook.com, non-expiring system-user token) alongside Instagram Login.
ALTER TABLE instagram_accounts ADD COLUMN login_mode TEXT NOT NULL DEFAULT 'instagram' CHECK (login_mode IN ('instagram','unified'));
