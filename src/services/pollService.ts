import { GitService } from '../git/gitService';
import { DataStore } from '../data/dataStore';

export class PollService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(
    private gitService: GitService,
    private dataStore: DataStore,
    private intervalMs: number,
    private onUpdate: () => void
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.timer) {
      this.start(); // restart with new interval
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) {return;} // skip overlapping polls
    this.polling = true;
    try {
      const repos = this.dataStore.getRepos();
      // Fire all git status checks in parallel
      await Promise.allSettled(repos.map((r) => this.gitService.getStatus(r.path)));
      this.onUpdate();
    } finally {
      this.polling = false;
    }
  }
}
