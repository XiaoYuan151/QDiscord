import { describe, expect, it, vi } from "vitest";

import { AsyncTaskQueue } from "../src/queue.js";

describe("AsyncTaskQueue", () => {
  it("retries failed tasks and records stats", async () => {
    const queue = new AsyncTaskQueue({
      name: "test",
      concurrency: 1,
      maxPending: 100,
      minDelayMs: 0,
      maxRetries: 2,
      retryBaseDelayMs: 0
    });
    let attempts = 0;

    const result = await queue.add("flaky", async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("not yet");
      }
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(queue.stats()).toEqual({
      pending: 0,
      running: 0,
      completed: 1,
      failed: 0,
      dropped: 0
    });
  });

  it("waits for queued work to become idle", async () => {
    vi.useFakeTimers();
    const queue = new AsyncTaskQueue({
      name: "test",
      concurrency: 1,
      maxPending: 100,
      minDelayMs: 0,
      maxRetries: 0,
      retryBaseDelayMs: 0
    });
    let resolveTask: (() => void) | undefined;

    const taskResult = queue.add(
      "slow",
      () =>
        new Promise<string>((resolve) => {
          resolveTask = () => resolve("ok");
        })
    );
    await vi.runOnlyPendingTimersAsync();
    const idle = queue.waitForIdle(1000);
    resolveTask?.();

    await expect(taskResult).resolves.toBe("ok");
    await expect(idle).resolves.toBe(true);
    vi.useRealTimers();
  });

  it("reports false when idle wait times out", async () => {
    vi.useFakeTimers();
    const queue = new AsyncTaskQueue({
      name: "test",
      concurrency: 1,
      maxPending: 100,
      minDelayMs: 0,
      maxRetries: 0,
      retryBaseDelayMs: 0
    });

    void queue.add("slow", () => new Promise<string>(() => undefined));
    await vi.runOnlyPendingTimersAsync();
    const idle = queue.waitForIdle(1000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(idle).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("runs newly available work while a retry is waiting for backoff", async () => {
    vi.useFakeTimers();
    const queue = new AsyncTaskQueue({
      name: "test",
      concurrency: 1,
      maxPending: 100,
      minDelayMs: 0,
      maxRetries: 1,
      retryBaseDelayMs: 1000
    });
    const events: string[] = [];
    let firstAttempts = 0;

    const first = queue.add("first", async () => {
      firstAttempts += 1;
      events.push(`first:${firstAttempts}`);
      if (firstAttempts === 1) {
        throw new Error("retry later");
      }
      return "first-ok";
    });
    await vi.runOnlyPendingTimersAsync();

    const second = queue.add("second", async () => {
      events.push("second");
      return "second-ok";
    });
    await vi.runOnlyPendingTimersAsync();

    expect(events).toEqual(["first:1", "second"]);
    await expect(second).resolves.toBe("second-ok");

    await vi.advanceTimersByTimeAsync(1000);
    await expect(first).resolves.toBe("first-ok");
    expect(events).toEqual(["first:1", "second", "first:2"]);
    vi.useRealTimers();
  });

  it("adds bounded retry jitter", async () => {
    vi.useFakeTimers();
    const queue = new AsyncTaskQueue({
      name: "test",
      concurrency: 1,
      maxPending: 100,
      minDelayMs: 0,
      maxRetries: 1,
      retryBaseDelayMs: 1000,
      retryJitterMs: 100,
      random: () => 0.5
    });
    let attempts = 0;

    const result = queue.add("flaky", async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("retry later");
      }
      return "ok";
    });
    await vi.runOnlyPendingTimersAsync();

    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1049);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("ok");
    expect(attempts).toBe(2);
    vi.useRealTimers();
  });

  it("drops new tasks when pending work exceeds the configured limit", async () => {
    const queue = new AsyncTaskQueue({
      name: "test",
      concurrency: 1,
      maxPending: 1,
      minDelayMs: 1000,
      maxRetries: 0,
      retryBaseDelayMs: 0
    });

    void queue.add("first", async () => "ok");
    await expect(queue.add("second", async () => "nope")).rejects.toThrow(
      "Queue test is full"
    );
    expect(queue.stats()).toMatchObject({
      pending: 1,
      dropped: 1
    });
  });

  it("rejects pending work and new tasks after shutdown", async () => {
    vi.useFakeTimers();
    try {
      const queue = new AsyncTaskQueue({
        name: "test",
        concurrency: 1,
        maxPending: 100,
        minDelayMs: 0,
        maxRetries: 0,
        retryBaseDelayMs: 0
      });
      let resolveRunning: (() => void) | undefined;

      const running = queue.add(
        "running",
        () =>
          new Promise<string>((resolve) => {
            resolveRunning = () => resolve("ok");
          })
      );
      await vi.runOnlyPendingTimersAsync();

      const pending = queue.add("pending", async () => "nope");
      expect(queue.shutdown(new Error("shutdown"))).toBe(1);
      await expect(pending).rejects.toThrow("shutdown");
      await expect(queue.add("late", async () => "late")).rejects.toThrow(
        "Queue test is stopped"
      );
      expect(queue.stats()).toMatchObject({ pending: 0, running: 1, dropped: 2 });

      resolveRunning?.();
      await expect(running).resolves.toBe("ok");
      expect(queue.stats()).toMatchObject({ pending: 0, running: 0, completed: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not requeue running work that fails after shutdown", async () => {
    vi.useFakeTimers();
    try {
      const queue = new AsyncTaskQueue({
        name: "test",
        concurrency: 1,
        maxPending: 100,
        minDelayMs: 0,
        maxRetries: 1,
        retryBaseDelayMs: 1000
      });
      let attempts = 0;
      let rejectRunning: (() => void) | undefined;

      const running = queue.add("flaky", () => {
        attempts += 1;
        return new Promise<string>((_resolve, reject) => {
          rejectRunning = () => reject(new Error("fail"));
        });
      });
      await vi.runOnlyPendingTimersAsync();

      expect(attempts).toBe(1);
      expect(queue.shutdown()).toBe(0);
      rejectRunning?.();
      await expect(running).rejects.toThrow("fail");
      await vi.advanceTimersByTimeAsync(1000);

      expect(attempts).toBe(1);
      expect(queue.stats()).toMatchObject({ pending: 0, running: 0, failed: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});
