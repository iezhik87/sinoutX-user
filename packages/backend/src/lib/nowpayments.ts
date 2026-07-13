import crypto from 'node:crypto'
import { config } from '../config/index.js'

const NOWPAYMENTS_BASE = 'https://api.nowpayments.io/v1'

export interface CreateInvoiceInput {
  priceAmount: number
  priceCurrency?: string
  orderId: string
  orderDescription: string
  ipnCallbackUrl: string
  successUrl?: string
  cancelUrl?: string
  customerEmail?: string
}

export interface NowPaymentsInvoice {
  id: string
  order_id: string
  invoice_url: string
  price_amount: number
  price_currency: string
  created_at: string
}

export function isNowPaymentsConfigured(): boolean {
  return !!config.NOWPAYMENTS_API_KEY
}

export async function createInvoice(input: CreateInvoiceInput): Promise<NowPaymentsInvoice> {
  if (!config.NOWPAYMENTS_API_KEY) {
    throw new Error('NOWPAYMENTS_API_KEY not configured')
  }
  const res = await fetch(`${NOWPAYMENTS_BASE}/invoice`, {
    method: 'POST',
    headers: {
      'x-api-key': config.NOWPAYMENTS_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      price_amount: input.priceAmount,
      price_currency: input.priceCurrency ?? 'usd',
      order_id: input.orderId,
      order_description: input.orderDescription,
      ipn_callback_url: input.ipnCallbackUrl,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`NOWPayments invoice failed: ${res.status} ${text}`)
  }
  return (await res.json()) as NowPaymentsInvoice
}

/**
 * NOWPayments signs IPN payloads with HMAC-SHA512 over the JSON body
 * with keys sorted alphabetically (deep). Returns true if `signature`
 * matches the body using the configured IPN secret.
 */
export function verifyIpnSignature(rawBody: unknown, signature: string | undefined): boolean {
  if (!signature || !config.NOWPAYMENTS_IPN_SECRET) return false
  const sorted = sortObjectKeys(rawBody)
  const payload = JSON.stringify(sorted)
  const expected = crypto
    .createHmac('sha512', config.NOWPAYMENTS_IPN_SECRET)
    .update(payload)
    .digest('hex')
  // Constant-time compare
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortObjectKeys(obj[k])
        return acc
      }, {})
  }
  return value
}
