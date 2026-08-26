// ─── Where a document-recognition key comes from ──────────────────────────────
// Three places could hold one, and every consumer used to re-derive the priority
// itself — which is how the same lookup drifted apart in three files. It lives
// here now, once:
//
//   1. the user's own key (Settings → AI → document recognition);
//   2. a key saved on a module before this setting moved out of modules — read
//      only, so an instance configured the old way keeps recognising documents;
//   3. the instance's shared key, metered to the user.
import type { PrismaClient } from '@prisma/client'
import { getVisionSettings } from '../modules/ai/ai.service.js'
import { managedVisionFor } from './managedAccess.js'
import { decryptSecret } from './crypto.js'
import type { OcrConfig } from './modules/vision.js'

export async function resolveVisionOcr(
  prisma: PrismaClient, workspaceId: string, userId: string | null, source: string,
): Promise<OcrConfig | null> {
  const own = await getVisionSettings(workspaceId, prisma)
  if (own?.apiKey && own.model) {
    return { provider: own.provider, model: own.model, baseUrl: own.baseUrl, apiKey: own.apiKey }
  }

  const modules = await prisma.project.findMany({
    where: { workspaceId, isModule: true }, select: { settings: true },
  })
  for (const p of modules) {
    const ocr = ((p.settings as Record<string, unknown>)?.ocr ?? {}) as Record<string, string>
    if (ocr.apiKey && ocr.model) {
      return { provider: ocr.provider, model: ocr.model, baseUrl: ocr.baseUrl, apiKey: decryptSecret(ocr.apiKey)! }
    }
  }

  return managedVisionFor(prisma, workspaceId, userId, source)
}
