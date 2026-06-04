import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type ComputeDeltaResult =
  | { fallbackToKeyframe: true; fullHash: string; fullSize: number }
  | {
      fallbackToKeyframe: false;
      delta: ArrayBuffer;
      deltaSize: number;
      fullSize: number;
      fullHash: string;
    };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class DeltaWorkerPool {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private nextId = 0;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const workerPath = path.join(__dirname, 'delta-worker.js');
    this.worker = new Worker(workerPath);

    this.worker.on('message', (msg: { id: string; type: string; error?: string; [key: string]: unknown }) => {
      const request = this.pending.get(msg.id);
      if (!request) return;
      this.pending.delete(msg.id);

      if (msg.type === 'error') {
        request.reject(new Error(msg.error ?? 'Unknown worker error'));
      } else {
        request.resolve(msg);
      }
    });

    this.worker.on('error', (err: Error) => {
      for (const [id, request] of this.pending) {
        request.reject(err);
        this.pending.delete(id);
      }
      this.worker = null;
    });

    this.worker.on('exit', (code: number) => {
      if (code !== 0) {
        const err = new Error(`Delta worker exited with code ${code}`);
        for (const [id, request] of this.pending) {
          request.reject(err);
          this.pending.delete(id);
        }
      }
      this.worker = null;
    });

    return this.worker;
  }

  private generateId(): string {
    return String(this.nextId++);
  }

  computeDelta(
    baseBuffer: ArrayBuffer,
    targetBuffer: ArrayBuffer
  ): Promise<ComputeDeltaResult> {
    return new Promise<ComputeDeltaResult>((resolve, reject) => {
      const id = this.generateId();
      const worker = this.ensureWorker();

      this.pending.set(id, {
        resolve: (msg: unknown) => {
          const result = msg as {
            fallbackToKeyframe: boolean;
            delta?: ArrayBuffer;
            deltaSize?: number;
            fullSize: number;
            fullHash: string;
          };
          if (result.fallbackToKeyframe) {
            resolve({
              fallbackToKeyframe: true,
              fullHash: result.fullHash,
              fullSize: result.fullSize,
            });
          } else {
            resolve({
              fallbackToKeyframe: false,
              delta: result.delta!,
              deltaSize: result.deltaSize!,
              fullSize: result.fullSize,
              fullHash: result.fullHash,
            });
          }
        },
        reject,
      });

      worker.postMessage(
        {
          type: 'compute',
          id,
          baseBuffer,
          targetBuffer,
        },
        [baseBuffer, targetBuffer]
      );
    });
  }

  applyDelta(
    baseBuffer: ArrayBuffer,
    deltaBuffer: ArrayBuffer,
    expectedHash: string
  ): Promise<ArrayBuffer> {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const id = this.generateId();
      const worker = this.ensureWorker();

      this.pending.set(id, {
        resolve: (msg: unknown) => {
          const result = msg as { result: ArrayBuffer };
          resolve(result.result);
        },
        reject,
      });

      worker.postMessage(
        {
          type: 'apply',
          id,
          baseBuffer,
          deltaBuffer,
          expectedHash,
        },
        [baseBuffer, deltaBuffer]
      );
    });
  }

  warmUp(): void {
    this.ensureWorker();
  }

  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    // Reject any remaining pending requests
    for (const [id, request] of this.pending) {
      request.reject(new Error('Worker pool shut down'));
      this.pending.delete(id);
    }
  }
}
