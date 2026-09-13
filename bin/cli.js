#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const DEPS = ["@asdi/aws-infra", "aws-cdk-lib"];
const DEV_DEPS = ["tsx"];

function installDeps(cwd) {
  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    console.log("No package.json found, running npm init -y...");
    execSync("npm init -y --silent", { cwd, stdio: "pipe" });
  }
  console.log("Installing dependencies...");
  try {
    execSync(`npm install ${DEPS.join(" ")} --force --no-audit --no-fund --loglevel=error`, {
      cwd,
      stdio: "pipe",
    });
    execSync(`npm install -D ${DEV_DEPS.join(" ")} --force --no-audit --no-fund --loglevel=error`, {
      cwd,
      stdio: "pipe",
    });
    console.log("Dependencies installed.");
  } catch (err) {
    console.error("Failed to install dependencies.");
    process.exit(1);
  }
}

const PKG_ROOT = path.join(__dirname, "..");
const TEMPLATES_CANDIDATES = [path.join(PKG_ROOT, "templates")];
const WORKFLOWS_CANDIDATES = [path.join(PKG_ROOT, "workflows")];

function pickDir(candidates) {
  for (const d of candidates) {
    if (fs.existsSync(d)) return d;
  }
  return candidates[0];
}

function templatesDir() {
  return pickDir(TEMPLATES_CANDIDATES);
}

function workflowsDir() {
  return pickDir(WORKFLOWS_CANDIDATES);
}

function listTemplateNames() {
  const dir = templatesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.basename(e.name, ".ts"))
    .sort();
}

function listWorkflows() {
  const dir = workflowsDir();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const provider = entry.name;
    const providerDir = path.join(dir, provider);
    for (const f of fs.readdirSync(providerDir, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      if (!f.name.endsWith(".yml") && !f.name.endsWith(".yaml")) continue;
      const ext = f.name.endsWith(".yaml") ? ".yaml" : ".yml";
      out.push({
        name: path.basename(f.name, ext),
        provider,
        file: f.name,
        from: path.join(providerDir, f.name),
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider));
  return out;
}

function cmdList() {
  const templates = listTemplateNames();
  const workflows = listWorkflows();

  console.log("Templates:");
  if (templates.length === 0) {
    console.log("  (none)");
  } else {
    for (const t of templates) console.log(`  ${t}`);
  }
  console.log("");
  console.log("Workflows:");
  if (workflows.length === 0) {
    console.log("  (none)");
  } else {
    const width = Math.max(...workflows.map((w) => w.name.length));
    for (const w of workflows) console.log(`  ${w.name.padEnd(width)}  ${w.provider}`);
  }
}

function copyFile(from, to, force) {
  if (fs.existsSync(to) && !force) {
    console.warn(`Skipped ${path.relative(process.cwd(), to)} (already exists, use --force to overwrite).`);
    return false;
  }
  const overwritten = fs.existsSync(to);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`${overwritten ? "Overwrote" : "Created"} ${path.relative(process.cwd(), to)}.`);
  return true;
}

function resolveTemplate(name) {
  const dir = templatesDir();
  const from = path.join(dir, `${name}.ts`);
  return fs.existsSync(from) ? from : null;
}

function resolveWorkflows(name) {
  const dir = workflowsDir();
  if (!fs.existsSync(dir)) return [];
  const matches = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const ext of [".yml", ".yaml"]) {
      const from = path.join(dir, entry.name, `${name}${ext}`);
      if (fs.existsSync(from)) {
        matches.push({ provider: entry.name, file: `${name}${ext}`, from });
      }
    }
  }
  return matches;
}

function cmdInit(cwd, force) {
  const from = path.join(templatesDir(), "cdk.json");
  if (!fs.existsSync(from)) {
    console.error("Template files missing. Try reinstalling @asdi/aws-infra.");
    process.exit(1);
  }
  copyFile(from, path.join(cwd, "cdk.json"), force);
  installDeps(cwd);
}

function cmdAdd(cwd, name, force) {
  const templateFrom = resolveTemplate(name);
  if (templateFrom) {
    copyFile(templateFrom, path.join(cwd, "infra", `${name}.ts`), force);
    return;
  }

  const wfMatches = resolveWorkflows(name);
  if (wfMatches.length === 1) {
    const m = wfMatches[0];
    const to =
      m.provider === "github"
        ? path.join(cwd, ".github", "workflows", m.file)
        : path.join(cwd, "workflows", m.provider, m.file);
    copyFile(m.from, to, force);
    return;
  }
  if (wfMatches.length > 1) {
    console.error(
      `Ambiguous name "${name}" matches multiple workflows: ${wfMatches.map((m) => `${m.provider}/${m.file}`).join(", ")}.`,
    );
    process.exit(1);
  }

  console.error(`Unknown template or workflow "${name}". Use "list" to see available names.`);
  process.exit(1);
}

function printHelp() {
  console.log(
    "Usage: npx @asdi/aws-infra <command> [options]\n\nCommands:\n  list          List templates and workflows\n  init          Scaffold cdk.json and install dependencies\n  add <name>    Add a template or workflow by name\n  help          Show this help\n\nOptions:\n  --force       Overwrite existing files\n  -h, --help    Show this help\n\nExamples:\n  npx @asdi/aws-infra list\n  npx @asdi/aws-infra init\n  npx @asdi/aws-infra add static-website\n  npx @asdi/aws-infra add sync --force",
  );
}

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("-"));
  const cmd = positional[0];
  const name = positional[1];
  const help = args.includes("--help") || args.includes("-h");
  const force = args.includes("--force");

  if (help || cmd === "help" || cmd === undefined) {
    printHelp();
    return;
  }

  if (cmd === "list") {
    cmdList();
    return;
  }

  if (cmd === "init") {
    cmdInit(process.cwd(), force);
    return;
  }

  if (cmd === "add") {
    if (!name) {
      console.error('Missing name. Usage: npx @asdi/aws-infra add <name> [--force]');
      process.exit(1);
    }
    cmdAdd(process.cwd(), name, force);
    return;
  }

  console.error(`Unknown command "${cmd}".`);
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
