/**
 * Path Info tool - Normalize and structure file paths for LLMs
 */

import path from 'path';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';

type PathType =
  | 'windows_absolute'
  | 'windows_unc'
  | 'windows_relative'
  | 'unix_absolute'
  | 'unix_home'
  | 'unix_relative'
  | 'mac_absolute'
  | 'network_path'
  | 'url_path'
  | 'wsl_path'
  | 'unknown';

type ComponentType = 'drive' | 'directory' | 'file' | 'special';

interface PathComponent {
  name: string;
  type: ComponentType;
  is_hidden: boolean;
  extension?: string | null;
}

interface PathInfoResult {
  original: string;
  normalized: string;
  type: PathType;
  components: PathComponent[];
  is_absolute: boolean;
  is_file: boolean;
  file_info?: {
    filename: string;
    name_without_extension: string;
    extension?: string | null;
    is_hidden: boolean;
  } | null;
  current_os: 'windows' | 'macos' | 'unix';
  cross_platform_info: {
    windows: boolean;
    unix: boolean;
    macos: boolean;
    notes: string[];
  };
}

const URL_PREFIXES = ['http://', 'https://', 'ftp://', 'file://'];

function detectCurrentOS(): 'windows' | 'macos' | 'unix' {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'unix';
}

function detectPathType(inputPath: string): PathType {
  const trimmed = inputPath.trim();

  if (URL_PREFIXES.some(prefix => trimmed.startsWith(prefix))) {
    return 'url_path';
  }

  if (trimmed.startsWith('\\\\')) {
    return 'windows_unc';
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return 'windows_absolute';
  }

  if (trimmed.includes('\\') && !trimmed.startsWith('/')) {
    return 'windows_relative';
  }

  if (trimmed.startsWith('~')) {
    return 'unix_home';
  }

  if (trimmed.startsWith('//')) {
    return 'network_path';
  }

  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('/mnt/')) return 'wsl_path';
    if (trimmed.startsWith('/Volumes/')) return 'mac_absolute';
    return 'unix_absolute';
  }

  return 'unix_relative';
}

function normalizePath(inputPath: string): string {
  let normalized = inputPath.replace(/\\/g, '/');
  const hasUNC = normalized.startsWith('//');
  const driveMatch = normalized.match(/^[A-Za-z]:/);

  if (driveMatch) {
    normalized = normalized[0].toUpperCase() + normalized.slice(1);
  }

  // Collapse duplicate slashes, preserving UNC prefix.
  if (hasUNC) {
    normalized = '//' + normalized.slice(2).replace(/\/{2,}/g, '/');
  } else {
    normalized = normalized.replace(/\/{2,}/g, '/');
  }

  const prefix =
    hasUNC
      ? '//'
      : driveMatch
        ? `${normalized.slice(0, 2)}/`
        : normalized.startsWith('/')
          ? '/'
          : '';

  const remainder = prefix ? normalized.slice(prefix.length) : normalized;
  const parts = remainder.split('/').filter(Boolean);
  const stack: string[] = [];

  for (const part of parts) {
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else {
        stack.push('..');
      }
    } else if (part !== '.' && part !== '') {
      stack.push(part);
    }
  }

  const joined = stack.join('/');
  if (driveMatch) {
    return prefix + (joined ? joined : '');
  }
  if (prefix) {
    return prefix + joined;
  }
  return joined;
}

function splitComponents(inputPath: string, pathType: PathType): string[] {
  if (pathType === 'windows_unc' || pathType === 'windows_absolute' || pathType === 'windows_relative') {
    return inputPath.split(/[\\/]+/).filter(Boolean);
  }
  return inputPath.split('/').filter(Boolean);
}

function extractFileInfo(inputPath: string): PathInfoResult['file_info'] {
  const base = path.basename(inputPath);
  const ext = path.extname(base);
  const nameWithoutExt = ext ? base.slice(0, -ext.length) : base;
  return {
    filename: base,
    name_without_extension: nameWithoutExt,
    extension: ext ? ext.slice(1).toLowerCase() : null,
    is_hidden: base.startsWith('.'),
  };
}

function isFilePath(inputPath: string): boolean {
  const trimmed = inputPath.trim();
  const last = trimmed.split(/[\\/]+/).filter(Boolean).pop() || '';
  if (!last || last === '.' || last === '..') return false;
  return last.includes('.');
}

function isAbsolutePath(pathType: PathType): boolean {
  return [
    'windows_absolute',
    'windows_unc',
    'unix_absolute',
    'unix_home',
    'mac_absolute',
    'network_path',
    'url_path',
    'wsl_path',
  ].includes(pathType);
}

function getCrossPlatformInfo(pathType: PathType): PathInfoResult['cross_platform_info'] {
  const info = {
    windows: false,
    unix: false,
    macos: false,
    notes: [] as string[],
  };

  if (pathType === 'windows_absolute' || pathType === 'windows_relative' || pathType === 'windows_unc') {
    info.windows = true;
    if (pathType === 'windows_absolute') {
      info.notes.push('Drive letters (C:, D:) are Windows-specific.');
    }
  } else if (pathType === 'unix_absolute' || pathType === 'unix_relative' || pathType === 'unix_home') {
    info.unix = true;
    info.macos = true;
    if (pathType === 'unix_home') {
      info.notes.push('Tilde expands to the user home directory on Unix-like systems.');
    }
  } else if (pathType === 'mac_absolute') {
    info.macos = true;
    info.notes.push('/Volumes/ is macOS-specific for mounted volumes.');
  } else if (pathType === 'network_path') {
    info.windows = true;
    info.unix = true;
    info.macos = true;
    info.notes.push('Network paths may require authentication and permissions.');
  } else if (pathType === 'wsl_path') {
    info.windows = true;
    info.notes.push('/mnt/<drive>/ is WSL-specific for Windows drives.');
  } else if (pathType === 'url_path') {
    info.windows = true;
    info.unix = true;
    info.macos = true;
  }

  return info;
}

function parseComponents(inputPath: string, pathType: PathType): PathComponent[] {
  const components: PathComponent[] = [];
  const parts = splitComponents(inputPath, pathType);

  if (pathType === 'windows_absolute' && parts[0] && /^[A-Za-z]:$/.test(parts[0])) {
    const drive = parts.shift() as string;
    components.push({
      name: drive,
      type: 'drive',
      is_hidden: false,
      extension: null,
    });
  }

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const isLast = i === parts.length - 1;

    let type: ComponentType = 'directory';
    if (part === '.' || part === '..') {
      type = 'special';
    } else if (isLast && part.includes('.')) {
      type = 'file';
    }

    const extension = type === 'file' && part.includes('.')
      ? part.split('.').pop() || null
      : null;

    components.push({
      name: part,
      type,
      is_hidden: part.startsWith('.'),
      extension,
    });
  }

  return components;
}

export const pathInfoTool: Tool = {
  definition: {
    name: 'path_info',
    description: 'Convert a file path into a structured JSON description. Use this to normalize paths, detect path type (Windows/Unix/UNC/URL/WSL), and provide component breakdowns that are easy for LLMs to interpret.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path to analyze.',
        },
      },
      required: ['path'],
    },
  },

  async execute(input: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const rawPath = (input.path as string | undefined)?.trim();
    if (!rawPath) {
      return {
        success: false,
        error: 'path is required',
      };
    }

    const pathType = detectPathType(rawPath);
    const normalized = normalizePath(rawPath);
    const components = parseComponents(rawPath, pathType);
    const isFile = isFilePath(rawPath);

    const result: PathInfoResult = {
      original: rawPath,
      normalized,
      type: pathType,
      components,
      is_absolute: isAbsolutePath(pathType),
      is_file: isFile,
      file_info: isFile ? extractFileInfo(rawPath) : null,
      current_os: detectCurrentOS(),
      cross_platform_info: getCrossPlatformInfo(pathType),
    };

    return {
      success: true,
      output: JSON.stringify(result, null, 2),
    };
  },
};
