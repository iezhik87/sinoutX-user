-- Episodic memory: track when a chat was last distilled into a memory episode.
ALTER TABLE "ai_conversations" ADD COLUMN "summarized_at" TIMESTAMP(3);
