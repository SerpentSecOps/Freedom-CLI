/**
 * Type definitions for LSP (Language Server Protocol) integration
 */

/**
 * LSP server configuration
 */
export interface LSPServerConfig {
  /** Command to start the LSP server */
  command: string;
  /** Command arguments */
  args?: string[];
  /** File extension to language ID mapping */
  extensionToLanguage?: Record<string, string>;
  /** Startup timeout in milliseconds */
  startupTimeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
}

/**
 * LSP server state
 */
export type LSPServerState = 'stopped' | 'starting' | 'running' | 'failed';

/**
 * LSP Position (line and character)
 */
export interface Position {
  /** Line number (0-based) */
  line: number;
  /** Character offset (0-based) */
  character: number;
}

/**
 * LSP Range
 */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * LSP Location
 */
export interface Location {
  uri: string;
  range: Range;
}

/**
 * LSP Diagnostic severity
 */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

/**
 * LSP Diagnostic
 */
export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
}

/**
 * LSP Symbol information
 */
export interface SymbolInformation {
  name: string;
  kind: number;
  location: Location;
  containerName?: string;
}

/**
 * LSP Hover information
 */
export interface Hover {
  contents: string | string[];
  range?: Range;
}

/**
 * LSP Completion item
 */
export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

/**
 * LSP operation types
 */
export type LSPOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'completion'
  | 'goToImplementation'
  | 'prepareCallHierarchy'
  | 'incomingCalls'
  | 'outgoingCalls';

/**
 * LSP request parameters
 */
export interface LSPRequestParams {
  /** File path (URI) */
  filePath: string;
  /** Position in file */
  position?: Position;
  /** Query string (for workspace symbol) */
  query?: string;
}

/**
 * LSP response
 */
export interface LSPResponse<T = any> {
  success: boolean;
  result?: T;
  error?: string;
}

/**
 * Call hierarchy item
 */
export interface CallHierarchyItem {
  name: string;
  kind: number;
  uri: string;
  range: Range;
  selectionRange: Range;
}

/**
 * Incoming call
 */
export interface CallHierarchyIncomingCall {
  from: CallHierarchyItem;
  fromRanges: Range[];
}

/**
 * Outgoing call
 */
export interface CallHierarchyOutgoingCall {
  to: CallHierarchyItem;
  fromRanges: Range[];
}
