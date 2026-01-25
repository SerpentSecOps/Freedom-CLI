/**
 * Secure Secret Manager
 * Handles persistent storage of API keys using the System Keychain (primary)
 * or a restricted-access .env file (fallback).
 * 
 * This is the lowest-risk professional approach to secret management.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const SERVICE_NAME = 'freedom-cli';

export class SecretManager {
  private envPath: string;
  private keytar: any = null;
  private keytarLoaded: boolean = false;

  constructor(dataDir: string) {
    this.envPath = path.join(dataDir, '.env');
  }

  /**
   * Try to load the native 'keytar' module.
   * Keytar is a native dependency and may fail to load in some environments.
   */
  private async getKeytar() {
    if (this.keytarLoaded) return this.keytar;
    
    try {
      // Use dynamic import for native module
      const module = await import('keytar');
      this.keytar = module.default || module;
    } catch (e) {
      // Silently fall back to .env if keytar is unavailable
      this.keytar = null;
    } finally {
      this.keytarLoaded = true;
    }
    return this.keytar;
  }

  /**
   * Load secrets from both Keychain and .env into process.env
   */
  public async load(): Promise<void> {
    // 1. Load from .env file (Fallback)
    if (fs.existsSync(this.envPath)) {
      dotenv.config({ path: this.envPath, override: true });
    }

    // 2. Load from System Keychain (Primary)
    const keytar = await this.getKeytar();
    if (keytar) {
      try {
        const credentials = await keytar.findCredentials(SERVICE_NAME);
        for (const cred of credentials) {
          process.env[cred.account] = cred.password;
        }
      } catch (e) {
        // Keychain access might be denied or unavailable
      }
    }
  }

  /**
   * Securely save a key-value pair
   */
  public async save(key: string, value: string): Promise<void> {
    // Try Keychain first
    const keytar = await this.getKeytar();
    let savedInKeychain = false;

    if (keytar) {
      try {
        await keytar.setPassword(SERVICE_NAME, key, value);
        savedInKeychain = true;
      } catch (e) {
        // Keychain failed, fall through to .env
      }
    }

    // Always mirror to .env as secondary/fallback storage 
    // (This ensures persistence even if Keychain becomes unavailable)
    let content = '';
    if (fs.existsSync(this.envPath)) {
      content = fs.readFileSync(this.envPath, 'utf-8');
    }

    const lines = content.split('\n').filter(line => line.trim() !== '');
    const newLines = lines.filter(line => !line.startsWith(`${key}=`));
    newLines.push(`${key}="${value}"`);

    const newContent = newLines.join('\n') + '\n';
    fs.writeFileSync(this.envPath, newContent, { mode: 0o600 });
    
    // Update current process immediately
    process.env[key] = value;
  }

  /**
   * Remove a secret
   */
  public async remove(key: string): Promise<void> {
    // Remove from Keychain
    const keytar = await this.getKeytar();
    if (keytar) {
      try {
        await keytar.deletePassword(SERVICE_NAME, key);
      } catch (e) {}
    }

    // Remove from .env
    if (fs.existsSync(this.envPath)) {
      const content = fs.readFileSync(this.envPath, 'utf-8');
      const lines = content.split('\n');
      const newLines = lines.filter(line => !line.startsWith(`${key}=`));
      fs.writeFileSync(this.envPath, newLines.join('\n'), { mode: 0o600 });
    }

    delete process.env[key];
  }
}
