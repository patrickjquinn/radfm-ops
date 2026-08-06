export type Bindings = {
  ASSETS: Fetcher;
  CLOUDFLARE_API_TOKEN?: string;
  CF_ACCOUNT_ID: string;
  BACKEND_ORIGIN: string;
  BACKEND_SCRIPT_NAME: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Local dev only: a Rad.FM user JWT so /admin/* can be exercised without Access. */
  DEV_BACKEND_JWT?: string;
  /**
   * A Rad.FM owner JWT held by the Worker, so the single authorised operator does
   * not have to paste their own token into every new tab.
   *
   * This was originally ruled out on the grounds that it "gives every Access user
   * the rights of whoever's token it is". That objection is real, and it is why
   * OPS_OWNER_EMAIL exists: the token is attached ONLY for the Access identity
   * named there. Anyone else who is later added to the Access policy falls back to
   * supplying their own JWT, so attribution survives adding a second person.
   *
   * Without OPS_OWNER_EMAIL set, this secret is ignored entirely.
   */
  OPS_BACKEND_JWT?: string;
  OPS_OWNER_EMAIL?: string;
};

export type Variables = {
  email: string;
};

export type Ctx = { Bindings: Bindings; Variables: Variables };

/**
 * The placeholder that ships in wrangler.jsonc. Dev-only behaviour keys off this
 * rather than off NODE_ENV, so a real deployment cannot accidentally disable a
 * gate: the moment a genuine AUD is configured, the dev paths are unreachable.
 */
export const UNCONFIGURED_AUD = 'REPLACE_WITH_APPLICATION_AUD';

export const isUnconfigured = (env: Bindings) =>
  !env.ACCESS_AUD || env.ACCESS_AUD === UNCONFIGURED_AUD;
