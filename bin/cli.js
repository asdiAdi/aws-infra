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

const CANDIDATES = [
  path.join(__dirname, "../src/static-site/templates"),
  path.join(__dirname, "../dist/static-site/templates"),
];

function templateDir() {
  for (const d of CANDIDATES) {
    if (fs.existsSync(path.join(d, "infra", "index.ts"))) return d;
  }
  return CANDIDATES[0];
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

function copyDir(fromDir, toDir, force) {
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to, force);
    } else {
      copyFile(from, to, force);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args.find((a) => !a.startsWith("-"));
  const help = args.includes("--help") || args.includes("-h");
  const force = args.includes("--force");

  if (help || cmd === "help" || cmd === undefined) {
    console.log(
      "Usage: npx @asdi/aws-infra <command> [options]\n\nCommands:\n  static-site   Scaffold static site\n  list          List templates\n\nOptions:\n  --force       Overwrite existing scaffolded files\n  -h, --help    Show this help"
    );
    return;
  }

  if (cmd === "list") {
    console.log("static-site");
    return;
  }

  if (cmd !== "static-site") {
    console.error(`Unknown command "${cmd}".`);
    process.exit(1);
  }

  const from = templateDir();
  const cwd = process.cwd();
  for (const f of ["infra/index.ts", "cdk.json"]) {
    if (!fs.existsSync(path.join(from, f))) {
      console.error("Template files missing. Try reinstalling @asdi/aws-infra.");
      process.exit(1);
    }
  }

  copyFile(path.join(from, "infra", "index.ts"), path.join(cwd, "infra", "index.ts"), force);
  copyFile(path.join(from, "cdk.json"), path.join(cwd, "cdk.json"), force);

  const githubFrom = path.join(from, ".github");
  if (fs.existsSync(githubFrom)) {
    copyDir(githubFrom, path.join(cwd, ".github"), force);
  }

  installDeps(cwd);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
