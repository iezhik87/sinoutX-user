-- Invitations for people who do not have an account yet. Until now a workspace
-- invite required the person to already exist, so whoever had just paid for Team
-- was told «user not found» and had to talk them through signing up first.
CREATE TABLE "invites" (
  "id"           TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "workspace_id" TEXT,
  "project_id"   TEXT,
  "role"         TEXT NOT NULL DEFAULT 'MEMBER',
  "token"        TEXT NOT NULL,
  "invited_by"   TEXT NOT NULL,
  "expires_at"   TIMESTAMP(3) NOT NULL,
  "accepted_at"  TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");
CREATE INDEX "invites_email_idx" ON "invites"("email");
