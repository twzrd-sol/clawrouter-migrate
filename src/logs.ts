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
 * Keep stdout machine-readable for the rest of the process: the peer library
 * logs its wallet, routing and payment lines through console.log (its only
 * real stdout channel), which in `--json` mode landed in front of the JSON and
 * broke every naive parser. Route them to stderr and hand back the original
 * writer so the caller can print the one thing stdout is for. Not scoped to a
 * call on purpose: with --keep-running the proxy keeps logging after the
 * result is printed, and those lines must not follow the JSON either.
 * withConsoleCapture still sees the lines because it wraps whatever
 * console.log is at the time.
 */
export function redirectStdoutLogs(): (...args: unknown[]) => void {
  const stdout = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  return stdout;
}
