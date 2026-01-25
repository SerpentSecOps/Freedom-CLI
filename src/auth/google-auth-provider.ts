/**
 * Google OAuth Provider for Freedom CLI
 * Using the exact same OAuth configuration as gemini-cli
 */

import type { 
  OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata, 
  OAuthClientInformationMixed,
  OAuthTokens 
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAuth2Client } from 'google-auth-library';
import type { Credentials } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';
import * as net from 'net';
import { homedir } from 'os';
import open from 'open';

// Use gemini-cli's exact OAuth configuration
// OAuth credentials should be provided via environment variables for security.
// If not set, the application will throw an error at startup.
const OAUTH_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
  throw new Error(
    'Google OAuth Client ID and Secret must be provided via GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
  );
}

const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/generative-language',
];

const SIGN_IN_SUCCESS_URL = 'https://developers.google.com/gemini-code-assist/auth_success_gemini';
const SIGN_IN_FAILURE_URL = 'https://developers.google.com/gemini-code-assist/auth_failure_gemini';

interface GoogleUserInfo {
  email: string;
  name: string;
  picture?: string;
}

export class GoogleOAuthProvider implements OAuthClientProvider {
  private static instance?: GoogleOAuthProvider;
  
  private client: OAuth2Client;
  private cachedTokens?: OAuthTokens;
  private userInfo?: GoogleUserInfo;
  private codeVerifierCache?: string;
  private stateCache?: string;
  private readonly tokenStorePath: string;
  private readonly userInfoPath: string;

  // OAuth Client Provider properties  
  readonly redirectUrl: string;
  
  readonly clientMetadata: OAuthClientMetadata = {
    client_name: 'Freedom CLI',
    client_uri: 'https://github.com/freedom-cli/freedom-cli',
    redirect_uris: [],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  };

  private _clientInformation?: OAuthClientInformationMixed;

  constructor() {
    const baseDir = path.join(homedir(), '.freedom-cli', 'google');
    this.tokenStorePath = path.join(baseDir, 'credentials.json');
    this.userInfoPath = path.join(baseDir, 'user.json');
    
    this.client = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    });

    // Will be set dynamically during auth flow
    this.redirectUrl = '';
  }

  static getInstance(): GoogleOAuthProvider {
    if (!GoogleOAuthProvider.instance) {
      GoogleOAuthProvider.instance = new GoogleOAuthProvider();
    }
    return GoogleOAuthProvider.instance;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this._clientInformation || {
      client_id: OAUTH_CLIENT_ID,
      client_secret: OAUTH_CLIENT_SECRET,
    };
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this._clientInformation = clientInformation;
  }

  /**
   * Clear cached tokens to force refresh on next access
   */
  clearCache(): void {
    this.cachedTokens = undefined;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    // Return cached tokens if valid
    if (this.cachedTokens) {
      return this.cachedTokens;
    }

    // Load from disk
    try {
      const data = await fs.readFile(this.tokenStorePath, 'utf-8');
      const credentials: Credentials = JSON.parse(data);
      
      // Check if tokens are expired
      if (credentials.expiry_date && Date.now() > credentials.expiry_date - 5 * 60 * 1000) {
        // Try to refresh
        if (credentials.refresh_token) {
          const refreshed = await this.refreshTokens(credentials.refresh_token);
          if (refreshed) {
            this.cachedTokens = refreshed;
            return refreshed;
          }
        }
        // Tokens expired and couldn't refresh
        return undefined;
      }

      // Convert credentials to OAuthTokens format
      const tokens: OAuthTokens = {
        access_token: credentials.access_token!,
        token_type: credentials.token_type || 'Bearer',
        refresh_token: credentials.refresh_token ?? undefined,
        expires_in: credentials.expiry_date ? 
          Math.floor((credentials.expiry_date - Date.now()) / 1000) : undefined,
        scope: credentials.scope,
      };

      this.cachedTokens = tokens;
      return tokens;
    } catch {
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Convert to Credentials format for consistency with gemini-cli
    const credentials: Credentials = {
      access_token: tokens.access_token,
      token_type: tokens.token_type,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : undefined,
      scope: tokens.scope,
    };

    this.cachedTokens = tokens;
    this.client.setCredentials(credentials);

    // Save to disk
    await fs.mkdir(path.dirname(this.tokenStorePath), { recursive: true });
    await fs.writeFile(this.tokenStorePath, JSON.stringify(credentials, null, 2));
  }

  async state(): Promise<string> {
    if (!this.stateCache) {
      this.stateCache = crypto.randomBytes(32).toString('hex');
    }
    return this.stateCache;
  }

  async codeVerifier(): Promise<string> {
    if (!this.codeVerifierCache) {
      this.codeVerifierCache = crypto.randomBytes(32).toString('base64url');
    }
    return this.codeVerifierCache;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.codeVerifierCache = codeVerifier;
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    console.log('\n🔐 Opening browser for Google authentication...\n');
    console.log(`→ Authorization URL: ${authorizationUrl}\n`);

    try {
      const childProcess = await open(authorizationUrl.toString());
      
      childProcess.on('error', (error) => {
        console.error('❌ Failed to open browser:', error.message);
        console.log(`\n📋 Please manually open this URL in your browser:\n${authorizationUrl}\n`);
      });
      
      console.log('✅ Browser opened successfully\n');
    } catch (error: any) {
      console.error('❌ Failed to open browser:', error.message);
      console.log(`\n📋 Please manually open this URL in your browser:\n${authorizationUrl}\n`);
    }
  }

  /**
   * Get an available port for OAuth callback
   */
  private async getAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = (server.address() as net.AddressInfo).port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  /**
   * Perform the full Google OAuth login flow (like gemini-cli)
   */
  async performLogin(): Promise<boolean> {
    try {
      console.log('🔐 Starting Google OAuth login...\n');

      const port = await this.getAvailablePort();
      const redirectUri = `http://localhost:${port}/oauth2callback`;
      const state = await this.state();

      // Update redirect URL for this session
      (this as any).redirectUrl = redirectUri;
      this.clientMetadata.redirect_uris = [redirectUri];

      const authUrl = this.client.generateAuthUrl({
        redirect_uri: redirectUri,
        access_type: 'offline',
        scope: OAUTH_SCOPE,
        state,
      });

      // Start callback server and open browser
      const callbackPromise = this.startCallbackServer(port, state);
      await this.redirectToAuthorization(new URL(authUrl));

      // Wait for callback
      const { code } = await callbackPromise;

      // Exchange code for tokens
      const { tokens } = await this.client.getToken({
        code,
        redirect_uri: redirectUri,
      });

      this.client.setCredentials(tokens);

      // Convert and save tokens
      const oauthTokens: OAuthTokens = {
        access_token: tokens.access_token!,
        token_type: tokens.token_type || 'Bearer',
        refresh_token: tokens.refresh_token ?? undefined,
        expires_in: tokens.expiry_date ? 
          Math.floor((tokens.expiry_date - Date.now()) / 1000) : undefined,
        scope: tokens.scope,
      };

      await this.saveTokens(oauthTokens);

      // Get and save user info
      const userInfo = await this.fetchUserInfo(tokens.access_token!);
      await this.saveUserInfo(userInfo);

      console.log('✅ Authentication successful!');
      console.log(`   Logged in as: ${userInfo.name} (${userInfo.email})`);
      
      return true;
    } catch (error: any) {
      console.error('❌ Authentication failed:', error.message);
      return false;
    }
  }

  /**
   * Start callback server to handle OAuth redirect (like gemini-cli)
   */
  private startCallbackServer(port: number, expectedState: string): Promise<{ code: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          if (req.url!.indexOf('/oauth2callback') === -1) {
            res.writeHead(301, { Location: SIGN_IN_FAILURE_URL });
            res.end();
            reject(new Error('OAuth callback not received. Unexpected request: ' + req.url));
            return;
          }

          const queryParams = new URLSearchParams(req.url!.split('?')[1] || '');
          const code = queryParams.get('code');
          const state = queryParams.get('state');
          const error = queryParams.get('error');

          if (error) {
            res.writeHead(301, { Location: SIGN_IN_FAILURE_URL });
            res.end();
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code || state !== expectedState) {
            res.writeHead(301, { Location: SIGN_IN_FAILURE_URL });
            res.end();
            server.close();
            reject(new Error('Invalid callback: missing code or state mismatch'));
            return;
          }

          res.writeHead(301, { Location: SIGN_IN_SUCCESS_URL });
          res.end();
          server.close();
          resolve({ code });
        } catch (error: any) {
          res.writeHead(301, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          server.close();
          reject(error);
        }
      });

      server.listen(port, 'localhost', () => {
        console.log(`🌐 OAuth callback server started on http://localhost:${port}\n`);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth callback timeout (5 minutes)'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Refresh expired tokens
   */
  private async refreshTokens(refreshToken: string): Promise<OAuthTokens | undefined> {
    try {
      this.client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await this.client.refreshAccessToken();
      
      const tokens: OAuthTokens = {
        access_token: credentials.access_token!,
        token_type: credentials.token_type || 'Bearer',
        refresh_token: credentials.refresh_token || refreshToken,
        expires_in: credentials.expiry_date ? 
          Math.floor((credentials.expiry_date - Date.now()) / 1000) : undefined,
        scope: credentials.scope,
      };

      await this.saveTokens(tokens);
      return tokens;
    } catch {
      return undefined;
    }
  }

  /**
   * Get user information from Google
   */
  private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    return (await response.json()) as GoogleUserInfo;
  }

  /**
   * Save user information
   */
  private async saveUserInfo(userInfo: GoogleUserInfo): Promise<void> {
    this.userInfo = userInfo;
    await fs.mkdir(path.dirname(this.userInfoPath), { recursive: true });
    await fs.writeFile(this.userInfoPath, JSON.stringify(userInfo, null, 2));
  }

  /**
   * Get cached user information
   */
  async getUserInfo(): Promise<GoogleUserInfo | undefined> {
    if (this.userInfo) return this.userInfo;

    try {
      const data = await fs.readFile(this.userInfoPath, 'utf-8');
      this.userInfo = JSON.parse(data);
      return this.userInfo;
    } catch {
      return undefined;
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const tokens = await this.tokens();
    return !!tokens?.access_token;
  }

  /**
   * Clear all stored credentials
   */
  async logout(): Promise<void> {
    this.cachedTokens = undefined;
    this.userInfo = undefined;
    this.codeVerifierCache = undefined;
    this.stateCache = undefined;

    try {
      await fs.rm(path.dirname(this.tokenStorePath), { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get an authenticated OAuth2Client for making requests
   * This follows gemini-cli's pattern where the AuthClient handles token refresh automatically
   */
  async getAuthClient(): Promise<OAuth2Client | null> {
    try {
      const data = await fs.readFile(this.tokenStorePath, 'utf-8');
      const credentials: Credentials = JSON.parse(data);
      
      // Set credentials on the client
      this.client.setCredentials(credentials);
      
      // Set up automatic token refresh handling like gemini-cli does
      this.client.on('tokens', async (newTokens: Credentials) => {
        // Save refreshed tokens
        const tokens: OAuthTokens = {
          access_token: newTokens.access_token!,
          token_type: newTokens.token_type || 'Bearer',
          refresh_token: newTokens.refresh_token || credentials.refresh_token || undefined,
          expires_in: newTokens.expiry_date ? 
            Math.floor((newTokens.expiry_date - Date.now()) / 1000) : undefined,
          scope: newTokens.scope,
        };
        await this.saveTokens(tokens);
        this.cachedTokens = tokens;
      });
      
      return this.client;
    } catch {
      return null;
    }
  }
}