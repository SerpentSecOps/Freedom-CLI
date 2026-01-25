/**
 * OAuth Provider for MCP Servers
 * Implements OAuthClientProvider interface from @modelcontextprotocol/sdk
 */

import { type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';
import { homedir } from 'os';
import open from 'open';

interface StoredTokens {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  serverName?: string;
  expiresAt?: number;
}

interface StoredClientInfo {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  serverName?: string;
}

/**
 * Simple file-based OAuth provider for MCP servers
 */
export class SimpleMCPOAuthProvider implements OAuthClientProvider {
  private tokensCache: StoredTokens | undefined;
  private clientInfoCache: StoredClientInfo | undefined;
  private codeVerifierCache: string | undefined;
  private stateCache: string | undefined;
  private authorizationCodeCache: string | undefined;
  private tokenStorePath: string;
  private clientInfoPath: string;

  constructor(
    private serverName: string,
    private redirectPort: number = 3000
  ) {
    const baseDir = path.join(homedir(), '.freedom-cli', 'oauth');
    this.tokenStorePath = path.join(baseDir, `${serverName}-tokens.json`);
    this.clientInfoPath = path.join(
      baseDir,
      `${serverName}-client.json`
    );
  }

  get redirectUrl(): string {
    return `http://localhost:${this.redirectPort}/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Freedom CLI',
      client_uri: 'https://github.com/freedom-cli/freedom-cli',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client (PKCE)
    };
  }

  async state(): Promise<string> {
    if (!this.stateCache) {
      this.stateCache = crypto.randomBytes(16).toString('base64url');
    }
    return this.stateCache;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.clientInfoCache) {
      return this.clientInfoCache;
    }

    try {
      const data = await fs.readFile(this.clientInfoPath, 'utf-8');
      this.clientInfoCache = JSON.parse(data);
      return this.clientInfoCache;
    } catch (error) {
      // File doesn't exist yet
      return undefined;
    }
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed
  ): Promise<void> {
    this.clientInfoCache = {
      ...clientInformation,
      serverName: this.serverName,
    };

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.clientInfoPath), { recursive: true });
    await fs.writeFile(
      this.clientInfoPath,
      JSON.stringify(this.clientInfoCache, null, 2),
      'utf-8'
    );
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    if (this.tokensCache && this.tokensCache.access_token && this.tokensCache.token_type) {
      return this.tokensCache as OAuthTokens;
    }

    try {
      const data = await fs.readFile(this.tokenStorePath, 'utf-8');
      const parsed: StoredTokens = JSON.parse(data);
      this.tokensCache = parsed;

      // Return undefined if required fields are missing
      if (!parsed.access_token || !parsed.token_type) {
        return undefined;
      }

      return parsed as OAuthTokens;
    } catch (error) {
      // File doesn't exist yet
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.tokensCache = {
      ...tokens,
      serverName: this.serverName,
      expiresAt: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : undefined,
    };

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.tokenStorePath), { recursive: true });
    await fs.writeFile(
      this.tokenStorePath,
      JSON.stringify(this.tokensCache, null, 2),
      'utf-8'
    );

    console.log(
      `✅ OAuth tokens saved for MCP server: ${this.serverName}`
    );
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    console.log('\n🔐 Opening browser for OAuth authorization...\n');
    console.log(`→ Authorization URL: ${authorizationUrl}\n`);
    console.log('📝 If the browser does not open automatically, copy and paste the URL above.\n');

    // Start the callback server to capture the authorization code
    const callbackPromise = this.startCallbackServer();

    try {
      await open(authorizationUrl.toString());
      console.log('✓ Browser opened successfully\n');
      
      // Wait for the callback with the authorization code
      const { authorizationCode } = await callbackPromise;
      
      // Store the authorization code for the MCP SDK to use
      this.authorizationCodeCache = authorizationCode;
      
    } catch (error) {
      console.error('✗ Failed to complete OAuth flow:', error);
      throw error;
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.codeVerifierCache = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    if (!this.codeVerifierCache) {
      throw new Error('Code verifier not found');
    }
    return this.codeVerifierCache;
  }

  /**
   * Start a local HTTP server to handle OAuth callback
   * This method is used internally by redirectToAuthorization
   */
  private async startCallbackServer(): Promise<{
    authorizationCode: string;
    state: string;
  }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${this.redirectPort}`);

        if (url.pathname === '/oauth/callback') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>Authorization Failed</h1>
                  <p>Error: ${error}</p>
                  <p>${url.searchParams.get('error_description') || ''}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
            server.close();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (!code || !state) {
            res.writeHead(400);
            res.end('Missing code or state parameter');
            server.close();
            reject(new Error('Invalid callback: missing code or state'));
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authorization Successful!</h1>
                <p>You can close this window and return to the CLI.</p>
                <script>window.close();</script>
              </body>
            </html>
          `);

          server.close();
          resolve({ authorizationCode: code, state });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(this.redirectPort, () => {
        console.log(
          `🌐 OAuth callback server listening on port ${this.redirectPort}`
        );
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('OAuth callback timeout (5 minutes)'));
      }, 5 * 60 * 1000);
    });
  }
}
