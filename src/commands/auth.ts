/**
 * Authentication commands for Freedom CLI
 */

import { Command } from 'commander';
import { GoogleOAuthProvider } from '../auth/google-auth-provider.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

interface AuthStatus {
  authenticated: boolean;
  method?: 'google-oauth' | 'api-key';
  user?: string;
  email?: string;
}

export class AuthManager {
  private googleAuth?: GoogleOAuthProvider;

  async getStatus(): Promise<AuthStatus> {
    const status: AuthStatus = { authenticated: false };

    // Check for API key first
    if (process.env.GEMINI_API_KEY) {
      status.authenticated = true;
      status.method = 'api-key';
      return status;
    }

    // Check for Google OAuth authentication
    try {
      const googleAuth = new GoogleOAuthProvider();
      const isAuthenticated = await googleAuth.isAuthenticated();
      
      if (isAuthenticated) {
        const userInfo = await googleAuth.getUserInfo();
        status.authenticated = true;
        status.method = 'google-oauth';
        status.user = userInfo?.name;
        status.email = userInfo?.email;
        return status;
      }
    } catch (error) {
      // Continue checking other methods
    }

    return status;
  }

  async loginWithGoogle(): Promise<boolean> {
    try {
      console.log(chalk.blue('🔐 Starting Google authentication...\n'));

      // Check if user is already authenticated
      const status = await this.getStatus();
      if (status.authenticated && status.method === 'google-oauth') {
        console.log(chalk.green(`✅ Already authenticated as ${status.user} (${status.email})`));
        return true;
      }

      const googleAuth = new GoogleOAuthProvider();
      const success = await googleAuth.performLogin();
      
      if (success) {
        console.log(chalk.green('\n🎉 Ready to use your Google AI Pro subscription with Freedom CLI!'));
        return true;
      } else {
        console.log(chalk.red('\n❌ Authentication failed. Please try again.'));
        return false;
      }
    } catch (error) {
      console.error(chalk.red('❌ Authentication failed:'), error);
      return false;
    }
  }

  async logout(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      
      if (!status.authenticated) {
        console.log(chalk.yellow('ℹ️  No active authentication found'));
        return true;
      }

      console.log(chalk.blue('🔓 Logging out...'));

      if (status.method === 'google-oauth') {
        const googleAuth = new GoogleOAuthProvider();
        await googleAuth.logout();
        console.log(chalk.green('✅ Google authentication cleared'));
      }

      console.log(chalk.green('\n✅ Logout completed'));
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Logout failed:'), error);
      return false;
    }
  }

  async showStatus(): Promise<void> {
    try {
      console.log(chalk.blue('🔍 Checking authentication status...\n'));
      
      const status = await this.getStatus();
      
      if (status.authenticated) {
        console.log(chalk.green('✅ Authenticated'));
        console.log(chalk.gray(`   Method: ${status.method}`));
        
        if (status.method === 'google-oauth') {
          console.log(chalk.gray(`   User: ${status.user}`));
          console.log(chalk.gray(`   Email: ${status.email}`));
          console.log(chalk.gray('\n   Available services:'));
          console.log(chalk.gray('   • Google AI Pro / Gemini'));
          console.log(chalk.gray('   • Generative Language API'));
        } else if (status.method === 'api-key') {
          console.log(chalk.gray('\n   Using API key authentication'));
          console.log(chalk.gray('   Note: For full subscription features, use "freedom auth login"'));
        }
      } else {
        console.log(chalk.red('❌ Not authenticated'));
        console.log(chalk.gray('\n   To authenticate with your Google AI Pro subscription:'));
        console.log(chalk.cyan('   freedom auth login'));
        console.log(chalk.gray('\n   Or set an API key:'));
        console.log(chalk.cyan('   export GEMINI_API_KEY="your-api-key"'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Failed to check status:'), error);
    }
  }
}

export function createAuthCommand(): Command {
  const authManager = new AuthManager();
  const auth = new Command('auth');
  
  auth.description('Manage authentication for Google AI services');

  auth
    .command('login')
    .description('Login with Google account (for AI Pro subscription)')
    .action(async () => {
      const success = await authManager.loginWithGoogle();
      process.exit(success ? 0 : 1);
    });

  auth
    .command('logout')
    .description('Logout and clear credentials')
    .action(async () => {
      const success = await authManager.logout();
      process.exit(success ? 0 : 1);
    });

  auth
    .command('status')
    .description('Show authentication status')
    .action(async () => {
      await authManager.showStatus();
    });

  return auth;
}