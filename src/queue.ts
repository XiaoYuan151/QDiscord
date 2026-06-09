export interface AsyncTaskQueueOptions {
  name: string;
  concurrency: number;
  maxPending: number;
  minDelayMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryJitterMs?: number;
  random?: () => number;
}

export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  dropped: number;
}

interface QueueItem<T> {
  label: string;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  attempt: number;
  availableAt: number;
}

export class AsyncTaskQueue {
  private readonly pending: Array<QueueItem<unknown>> = [];
  private readonly idleWaiters = new Set<() => void>();
  private running = 0;
  private completed = 0;
  private failed = 0;
  private dropped = 0;
  private nextRunAt = 0;
  private drainTimer?: NodeJS.Timeout;
  private drainTimerDueAt = 0;

  constructor(private readonly options: AsyncTaskQueueOptions) {}

  get name(): string {
    return this.options.name;
  }

  add<T>(label: string, task: () => Promise<T>): Promise<T> {
    if (this.pending.length >= this.options.maxPending) {
      this.dropped += 1;
      return Promise.reject(new Error(`Queue ${this.options.name} is full; dropped task: ${label}`));
    }

    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        label,
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        attempt: 0,
        availableAt: Date.now()
      });
      this.scheduleDrain();
    });
  }

  stats(): QueueStats {
    return {
      pending: this.pending.length,
      running: this.running,
      completed: this.completed,
      failed: this.failed,
      dropped: this.dropped
    };
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.isIdle()) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (idle: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        this.idleWaiters.delete(onIdle);
        resolve(idle);
      };
      const onIdle = () => finish(true);
      const timer = setTimeout(() => finish(this.isIdle()), timeoutMs);
      this.idleWaiters.add(onIdle);
    });
  }

  private isIdle(): boolean {
    return this.pending.length === 0 && this.running === 0;
  }

  private scheduleDrain(delayMs = 0): void {
    const dueAt = Date.now() + Math.max(0, delayMs);
    if (this.drainTimer) {
      if (this.drainTimerDueAt <= dueAt) {
        return;
      }

      clearTimeout(this.drainTimer);
      this.drainTimer = undefined;
    }

    this.drainTimerDueAt = dueAt;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = undefined;
      this.drainTimerDueAt = 0;
      void this.drain();
    }, Math.max(0, delayMs));
  }

  private async drain(): Promise<void> {
    while (this.running < this.options.concurrency && this.pending.length > 0) {
      const now = Date.now();
      if (now < this.nextRunAt) {
        this.scheduleDrain(this.nextRunAt - now);
        return;
      }

      const itemIndex = this.pending.findIndex((candidate) => candidate.availableAt <= now);
      if (itemIndex < 0) {
        const nextAvailableAt = Math.min(...this.pending.map((candidate) => candidate.availableAt));
        this.scheduleDrain(nextAvailableAt - now);
        return;
      }

      const [item] = this.pending.splice(itemIndex, 1);
      if (!item) {
        return;
      }

      this.running += 1;
      this.nextRunAt = Date.now() + this.options.minDelayMs;
      void this.runItem(item);
    }

    this.notifyIdleWaiters();
  }

  private async runItem(item: QueueItem<unknown>): Promise<void> {
    try {
      item.resolve(await item.task());
      this.completed += 1;
    } catch (error) {
      if (item.attempt < this.options.maxRetries) {
        const retryDelayMs = this.retryDelayMs(item.attempt + 1);
        this.pending.unshift({
          ...item,
          attempt: item.attempt + 1,
          availableAt: Date.now() + retryDelayMs
        });
        this.scheduleDrain(retryDelayMs);
      } else {
        this.failed += 1;
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.running -= 1;
      this.scheduleDrain();
      this.notifyIdleWaiters();
    }
  }

  private notifyIdleWaiters(): void {
    if (!this.isIdle()) {
      return;
    }

    for (const waiter of this.idleWaiters) {
      waiter();
    }
  }

  private retryDelayMs(attempt: number): number {
    const baseDelayMs = this.options.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
    const jitterMs = this.options.retryJitterMs ?? 0;
    if (jitterMs <= 0) {
      return baseDelayMs;
    }

    return baseDelayMs + Math.floor((this.options.random ?? Math.random)() * (jitterMs + 1));
  }
}
