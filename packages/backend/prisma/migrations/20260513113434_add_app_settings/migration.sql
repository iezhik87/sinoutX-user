-- CreateTable
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "registration_mode" TEXT NOT NULL DEFAULT 'invite',
    "invite_code" TEXT,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- Seed default row
INSERT INTO "app_settings" ("id", "registration_mode", "invite_code")
VALUES ('singleton', 'invite', NULL)
ON CONFLICT ("id") DO NOTHING;
