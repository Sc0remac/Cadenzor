import { google } from "googleapis";

interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function getGoogleOAuthConfig(override?: Partial<GoogleOAuthConfig>): GoogleOAuthConfig {
  const base: GoogleOAuthConfig = {
    clientId: readEnv("GOOGLE_CLIENT_ID"),
    clientSecret: readEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  };

  if (override?.redirectUri) {
    base.redirectUri = override.redirectUri;
  }

  if (override?.clientId) {
    base.clientId = override.clientId;
  }
  if (override?.clientSecret) {
    base.clientSecret = override.clientSecret;
  }

  return base;
}

export function createOAuthClient(config?: Partial<GoogleOAuthConfig>) {
  const resolved = getGoogleOAuthConfig(config);
  if (resolved.redirectUri) {
    return new google.auth.OAuth2(resolved.clientId, resolved.clientSecret, resolved.redirectUri);
  }
  return new google.auth.OAuth2(resolved.clientId, resolved.clientSecret);
}

export function generateOAuthState(): string {
  return crypto.randomUUID();
}

export function buildOAuthUrl(options: {
  redirectUri: string;
  state: string;
  scopes?: string[];
  prompt?: "consent" | "select_account" | "none";
  accessType?: "online" | "offline";
}) {
  const { redirectUri, state, scopes = DRIVE_SCOPES, prompt = "consent", accessType = "offline" } = options;
  const client = createOAuthClient({ redirectUri });
  return client.generateAuthUrl({
    access_type: accessType,
    scope: scopes,
    state,
    prompt,
    include_granted_scopes: true,
  });
}
