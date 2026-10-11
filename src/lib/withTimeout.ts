/** Raised when a request got no answer in time. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`No answer after ${Math.round(ms / 1000)} seconds`);
    this.name = 'TimeoutError';
  }
}

/** Stops waiting for a promise after `ms` milliseconds (the work itself keeps running; its late answer is ignored). */
export function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
