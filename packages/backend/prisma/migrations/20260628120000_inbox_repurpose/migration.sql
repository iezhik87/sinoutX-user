-- Repurpose the legacy system project (the old «Ассистент» / Telegram home) as the
-- assistant's «Входящие» (Inbox) — the default home for unfiled tasks/notes. No
-- data is lost; the project is renamed, not deleted.
UPDATE "projects" SET "name" = 'Входящие', "icon" = '📥' WHERE "is_system" = true;
