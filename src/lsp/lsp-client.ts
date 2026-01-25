/**
 * LSP Client - communicates with language servers via JSON-RPC
 */

import { spawn, ChildProcess } from 'child_process';
import {
  StreamMessageReader,
  StreamMessageWriter,
  createMessageConnection,
  MessageConnection,
} from 'vscode-jsonrpc/node.js';
import { pathToFileURL } from 'url';
import type {
  LSPServerConfig,
  LSPServerState,
  Position,
  Location,
  Hover,
  SymbolInformation,
  CompletionItem,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  LSPResponse,
} from './lsp-types.js';

/**
 * LSP Client for a single language server
 */
export class LSPClient {
  private config: LSPServerConfig;
  private state: LSPServerState = 'stopped';
  private serverProcess: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private initializePromise: Promise<void> | null = null;

  constructor(config: LSPServerConfig) {
    this.config = config;
  }

  /**
   * Start the language server
   */
  async start(): Promise<void> {
    if (this.state !== 'stopped') {
      throw new Error(`LSP server is already ${this.state}`);
    }

    this.state = 'starting';

    try {
      // Spawn the language server process
      this.serverProcess = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...this.config.env },
        cwd: this.config.cwd || process.cwd(),
      });

      if (!this.serverProcess.stdout || !this.serverProcess.stdin) {
        throw new Error('Failed to create LSP server process streams');
      }

      // Create JSON-RPC connection
      const reader = new StreamMessageReader(this.serverProcess.stdout);
      const writer = new StreamMessageWriter(this.serverProcess.stdin);
      this.connection = createMessageConnection(reader, writer);

      // Handle server errors
      this.serverProcess.on('error', (error) => {
        console.error('LSP server process error:', error);
        this.state = 'failed';
      });

      this.serverProcess.on('exit', (code) => {
        console.log(`LSP server exited with code ${code}`);
        this.state = 'stopped';
      });

      // Start listening
      this.connection.listen();

      this.state = 'running';
    } catch (error: any) {
      this.state = 'failed';
      throw new Error(`Failed to start LSP server: ${error.message}`);
    }
  }

  /**
   * Initialize the language server
   */
  async initialize(rootPath: string): Promise<void> {
    if (!this.connection) {
      throw new Error('LSP server not started');
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = (async () => {
      const initParams = {
        processId: process.pid,
        rootUri: pathToFileURL(rootPath).toString(),
        capabilities: {
          textDocument: {
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            hover: { dynamicRegistration: false },
            documentSymbol: { dynamicRegistration: false },
            completion: { dynamicRegistration: false },
          },
          workspace: {
            symbol: { dynamicRegistration: false },
          },
        },
      };

      await this.connection!.sendRequest('initialize', initParams);
      await this.connection!.sendNotification('initialized', {});
    })();

    return this.initializePromise;
  }

  /**
   * Shutdown the language server
   */
  async shutdown(): Promise<void> {
    if (this.connection) {
      try {
        await this.connection.sendRequest('shutdown', null);
        await this.connection.sendNotification('exit', null);
        this.connection.dispose();
      } catch (error) {
        // Ignore errors during shutdown
      }
      this.connection = null;
    }

    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }

    this.state = 'stopped';
    this.initializePromise = null;
  }

  /**
   * Go to definition
   */
  async goToDefinition(
    filePath: string,
    line: number,
    character: number
  ): Promise<LSPResponse<Location[]>> {
    try {
      const result = await this.sendRequest('textDocument/definition', {
        textDocument: { uri: pathToFileURL(filePath).toString() },
        position: { line, character },
      });

      const locations = Array.isArray(result) ? result : result ? [result] : [];

      return {
        success: true,
        result: locations,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Find references
   */
  async findReferences(
    filePath: string,
    line: number,
    character: number
  ): Promise<LSPResponse<Location[]>> {
    try {
      const result = await this.sendRequest('textDocument/references', {
        textDocument: { uri: pathToFileURL(filePath).toString() },
        position: { line, character },
        context: { includeDeclaration: true },
      });

      return {
        success: true,
        result: result || [],
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get hover information
   */
  async hover(
    filePath: string,
    line: number,
    character: number
  ): Promise<LSPResponse<Hover>> {
    try {
      const result = await this.sendRequest('textDocument/hover', {
        textDocument: { uri: pathToFileURL(filePath).toString() },
        position: { line, character },
      });

      return {
        success: true,
        result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get document symbols
   */
  async documentSymbol(filePath: string): Promise<LSPResponse<SymbolInformation[]>> {
    try {
      const result = await this.sendRequest('textDocument/documentSymbol', {
        textDocument: { uri: pathToFileURL(filePath).toString() },
      });

      return {
        success: true,
        result: result || [],
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Search workspace symbols
   */
  async workspaceSymbol(query: string): Promise<LSPResponse<SymbolInformation[]>> {
    try {
      const result = await this.sendRequest('workspace/symbol', { query });

      return {
        success: true,
        result: result || [],
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get completion items
   */
  async completion(
    filePath: string,
    line: number,
    character: number
  ): Promise<LSPResponse<CompletionItem[]>> {
    try {
      const result = await this.sendRequest('textDocument/completion', {
        textDocument: { uri: pathToFileURL(filePath).toString() },
        position: { line, character },
      });

      const items = result?.items || result || [];

      return {
        success: true,
        result: items,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send a request to the language server
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    if (!this.connection) {
      throw new Error('LSP server not started');
    }

    if (!this.initializePromise) {
      throw new Error('LSP server not initialized');
    }

    await this.initializePromise;

    return await this.connection.sendRequest(method, params);
  }

  /**
   * Get current state
   */
  getState(): LSPServerState {
    return this.state;
  }

  /**
   * Check if server is ready
   */
  isReady(): boolean {
    return this.state === 'running' && this.initializePromise !== null;
  }
}
