// Legacy titles/names may carry a decorative leading emoji (e.g. "🐟 Feeder Pro
// 2026", "🔒 Mullvad VPN"). The product uses one clean Lucide icon set, so we
// strip a leading emoji run at DISPLAY time — non-destructive: the stored value
// is untouched, and search/export still see the original text.
const LEADING_EMOJI = /^(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{20E3}️‍]+[\s​]*)+/u

export function stripLeadingEmoji(text: string | null | undefined): string {
  if (!text) return text ?? ''
  const cleaned = text.replace(LEADING_EMOJI, '').trimStart()
  // If the title was ONLY an emoji, keep the original so we never show an empty label.
  return cleaned || text
}
