# SinoutX Code model tiers

`POST /api/v1/llm/chat/completions` accepts `model_tier`:

| Value | Server configuration |
| --- | --- |
| omitted | Unchanged legacy selection: `code`, then `ai` |
| `medium` | Existing `code` slot; an empty slot uses `ai` |
| `light` | `codeLight` only |
| `strong` | `codeStrong` only |
| `auto` | `codeRouter` classifies the original task and pins an available tier |

These are actual models and providers, chosen by the administrator under **Model
SinoutX → SinoutX Code**. `reasoning_effort` remains independent. The client cannot
override server routing with `model`, `models`, or `provider`. Routing fields are
never forwarded upstream. An explicitly selected unconfigured tier returns HTTP
503 with `error.code = model_tier_not_configured`; it never uses another tier.
An incomplete/broken `code` slot also fails for explicit `medium`; omitting the
field retains the old fallback behavior.

No database migration is required. The existing JSON settings and encrypted keys
are retained. New slots use the same encrypted storage and admin-only editing.
Each new slot may reuse the language model's key for the same provider, or have
its own key. The pricing screen includes the three levels and router.

## Capability discovery

`GET /api/v1/llm/model-tiers`, authenticated with an API key, returns:

```json
{"tiers":[{"id":"auto","configured":true},{"id":"light","configured":true},{"id":"medium","configured":true},{"id":"strong","configured":false}]}
```

No model names or credentials are exposed. `auto` is configured when the router
and at least one target tier are configured. This reports configuration, not the
health of Redis or a provider. Clients should check this endpoint before offering
tiers; an older server can otherwise silently ignore unknown request fields.

## Auto request and stable tool loops

```json
{
  "model_tier":"auto",
  "routing_key":"bf345276-9514-480b-9dd0-bc0958b86507",
  "routing_task":"Fix the failing parser and add a regression test",
  "messages":[{"role":"user","content":"Fix the failing parser and add a regression test"}],
  "stream":true
}
```

- `routing_key`: one UUID per user turn. Reuse it on retries and all tool-loop
  requests; generate a new UUID for the next user task.
- `routing_task`: original task, trimmed, 1–4000 characters. Send the same value
  on each request, including continuations. Only this short text, available model
  names and their known prices go to the router, not the whole conversation.
- The first request ends with a `user` message. A tool continuation ends with a
  `tool`/`assistant` message. Do not append fake user messages for app notices.
- Redis pins the tier and actual provider/model/base URL for 24 hours of
  inactivity. The cache is isolated by user, API key ID and workspace scope, and
  survives backend restarts. Keys themselves are never cached in Redis. Parallel
  requests share the selection through a distributed lock.
- If an admin changes/removes a pinned model, HTTP 409 `model_route_changed`
  requires a new turn. A key rotation alone keeps working. A continuation whose
  route expired or was lost returns 409 `model_route_expired`, rather than
  silently selecting a new model with incompatible tool signatures.
- Redis failure returns 503 `routing_unavailable`; concurrent selection that has
  not finished returns 503 `routing_busy`. Retry using the same UUID.

All successful completions, JSON and SSE, include
`X-SinoutX-Model-Tier: light|medium|strong`. On classifier error, invalid selection,
or timeout (8 seconds), the fallback is **medium only**, with
`X-SinoutX-Routing-Fallback: router_failed`. Display this fallback to the user. If
medium is unavailable, return 503 `router_failed`. **A price-cap rejection is an
exception: it fails with `price_cap_exceeded`, with no fallback or model switch.**
A router must be configured
before Auto is available; an absent router is not an implicit medium selection.

The router call is metered separately as `source: code_router`, using its actual
provider/model and reported cost (or the existing pricing table). Answer calls
remain `source: code`. Billing checks run before classification and again before
the answer; normal key scopes and account freeze rules still apply. An unpriced
model follows existing accounting behavior, so operators must configure its price.

## OpenRouter price ceilings

Existing `OPENROUTER_MAX_PROMPT_USD` / `OPENROUTER_MAX_COMPLETION_USD` remain the
defaults; this change does not raise them or change any configured model. Both
environment values must be finite nonnegative numbers. Zero retains its legacy
meaning: no ceiling for that dimension.

Administrators can override the ceiling per managed slot (`ai`, `codeLight`,
`code` for medium, `codeStrong`, and `codeRouter`) in **Model SinoutX**. The
existing `/admin/managed` GET/PATCH accepts the optional slot field:

```json
{"codeStrong":{"maxPrice":{"prompt":2,"completion":6}}}
```

These are USD per **million** tokens. Omitted `maxPrice` leaves the saved setting
unchanged. `maxPrice: null` clears the override; missing dimensions inherit env
defaults. A medium slot borrowing the `ai` model inherits `ai`'s whole override
unless `code.maxPrice` is set. All values must be finite nonnegative numbers;
strings, negative values and infinities are rejected with HTTP 400. Saving a
ceiling leaves the provider, model and encrypted key untouched. Admin GET exposes
the override and `effectiveMaxPrice`, never secrets. A cap-only policy update
does not reroute an already pinned turn.

Explicit per-slot ceilings are enforced even with billing disabled. Without an
override, Code retains its legacy behavior: global caps apply when billing is
enabled. The managed assistant retains its existing global-cap behavior. BYOK
assistant requests receive no server-side ceiling.

**No request is automatically retried without its ceiling.** A provider price
rejection (including `No endpoints found that satisfy the max price for this
request`) returns this contract for both manual tiers and Auto:

```json
{"error":{"message":"Понятное описание модели, уровня и потолков…","type":"invalid_request_error","code":"price_cap_exceeded","retryable":false}}
```

The HTTP status is **503** before a stream starts. An error arriving after SSE
HTTP 200 uses `data: {"error":{...}}` with the **same code and retryable flag**,
then closes the stream. Clients must treat the code as a configuration refusal,
not a transient 503: show the message, do not retry or switch models. A router's
price refusal does not fall back to medium. The separate retry for unsupported
`stream_options` remains, with identical model and ceilings.

`POST /admin/managed/price-check` with `{ "slot": "codeStrong" }` checks the saved
policy against OpenRouter's public **per-endpoint** input/output prices, together
on the same endpoint. It is admin-only, read-only, uses no operator key and makes
no inference. It returns `status: compatible|blocked|unknown`, plus model, limits
and endpoint counts when available. The UI exposes this as **Check ceiling**;
save edited limits first. An unknown result never means compatible. Even a match
is not a guarantee: account/key limits, region, privacy preferences and current
endpoint availability can impose additional restrictions. The check neither
adjusts limits nor rejects saving an intentional ceiling below current prices.

Actual production env values and OpenRouter account/key restrictions must be
checked by the operator. Local defaults do not establish their production values.

## Validation

`node --import tsx scripts/model-tiers-test.ts` exercises the real Fastify handlers
and settings resolver against fake storage/providers, including encryption,
compatibility, per-tier routing, SSE, Anthropic, key reuse, wallet checks,
concurrency, route isolation/expiry, timeout, disclosed fallback, price-cap
validation/persistence, per-tier enforcement, HTTP/JSON/SSE refusals, safe
compatibility retries and public endpoint compatibility checks. It does not
call paid providers or a live deployment.
