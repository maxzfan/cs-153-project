/**
 * Storage utilities for commit data
 * Uses IndexedDB for large file buffers and localStorage for commit metadata
 */

const DB_NAME = 'rhino-studio-commits';
const DB_VERSION = 1;
const STORE_NAME = 'fileBuffers';

interface FileBufferRecord {
  commitId: string;
  filePath: string;
  buffer: ArrayBuffer;
  timestamp: number;
}

/**
 * Initialize IndexedDB database
 */
async function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ['commitId', 'filePath'] });
        store.createIndex('filePath', 'filePath', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Store a file buffer for a commit
 */
export async function storeFileBuffer(
  commitId: string,
  filePath: string,
  buffer: ArrayBuffer
): Promise<void> {
  try {
    const db = await getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const record: FileBufferRecord = {
      commitId,
      filePath,
      buffer,
      timestamp: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

  } catch {
    // Don't throw - this is not critical, we can still work without it
  }
}

/**
 * Retrieve a file buffer for a commit
 */
export async function getFileBuffer(
  commitId: string,
  filePath: string
): Promise<ArrayBuffer | null> {
  try {
    const db = await getDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise<ArrayBuffer | null>((resolve, reject) => {
      const request = store.get([commitId, filePath]);
      request.onsuccess = () => {
        const record = request.result as FileBufferRecord | undefined;
        if (record) {
          resolve(record.buffer);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/**
 * Delete file buffers for a specific file path (cleanup)
 */
export async function deleteFileBuffers(filePath: string): Promise<void> {
  try {
    const db = await getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('filePath');

    return new Promise<void>((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.only(filePath));
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Silent catch
  }
}

/**
 * Clean up old file buffers (older than specified days)
 */
export async function cleanupOldFileBuffers(daysToKeep: number = 30): Promise<void> {
  try {
    const db = await getDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;

    return new Promise<void>((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Silent catch
  }
}
