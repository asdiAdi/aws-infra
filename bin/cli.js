#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const DEPS = ["@asdi/aws-infra", "aws-cdk-lib"];
const DEV_DEPS = ["tsx"];

function installDeps(cwd) {
  if (!fs.existsSync(path.join(cwd, "package.json"))) {
    execSync("npm init -y", { cwd, stdio: "inherit" });
  }
  try {
    execSync(`npm install ${DEPS.join(" ")} --force`, {
      cwd,
      stdio: "inherit",
    });
    execSync(`npm install -D ${DEV_DEPS.join(" ")} --force`, {
      cwd,
      stdio: "inherit",
    });
    console.log("Dependencies installed successfully.");
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

function main() {
  const cmd = process.argv.slice(2).find((a) => !a.startsWith("-"));
  const help = process.argv.includes("--help") || process.argv.includes("-h");

  if (help || cmd === "help" || cmd === undefined) {
    console.log(
      "Usage: npx @asdi/aws-infra <command>\n\nCommands:\n  static-site   Scaffold static site\n  list          List templates"
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

  fs.mkdirSync(path.join(cwd, "infra"), { recursive: true });
  fs.copyFileSync(path.join(from, "infra", "index.ts"), path.join(cwd, "infra", "index.ts"));
  fs.copyFileSync(path.join(from, "cdk.json"), path.join(cwd, "cdk.json"));

  const githubFrom = path.join(from, ".github");
  if (fs.existsSync(githubFrom)) {
    fs.cpSync(githubFrom, path.join(cwd, ".github"), { recursive: true });
  }

  installDeps(cwd);
}

try {
  main();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
