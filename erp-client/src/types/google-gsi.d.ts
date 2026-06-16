// Minimal ambient typings for the Google Identity Services (GIS) browser client
// loaded from https://accounts.google.com/gsi/client. We only declare the surface
// the login page uses (initialize + renderButton + the credential callback), so
// strict TypeScript stays satisfied without an `any` and without a new dependency.
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

interface Window {
  google?: {
    accounts: {
      id: GoogleAccountsId;
    };
  };
}
