import {
  DeleteParameterCommand,
  GetParametersByPathCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import type { FileParam, ParamType } from "./format";

export function normalizePrefix(prefix: string): string {
  if (!prefix || prefix.trim() === "")
    throw new Error("Missing --prefix (e.g. --prefix /myapp/prod).");
  let p = prefix.trim();
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/+$/, "");
  if (p === "") throw new Error(`Invalid --prefix "${prefix}".`);
  return p;
}

export function fullName(path: string, key: string): string {
  return `${normalizePrefix(path)}/${key}`;
}

// Delete safety guards. normalizePrefix("/") already throws, but with a
// generic message — this names the danger explicitly before anything else.
export function assertNotRoot(raw: string): void {
  const t = (raw ?? "").trim();
  if (t === "" || /^\/+$/.test(t)) {
    throw new Error(
      "Refusing: --prefix '/' would delete the entire Parameter Store. Delete a named prefix instead.",
    );
  }
}

// Depth of a normalized prefix: "/prod" -> 1, "/myapp/prod" -> 2.
export function prefixDepth(normalized: string): number {
  return normalized.split("/").filter((s) => s !== "").length;
}

// How many --force flags delete requires: shallow prefixes need doubling.
export function forceRequired(normalized: string): number {
  return prefixDepth(normalized) <= 1 ? 2 : 1;
}

export function resolveRegion(explicit?: string): string | undefined {
  const r = (
    explicit ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION
  )?.trim();
  return r === "" ? undefined : r;
}

export function createClient(region?: string): SSMClient {
  return new SSMClient({ region: resolveRegion(region) });
}

export function ssmTypeToFileType(
  t: string | undefined,
  name: string,
): ParamType {
  if (t === "SecureString") return "SecureString";
  if (t === "StringList") return "StringList";
  if (t === "String" || t === undefined) return "String";
  throw new Error(
    `Unsupported type "${t}" for ${name} (only String/SecureString/StringList).`,
  );
}

export interface PushResult {
  put: number;
  skipped: number;
  failed: number;
}

export async function pushParams(
  client: SSMClient,
  params: FileParam[],
  opts: { overwrite: boolean; dryRun: boolean; log: (msg: string) => void },
): Promise<PushResult> {
  const sorted = [...params].sort(
    (a, b) => a.path.localeCompare(b.path) || a.key.localeCompare(b.key),
  );
  let put = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of sorted) {
    const name = `${p.path}/${p.key}`;
    const dry = opts.dryRun ? "DRY-RUN " : "";
    if (opts.dryRun) {
      opts.log(`${dry}PUT ${name} (${p.type}, overwrite=${opts.overwrite})`);
      put++;
      continue;
    }
    try {
      await client.send(
        new PutParameterCommand({
          Name: name,
          Value: p.value,
          Type: p.type,
          Overwrite: opts.overwrite,
          Tier: "Standard", // no support for advanced/intelligent-tiering for now
        }),
      );
      opts.log(`✔ PUT ${name} (${p.type})`);
      put++;
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      // Without --overwrite, SSM throws ParameterAlreadyExists. Treat as skip, not failure.
      if (!opts.overwrite && e?.name === "ParameterAlreadyExists") {
        opts.log(`⏭ SKIP ${name} (exists, use --overwrite)`);
        skipped++;
        continue;
      }
      opts.log(`✖ FAIL ${name}: ${e?.message ?? String(err)}`);
      failed++;
    }
  }
  opts.log(`Done: ${put} put, ${skipped} skipped, ${failed} failed.`);
  return { put, skipped, failed };
}

export async function pullParams(
  client: SSMClient,
  prefix: string,
): Promise<FileParam[]> {
  const norm = normalizePrefix(prefix);
  const out: FileParam[] = [];
  let nextToken: string | undefined;

  do {
    const res = await client.send(
      new GetParametersByPathCommand({
        Path: norm,
        Recursive: true,
        WithDecryption: true,
        MaxResults: 10,
        NextToken: nextToken,
      }),
    );
    for (const p of res.Parameters ?? []) {
      if (!p.Name) continue;
      // Split on last "/": dir -> # path:, leaf -> KEY. This supports pulling
      // a parent prefix (e.g. /myapp) into multiple # path: sections.
      // Names equal to the prefix itself have no leaf key and are skipped.
      if (!p.Name.startsWith(norm + "/") && p.Name !== norm) continue;
      if (p.Name === norm) continue;
      const slash = p.Name.lastIndexOf("/");
      if (slash <= 0) continue;
      const dir = p.Name.slice(0, slash);
      const key = p.Name.slice(slash + 1);
      if (!dir || !key || key.includes("/")) continue;
      out.push({
        path: dir,
        key,
        value: p.Value ?? "",
        type: ssmTypeToFileType(p.Type, p.Name),
      });
    }
    nextToken = res.NextToken;
  } while (nextToken);

  return out.sort(
    (a, b) => a.path.localeCompare(b.path) || a.key.localeCompare(b.key),
  );
}

// Phase 1 of delete: full recursive name list (all pages) before any write.
// Unlike pull, no flat-key filter — nested /prefix/a/b dies too.
// WithDecryption:false — values are irrelevant for deletion and this avoids
// KMS decrypt permission requirements on the list step.
export async function listParamNames(
  client: SSMClient,
  prefix: string,
): Promise<string[]> {
  const norm = normalizePrefix(prefix);
  const out: string[] = [];
  let nextToken: string | undefined;

  do {
    const res = await client.send(
      new GetParametersByPathCommand({
        Path: norm,
        Recursive: true,
        WithDecryption: false,
        MaxResults: 10,
        NextToken: nextToken,
      }),
    );
    for (const p of res.Parameters ?? []) {
      if (p.Name) out.push(p.Name);
    }
    nextToken = res.NextToken;
  } while (nextToken);

  return out.sort((a, b) => a.localeCompare(b));
}

export interface DeleteResult {
  deleted: number;
  failed: number;
}

// Phase 2 of delete: sequential DeleteParameter over a pre-listed name set
// (SSM has no batch-delete API). Continue-on-error, mirroring pushParams.
export async function deleteByNames(
  client: SSMClient,
  names: string[],
  opts: { dryRun: boolean; log: (msg: string) => void },
): Promise<DeleteResult> {
  let deleted = 0;
  let failed = 0;

  for (const name of names) {
    if (opts.dryRun) {
      opts.log(`DRY-RUN DELETE ${name}`);
      deleted++;
      continue;
    }
    try {
      await client.send(new DeleteParameterCommand({ Name: name }));
      opts.log(`✔ DELETE ${name}`);
      deleted++;
    } catch (err: unknown) {
      const e = err as { message?: string };
      opts.log(`✖ FAIL ${name}: ${e?.message ?? String(err)}`);
      failed++;
    }
  }
  const dry = opts.dryRun ? "DRY-RUN " : "";
  opts.log(`${dry}Done: ${deleted} deleted, ${failed} failed.`);
  return { deleted, failed };
}
