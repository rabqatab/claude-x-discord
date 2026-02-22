import { ClaudeProcess, type ClaudeProcessOptions } from "./process.js";

export class ClaudePool {
  private processes = new Map<string, ClaudeProcess>();
  private idleTimers = new Map<string, NodeJS.Timeout>();
  private sessionIds = new Map<string, string>();

  constructor(
    private maxProcesses: number,
    private idleTimeout: number
  ) {}

  get(topicId: string): ClaudeProcess | undefined {
    return this.processes.get(topicId);
  }

  getSessionId(topicId: string): string | undefined {
    return this.sessionIds.get(topicId);
  }

  setSessionId(topicId: string, sessionId: string): void {
    this.sessionIds.set(topicId, sessionId);
  }

  clearSessionId(topicId: string): void {
    this.sessionIds.delete(topicId);
  }

  /** Run a prompt for a given topic. Creates a new ClaudeProcess per message. */
  run(topicId: string, prompt: string, options: ClaudeProcessOptions): ClaudeProcess {
    // Kill existing process if still running
    const existing = this.processes.get(topicId);
    if (existing?.isAlive) {
      existing.stop();
    }

    if (this.processes.size >= this.maxProcesses) {
      this.evictOldest();
    }

    // Use stored sessionId if available
    const sessionId = options.sessionId || this.sessionIds.get(topicId);
    const proc = new ClaudeProcess({
      ...options,
      sessionId,
    });

    proc.on("session", (sid: string) => {
      this.sessionIds.set(topicId, sid);
    });

    proc.run(prompt);
    this.processes.set(topicId, proc);
    this.resetIdleTimer(topicId);

    proc.on("exit", () => {
      // Only clear timer if this process is still the active one for this topic.
      // Prevents stale exit handler from clearing a newer process's timer.
      if (this.processes.get(topicId) === proc) {
        this.clearIdleTimer(topicId);
      }
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
