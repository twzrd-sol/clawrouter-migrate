export async function withConsoleCapture<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
    orig(...args);
  };
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    console.log = orig;
  }
}

/**
 * Keep stdout machine-readable while `fn` runs: the peer library logs its
 * wallet, routing and payment lines through console.log, which in `--json`
 * mode landed in front of the JSON and broke every naive parser. Route them
 * to stderr for the duration; withConsoleCapture still sees them because it
 * wraps whatever console.log is at the time.
 */
export async function withStdoutQuiet<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  try {
    return await fn();
  } finally {
    console.log = orig;
  }
}
