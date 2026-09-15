// .env <-> SSM parameter mapping.
// File convention: one file holds multiple SSM prefixes.
//   # path: /myapp/prod     # -> SSM prefix
//   # string
//   A=42
//   B=24
//
//   # secret           # -> SecureString
//   C=23
//
//   # path: /myapp/shared
//   # list             # -> StringList
//   E=1,2,3

export type ParamType = "String" | "SecureString" | "StringList";

export interface FileParam {
  path: string;
  key: string;
  value: string;
  type: ParamType;
}

export const ENV_FORMAT_HELP = `Env file format:
  # path: /myapp/prod    required before any KEY 
  KEY=value              default type is String
  # string               following keys are String
  # secret               following keys are SecureString
  # list                 following keys are StringList

Example:
  # path: /myapp/prod
  # string
  A=42
  B=24
  # secret
  C=23
  # path: /myapp/shared
  # list
  E=1,2,3

Rules:
  - single/double quotes around values are stripped
  - blank lines and unknown "# comments" are ignored
  - type resets to String on every "# path:"
  - duplicate (path, key): last wins
  - keys may contain [a-zA-Z0-9_. -], no slashes
  - list values split on "," and are trimmed`;

const KEY_RE = /^[a-zA-Z0-9_.-]+$/;

function pathOfMarker(line: string): string | null | { error: string } {
  // Accepts "# path: /myapp/prod" (case-insensitive, flexible spacing).
  const m = line.match(/^\s*#\s*path\s*:(.*)$/i);
  if (!m) return null;
  const raw = (m[1] ?? "").trim();
  if (raw === "") return { error: "missing value" };
  let p = raw.split(/\s+/)[0] ?? "";
  // Strip inline trailing comment attached without space? No — values with
  // spaces are invalid SSM paths, so take first token and validate strictly.
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+$/, "");
  if (p === "" || /^\/+$/.test(raw)) return { error: `"${raw}"` };
  if (/[^a-zA-Z0-9_.\-/]/.test(p)) return { error: `"${raw}"` };
  return p;
}
function sectionOfMarker(line: string): ParamType | null {
  // Accepts "# string", "#string", "# secret", "#securestring", "# list".
  const m = line.match(/^\s*#\s*([a-z]+)\s*$/i);
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (word === "string") return "String";
  if (word === "secret" || word === "securestring") return "SecureString";
  if (word === "list" || word === "stringlist") return "StringList";
  return null;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnvFile(content: string): {
  params: FileParam[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const byId = new Map<string, FileParam>();
  const order: string[] = [];
  const seenPaths = new Set<string>();
  let currentPath: string | null = null;
  let current: ParamType = "String";

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "") continue;

    const pathMarker = pathOfMarker(trimmed);
    if (pathMarker !== null) {
      if (typeof pathMarker !== "string") {
        throw new Error(
          `Line ${i + 1}: invalid "# path:" value ${pathMarker.error} (expected e.g. "# path: /myapp/prod").`,
        );
      }
      currentPath = pathMarker;
      current = "String"; // type resets on every path switch
      seenPaths.add(currentPath);
      continue;
    }

    const section = sectionOfMarker(trimmed);
    if (section) {
      if (currentPath === null) {
        throw new Error(
          `Line ${i + 1}: type marker before any "# path:" (add "# path: /prefix" first).`,
        );
      }
      current = section;
      continue;
    }
    if (trimmed.startsWith("#")) continue; // unknown comment, ignore

    let line = trimmed;
    if (/^export\s+/i.test(line)) line = line.replace(/^export\s+/i, "").trim();

    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Line ${i + 1}: expected KEY=value, got: ${raw}`);
    }
    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();
    if (currentPath === null) {
      throw new Error(
        `Line ${i + 1}: KEY=value before any "# path:" (add "# path: /prefix" first).`,
      );
    }
    if (!key || !KEY_RE.test(key)) {
      throw new Error(
        `Line ${i + 1}: invalid key "${key}" (allowed: [a-zA-Z0-9_. -]).`,
      );
    }
    const value = stripQuotes(rawValue);

    if (current === "StringList") {
      const items = value.split(",").map((s) => s.trim());
      if (items.some((s) => s === "")) {
        throw new Error(`Line ${i + 1}: list "${key}" contains an empty item.`);
      }
    }

    const id = `${currentPath}\u0000${key}`;
    if (byId.has(id))
      warnings.push(
        `Duplicate key "${key}" under ${currentPath} on line ${i + 1}: last wins.`,
      );
    else order.push(id);
    byId.set(id, { path: currentPath, key, value, type: current });
  }

  if (seenPaths.size === 0 && order.length === 0) {
    // Distinguish truly empty files (only comments/blank) from keys without path
    // (already thrown above). Empty files push nothing.
    return { params: [], warnings };
  }
  for (const p of seenPaths) {
    if (!order.some((id) => id.startsWith(p + "\u0000"))) {
      warnings.push(`Empty path "${p}": no keys (skipped on push).`);
    }
  }

  return { params: order.map((id) => byId.get(id)!), warnings };
}

export function emitEnvFile(params: FileParam[]): string {
  const groups: Array<{ type: ParamType; marker: string }> = [
    { type: "String", marker: "# string" },
    { type: "SecureString", marker: "# secret" },
    { type: "StringList", marker: "# list" },
  ];
  const lines: string[] = [
    "# Generated by asdi param pull. See: asdi param --help",
  ];
  const paths = [...new Set(params.map((p) => p.path))].sort((a, b) =>
    a.localeCompare(b),
  );
  for (const p of paths) {
    lines.push("", `# path: ${p}`);
    for (const g of groups) {
      const items = params
        .filter((x) => x.path === p && x.type === g.type)
        .sort((a, b) => a.key.localeCompare(b.key));
      if (items.length === 0) continue;
      lines.push(g.marker);
      for (const item of items) lines.push(`${item.key}=${item.value}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
