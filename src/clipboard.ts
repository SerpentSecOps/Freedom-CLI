/**
 * Clipboard utilities for copying text across different terminal environments.
 * Supports OSC-52 for remote terminals (SSH, tmux, screen, WSL) and local clipboard.
 */

import fs from 'node:fs';
import { Writable } from 'node:stream';

const ESC = '\u001B';
const BEL = '\u0007';
const ST = '\u001B\\';

const MAX_OSC52_SEQUENCE_BYTES = 100_000;
const OSC52_HEADER = `${ESC}]52;c;`;
const OSC52_FOOTER = BEL;
const MAX_OSC52_BODY_B64_BYTES =
  MAX_OSC52_SEQUENCE_BYTES -
  Buffer.byteLength(OSC52_HEADER) -
  Buffer.byteLength(OSC52_FOOTER);
const MAX_OSC52_DATA_BYTES = Math.floor(MAX_OSC52_BODY_B64_BYTES / 4) * 3;

// Conservative chunk size for GNU screen DCS passthrough
const SCREEN_DCS_CHUNK_SIZE = 240;

type TtyTarget = { stream: Writable; closeAfter: boolean } | null;

/**
 * Pick the best TTY stream for output.
 * Prefers /dev/tty to avoid interleaving with piped stdout.
 */
const pickTty = (): TtyTarget => {
  try {
    const devTty = fs.createWriteStream('/dev/tty');
    return { stream: devTty, closeAfter: true };
  } catch {
    // Fall through to stderr/stdout
  }
  if (process.stderr?.isTTY) return { stream: process.stderr, closeAfter: false };
  if (process.stdout?.isTTY) return { stream: process.stdout, closeAfter: false };
  return null;
};

const inTmux = (): boolean =>
  Boolean(
    process.env['TMUX'] || (process.env['TERM'] ?? '').startsWith('tmux'),
  );

const inScreen = (): boolean =>
  Boolean(
    process.env['STY'] || (process.env['TERM'] ?? '').startsWith('screen'),
  );

const isSSH = (): boolean =>
  Boolean(
    process.env['SSH_TTY'] ||
      process.env['SSH_CONNECTION'] ||
      process.env['SSH_CLIENT'],
  );

const isWSL = (): boolean =>
  Boolean(
    process.env['WSL_DISTRO_NAME'] ||
      process.env['WSLENV'] ||
      process.env['WSL_INTEROP'],
  );

const isDumbTerm = (): boolean => (process.env['TERM'] ?? '') === 'dumb';

const shouldUseOsc52 = (tty: TtyTarget): boolean =>
  Boolean(tty) &&
  !isDumbTerm() &&
  (isSSH() || inTmux() || inScreen() || isWSL());

/**
 * Safely truncate a UTF-8 buffer to a maximum byte size without cutting through multi-byte characters.
 */
const safeUtf8Truncate = (buf: Buffer, maxBytes: number): Buffer => {
  if (buf.length <= maxBytes) return buf;
  let end = maxBytes;
  // Back up to the start of a UTF-8 code point if we cut through a continuation byte (10xxxxxx)
  while (end > 0 && (buf[end - 1] & 0b1100_0000) === 0b1000_0000) end--;
  return buf.subarray(0, end);
};

/**
 * Build an OSC-52 escape sequence for clipboard copy.
 */
const buildOsc52 = (text: string): string => {
  const raw = Buffer.from(text, 'utf8');
  const safe = safeUtf8Truncate(raw, MAX_OSC52_DATA_BYTES);
  const b64 = safe.toString('base64');
  return `${OSC52_HEADER}${b64}${OSC52_FOOTER}`;
};

/**
 * Wrap OSC-52 sequence for tmux passthrough.
 */
const wrapForTmux = (seq: string): string => {
  // Double ESC bytes in payload
  const doubledEsc = seq.split(ESC).join(ESC + ESC);
  return `${ESC}Ptmux;${doubledEsc}${ST}`;
};

/**
 * Wrap OSC-52 sequence for GNU screen passthrough.
 */
const wrapForScreen = (seq: string): string => {
  let out = '';
  for (let i = 0; i < seq.length; i += SCREEN_DCS_CHUNK_SIZE) {
    out += `${ESC}P${seq.slice(i, i + SCREEN_DCS_CHUNK_SIZE)}${ST}`;
  }
  return out;
};

/**
 * Write all data to a stream and wait for completion.
 */
const writeAll = (stream: Writable, data: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onError = (err: unknown) => {
      cleanup();
      reject(err as Error);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      stream.off('error', onError);
      stream.off('drain', onDrain);
    };
    stream.once('error', onError);
    if (stream.write(data)) {
      cleanup();
      resolve();
    } else {
      stream.once('drain', onDrain);
    }
  });

/**
 * Copy text to clipboard using OSC-52 for remote terminals.
 * Falls back to xclip/pbcopy for local terminals.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;

  const tty = pickTty();

  // Use OSC-52 for remote/multiplexed terminals
  if (shouldUseOsc52(tty)) {
    const osc = buildOsc52(text);
    const payload = inTmux()
      ? wrapForTmux(osc)
      : inScreen()
        ? wrapForScreen(osc)
        : osc;

    await writeAll(tty!.stream, payload);

    if (tty!.closeAfter) {
      (tty!.stream as fs.WriteStream).end();
    }
    return;
  }

  // Local fallback: Try platform-specific clipboard commands
  const { spawn } = await import('child_process');

  return new Promise<void>((resolve, reject) => {
    let cmd: string;
    let args: string[] = [];

    switch (process.platform) {
      case 'darwin':
        cmd = 'pbcopy';
        break;
      case 'linux':
        // Use xclip (most common)
        cmd = 'xclip';
        args = ['-selection', 'clipboard'];
        break;
      case 'win32':
        cmd = 'clip';
        break;
      default:
        reject(new Error(`Clipboard not supported on platform: ${process.platform}`));
        return;
    }

    const proc = spawn(cmd, args);
    let errorOutput = '';

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('error', (error) => {
      reject(new Error(`Failed to spawn ${cmd}: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Clipboard command failed with code ${code}: ${errorOutput}`));
      }
    });

    // Write text to stdin and close
    proc.stdin.write(text);
    proc.stdin.end();
  });
}
