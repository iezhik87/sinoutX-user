// Solo self-hosted edition — a single-user instance with no admin panel, no
// billing/cloud, no team/multi-user. Opt-in via the SINOUT_EDITION env var and
// defaults OFF, so existing multi-user and cloud instances are completely
// unchanged. The public "sinoutX-user" repo ships with SINOUT_EDITION=solo.
export const isSoloEdition = (): boolean =>
  String(process.env.SINOUT_EDITION ?? '').trim().toLowerCase() === 'solo'
