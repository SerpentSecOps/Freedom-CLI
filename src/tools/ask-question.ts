import * as readline from 'readline';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface AskQuestionInput {
  questions: Question[];
}

/**
 * AskQuestion tool - Interactive decision-making with structured options
 *
 * Inspired by Claude Code's AskUserQuestion pattern but implemented from scratch.
 * Provides rich UX for gathering user decisions with labeled choices and descriptions.
 */
export const askQuestionTool: Tool = {
  definition: {
    name: 'ask_question',
    description: `Ask the user structured questions with multiple choice options.

Use this when you need user input to make decisions during execution:
- Gathering preferences or requirements
- Clarifying ambiguous instructions
- Getting decisions on implementation choices
- Offering choices about direction to take

Each question should have:
- question: The complete question (clear, specific, ends with ?)
- header: Short label (max 12 chars) like "Auth method", "Library"
- options: 2-4 choices with label and description
- multiSelect: Allow multiple selections (optional, default false)

Users can always provide custom text if none of the options fit.

Example:
{
  "questions": [{
    "question": "Which authentication method should we use?",
    "header": "Auth method",
    "options": [
      {"label": "JWT", "description": "Stateless tokens, good for distributed systems"},
      {"label": "Sessions", "description": "Server-side state, simpler but less scalable"}
    ],
    "multiSelect": false
  }]
}`,
    input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'Questions to ask the user (1-4 questions)',
        items: {
          type: 'object',
          description: 'A question to ask the user',
          required: ['question', 'header', 'options'],
          properties: {
            question: {
              type: 'string',
              description: 'The complete question to ask. Should be clear, specific, and end with ?',
            },
            header: {
              type: 'string',
              description: 'Very short label (max 12 chars). Examples: "Auth method", "Library", "Approach"',
            },
            options: {
              type: 'array',
              description: 'Available choices (2-4 options). Each should be distinct and mutually exclusive unless multiSelect is enabled.',
              items: {
                type: 'object',
                description: 'An option for the question',
                properties: {
                  label: {
                    type: 'string',
                    description: 'Display text (1-5 words) that clearly describes the choice',
                  },
                  description: {
                    type: 'string',
                    description: 'Explanation of what this option means or what will happen if chosen',
                  },
                },
                required: ['label', 'description'],
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Allow multiple selections. Use when choices are not mutually exclusive.',
            },
          },
        },
      },
    },
      required: ['questions'],
    },
  },

  execute: async (input: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const questions = input.questions as AskQuestionInput['questions'];

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return {
        success: false,
        error: 'No questions provided',
      };
    }

    const answers: Record<string, string | string[]> = {};

    for (const q of questions) {
      const answer = await askSingleQuestion(q);
      answers[q.header] = answer;
    }

    return {
      success: true,
      output: JSON.stringify(answers, null, 2),
    };
  },
};

async function askSingleQuestion(question: Question): Promise<string | string[]> {
  const { question: text, header, options, multiSelect } = question;

  console.log(`\n╭─ ${header}`);
  console.log(`│ ${text}`);
  console.log('│');

  // Display options
  options.forEach((opt, idx) => {
    console.log(`│ ${idx + 1}. ${opt.label}`);
    console.log(`│    ${opt.description}`);
    if (idx < options.length - 1) console.log('│');
  });

  console.log(`│ ${options.length + 1}. Other (custom input)`);
  console.log('╰─');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = multiSelect
    ? `Select option(s) (1-${options.length + 1}, comma-separated): `
    : `Select option (1-${options.length + 1}): `;

  return new Promise((resolve) => {
    rl.question(prompt, (input) => {
      rl.close();

      const trimmed = input.trim();

      if (multiSelect) {
        // Parse comma-separated selections
        const selections = trimmed
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        const results: string[] = [];
        for (const sel of selections) {
          const num = parseInt(sel, 10);
          if (isNaN(num) || num < 1 || num > options.length + 1) {
            results.push(sel); // Treat as custom text
          } else if (num === options.length + 1) {
            // "Other" selected - ask for custom input
            console.log('Please enter your custom response:');
            const rl2 = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });
            rl2.question('> ', (custom) => {
              rl2.close();
              results.push(custom.trim());
              resolve(results);
            });
            return;
          } else {
            results.push(options[num - 1].label);
          }
        }
        resolve(results);
      } else {
        // Single selection
        const num = parseInt(trimmed, 10);
        if (isNaN(num) || num < 1 || num > options.length + 1) {
          // Invalid number - treat as custom text
          resolve(trimmed);
        } else if (num === options.length + 1) {
          // "Other" selected
          const rl2 = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl2.question('Please enter your custom response:\n> ', (custom) => {
            rl2.close();
            resolve(custom.trim());
          });
        } else {
          resolve(options[num - 1].label);
        }
      }
    });
  });
}
