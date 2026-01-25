/**
 * Freedom CLI animated logo with glitch effect
 * Inspired by retro cyberpunk aesthetics
 */

import chalk from 'chalk';

const LOGO = [
  "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░",
  "  ███████╗██████╗ ███████╗███████╗██████╗  ██████╗ ███╗   ███╗     ██████╗██╗     ██╗",
  "  ██╔════╝██╔══██╗██╔════╝██╔════╝██╔══██╗██╔═══██╗████╗ ████║    ██╔════╝██║     ██║",
  "  █████╗  ██████╔╝█████╗  █████╗  ██║  ██║██║   ██║██╔████╔██║    ██║     ██║     ██║",
  "  ██╔══╝  ██╔══██╗██╔══╝  ██╔══╝  ██║  ██║██║   ██║██║╚██╔╝██║    ██║     ██║     ██║",
  "  ██║     ██║  ██║███████╗███████╗██████╔╝╚██████╔╝██║ ╚═╝ ██║    ╚██████╗███████╗██║",
  "  ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝╚═════╝  ╚═════╝ ╚═╝     ╚═╝     ╚═════╝╚══════╝╚═╝",
  "                     Y O U R   A I ,   Y O U R   W A Y",
  "              Copyright 2025 - github.com/SerpentSecOps - All Rights Reserved",
  "░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░",
];

// Base colors for normal display
const BASE_COLORS = [
  chalk.white,           // Top border
  chalk.hex('#00D9FF'),  // Cyan-blue
  chalk.hex('#FF006E'),  // Hot pink/magenta
  chalk.hex('#00D9FF'),  // Cyan-blue
  chalk.hex('#FF006E'),  // Hot pink/magenta
  chalk.hex('#00D9FF'),  // Cyan-blue
  chalk.hex('#FF006E'),  // Hot pink/magenta
  chalk.white,           // Tagline
  chalk.gray,            // Copyright
  chalk.white,           // Bottom border
];

// Glitch colors for animation
const GLITCH_COLORS = [
  chalk.hex('#FF3366'),  // Bright red
  chalk.hex('#33FF88'),  // Bright green
  chalk.hex('#FFCC00'),  // Yellow
  chalk.hex('#00FFFF'),  // Cyan
  chalk.hex('#FF00FF'),  // Magenta
];

function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

function hideCursor(): void {
  process.stdout.write('\x1b[?25l');
}

function showCursor(): void {
  process.stdout.write('\x1b[?25h');
}

export function getStaticFreedomLogo(): string {
  return '\n' + LOGO.map((line, i) => BASE_COLORS[i](line)).join('\n') + '\n';
}

export function getWelcomeBanner(): string {
  return getStaticFreedomLogo();
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Glitch animation effect
 */
export async function showAnimatedLogo(duration: number = 1500): Promise<void> {
  hideCursor();
  clearScreen();

  const startTime = Date.now();
  const frameTime = 33; // ~30 FPS for smooth animation
  let frame = 0;

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (elapsed >= duration) {
        clearInterval(interval);
        clearScreen();
        console.log(getStaticFreedomLogo());
        showCursor();
        resolve();
        return;
      }

      // Calculate dynamic intensity (starts high, decreases over time)
      const progress = elapsed / duration;
      const intensity = 0.25 * (1 - progress); // Fade from 25% to 0%

      // Clear and redraw
      process.stdout.write('\x1b[H'); // Move to home position
      console.log('');

      for (let i = 0; i < LOGO.length; i++) {
        let line = LOGO[i];

        // Random chance of glitch (decreases over time)
        if (Math.random() < intensity) {
          // Pick a random glitch color
          const glitchColor = GLITCH_COLORS[Math.floor(Math.random() * GLITCH_COLORS.length)];

          // Sometimes shift the line horizontally
          if (Math.random() < 0.3) {
            const shift = Math.random() < 0.5 ? -2 : 2;
            if (shift > 0) {
              line = ' '.repeat(shift) + line;
            } else {
              line = line.slice(Math.abs(shift));
            }
          }

          console.log(glitchColor(line));
        } else {
          // Normal line with base color
          console.log(BASE_COLORS[i](line));
        }
      }

      console.log('');
      frame++;
    }, frameTime);
  });
}

/**
 * Get a single animated frame (for use in other contexts)
 */
export function getAnimatedFreedomLogo(frame: number = 0): string {
  const intensity = 0.1;
  let output = '\n';

  for (let i = 0; i < LOGO.length; i++) {
    let line = LOGO[i];

    // Deterministic glitch based on frame
    if ((frame + i) % 10 < intensity * 10) {
      const glitchColor = GLITCH_COLORS[(frame + i) % GLITCH_COLORS.length];
      output += glitchColor(line) + '\n';
    } else {
      output += BASE_COLORS[i](line) + '\n';
    }
  }

  return output;
}
