INSERT INTO feature_flags (key, enabled, updated_at) VALUES ('monetization_enabled', 0, unixepoch() * 1000);
--> statement-breakpoint
INSERT INTO feature_flags (key, enabled, updated_at) VALUES ('ai_external_enabled', 0, unixepoch() * 1000);
