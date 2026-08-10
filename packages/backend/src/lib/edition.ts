// Solo self-hosted edition — a single-user instance with no admin panel, no
// billing/cloud, no team/multi-user. Opt-in via the SINOUT_EDITION env var and
// defaults OFF, so existing multi-user and cloud instances are completely
// unchanged. The public "sinoutX-user" repo ships with SINOUT_EDITION=solo.
export const isSoloEdition = (): boolean =>
  String(process.env.SINOUT_EDITION ?? '').trim().toLowerCase() === 'solo'

// «Лаборатория» — personal experiments that must never reach buyers. Three barriers,
// each independent:
//   1. this env flag        → whether the lab loads on this instance at all;
//   2. capability `lab:use` → WHO sees the tools (owner/admin only — it's in
//      ALL_CAPS but never in BASE_CAPS, so a customer on the same instance can't);
//   3. the publish script   → `src/lab/**` is stripped from the public snapshot,
//      so the code isn't merely disabled there — it's absent.
// The lab registers itself (see app.ts): the core never imports it, so removing the
// folder cannot break the build.
export const isLabEnabled = (): boolean =>
  String(process.env.SINOUT_LAB ?? '').trim().toLowerCase() === 'true'
