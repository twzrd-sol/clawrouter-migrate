#!/usr/bin/env node
import { HELP, parseArgs, shouldExitProcess } from "./args.js";
import { withStdoutQuiet } from "./logs.js";
import { defaultDeps, runMigrate } from "./run.js";
import { humanBlock, machineLine } from "./report.js";

async function main(): Promise<{ code: number; keepRunning: boolean }> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return { code: 1, keepRunning: false };
  }

  if (args.help) {
    console.log(HELP);
    return { code: 0, keepRunning: false };
  }

  try {
    // --json promises a parseable stdout; the peer library's console.log
    // chatter goes to stderr for the run so the JSON is the only thing printed.
    const result = args.json
      ? await withStdoutQuiet(() => runMigrate(args, defaultDeps()))
      : await runMigrate(args, defaultDeps());
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(humanBlock(result));
      console.log("");
      console.log(machineLine(result));
      if (result.rewrite) {
        console.log("");
        console.log(result.rewrite);
      }
    }
    const code = result.free === "fail" || result.paid === "fail" ? 1 : 0;
    return { code, keepRunning: result.keepRunning };
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return { code: 1, keepRunning: false };
  }
}

const { code, keepRunning } = await main();
if (shouldExitProcess({ keepRunning, code })) {
  process.exit(code);
}
