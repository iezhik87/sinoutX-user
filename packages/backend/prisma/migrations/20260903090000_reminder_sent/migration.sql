-- Отметка об отправленном напоминании.
--
-- Прежде напоминания искались в окне ровно в одну минуту (r >= now-60s), а
-- признака «уже отправлено» не существовало вовсе. Любой простой сервера — даже
-- двухминутный, даже задержка тика под нагрузкой — означал, что напоминание не
-- придёт никогда и никто об этом не узнает.
--
-- Теперь ищем просроченные за несколько часов и не отправленные, а уникальный
-- индекс не даёт послать одно и то же дважды.
CREATE TABLE "reminder_sent" (
  "id"        TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "ref_id"    TEXT NOT NULL,
  "remind_at" TIMESTAMP(3) NOT NULL,
  "sent_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reminder_sent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reminder_sent_kind_ref_id_remind_at_key"
  ON "reminder_sent"("kind", "ref_id", "remind_at");
CREATE INDEX "reminder_sent_sent_at_idx" ON "reminder_sent"("sent_at");
