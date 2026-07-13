import puppeteer from 'puppeteer-core'

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser'

const W = 600
const H = 300

export async function screenshotMapEmbed(embedSrc: string): Promise<Buffer | null> {
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
    })
    const page = await browser.newPage()
    await page.setViewport({ width: W, height: H })

    // Embed APIs (Google Maps etc.) require iframe context — wrap in a local page
    const safeUrl = embedSrc.replace(/"/g, '&quot;')
    await page.setContent(
      `<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden">` +
      `<iframe src="${safeUrl}" width="${W}" height="${H}" frameborder="0" allowfullscreen` +
      ` style="border:0;display:block;width:${W}px;height:${H}px"></iframe>` +
      `</body></html>`,
      { waitUntil: 'domcontentloaded' },
    )

    // Wait for map tiles to render
    await new Promise(r => setTimeout(r, 5000))

    const buf = await page.screenshot({ type: 'png' })
    return Buffer.from(buf)
  } catch { return null }
  finally { await browser?.close() }
}
