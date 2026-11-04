import type { PreviewTask, TaskResult, WorkerRequest, WorkerResponse } from "./protocol";

export type Lane = "interactive" | "background";

interface Job {
  id: number;
  task: PreviewTask;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}

/**
 * A small pool of preview workers with two lanes. Interactive jobs (visible
 * thumbnails) run first, newest first, so scrolling fast shows what's on
 * screen; background jobs (EXIF indexing) fill idle workers in order.
 * Queued jobs whose signal aborts are dropped.
 */
export class WorkerPool {
  private workers: Array<{ worker: Worker; busy: Job | null }> = [];
  private interactive: Job[] = [];
  private background: Job[] = [];
  private nextId = 1;

  constructor(
    private readonly createWorker: () => Worker,
    private readonly size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
  ) {}

  run<T extends PreviewTask>(task: T, opts: { lane?: Lane; signal?: AbortSignal } = {}): Promise<TaskResult<T>> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const job: Job = { id: this.nextId++, task, resolve: resolve as (v: unknown) => void, reject, signal: opts.signal };
      opts.signal?.addEventListener("abort", () => this.drop(job), { once: true });
      (opts.lane === "background" ? this.background : this.interactive).push(job);
      this.pump();
    });
  }

  /** Reject everything queued (e.g. on folder change). Running jobs finish. */
  clear(): void {
    for (const job of [...this.interactive, ...this.background]) job.reject(new DOMException("Cleared", "AbortError"));
    this.interactive = [];
    this.background = [];
  }

  private drop(job: Job): void {
    const lists = [this.interactive, this.background];
    for (const list of lists) {
      const i = list.indexOf(job);
      if (i >= 0) {
        list.splice(i, 1);
        job.reject(new DOMException("Aborted", "AbortError"));
      }
    }
  }

  private pump(): void {
    while (this.interactive.length || this.background.length) {
      const slot = this.workers.find((w) => !w.busy) ?? this.spawn();
      if (!slot) return;
      const job = this.interactive.pop() ?? this.background.shift()!;
      slot.busy = job;
      // Decoded pixels move to the worker rather than being copied.
      const transfer = job.task.type === "thumbnail" && typeof ImageBitmap !== "undefined" && job.task.file instanceof ImageBitmap ? [job.task.file] : [];
      slot.worker.postMessage({ id: job.id, task: job.task } satisfies WorkerRequest, transfer);
    }
  }

  private spawn() {
    if (this.workers.length >= this.size) return null;
    const slot = { worker: this.createWorker(), busy: null as Job | null };
    slot.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const job = slot.busy;
      slot.busy = null;
      if (job && job.id === e.data.id) {
        if (e.data.ok) job.resolve(e.data.result);
        else job.reject(new Error(e.data.error));
      }
      this.pump();
    };
    slot.worker.onerror = (e) => {
      const job = slot.busy;
      slot.busy = null;
      job?.reject(new Error(e.message || "Preview worker crashed"));
      this.pump();
    };
    this.workers.push(slot);
    return slot;
  }
}
