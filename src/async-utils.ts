export class TimeoutError extends Error {
  constructor(message = "Operation timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export type RetryOptions = {
  attempts?: number;
  delayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

export async function retry<T>(
  operation: () => T | Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const factor = Math.max(1, options.factor ?? 2);
  const maxDelayMs = Math.max(
    0,
    options.maxDelayMs ?? Number.POSITIVE_INFINITY,
  );
  let delayMs = Math.max(0, options.delayMs ?? 0);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (
        attempt >= attempts ||
        options.shouldRetry?.(error, attempt) === false
      ) {
        throw error;
      }
      if (!options.shouldRetry && attempt >= attempts) throw error;
      if (delayMs > 0)
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(maxDelayMs, delayMs * factor || delayMs);
    }
  }

  throw lastError;
}

export async function withTimeout<T>(
  operation: Promise<T> | (() => Promise<T> | T),
  timeoutMs: number,
  message = `Operation timed out after ${timeoutMs}ms`,
): Promise<T> {
  const work =
    typeof operation === "function"
      ? Promise.resolve().then(operation)
      : operation;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return await work;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withTimeoutFallback<T>(
  operation: Promise<T> | (() => Promise<T> | T),
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  try {
    return await withTimeout(operation, timeoutMs);
  } catch {
    return fallback;
  }
}
