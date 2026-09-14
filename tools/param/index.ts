// param tool (run as: asdi param ...).
// Sync .env files with AWS SSM Parameter Store (Standard tier only).
//
// Usage:
//   asdi param push --prefix /myapp/prod [--file .env] [--region r] [--overwrite] [--dry-run]
//   asdi param pull --prefix /myapp/prod --file .env [--region r] [--overwrite] [--dry-run]
//   asdi param delete --prefix /myapp/prod [--region r] --force [--dry-run]

import * as fs from "node:fs";
import * as path from "node:path";
import { ENV_FORMAT_HELP, emitEnvFile, parseEnvFile } from "./format";
import {
  assertNotRoot,
  createClient,
  deleteByNames,
  forceRequired,
  listParamNames,
  normalizePrefix,
  pullParams,
  pushParams,
} from "./ssm";

export const PARAM_HELP = `Usage:
  asdi param push --prefix <path> [--file <env>] [--region <r>] [--overwrite] [--dry-run]
  asdi param pull --prefix <path> --file <env> [--region <r>] [--overwrite] [--dry-run]
  asdi param delete --prefix <path> [--region <r>] --force [--dry-run]

Commands:
  push          Upload .env file to SSM (default --file .env)
  pull          Download SSM prefix to .env file
  delete        Delete ALL params under prefix (irreversible, requires --force)

Options:
  --prefix      Required. e.g. /myapp/prod
  --file        push: defaults to .env | pull: required output path
  --region      Optional. Precedence: --region > AWS_REGION > AWS config/chain
  --overwrite   push: overwrite existing params | pull: overwrite existing file
  --force       delete: required (twice for single-segment prefixes, e.g. /prod)
  --dry-run     Validate + print plan
  -h, --help    Show this help

${ENV_FORMAT_HELP}

Examples:
  asdi param push --prefix /myapp/prod --file .env
  asdi param push --prefix /myapp/prod --overwrite --dry-run
  asdi param pull --prefix /myapp/prod --file .env
  asdi param pull --prefix /myapp/prod --file .env --overwrite --region eu-central-1
  asdi param delete --prefix /myapp/prod --dry-run
  asdi param delete --prefix /myapp/prod --force`;

interface Args {
  command?: string;
  prefix?: string;
  file?: string;
  region?: string;
  overwrite: boolean;
  forceCount: number;
  dryRun: boolean;
  help: boolean;
}

function takeValue(argv: string[], i: number, flag: string): string {
  const v = argv[i + 1];
  if (!v || v.startsWith("-")) throw new Error(`Missing value for ${flag}.`);
  return v;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    overwrite: false,
    forceCount: 0,
    dryRun: false,
    help: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--prefix") a.prefix = takeValue(argv, i++, t);
    else if (t.startsWith("--prefix=")) a.prefix = t.slice("--prefix=".length);
    else if (t === "--file") a.file = takeValue(argv, i++, t);
    else if (t.startsWith("--file=")) a.file = t.slice("--file=".length);
    else if (t === "--region") a.region = takeValue(argv, i++, t);
    else if (t.startsWith("--region=")) a.region = t.slice("--region=".length);
    else if (t === "--overwrite") a.overwrite = true;
    else if (t === "--force") {
      a.overwrite = true;
      a.forceCount++;
    } else if (t === "--dry-run") a.dryRun = true;
    else if (t === "--help" || t === "-h") a.help = true;
    else if (t.startsWith("-"))
      throw new Error(`Unknown flag "${t}". See: asdi param --help`);
    else positional.push(t);
  }
  if (positional.length > 0) a.command = positional[0];
  return a;
}

async function cmdPush(a: Args): Promise<void> {
  const prefix = normalizePrefix(a.prefix ?? "");
  const file = a.file ?? ".env";
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${file}`);
  const { params, warnings } = parseEnvFile(fs.readFileSync(abs, "utf8"));
  for (const w of warnings) console.warn(`warn: ${w}`);
  if (params.length === 0) {
    console.log("Nothing to push (no params in file).");
    return;
  }
  const client = createClient(a.region);
  const res = await pushParams(client, prefix, params, {
    overwrite: a.overwrite,
    dryRun: a.dryRun,
    log: (m) => console.log(m),
  });
  if (res.failed > 0) {
    process.exitCode = 1;
    throw new Error(`${res.failed} parameter(s) failed.`);
  }
}

async function cmdPull(a: Args): Promise<void> {
  const prefix = normalizePrefix(a.prefix ?? "");
  if (!a.file)
    throw new Error("Missing --file (pull requires an output path).");
  const abs = path.resolve(process.cwd(), a.file);
  if (fs.existsSync(abs) && !a.overwrite && !a.dryRun) {
    throw new Error(`File exists: ${a.file} (use --overwrite to replace).`);
  }
  const client = createClient(a.region);
  const params = await pullParams(client, prefix);
  const content = emitEnvFile(params);
  if (a.dryRun) {
    console.log(
      `DRY-RUN PULL ${prefix} -> ${a.file} (${params.length} params, file unchanged)`,
    );
    console.log(content);
    return;
  }
  if (params.length === 0)
    console.warn(`warn: no parameters under ${prefix}; writing empty file.`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  for (const p of params) console.log(`✔ GET ${prefix}/${p.key} (${p.type})`);
  console.log(`Done: ${params.length} pulled -> ${a.file}`);
}

async function cmdDelete(a: Args): Promise<void> {
  assertNotRoot(a.prefix ?? "");
  const prefix = normalizePrefix(a.prefix ?? "");
  if (a.file !== undefined) {
    throw new Error(
      "delete takes no --file (it deletes everything under --prefix).",
    );
  }
  const need = forceRequired(prefix);
  const flag = need === 2 ? "--force --force" : "--force";
  const client = createClient(a.region);
  // Phase 1 (reads only): list everything first — refusal message states N,
  // and a list failure aborts before anything is deleted.
  const names = await listParamNames(client, prefix);
  if (names.length === 0) {
    console.log(`warn: no parameters under ${prefix}; nothing to delete.`);
    return;
  }
  if (!a.dryRun && a.forceCount < need) {
    throw new Error(
      `Refusing to delete ${names.length} param(s) under ${prefix} without ${flag}. Re-run with ${flag} (or --dry-run to preview).`,
    );
  }
  // Phase 2: sequential deletes (or dry-run preview), continue-on-error.
  const res = await deleteByNames(client, names, {
    dryRun: a.dryRun,
    log: (m) => console.log(m),
  });
  if (res.failed > 0) {
    process.exitCode = 1;
    throw new Error(`${res.failed} parameter(s) failed to delete.`);
  }
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const a = parseArgs(argv);
  if (a.help || !a.command) {
    console.log(PARAM_HELP);
    return;
  }
  if (a.command === "push") return cmdPush(a);
  if (a.command === "pull") return cmdPull(a);
  if (a.command === "delete") return cmdDelete(a);
  if (a.command === "help") {
    console.log(PARAM_HELP);
    return;
  }
  throw new Error(`Unknown command "${a.command}". See: asdi param --help`);
}

if (typeof require !== "undefined" && require.main === module) {
  void main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    if (process.exitCode === 0) process.exitCode = 1;
  });
}
