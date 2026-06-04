import { parentPort } from 'worker_threads';
import { createHash } from 'crypto';
import { createDelta, applyDelta } from 'fossil-delta';

interface ComputeMessage {
  type: 'compute';
  id: string;
  baseBuffer: ArrayBuffer;
  targetBuffer: ArrayBuffer;
}

interface ApplyMessage {
  type: 'apply';
  id: string;
  baseBuffer: ArrayBuffer;
  deltaBuffer: ArrayBuffer;
  expectedHash: string;
}

type WorkerMessage = ComputeMessage | ApplyMessage;

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

parentPort!.on('message', (msg: WorkerMessage) => {
  try {
    if (msg.type === 'compute') {
      const base = new Uint8Array(msg.baseBuffer);
      const target = new Uint8Array(msg.targetBuffer);
      const fullHash = sha256(target);

      const delta = createDelta(base, target);
      const deltaBytes = delta instanceof Uint8Array ? delta : new Uint8Array(delta);

      // If delta is >= 60% of full size, fall back to keyframe
      if (deltaBytes.byteLength > msg.targetBuffer.byteLength * 0.6) {
        parentPort!.postMessage({
          id: msg.id,
          type: 'result',
          fallbackToKeyframe: true,
          fullHash,
          fullSize: msg.targetBuffer.byteLength,
        });
      } else {
        const deltaBuffer = deltaBytes.buffer.slice(
          deltaBytes.byteOffset,
          deltaBytes.byteOffset + deltaBytes.byteLength
        );
        parentPort!.postMessage(
          {
            id: msg.id,
            type: 'result',
            fallbackToKeyframe: false,
            delta: deltaBuffer,
            deltaSize: deltaBytes.byteLength,
            fullSize: msg.targetBuffer.byteLength,
            fullHash,
          },
          [deltaBuffer]
        );
      }
    } else if (msg.type === 'apply') {
      const base = new Uint8Array(msg.baseBuffer);
      const delta = new Uint8Array(msg.deltaBuffer);

      const reconstructed = applyDelta(base, delta);
      const reconstructedBytes =
        reconstructed instanceof Uint8Array
          ? reconstructed
          : new Uint8Array(reconstructed);
      const hash = sha256(reconstructedBytes);

      if (hash !== msg.expectedHash) {
        parentPort!.postMessage({
          id: msg.id,
          type: 'error',
          error: 'Hash mismatch after delta reconstruction',
        });
      } else {
        const resultBuffer = reconstructedBytes.buffer.slice(
          reconstructedBytes.byteOffset,
          reconstructedBytes.byteOffset + reconstructedBytes.byteLength
        );
        parentPort!.postMessage(
          {
            id: msg.id,
            type: 'result',
            result: resultBuffer,
          },
          [resultBuffer]
        );
      }
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({
      id: msg.id,
      type: 'error',
      error: errorMessage,
    });
  }
});
