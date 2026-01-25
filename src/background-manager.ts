/**
 * Background Task Manager
 * Manages background bash processes and agent tasks
 */

import { spawn, ChildProcess } from 'child_process';

export interface BackgroundTask {
  id: string;
  type: 'bash' | 'agent';
  status: 'running' | 'completed' | 'failed';
  output: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

class BackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private nextId: number = 1;

  /**
   * Start a background bash command
   */
  startBashTask(
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeout?: number
  ): string {
    const id = `bash_${this.nextId++}`;

    const task: BackgroundTask = {
      id,
      type: 'bash',
      status: 'running',
      output: '',
      startTime: Date.now(),
    };

    this.tasks.set(id, task);

    // Start the process
    const proc = spawn(command, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
      stdio: 'pipe',
    });

    this.processes.set(id, proc);

    // Collect output
    proc.stdout?.on('data', (data) => {
      task.output += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      task.output += data.toString();
    });

    // Handle completion
    proc.on('close', (code) => {
      task.status = code === 0 ? 'completed' : 'failed';
      task.endTime = Date.now();
      if (code !== 0) {
        task.error = `Process exited with code ${code}`;
      }
      this.processes.delete(id);
    });

    proc.on('error', (err) => {
      task.status = 'failed';
      task.error = err.message;
      task.endTime = Date.now();
      this.processes.delete(id);
    });

    // Set timeout if specified
    if (timeout) {
      setTimeout(() => {
        if (task.status === 'running') {
          proc.kill('SIGTERM');
          task.status = 'failed';
          task.error = `Command timed out after ${timeout}ms`;
          task.endTime = Date.now();
        }
      }, timeout);
    }

    return id;
  }

  /**
   * Get task status and output
   */
  getTask(taskId: string, block: boolean = true, timeout: number = 30000): BackgroundTask | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    // If blocking, wait for completion
    if (block && task.status === 'running') {
      return this.waitForTask(taskId, timeout);
    }

    return task;
  }

  /**
   * Wait for a task to complete
   */
  private waitForTask(taskId: string, timeout: number): BackgroundTask | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    const startWait = Date.now();

    // Poll for completion
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const currentTask = this.tasks.get(taskId);

        if (!currentTask) {
          clearInterval(checkInterval);
          resolve(null);
          return;
        }

        if (currentTask.status !== 'running') {
          clearInterval(checkInterval);
          resolve(currentTask);
          return;
        }

        if (Date.now() - startWait > timeout) {
          clearInterval(checkInterval);
          resolve(currentTask); // Return running task on timeout
        }
      }, 100);
    }) as any;
  }

  /**
   * Kill a background task
   */
  killTask(taskId: string): boolean {
    const proc = this.processes.get(taskId);
    if (proc) {
      proc.kill('SIGTERM');
      return true;
    }
    return false;
  }

  /**
   * List all tasks
   */
  listTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Clean up completed tasks older than specified time
   */
  cleanup(maxAgeMs: number = 3600000): void {
    const now = Date.now();
    const toDelete: string[] = [];

    this.tasks.forEach((task, id) => {
      if (task.status !== 'running' && task.endTime && now - task.endTime > maxAgeMs) {
        toDelete.push(id);
      }
    });

    toDelete.forEach(id => this.tasks.delete(id));
  }
}

// Global singleton instance
export const backgroundManager = new BackgroundManager();
