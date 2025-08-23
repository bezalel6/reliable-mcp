import { ProcessWrapper } from './process-wrapper';
import * as os from 'os';
import * as path from 'path';

describe('ProcessWrapper', () => {
  const isWindows = os.platform() === 'win32';

  describe('Basic functionality', () => {
    it('should execute a simple command', async () => {
      const wrapper = new ProcessWrapper({
        command: isWindows ? 'cmd' : 'echo',
        args: isWindows ? ['/c', 'echo', 'test'] : ['test'],
        verbose: false,
      });

      const exitCode = await wrapper.start();
      expect(exitCode).toBe(0);
      expect(wrapper.killed).toBe(true);
    });

    it('should handle non-zero exit codes', async () => {
      const wrapper = new ProcessWrapper({
        command: isWindows ? 'cmd' : 'sh',
        args: isWindows ? ['/c', 'exit', '1'] : ['-c', 'exit 1'],
        verbose: false,
      });

      const exitCode = await wrapper.start();
      expect(exitCode).toBe(1);
    });

    it('should provide process PID', async () => {
      const wrapper = new ProcessWrapper({
        command: isWindows ? 'cmd' : 'sleep',
        args: isWindows ? ['/c', 'ping', '127.0.0.1', '-n', '2'] : ['0.1'],
        verbose: false,
      });

      const startPromise = wrapper.start();
      expect(wrapper.pid).toBeDefined();
      expect(wrapper.pid).toBeGreaterThan(0);
      
      await startPromise;
    });
  });

  describe('Signal handling', () => {
    it('should terminate child process on SIGTERM', async () => {
      const wrapper = new ProcessWrapper({
        command: isWindows ? 'cmd' : 'sleep',
        args: isWindows ? ['/c', 'ping', '127.0.0.1', '-n', '10'] : ['10'],
        verbose: false,
      });

      const startPromise = wrapper.start();
      
      // Wait a bit for process to start
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Terminate the process
      wrapper.terminate();
      
      const exitCode = await startPromise;
      expect(wrapper.killed).toBe(true);
    }, 15000);

    it('should handle timeout option', async () => {
      const wrapper = new ProcessWrapper({
        command: isWindows ? 'cmd' : 'sleep',
        args: isWindows ? ['/c', 'ping', '127.0.0.1', '-n', '10'] : ['10'],
        timeout: 500,
        verbose: false,
      });

      const startTime = Date.now();
      await wrapper.start();
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(2000);
      expect(wrapper.killed).toBe(true);
    }, 5000);
  });

  describe('Error handling', () => {
    it('should handle invalid commands', async () => {
      const wrapper = new ProcessWrapper({
        command: 'this-command-does-not-exist-12345',
        args: [],
        verbose: false,
      });

      try {
        await wrapper.start();
      } catch (error) {
        // Expected to fail
      }
      
      expect(wrapper.killed).toBe(true);
    });

    it('should prevent double start', async () => {
      const wrapper = new ProcessWrapper({
        command: isWindows ? 'cmd' : 'echo',
        args: isWindows ? ['/c', 'echo', 'test'] : ['test'],
        verbose: false,
      });

      const firstStart = wrapper.start();
      
      await expect(wrapper.start()).rejects.toThrow('Process already started');
      
      await firstStart;
    });
  });

  describe('Process labeling', () => {
    it('should use custom label when provided', () => {
      const wrapper = new ProcessWrapper({
        command: 'node',
        args: ['--version'],
        label: 'my-custom-label',
        verbose: false,
      });

      expect(wrapper['label']).toBe('my-custom-label');
    });

    it('should default to command basename', () => {
      const wrapper = new ProcessWrapper({
        command: '/usr/bin/node',
        args: ['--version'],
        verbose: false,
      });

      expect(wrapper['label']).toBe('node');
    });
  });
});