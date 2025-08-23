import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import treeKill from 'tree-kill';

export interface WrapperOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  detached?: boolean;
  shell?: boolean | string;
  timeout?: number;
  label?: string;
  verbose?: boolean;
}

export class ProcessWrapper {
  private child: ChildProcess | null = null;
  private isWindows = os.platform() === 'win32';
  private cleanupHandlers: Array<() => void> = [];
  private exitPromise: Promise<number> | null = null;
  private terminated = false;
  private label: string;
  private verbose: boolean;

  constructor(private options: WrapperOptions) {
    this.label = options.label || path.basename(options.command);
    this.verbose = options.verbose || false;
  }

  private log(message: string, level: 'info' | 'error' | 'debug' = 'info') {
    if (this.verbose || level === 'error') {
      const prefix = `[reliable-mcp:${this.label}]`;
      if (level === 'error') {
        console.error(`${prefix} ${message}`);
      } else if (level === 'debug' && this.verbose) {
        console.log(`${prefix} [DEBUG] ${message}`);
      } else {
        console.log(`${prefix} ${message}`);
      }
    }
  }

  async start(): Promise<number> {
    if (this.child) {
      throw new Error('Process already started');
    }

    this.log(`Starting process: ${this.options.command} ${(this.options.args || []).join(' ')}`, 'debug');

    // Spawn the child process
    this.child = spawn(this.options.command, this.options.args || [], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      windowsHide: this.options.windowsHide !== false,
      detached: this.isWindows ? false : this.options.detached || false,
      shell: this.options.shell,
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    this.child.on('error', (error) => {
      this.log(`Process error: ${error.message}`, 'error');
    });

    // Set up process name for easier identification in Task Manager
    if (this.isWindows && this.child.pid) {
      try {
        process.title = `reliable-mcp: ${this.label} [PID:${this.child.pid}]`;
      } catch (e) {
        // Ignore title setting errors
      }
    }

    // Setup cleanup handlers
    this.setupCleanupHandlers();

    // Create exit promise
    this.exitPromise = new Promise<number>((resolve) => {
      if (!this.child) {
        resolve(-1);
        return;
      }

      this.child.on('exit', (code, signal) => {
        this.log(`Process exited with code ${code}, signal ${signal}`, 'debug');
        this.cleanup();
        resolve(code || 0);
      });

      // Handle timeout if specified
      if (this.options.timeout) {
        setTimeout(() => {
          if (!this.terminated && this.child) {
            this.log(`Process timeout after ${this.options.timeout}ms, terminating...`, 'error');
            this.terminate();
          }
        }, this.options.timeout);
      }
    });

    return this.exitPromise;
  }

  private setupCleanupHandlers() {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    // Windows-specific signals
    if (this.isWindows) {
      signals.push('SIGBREAK');
    }

    signals.forEach((signal) => {
      const handler = () => {
        this.log(`Received ${signal}, terminating child process...`, 'info');
        this.terminate();
        
        // Give the child process time to cleanup before force exit
        setTimeout(() => {
          if (!this.terminated) {
            process.exit(0);
          }
        }, 5000);
      };

      process.on(signal, handler);
      this.cleanupHandlers.push(() => process.removeListener(signal, handler));
    });

    // Handle uncaught exceptions
    const exceptionHandler = (error: Error) => {
      this.log(`Uncaught exception: ${error.message}`, 'error');
      this.terminate();
      setTimeout(() => process.exit(1), 1000);
    };

    process.on('uncaughtException', exceptionHandler);
    this.cleanupHandlers.push(() => process.removeListener('uncaughtException', exceptionHandler));

    // Handle process exit
    const exitHandler = () => {
      this.terminate();
    };

    process.on('exit', exitHandler);
    this.cleanupHandlers.push(() => process.removeListener('exit', exitHandler));
  }

  terminate(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.terminated || !this.child || !this.child.pid) {
      return;
    }

    this.terminated = true;
    this.log(`Terminating process tree (PID: ${this.child.pid})...`, 'info');

    try {
      if (this.isWindows) {
        // Use tree-kill to terminate the entire process tree on Windows
        treeKill(this.child.pid, 'SIGTERM', (err) => {
          if (err) {
            this.log(`Error terminating process tree: ${err.message}`, 'error');
            // Fallback to force kill
            try {
              this.child?.kill('SIGKILL');
            } catch (e) {
              // Ignore
            }
          }
        });
      } else {
        // On Unix, try graceful termination first
        this.child.kill(signal);
        
        // Force kill after timeout
        setTimeout(() => {
          if (this.child && !this.child.killed) {
            this.child.kill('SIGKILL');
          }
        }, 3000);
      }
    } catch (error: any) {
      this.log(`Error terminating process: ${error.message}`, 'error');
    }
  }

  private cleanup() {
    this.cleanupHandlers.forEach((handler) => handler());
    this.cleanupHandlers = [];
    this.child = null;
    this.terminated = true;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get killed(): boolean {
    return this.terminated || (this.child?.killed || false);
  }
}