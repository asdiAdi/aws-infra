import { emitEnvFile, parseEnvFile } from "./format";
import { parseArgs, main } from "./index";
import { assertNotRoot, forceRequired, prefixDepth } from "./ssm";

describe("param format", () => {
  it("parses multiple paths with type sections", () => {
    const content = [
      "# path: /myapp/prod",
      "# string",
      "A=42",
      "B=24",
      "# secret",
      "C=23",
      "# path: /myapp/shared",
      "# list",
      "E=1,2,3",
    ].join("\n");
    const { params, warnings } = parseEnvFile(content);
    expect(warnings).toEqual([]);
    expect(params).toEqual([
      { path: "/myapp/prod", key: "A", value: "42", type: "String" },
      { path: "/myapp/prod", key: "B", value: "24", type: "String" },
      { path: "/myapp/prod", key: "C", value: "23", type: "SecureString" },
      { path: "/myapp/shared", key: "E", value: "1,2,3", type: "StringList" },
    ]);
  });

  it("resets type to String on every path switch", () => {
    const content = ["# path: /a", "# secret", "S=1", "# path: /b", "T=2"].join(
      "\n",
    );
    const { params } = parseEnvFile(content);
    expect(params).toEqual([
      { path: "/a", key: "S", value: "1", type: "SecureString" },
      { path: "/b", key: "T", value: "2", type: "String" },
    ]);
  });

  it("merges repeated paths and allows same key under different paths", () => {
    const content = [
      "# path: /a",
      "K=1",
      "# path: /b",
      "K=2",
      "# path: /a",
      "J=3",
    ].join("\n");
    const { params, warnings } = parseEnvFile(content);
    expect(warnings).toEqual([]);
    expect(params).toEqual([
      { path: "/a", key: "K", value: "1", type: "String" },
      { path: "/b", key: "K", value: "2", type: "String" },
      { path: "/a", key: "J", value: "3", type: "String" },
    ]);
  });

  it("last duplicate (path,key) wins with warning", () => {
    const content = ["# path: /a", "K=1", "K=2"].join("\n");
    const { params, warnings } = parseEnvFile(content);
    expect(params).toEqual([
      { path: "/a", key: "K", value: "2", type: "String" },
    ]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Duplicate key "K" under \/a/);
  });

  it("warns on empty path blocks", () => {
    const content = ["# path: /empty", "# path: /a", "K=1"].join("\n");
    const { params, warnings } = parseEnvFile(content);
    expect(params.map((p) => p.key)).toEqual(["K"]);
    expect(warnings.some((w) => w.includes('Empty path "/empty"'))).toBe(true);
  });

  it("supports export prefix, quotes and ignores comments", () => {
    const { params } = parseEnvFile(
      ["# path: /a", 'export A="a b"', "B='x'", "# a comment", "", "C=y"].join(
        "\n",
      ),
    );
    expect(params).toEqual([
      { path: "/a", key: "A", value: "a b", type: "String" },
      { path: "/a", key: "B", value: "x", type: "String" },
      { path: "/a", key: "C", value: "y", type: "String" },
    ]);
  });

  it("rejects keys before any path, bad keys, bad paths and empty list items", () => {
    expect(() => parseEnvFile("A=1\n")).toThrow(/before any "# path:"/);
    expect(() => parseEnvFile("# string\nA=1\n")).toThrow(
      /before any "# path:"/,
    );
    expect(() => parseEnvFile("# path: /a\nBAD/KEY=1")).toThrow(/invalid key/);
    expect(() => parseEnvFile("# path:\n")).toThrow(/invalid "# path:"/);
    expect(() => parseEnvFile("# path: /\n")).toThrow(/invalid "# path:"/);
    expect(() => parseEnvFile("# path: /a\n# list\nE=1,,3")).toThrow(
      /empty item/,
    );
  });

  it("round-trips through emit grouped by path then type", () => {
    const emitted = emitEnvFile([
      { path: "/myapp/shared", key: "B", value: "2", type: "StringList" },
      { path: "/myapp/prod", key: "S", value: "s", type: "SecureString" },
      { path: "/myapp/prod", key: "A", value: "1", type: "String" },
    ]);
    expect(emitted).toContain("# path: /myapp/prod");
    expect(emitted).toContain("# path: /myapp/shared");
    expect(emitted.indexOf("# path: /myapp/prod")).toBeLessThan(
      emitted.indexOf("# path: /myapp/shared"),
    );
    const { params } = parseEnvFile(emitted);
    expect(params).toEqual([
      { path: "/myapp/prod", key: "A", value: "1", type: "String" },
      { path: "/myapp/prod", key: "S", value: "s", type: "SecureString" },
      { path: "/myapp/shared", key: "B", value: "2", type: "StringList" },
    ]);
  });
});

describe("param delete guards", () => {
  it("refuses root prefixes", () => {
    expect(() => assertNotRoot("/")).toThrow(/entire Parameter Store/);
    expect(() => assertNotRoot("///")).toThrow(/entire Parameter Store/);
    expect(() => assertNotRoot("")).toThrow(/entire Parameter Store/);
    expect(() => assertNotRoot("/myapp/prod")).not.toThrow();
  });

  it("measures normalized prefix depth", () => {
    expect(prefixDepth("/prod")).toBe(1);
    expect(prefixDepth("/myapp/prod")).toBe(2);
    expect(prefixDepth("/a/b/c")).toBe(3);
  });

  it("requires double --force for single-segment prefixes", () => {
    expect(forceRequired("/prod")).toBe(2);
    expect(forceRequired("/myapp/prod")).toBe(1);
  });

  it("counts --force occurrences", () => {
    expect(parseArgs(["delete", "--prefix", "/a/b"]).forceCount).toBe(0);
    expect(
      parseArgs(["delete", "--prefix", "/a/b", "--force"]).forceCount,
    ).toBe(1);
    expect(
      parseArgs(["delete", "--prefix", "/prod", "--force", "--force"])
        .forceCount,
    ).toBe(2);
  });

  it("rejects --file on delete before any AWS call", async () => {
    await expect(
      main(["delete", "--prefix", "/myapp/prod", "--file", ".env", "--force"]),
    ).rejects.toThrow(/takes no --file/);
  });

  it("rejects --prefix on push before any AWS call", async () => {
    await expect(
      main(["push", "--prefix", "/myapp/prod", "--file", ".env"]),
    ).rejects.toThrow(/takes no --prefix/);
  });

  it("refuses / before any AWS call", async () => {
    await expect(main(["delete", "--prefix", "/"])).rejects.toThrow(
      /entire Parameter Store/,
    );
  });
});
