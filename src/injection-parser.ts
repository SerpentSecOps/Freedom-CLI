/**
 * Injection Parser - Parses @{file} and !{command} syntax in user prompts
 * Inspired by Gemini CLI's prompt processors, implemented from scratch
 */

export interface Injection {
  /** Content extracted from within braces (file path or command) */
  content: string;
  /** Starting index of the injection (inclusive) */
  startIndex: number;
  /** Ending index of the injection (exclusive, after closing brace) */
  endIndex: number;
}

/**
 * Extracts injections like @{...} or !{...} from a prompt string.
 * Handles nested braces correctly using brace counting.
 *
 * @param prompt The prompt string to parse
 * @param trigger The opening trigger sequence (e.g., '@{', '!{')
 * @returns Array of extracted Injection objects
 * @throws Error if an unclosed injection is found
 */
export function extractInjections(
  prompt: string,
  trigger: string
): Injection[] {
  const injections: Injection[] = [];
  let index = 0;

  while (index < prompt.length) {
    const startIndex = prompt.indexOf(trigger, index);

    if (startIndex === -1) {
      break;
    }

    let currentIndex = startIndex + trigger.length;
    let braceCount = 1;
    let foundEnd = false;

    while (currentIndex < prompt.length) {
      const char = prompt[currentIndex];

      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          const injectionContent = prompt.substring(
            startIndex + trigger.length,
            currentIndex
          );
          const endIndex = currentIndex + 1;

          injections.push({
            content: injectionContent.trim(),
            startIndex,
            endIndex,
          });

          index = endIndex;
          foundEnd = true;
          break;
        }
      }
      currentIndex++;
    }

    if (!foundEnd) {
      throw new Error(
        `Unclosed injection starting at index ${startIndex} ('${trigger}'). Ensure braces are balanced.`
      );
    }
  }

  return injections;
}
