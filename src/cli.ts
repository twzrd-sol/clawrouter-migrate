#!/usr/bin/env node
import { HELP, parseArgs } from "./args.js";
import { defaultDeps, runMigrate } from "./run.js";
import { humanBlock, machineLine } from "./report.js";

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }

  if (args.help) {
    console.log(HELP);
    return 0;
  }

  try {
    const result = await runMigrate(args, defaultDeps());
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
    if (result.free === "fail" || result.paid === "fail") return 1;
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

const code = await main();
process.exit(code);
