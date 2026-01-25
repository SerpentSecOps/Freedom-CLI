/**
 * Image utilities for loading and encoding images for LLM APIs
 * Supports both Anthropic (base64) and OpenAI-compatible (data URL) formats
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, extname } from 'path';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ImageData {
  base64: string;
  mediaType: ImageMediaType;
  fileName: string;
  sizeBytes: number;
}

// Max image size (20MB for Anthropic, but we'll be conservative)
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

// Supported extensions and their media types
const EXTENSION_TO_MEDIA_TYPE: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Get the media type from file extension
 */
export function getMediaTypeFromExtension(filePath: string): ImageMediaType | null {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_TO_MEDIA_TYPE[ext] || null;
}

/**
 * Check if a file is a supported image format
 */
export function isSupportedImageFormat(filePath: string): boolean {
  return getMediaTypeFromExtension(filePath) !== null;
}

/**
 * Load an image from disk and return its base64 encoding
 */
export function loadImage(imagePath: string, workingDirectory?: string): ImageData {
  // Resolve path relative to working directory if needed
  const fullPath = imagePath.startsWith('/')
    ? imagePath
    : resolve(workingDirectory || process.cwd(), imagePath);

  // Check if file exists
  if (!existsSync(fullPath)) {
    throw new Error(`Image file not found: ${fullPath}`);
  }

  // Get file stats
  const stats = statSync(fullPath);

  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${fullPath}`);
  }

  if (stats.size > MAX_IMAGE_SIZE) {
    throw new Error(`Image file too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 20MB.`);
  }

  // Check media type
  const mediaType = getMediaTypeFromExtension(fullPath);
  if (!mediaType) {
    const ext = extname(fullPath);
    throw new Error(`Unsupported image format: ${ext}. Supported formats: .jpg, .jpeg, .png, .gif, .webp`);
  }

  // Read and encode
  const buffer = readFileSync(fullPath);
  const base64 = buffer.toString('base64');

  return {
    base64,
    mediaType,
    fileName: fullPath.split('/').pop() || imagePath,
    sizeBytes: stats.size,
  };
}

/**
 * Load multiple images
 */
export function loadImages(imagePaths: string[], workingDirectory?: string): ImageData[] {
  return imagePaths.map(path => loadImage(path, workingDirectory));
}

/**
 * Create an Anthropic-format image block
 */
export function createAnthropicImageBlock(image: ImageData): {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageMediaType;
    data: string;
  };
} {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.base64,
    },
  };
}

/**
 * Create an OpenAI-format image content block (for LM Studio and others)
 */
export function createOpenAIImageBlock(image: ImageData): {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
} {
  return {
    type: 'image_url',
    image_url: {
      url: `data:${image.mediaType};base64,${image.base64}`,
      detail: 'auto',
    },
  };
}

/**
 * Parse image paths from user input
 * Supports formats:
 * - /path/to/image.png
 * - ./relative/path.jpg
 * - Multiple paths separated by spaces or commas
 */
export function parseImagePaths(input: string): string[] {
  // Split by comma or whitespace, filter empty strings
  const parts = input.split(/[,\s]+/).filter(p => p.trim());

  // Filter to only image paths
  return parts.filter(p => isSupportedImageFormat(p));
}

/**
 * Format image info for display
 */
export function formatImageInfo(image: ImageData): string {
  const sizeKB = (image.sizeBytes / 1024).toFixed(1);
  return `${image.fileName} (${image.mediaType}, ${sizeKB}KB)`;
}

/**
 * Load image from system clipboard
 * Returns null if no image in clipboard or clipboard tools not available
 * Supports: Linux (wl-paste/xclip), macOS (pngpaste/osascript), Windows (PowerShell)
 */
export async function loadImageFromClipboard(): Promise<ImageData | null> {
  const { execSync, spawnSync } = await import('child_process');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { existsSync, unlinkSync, readFileSync, statSync, writeFileSync } = await import('fs');
  
  const platform = process.platform;
  const tmpFile = join(tmpdir(), `freedom-cli-clipboard-${Date.now()}.png`);
  
  try {
    if (platform === 'linux') {
      // Try wl-paste first (Wayland), then xclip (X11)
      let success = false;
      
      // Wayland: wl-paste
      try {
        const result = spawnSync('wl-paste', ['--type', 'image/png'], { 
          encoding: 'buffer',
          timeout: 5000,
        });
        if (result.status === 0 && result.stdout && result.stdout.length > 0) {
          writeFileSync(tmpFile, result.stdout);
          success = true;
        }
      } catch {}
      
      // X11: xclip
      if (!success) {
        try {
          const result = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], {
            encoding: 'buffer',
            timeout: 5000,
          });
          if (result.status === 0 && result.stdout && result.stdout.length > 0) {
            writeFileSync(tmpFile, result.stdout);
            success = true;
          }
        } catch {}
      }
      
      if (!success) {
        return null;
      }
      
    } else if (platform === 'darwin') {
      // macOS - try pngpaste first, then osascript
      let success = false;
      
      // pngpaste (if installed via brew)
      try {
        const result = spawnSync('pngpaste', [tmpFile], { timeout: 5000 });
        if (result.status === 0) {
          success = true;
        }
      } catch {}
      
      // Fallback: osascript
      if (!success) {
        try {
          // Check if clipboard has image
          const check = spawnSync('osascript', ['-e', 'the clipboard as «class PNGf»'], { timeout: 5000 });
          if (check.status === 0) {
            // Write clipboard image to file using osascript
            const script = `
              set theFile to POSIX file "${tmpFile}"
              set png to the clipboard as «class PNGf»
              set fRef to open for access theFile with write permission
              write png to fRef
              close access fRef
            `;
            spawnSync('osascript', ['-e', script], { timeout: 5000 });
            success = existsSync(tmpFile);
          }
        } catch {}
      }
      
      if (!success) {
        return null;
      }
      
    } else if (platform === 'win32') {
      // Windows - use PowerShell with proper escaping
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $img = [System.Windows.Forms.Clipboard]::GetImage()
        if ($img -ne $null) {
          $img.Save("${tmpFile.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
          $img.Dispose()
          exit 0
        } else {
          exit 1
        }
      `.replace(/\n/g, ' ');
      
      try {
        const result = spawnSync('powershell', ['-NoProfile', '-Command', psScript], {
          timeout: 10000,
          windowsHide: true,
        });
        
        if (result.status !== 0) {
          return null;
        }
      } catch {
        return null;
      }
      
    } else {
      return null;
    }
    
    // Check if file was created and has content
    if (!existsSync(tmpFile)) {
      return null;
    }
    
    const stats = statSync(tmpFile);
    if (stats.size === 0) {
      try { unlinkSync(tmpFile); } catch {}
      return null;
    }
    
    // Read the image
    const buffer = readFileSync(tmpFile);
    const base64 = buffer.toString('base64');
    
    // Clean up temp file
    try { unlinkSync(tmpFile); } catch {}
    
    return {
      base64,
      mediaType: 'image/png',
      fileName: 'clipboard-image.png',
      sizeBytes: buffer.length,
    };
  } catch (error) {
    // Clean up temp file if it exists
    try {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    } catch {}
    
    return null;
  }
}
