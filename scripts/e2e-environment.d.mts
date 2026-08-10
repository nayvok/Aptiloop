export function createE2EEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  explicit?: Readonly<Record<string, string>>,
): Record<string, string>;
