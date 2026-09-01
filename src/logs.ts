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
