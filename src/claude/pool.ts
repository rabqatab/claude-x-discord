import { ClaudeProcess, type ClaudeProcessOptions } from "./process.js";

export class ClaudePool {
  private processes = new Map<string, ClaudeProcess>();
  private idleTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private maxProcesses: number,
    private idleTimeout: number
  ) {}

  get(topicId: string): ClaudeProcess | undefined {
    return this.processes.get(topicId);
  }

  spawn(topicId: string, options: ClaudeProcessOptions): ClaudeProcess {
    if (this.processes.size >= this.maxProcesses) {
      this.evictOldest();
    }
    const existing = this.processes.get(topicId);
    if (existing?.isAlive) {
      this.resetIdleTimer(topicId);
      return existing;
    }
    const proc = new ClaudeProcess(options);
    proc.start();
    this.processes.set(topicId, proc);
    this.resetIdleTimer(topicId);
    proc.on("exit", () => {
      this.clearIdleTimer(topicId);
    });
    return proc;
  }

  kill(topicId: string): void {
    const proc = this.processes.get(topicId);
    if (proc) {
      proc.stop();
      this.processes.delete(topicId);
      this.clearIdleTimer(topicId);
    }
  }

  resetIdleTimer(topicId: string): void {
    this.clearIdleTimer(topicId);
    this.idleTimers.set(
      topicId,
      setTimeout(() => {
        this.kill(topicId);
      }, this.idleTimeout * 1000)
    );
  }

  private clearIdleTimer(topicId: string): void {
    const timer = this.idleTimers.get(topicId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(topicId);
    }
  }

  private evictOldest(): void {
    const [oldestId] = this.processes.keys();
    if (oldestId) {
      this.kill(oldestId);
    }
  }

  listActive(): string[] {
    return [...this.processes.entries()]
      .filter(([, p]) => p.isAlive)
      .map(([id]) => id);
  }

  stopAll(): void {
    for (const [id] of this.processes) {
      this.kill(id);
    }
  }
}
