// Minimal ambient typings for the Google Identity Services (GIS) browser client
// loaded from https://accounts.google.com/gsi/client. We declare the surface the
// login page uses: the OAuth 2.0 authorization-code popup flow (oauth2.initCodeClient
// → requestCode), plus the legacy accounts.id (initialize + renderButton + credential
// callback) surface that the ID-token path still relies on. Strict TypeScript stays
// satisfied without an `any` and without a new dependency.
// Full reference: https://developers.google.com/identity/gsi/web/reference/js-reference

interface GoogleIdCredentialResponse {
  /** The Google-signed JWT ID token (the value POSTed to /auth/google). */
  credential: string;
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleIdCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
}

interface GoogleIdButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number | string;
  locale?: string;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfiguration) => void;
  renderButton: (
    parent: HTMLElement,
    options: GoogleIdButtonConfiguration,
  ) => void;
  prompt: () => void;
  cancel: () => void;
  disableAutoSelect: () => void;
}

// ---- OAuth 2.0 authorization-code popup flow (oauth2.initCodeClient) ----
// The callback fires with the short-lived authorization `code` on success, or an
// `error` string (e.g. the user closed/denied the popup). Returns a CodeClient whose
// requestCode() opens the consent popup — and because WE call requestCode() from our
// own button, the control can be styled freely (unlike the GIS-rendered button).
interface GoogleCodeResponse {
  /** Short-lived authorization code, POSTed to /auth/google/code on success. */
  code?: string;
  /** Set when the popup is closed/denied or the request fails. */
  error?: string;
  error_description?: string;
  scope?: string;
  state?: string;
}

interface GoogleCodeClientConfig {
  client_id: string;
  scope: string;
  ux_mode?: 'popup' | 'redirect';
  redirect_uri?: string;
  callback: (response: GoogleCodeResponse) => void;
  error_callback?: (error: { type: string; message?: string }) => void;
  state?: string;
  // Forwarded to Google's authorization endpoint. 'consent' forces the consent
  // screen on every login so the code exchange ALWAYS returns a refresh_token —
  // without it Google omits the refresh token for an already-granted user, so the
  // server can never (re)store an offline grant on a repeat login.
  prompt?: string;
}

interface GoogleCodeClient {
  requestCode: () => void;
}

interface GoogleAccountsOauth2 {
  initCodeClient: (config: GoogleCodeClientConfig) => GoogleCodeClient;
}

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
      oauth2: GoogleAccountsOauth2;
    };
  };
}
