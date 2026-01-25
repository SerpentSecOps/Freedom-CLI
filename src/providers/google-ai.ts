/**
 * Google AI Provider - Adapted from gemini-cli
 * 
 * This implementation follows gemini-cli's architecture for:
 * - Code Assist API integration (server.ts, converter.ts)
 * - Streaming SSE responses (requestStreamingPost)
 * - Retry with backoff (retry.ts)
 * - Error classification (googleQuotaErrors.ts)
 * - User setup/onboarding (setup.ts)
 * 
 * @license Apache-2.0 (adapted from Google's gemini-cli)
 */

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js';
import type { ToolDefinition } from '../types.js';
import { LLMProvider, type ProviderConfig, type CompletionResult, type StreamOptions } from './base.js';
import { GoogleOAuthProvider } from '../auth/google-auth-provider.js';
import { classifyGoogleError, RetryableQuotaError, TerminalQuotaError, ModelNotFoundError, getErrorStatus } from './google-quota-errors.js';
import type { OAuth2Client } from 'google-auth-library';
import * as readline from 'node:readline';

// Constants from gemini-cli
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';
// DEFAULT_RETRY_OPTIONS from gemini-cli retry.ts
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 5000;
const DEFAULT_MAX_DELAY_MS = 30000; // 30 seconds

// Retryable network error codes from gemini-cli
const RETRYABLE_NETWORK_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
];

interface UserData {
  projectId: string;
  userTier: string;
}

export class GoogleAIProvider extends LLMProvider {
  // Cache for user setup data (like gemini-cli)
  private static userDataCache = new Map<string, UserData>();
  
  // Cached auth client (like gemini-cli's CodeAssistServer)
  private authClient: OAuth2Client | null = null;
  private sessionId: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Track if we've shown the working message this turn
  private shownWorkingMessage = false;

  async streamCompletion(
    messages: MessageParam[],
    tools: ToolDefinition[],
    options?: StreamOptions
  ): Promise<CompletionResult> {
    // Show working indicator only once per user turn (not on tool result continuations)
    const lastMessage = messages[messages.length - 1];
    const isToolResult = Array.isArray(lastMessage?.content) && 
      lastMessage.content.some((block: any) => block.type === 'tool_result');
    
    if (options?.onTextDelta && !isToolResult && !this.shownWorkingMessage) {
      options.onTextDelta('🔄 Working...\n');
      this.shownWorkingMessage = true;
    }
    
    const result = await this.retryWithBackoff(
      () => this.executeStreamingRequest(messages, tools, undefined), // Don't pass options to suppress streaming
      {
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
        maxDelayMs: DEFAULT_MAX_DELAY_MS,
        silent: true, // Suppress retry messages
      }
    );
    
    // Reset working message flag when we get a final response (no tool calls)
    if (!result.toolCalls || result.toolCalls.length === 0) {
      this.shownWorkingMessage = false;
    }
    
    // Display the complete response after it finishes
    if (options?.onTextDelta && result.content) {
      for (const block of result.content) {
        if (block.type === 'text' && block.text) {
          options.onTextDelta(block.text);
        }
      }
    }
    
    return result;
  }

  getProviderName(): string {
    return 'Google AI';
  }

  isReasoningModel(): boolean {
    return false;
  }

  /**
   * Get authenticated OAuth2Client (like gemini-cli's CodeAssistServer)
   * Uses google-auth-library which handles token refresh automatically
   */
  private async getAuthenticatedClient(): Promise<OAuth2Client> {
    if (!this.authClient) {
      const authProvider = GoogleOAuthProvider.getInstance();
      this.authClient = await authProvider.getAuthClient();
    }
    
    if (!this.authClient) {
      throw new Error('OAuth authentication required. Run "freedom auth login"');
    }
    
    return this.authClient;
  }

  /**
   * Execute the streaming request - adapted from gemini-cli CodeAssistServer.requestStreamingPost
   * Uses google-auth-library's AuthClient.request() which handles token refresh automatically
   */
  private async executeStreamingRequest(
    messages: MessageParam[],
    tools: ToolDefinition[],
    options?: StreamOptions
  ): Promise<CompletionResult> {
    const controller = this.createAbortController();
    
    // Get authenticated client (like gemini-cli)
    const client = await this.getAuthenticatedClient();

    // Setup user if needed (like gemini-cli setupUser)
    const userData = await this.setupUser(client);

    // Build request exactly like gemini-cli toGenerateContentRequest
    const requestBody = this.buildGenerateContentRequest(messages, tools, userData.projectId);

    // Debug: log request for troubleshooting
    if (process.env.DEBUG_GOOGLE) {
      console.error('\n[DEBUG] Google API Request:');
      console.error(JSON.stringify(requestBody, null, 2).slice(0, 2000));
    }

    // Use streaming endpoint like gemini-cli CodeAssistServer.requestStreamingPost
    // The AuthClient.request() method handles token refresh automatically
    const response = await client.request({
      url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent`,
      method: 'POST',
      params: {
        alt: 'sse',  // Request SSE format like gemini-cli
      },
      headers: {
        'Content-Type': 'application/json',
      },
      responseType: 'stream',
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    // Process streaming response like gemini-cli requestStreamingPost
    return this.processStreamingResponse(response.data as NodeJS.ReadableStream, options);
  }

  /**
   * Process SSE streaming response - EXACT copy of gemini-cli requestStreamingPost pattern
   * Uses readline interface like gemini-cli does
   */
  private async processStreamingResponse(
    stream: NodeJS.ReadableStream,
    options?: StreamOptions
  ): Promise<CompletionResult> {
    const content: any[] = [];
    const toolCalls: any[] = [];
    let finishReason: string | undefined;

    // Use readline like gemini-cli requestStreamingPost
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity, // Recognizes '\r\n' and '\n' as line breaks (like gemini-cli)
    });

    let bufferedLines: string[] = [];
    
    for await (const line of rl) {
      if (line.startsWith('data: ')) {
        bufferedLines.push(line.slice(6).trim());
      } else if (line === '') {
        if (bufferedLines.length === 0) {
          continue; // no data to yield
        }
        
        try {
          const chunk = JSON.parse(bufferedLines.join('\n'));
          
          // Check for error in the response
          if (chunk.error) {
            const error = new Error(chunk.error.message || 'API error in stream');
            (error as any).status = chunk.error.code;
            throw error;
          }
          
          this.processChunk(chunk, content, toolCalls, options);
          
          // Check for finish reason
          const candidate = chunk.response?.candidates?.[0] || chunk.candidates?.[0];
          if (candidate?.finishReason) {
            finishReason = candidate.finishReason;
          }
        } catch (e: any) {
          // If it's an actual API error, rethrow
          if (e.status) {
            throw e;
          }
          // Ignore JSON parse errors
        }
        
        bufferedLines = []; // Reset the buffer after processing (like gemini-cli)
      }
      // Ignore other lines like comments or id fields (like gemini-cli)
    }

    // If no content was collected, add empty text
    if (content.length === 0) {
      content.push({ type: 'text' as const, text: '' });
    }

    return {
      content,
      stopReason: finishReason === 'STOP' ? 'end_turn' : (toolCalls.length > 0 ? 'tool_use' : 'end_turn'),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /**
   * Process a single streaming chunk - adapted from gemini-cli Turn.run
   */
  private processChunk(
    chunk: any,
    content: any[],
    toolCalls: any[],
    options?: StreamOptions
  ): void {
    const responseData = chunk.response || chunk;
    const candidate = responseData.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    for (const part of parts) {
      // Handle text parts
      if (part.text) {
        // Check if we already have a text block we can append to
        const lastContent = content[content.length - 1];
        if (lastContent && lastContent.type === 'text') {
          lastContent.text += part.text;
        } else {
          content.push({
            type: 'text' as const,
            text: part.text,
          });
        }
        
        // Stream text delta
        if (options?.onTextDelta) {
          options.onTextDelta(part.text);
        }
      }

      // Handle function calls
      if (part.functionCall) {
        const callId = part.functionCall.id || 
          `${part.functionCall.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        
        const toolUse = {
          type: 'tool_use' as const,
          id: callId,
          name: part.functionCall.name,
          input: part.functionCall.args || {},
        };
        content.push(toolUse);
        toolCalls.push(toolUse);
      }
    }
  }

  /**
   * Build generate content request - adapted from gemini-cli toGenerateContentRequest
   */
  private buildGenerateContentRequest(
    messages: MessageParam[],
    tools: ToolDefinition[],
    projectId: string
  ): any {
    // Extract system message for systemInstruction
    const systemMessage = messages.find(m => (m.role as string) === 'system');
    const systemInstruction = systemMessage && typeof systemMessage.content === 'string' 
      ? { role: 'user', parts: [{ text: systemMessage.content }] }
      : undefined;
    
    const contents = this.convertMessagesToGemini(messages);
    
    const request: any = {
      model: this.config.model,
      project: projectId,
      user_prompt_id: `prompt-${Date.now()}`,
      request: {
        contents,
        generationConfig: {
          temperature: this.config.temperature,
          maxOutputTokens: this.config.maxTokens,
        },
        session_id: this.sessionId,
      },
    };

    // Add system instruction if present
    if (systemInstruction) {
      request.request.systemInstruction = systemInstruction;
    }

    // Add tools if provided
    if (tools.length > 0) {
      request.request.tools = [{
        functionDeclarations: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        })),
      }];
    }

    return request;
  }

  /**
   * Convert messages to Gemini format - adapted from gemini-cli converter.ts
   */
  private convertMessagesToGemini(messages: MessageParam[]): any[] {
    const geminiContents: any[] = [];
    
    // Build a map of tool_use_id -> tool_name from assistant messages
    // Google's API requires the tool name in functionResponse, but the standard
    // Anthropic format only includes tool_use_id in tool_result blocks
    const toolIdToName = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ((block as any).type === 'tool_use') {
            const toolBlock = block as any;
            toolIdToName.set(toolBlock.id, toolBlock.name);
          }
        }
      }
    }
    
    for (const msg of messages) {
      // Skip system messages - they should be handled separately via systemInstruction
      if ((msg.role as string) === 'system') {
        continue;
      }
      
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];
      
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === 'string') {
            parts.push({ text: block });
          } else if (block.type === 'text') {
            parts.push({ text: (block as any).text || '' });
          } else if (block.type === 'tool_use') {
            // Convert to Gemini functionCall
            const toolBlock = block as any;
            parts.push({
              functionCall: {
                id: toolBlock.id,
                name: toolBlock.name,
                args: toolBlock.input || {},
              },
            });
          } else if (block.type === 'tool_result') {
            // Convert to Gemini functionResponse
            // Look up tool name from the map we built, fallback to 'tool' if not found
            const resultBlock = block as any;
            const toolName = toolIdToName.get(resultBlock.tool_use_id) || 'tool';
            parts.push({
              functionResponse: {
                id: resultBlock.tool_use_id,
                name: toolName,
                response: { 
                  output: typeof resultBlock.content === 'string' 
                    ? resultBlock.content 
                    : JSON.stringify(resultBlock.content) 
                },
              },
            });
          } else if (block.type === 'image') {
            // Handle image blocks
            const imageBlock = block as any;
            parts.push({
              inlineData: {
                mimeType: imageBlock.source?.media_type || 'image/png',
                data: imageBlock.source?.data || '',
              },
            });
          }
        }
      }
      
      if (parts.length > 0) {
        geminiContents.push({ role, parts });
      }
    }
    
    return geminiContents;
  }

  /**
   * Setup user - adapted from gemini-cli setup.ts setupUser
   * Uses OAuth2Client.request() for automatic token management
   */
  private async setupUser(client: OAuth2Client): Promise<UserData> {
    // Use a stable cache key based on credentials
    const cacheKey = 'user-setup';
    
    if (GoogleAIProvider.userDataCache.has(cacheKey)) {
      return GoogleAIProvider.userDataCache.get(cacheKey)!;
    }

    const clientMetadata = {
      ideType: 'GEMINI_CLI',
      platform: this.getPlatform(),
      pluginType: 'GEMINI',
    };

    // Step 1: loadCodeAssist - use client.request() like gemini-cli
    const loadResponse = await client.request({
      url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cloudaicompanionProject: undefined,
        metadata: clientMetadata,
      }),
    });

    const loadData: any = loadResponse.data;
    
    // If already onboarded, return the data
    if (loadData.currentTier && loadData.cloudaicompanionProject) {
      const userData: UserData = {
        projectId: loadData.cloudaicompanionProject,
        userTier: loadData.currentTier.id || 'standard-tier',
      };
      GoogleAIProvider.userDataCache.set(cacheKey, userData);
      return userData;
    }

    // Step 2: onboardUser if needed
    const tierId = this.getOnboardTier(loadData);
    const projectId = loadData.cloudaicompanionProject;

    const onboardRequest: any = {
      tierId,
      cloudaicompanionProject: tierId === 'free-tier' ? undefined : projectId,
      metadata: {
        ...clientMetadata,
        duetProject: projectId,
      },
    };

    // Poll onboardUser until done (like gemini-cli)
    let done = false;
    let finalProjectId = projectId;
    
    while (!done) {
      const onboardResponse = await client.request({
        url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:onboardUser`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(onboardRequest),
      });

      const onboardData: any = onboardResponse.data;
      done = onboardData.done === true;
      
      if (onboardData.response?.cloudaicompanionProject?.id) {
        finalProjectId = onboardData.response.cloudaicompanionProject.id;
      }

      if (!done) {
        await this.delay(5000); // Poll every 5 seconds like gemini-cli
      }
    }

    const userData: UserData = {
      projectId: finalProjectId || projectId,
      userTier: tierId,
    };
    GoogleAIProvider.userDataCache.set(cacheKey, userData);
    return userData;
  }

  /**
   * Get the tier to onboard to - adapted from gemini-cli getOnboardTier
   */
  private getOnboardTier(loadResponse: any): string {
    const allowedTiers = loadResponse.allowedTiers || [];
    for (const tier of allowedTiers) {
      if (tier.isDefault) {
        return tier.id;
      }
    }
    return 'standard-tier';
  }

  /**
   * Get platform string for client metadata
   */
  private getPlatform(): string {
    const platform = process.platform;
    const arch = process.arch;
    
    if (platform === 'darwin') {
      return arch === 'arm64' ? 'DARWIN_ARM64' : 'DARWIN_AMD64';
    } else if (platform === 'linux') {
      return arch === 'arm64' ? 'LINUX_ARM64' : 'LINUX_AMD64';
    } else if (platform === 'win32') {
      return 'WINDOWS_AMD64';
    }
    return 'PLATFORM_UNSPECIFIED';
  }

  /**
   * Get OAuth token
   */
  private async getAuthToken(): Promise<string | null> {
    const authProvider = GoogleOAuthProvider.getInstance();
    const tokens = await authProvider.tokens();
    return tokens?.access_token || null;
  }

  /**
   * Clear cached token (e.g., on 401 errors) to force refresh
   */
  private clearCachedToken(): void {
    const authProvider = GoogleOAuthProvider.getInstance();
    authProvider.clearCache();
  }

  /**
   * Retry with backoff - EXACT copy from gemini-cli retry.ts retryWithBackoff
   * 
   * Default values match gemini-cli DEFAULT_RETRY_OPTIONS:
   * - maxAttempts: 3
   * - initialDelayMs: 5000
   * - maxDelayMs: 30000
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: {
      maxAttempts: number;
      initialDelayMs: number;
      maxDelayMs: number;
      silent?: boolean; // Suppress retry messages
    }
  ): Promise<T> {
    const { maxAttempts, initialDelayMs, maxDelayMs, silent } = options;
    
    let attempt = 0;
    let currentDelay = initialDelayMs;

    while (attempt < maxAttempts) {
      // Check abort before each attempt (like gemini-cli)
      if (this.abortController?.signal?.aborted) {
        throw this.createAbortError();
      }

      attempt++;
      
      try {
        const result = await fn();
        // Success - return result (gemini-cli marks model healthy here)
        return result;
      } catch (error: any) {
        // Handle abort errors (like gemini-cli)
        if (error.name === 'AbortError' || this.abortController?.signal?.aborted) {
          throw error;
        }

        // Classify the error (like gemini-cli)
        const classifiedError = classifyGoogleError(error);
        const errorStatus = getErrorStatus(error);

        // Handle TerminalQuotaError or ModelNotFoundError - don't retry (like gemini-cli)
        if (classifiedError instanceof TerminalQuotaError || classifiedError instanceof ModelNotFoundError) {
          // gemini-cli calls onPersistent429 here for fallback - we just throw
          throw classifiedError;
        }

        // Handle 401 specifically - clear token cache and retry
        // (This is Freedom CLI specific - gemini-cli doesn't need this)
        if (errorStatus === 401) {
          if (attempt < maxAttempts) {
            if (!silent) console.log(`🔐 Token expired. Refreshing...`);
            this.clearCachedToken();
            continue;
          }
        }

        const is500 = errorStatus !== undefined && errorStatus >= 500 && errorStatus < 600;

        // Handle RetryableQuotaError or 5xx (like gemini-cli lines 221-267)
        if (classifiedError instanceof RetryableQuotaError || is500) {
          if (attempt >= maxAttempts) {
            // Max attempts reached (like gemini-cli lines 222-245)
            const errorMessage = classifiedError instanceof Error ? classifiedError.message : '';
            if (!silent) console.log(`⚠️  Attempt ${attempt} failed${errorMessage ? `: ${errorMessage}` : ''}. Max attempts reached`);
            throw classifiedError instanceof RetryableQuotaError ? classifiedError : error;
          }

          // Use API-provided delay if available (like gemini-cli lines 248-256)
          if (classifiedError instanceof RetryableQuotaError && classifiedError.retryDelayMs !== undefined) {
            if (!silent) console.log(`🕐 Attempt ${attempt} failed: ${classifiedError.message}. Retrying after ${classifiedError.retryDelayMs}ms...`);
            await this.delay(classifiedError.retryDelayMs);
            continue;
          } else {
            // Exponential backoff with jitter (like gemini-cli lines 261-266)
            if (!silent) this.logRetryAttempt(attempt, error, errorStatus);
            const jitter = currentDelay * 0.3 * (Math.random() * 2 - 1);
            const delayWithJitter = Math.max(0, currentDelay + jitter);
            await this.delay(delayWithJitter);
            currentDelay = Math.min(maxDelayMs, currentDelay * 2);
            continue;
          }
        }

        // Generic retry logic for other errors (like gemini-cli lines 270-286)
        if (attempt >= maxAttempts || !this.isRetryableError(error)) {
          throw error;
        }

        if (!silent) this.logRetryAttempt(attempt, error, errorStatus);
        
        // Exponential backoff with jitter
        const jitter = currentDelay * 0.3 * (Math.random() * 2 - 1);
        const delayWithJitter = Math.max(0, currentDelay + jitter);
        await this.delay(delayWithJitter);
        currentDelay = Math.min(maxDelayMs, currentDelay * 2);
      }
    }

    throw new Error('Retry attempts exhausted');
  }

  /**
   * Create abort error (like gemini-cli delay.ts createAbortError)
   */
  private createAbortError(): Error {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    return abortError;
  }

  /**
   * Check if error is retryable (like gemini-cli isRetryableError)
   */
  private isRetryableError(error: any): boolean {
    // Check for common network error codes
    const errorCode = this.getNetworkErrorCode(error);
    if (errorCode && RETRYABLE_NETWORK_CODES.includes(errorCode)) {
      return true;
    }

    // Check for fetch failed message
    if (error instanceof Error && error.message.toLowerCase().includes('fetch failed')) {
      return true;
    }

    // Check status (like gemini-cli lines 103-116)
    const status = getErrorStatus(error);
    if (status !== undefined) {
      // Do NOT retry 400 (Bad Request)
      if (status === 400) return false;
      return status === 429 || (status >= 500 && status < 600);
    }

    return false;
  }

  /**
   * Log retry attempt (like gemini-cli logRetryAttempt)
   */
  private logRetryAttempt(attempt: number, error: unknown, errorStatus?: number): void {
    let message = `⚠️  Attempt ${attempt} failed. Retrying with backoff...`;
    if (errorStatus) {
      message = `⚠️  Attempt ${attempt} failed with status ${errorStatus}. Retrying with backoff...`;
    }
    console.log(message);
  }

  /**
   * Get network error code from error object (like gemini-cli getNetworkErrorCode)
   */
  private getNetworkErrorCode(error: any): string | undefined {
    const getCode = (obj: unknown): string | undefined => {
      if (typeof obj !== 'object' || obj === null) return undefined;
      if ('code' in obj && typeof (obj as any).code === 'string') {
        return (obj as any).code;
      }
      return undefined;
    };

    const directCode = getCode(error);
    if (directCode) return directCode;

    if (typeof error === 'object' && error !== null && 'cause' in error) {
      return getCode((error as any).cause);
    }

    return undefined;
  }

  /**
   * Delay utility with abort support
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      
      const signal = this.abortController?.signal;
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeout);
          reject(new Error('Operation aborted'));
          return;
        }
        
        const onAbort = () => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', onAbort);
          reject(new Error('Operation aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}
