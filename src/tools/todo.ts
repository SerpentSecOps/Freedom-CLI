/**
 * Todo tool - Task list manager for LLM task tracking
 * Helps the AI stay organized during long-running operations
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { Tool, ToolExecutionContext, ToolExecutionResult } from '../types.js';

interface TodoItem {
  id: number;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

interface TodoList {
  items: TodoItem[];
  nextId: number;
}

function getTodoPath(workingDirectory: string): string {
  return join(workingDirectory, '.freedom-cli', 'todos.json');
}

function loadTodos(workingDirectory: string): TodoList {
  const todoPath = getTodoPath(workingDirectory);

  if (existsSync(todoPath)) {
    try {
      const content = readFileSync(todoPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      // If file is corrupted, start fresh
      return { items: [], nextId: 1 };
    }
  }

  return { items: [], nextId: 1 };
}

function saveTodos(workingDirectory: string, todos: TodoList): void {
  const todoPath = getTodoPath(workingDirectory);
  const dir = dirname(todoPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(todoPath, JSON.stringify(todos, null, 2), 'utf-8');
}

function formatTodoList(todos: TodoList): string {
  if (todos.items.length === 0) {
    return '📋 Todo List (empty)\n\nNo tasks yet. Use action "add" to create a task.';
  }

  const completed = todos.items.filter(t => t.status === 'completed').length;
  const total = todos.items.length;

  let output = `📋 Todo List (${completed}/${total} completed)\n\n`;

  for (const item of todos.items) {
    let icon: string;
    switch (item.status) {
      case 'completed':
        icon = '✓';
        break;
      case 'in_progress':
        icon = '→';
        break;
      case 'blocked':
        icon = '✗';
        break;
      default:
        icon = '○';
    }

    output += `  ${icon} ${item.id}. ${item.task} [${item.status}]`;
    if (item.notes) {
      output += `\n      Note: ${item.notes}`;
    }
    output += '\n';
  }

  return output;
}

export const todoTool: Tool = {
  definition: {
    name: 'todo',
    description: 'Manage a task list to track progress on multi-step work. ONLY use this for complex tasks that require tracking multiple steps (e.g., refactoring, debugging, multi-file changes). Do NOT use for simple questions or greetings. Actions: "add" (create task), "update" (change status/notes), "remove" (delete task), "list" (show all tasks), "clear" (remove all tasks). Always list after changes to see current state.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Action to perform: "add", "update", "remove", "list", or "clear"',
          enum: ['add', 'update', 'remove', 'list', 'clear'],
        },
        task: {
          type: 'string',
          description: 'Task description (required for "add" action)',
        },
        id: {
          type: 'number',
          description: 'Task ID (required for "update" and "remove" actions)',
        },
        status: {
          type: 'string',
          description: 'New status for task (for "update" action): "pending", "in_progress", "completed", or "blocked"',
          enum: ['pending', 'in_progress', 'completed', 'blocked'],
        },
        notes: {
          type: 'string',
          description: 'Optional notes for the task (for "add" or "update" actions)',
        },
      },
      required: ['action'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const action = input.action as string;
    const task = input.task as string | undefined;
    const id = input.id as number | undefined;
    const status = input.status as TodoItem['status'] | undefined;
    const notes = input.notes as string | undefined;

    const todos = loadTodos(context.workingDirectory);

    try {
      switch (action) {
        case 'add': {
          if (!task) {
            return {
              success: false,
              error: 'Task description is required for "add" action.',
            };
          }

          const newItem: TodoItem = {
            id: todos.nextId++,
            task,
            status: 'pending',
            notes,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          todos.items.push(newItem);
          saveTodos(context.workingDirectory, todos);

          return {
            success: true,
            output: `Added task #${newItem.id}: "${task}"\n\n${formatTodoList(todos)}`,
            metadata: { taskId: newItem.id, action: 'add' },
          };
        }

        case 'update': {
          if (id === undefined) {
            return {
              success: false,
              error: 'Task ID is required for "update" action.',
            };
          }

          const item = todos.items.find(t => t.id === id);
          if (!item) {
            return {
              success: false,
              error: `Task #${id} not found.`,
            };
          }

          if (status) {
            item.status = status;
          }
          if (notes !== undefined) {
            item.notes = notes;
          }
          item.updatedAt = Date.now();

          saveTodos(context.workingDirectory, todos);

          return {
            success: true,
            output: `Updated task #${id}\n\n${formatTodoList(todos)}`,
            metadata: { taskId: id, action: 'update', newStatus: status },
          };
        }

        case 'remove': {
          if (id === undefined) {
            return {
              success: false,
              error: 'Task ID is required for "remove" action.',
            };
          }

          const index = todos.items.findIndex(t => t.id === id);
          if (index === -1) {
            return {
              success: false,
              error: `Task #${id} not found.`,
            };
          }

          const removed = todos.items.splice(index, 1)[0];
          saveTodos(context.workingDirectory, todos);

          return {
            success: true,
            output: `Removed task #${id}: "${removed.task}"\n\n${formatTodoList(todos)}`,
            metadata: { taskId: id, action: 'remove' },
          };
        }

        case 'list': {
          return {
            success: true,
            output: formatTodoList(todos),
            metadata: {
              total: todos.items.length,
              completed: todos.items.filter(t => t.status === 'completed').length,
              inProgress: todos.items.filter(t => t.status === 'in_progress').length,
              pending: todos.items.filter(t => t.status === 'pending').length,
              blocked: todos.items.filter(t => t.status === 'blocked').length,
            },
          };
        }

        case 'clear': {
          const count = todos.items.length;
          todos.items = [];
          todos.nextId = 1;
          saveTodos(context.workingDirectory, todos);

          return {
            success: true,
            output: `Cleared ${count} task(s).\n\n${formatTodoList(todos)}`,
            metadata: { cleared: count, action: 'clear' },
          };
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Use "add", "update", "remove", "list", or "clear".`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Todo operation failed: ${error.message}`,
      };
    }
  },
};
