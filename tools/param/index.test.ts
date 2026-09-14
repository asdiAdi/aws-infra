import { emitEnvFile, parseEnvFile } from "./format";
import { parseArgs, main } from "./index";
import { assertNotRoot, forceRequired, prefixDepth } from "./ssm";

describe("param format", () => {
  it("defaults to String without markers", () => {
    const { params, warnings } = parseEnvFile("TEST=23\n");
    expect(warnings).toEqual([]);
    expect(params).toEqual([{ key: "TEST", value: "23", type: "String" }]);
  });

  it("applies section markers until next marker", () => {
    const content = [
      "# string",
      "A=42",
      "B=33",
      "# secret",
      "C=32",
      "D=11",
      "# list",
      "E=1,2,3",
    ].join("\n");
    const { params } = parseEnvFile(content);
    expect(params).toEqual([
      { key: "A", value: "42", type: "String" },
      { key: "B", value: "33", type: "String" },
      { key: "C", value: "32", type: "SecureString" },
      { key: "D", value: "11", type: "SecureString" },
      { key: "E", value: "1,2,3", type: "StringList" },
    ]);
  });

  it("supports export prefix, quotes and ignores comments", () => {
    const { params } = parseEnvFile(
      ['export A="a b"', "B='x'", "# a comment", "", "C=y"].join("\n"),
    );
    expect(params).toEqual([
      { key: "A", value: "a b", type: "String" },
      { key: "B", value: "x", type: "String" },
      { key: "C", value: "y", type: "String" },
    ]);
  });

  it("last duplicate wins with warning", () => {
    const { params, warnings } = parseEnvFile("A=1\nA=2\n");
    expect(params).toEqual([{ key: "A", value: "2", type: "String" }]);
    expect(warnings.length).toBe(1);
  });

  it("rejects bad keys and empty list items", () => {
    expect(() => parseEnvFile("BAD/KEY=1")).toThrow(/invalid key/);
    expect(() => parseEnvFile("# list\nE=1,,3")).toThrow(/empty item/);
  });

  it("round-trips through emit grouped by type", () => {
    const emitted = emitEnvFile([
      { key: "B", value: "2", type: "StringList" },
      { key: "A", value: "1", type: "String" },
      { key: "S", value: "s", type: "SecureString" },
    ]);
    const { params } = parseEnvFile(emitted);
    expect(params.map((p) => p.key)).toEqual(["A", "S", "B"]);
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
    expect(parseArgs(["delete", "--prefix", "/a/b", "--force"]).forceCount).toBe(1);
    expect(
      parseArgs(["delete", "--prefix", "/prod", "--force", "--force"]).forceCount,
    ).toBe(2);
  });

  it("rejects --file on delete before any AWS call", async () => {
    await expect(
      main(["delete", "--prefix", "/myapp/prod", "--file", ".env", "--force"]),
    ).rejects.toThrow(/takes no --file/);
  });

  it("refuses / before any AWS call", async () => {
    await expect(main(["delete", "--prefix", "/"])).rejects.toThrow(
      /entire Parameter Store/,
    );
  });
});
