const defaultMaximumConsecutiveFailures = 3;

export function createOwnerWatchdogPolicy(
  maximumConsecutiveFailures = defaultMaximumConsecutiveFailures,
) {
  if (
    !Number.isSafeInteger(maximumConsecutiveFailures) ||
    maximumConsecutiveFailures <= 0
  ) {
    throw new TypeError(
      "The ownership watchdog failure threshold must be a positive integer",
    );
  }

  let consecutiveFailures = 0;
  return Object.freeze({
    observe(active, { initial = false } = {}) {
      if (typeof active !== "boolean" || typeof initial !== "boolean") {
        throw new TypeError("The ownership watchdog observation is invalid");
      }
      if (active) {
        consecutiveFailures = 0;
        return false;
      }
      consecutiveFailures += 1;
      return initial || consecutiveFailures >= maximumConsecutiveFailures;
    },
  });
}
