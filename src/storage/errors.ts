/** Raised when a profile was saved by another writer after it was read (optimistic concurrency). */
export class ConcurrentProfileUpdateError extends Error {
  constructor(readonly userId: string) {
    super(`Concurrent profile update detected for ${userId}. Data berubah di proses lain; silakan ulangi aksi.`);
    this.name = 'ConcurrentProfileUpdateError';
  }
}

export function isConcurrentProfileUpdate(error: unknown): boolean {
  return error instanceof ConcurrentProfileUpdateError || (error instanceof Error && /Concurrent profile update/.test(error.message));
}
