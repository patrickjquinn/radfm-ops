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
