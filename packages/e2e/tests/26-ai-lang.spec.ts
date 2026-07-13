import { test, expect, type Page } from '@playwright/test'
import { getWorkspaceId } from './helpers'

// Verify the AI replies/generates content in the user's selected language.
// Needs an AI provider configured for the workspace; skips gracefully otherwise.
async function aiReply(page: Page, lang: 'en' | 'be' | 'ru', prompt: string, wid: string | null) {
  return page.evaluate(
    async ({ lang, prompt, wid }) => {
      const authRaw = localStorage.getItem('sinoutx-auth')
      const token = authRaw ? JSON.parse(authRaw)?.state?.token : null
      const r = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          context: { ...(wid ? { workspaceId: wid } : {}), userLanguage: lang },
        }),
      })
      if (!r.ok || !r.body) return { ok: false, status: r.status, text: '', error: '' }
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = '', text = '', error = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const s = line.replace(/^data: /, '').trim()
          if (!s) continue
          try {
            const p = JSON.parse(s) as { type?: string; text?: string }
            if (p.type === 'text' && p.text) text += p.text
            if (p.type === 'error' && p.text) error += p.text
          } catch { /* ignore non-JSON keep-alives */ }
        }
      }
      return { ok: true, status: 200, text, error }
    },
    { lang, prompt, wid },
  )
}

const hasCyrillic = (s: string) => /[а-яёА-ЯЁ]/.test(s)
const hasBelarusianMarks = (s: string) => /[ўіЎІ]/.test(s)

test('AI-LANG-EN — ассистент отвечает на английском', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/'); await page.waitForTimeout(500)
  const wid = await getWorkspaceId(page)

  const res = await aiReply(page, 'en', 'In one short sentence, what is the sea? Reply as plain text, no tools.', wid)
  if (!res.ok || res.error || res.text.trim().length < 5) {
    test.skip(true, `AI недоступен/не настроен (status ${res.status}, err: ${res.error || 'нет текста'})`)
  }
  expect(hasCyrillic(res.text), `ожидался английский, получено: "${res.text.slice(0, 160)}"`).toBe(false)
})

test('AI-LANG-BE — ассистент отвечает на белорусском', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/'); await page.waitForTimeout(500)
  const wid = await getWorkspaceId(page)

  const res = await aiReply(page, 'be', 'Адным сказам: што такое мора? Адкажы звычайным тэкстам, без інструментаў.', wid)
  if (!res.ok || res.error || res.text.trim().length < 5) {
    test.skip(true, `AI недоступен/не настроен (status ${res.status}, err: ${res.error || 'нет текста'})`)
  }
  // Belarusian-specific letters (ў / і) — absent in Russian, so they prove it's not RU.
  expect(hasBelarusianMarks(res.text), `ожидался белорусский, получено: "${res.text.slice(0, 200)}"`).toBe(true)
})
