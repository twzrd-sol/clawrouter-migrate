#!/usr/bin/env node
import { HELP, parseArgs, shouldExitProcess } from "./args.js";
import { redirectStdoutLogs } from "./logs.js";
import { defaultDeps, runMigrate } from "./run.js";
import { errorOutput, humanBlock, machineLine } from "./report.js";

async function main(): Promise<{ code: number; keepRunning: boolean }> {
  // Decided from argv, not parsed args: a parse error must still honour --json.
  const json = process.argv.slice(2).includes("--json");
  const emit = json ? redirectStdoutLogs() : console.log;
  const fail = (err: unknown) => {
    const out = errorOutput(err, json);
    if (out.stdout !== undefined) emit(out.stdout);
    if (out.stderr !== undefined) console.error(out.stderr);
    return { code: 1, keepRunning: false };
  };
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    return fail(err);
  }

  if (args.help) {
    console.log(HELP);
    return { code: 0, keepRunning: false };
  }

  try {
    // --json promises a parseable stdout. The peer library's console.log
    // chatter goes to stderr for the whole process (redirected above) — not
    // just this call, because --keep-running keeps logging after the result.
    const result = await runMigrate(args, defaultDeps());
    if (args.json) {
      emit(JSON.stringify(result, null, 2));
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
    return fail(err);
  }
}

const { code, keepRunning } = await main();
if (shouldExitProcess({ keepRunning, code })) {
  process.exit(code);
}
