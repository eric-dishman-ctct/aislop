import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatOpenCodeMessage, parseOpenCodeStdin, runOpenCodeHook } from "../../src/hooks/adapters/opencode.js";
import type { AislopFeedback } from "../../src/hooks/feedback.js";

const { spawnSync } = vi.hoisted(() => ({
	spawnSync: vi.fn(() => {
		throw new Error("automatic hook scans must not spawn subprocesses");
	}),
}));

vi.mock("node:child_process", () => ({ spawnSync }));

const baseFeedback = (overrides: Partial<AislopFeedback> = {}): AislopFeedback => ({
	schema: "aislop.hook.v2",
	score: 100,
	regressed: false,
	counts: { error: 0, warning: 0, fixable: 0, total: 0 },
	findings: [],
	nextSteps: [],
	suggestedActions: [],
	...overrides,
});

describe("parseOpenCodeStdin", () => {
	it("returns {} for empty or whitespace input", () => {
		expect(parseOpenCodeStdin("")).toEqual({});
		expect(parseOpenCodeStdin("   ")).toEqual({});
	});

	it("returns {} for malformed JSON", () => {
		expect(parseOpenCodeStdin("not json")).toEqual({});
	});

	it("parses a tool_result payload from the OpenCode plugin", () => {
		const parsed = parseOpenCodeStdin(
			JSON.stringify({ cwd: "/repo", file_paths: ["/repo/src/a.ts"], tool_name: "edit" }),
		);
		expect(parsed.cwd).toBe("/repo");
		expect(parsed.file_paths).toEqual(["/repo/src/a.ts"]);
		expect(parsed.tool_name).toBe("edit");
	});
});

describe("formatOpenCodeMessage", () => {
	it("returns an empty string when the file is clean", () => {
		expect(formatOpenCodeMessage(baseFeedback())).toBe("");
	});

	it("summarises score, counts, and each finding", () => {
		const message = formatOpenCodeMessage(
			baseFeedback({
				score: 82,
				baseline: 100,
				counts: { error: 1, warning: 1, fixable: 0, total: 2 },
				findings: [
					{
						ruleId: "security/eval",
						severity: "error",
						category: "Security",
						file: "src/a.ts",
						line: 12,
						message: "eval() is dangerous",
					},
					{
						ruleId: "ai-slop/trivial-comment",
						severity: "warning",
						category: "Comments",
						file: "src/a.ts",
						line: 3,
						message: "Trivial comment",
					},
				],
				nextSteps: ["Run `npx aislop fix`."],
			}),
		);
		expect(message).toContain("aislop: score 82/100 (baseline 100)");
		expect(message).toContain("1 error, 1 warning");
		expect(message).toContain("src/a.ts:12 [error] security/eval: eval() is dangerous");
		expect(message).toContain("src/a.ts:3 [warning] ai-slop/trivial-comment");
		expect(message).toContain("Run `npx aislop fix`.");
	});
});

describe("runOpenCodeHook (integration)", () => {
	let cwd: string;

	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-pi-"));
	});

	afterEach(() => {
		spawnSync.mockClear();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("emits a v2 envelope and does not block on a clean file", async () => {
		const file = path.join(cwd, "clean.ts");
		fs.writeFileSync(file, "export const add = (a: number, b: number): number => a + b;\n");

		let written = "";
		const code = await runOpenCodeHook({
			stdin: async () => JSON.stringify({ cwd, file_paths: [file] }),
			write: (s) => {
				written += s;
			},
		});

		expect(code).toBe(0);
		const out = JSON.parse(written);
		expect(out.schema).toBe("aislop.hook.v2");
		expect(out.block).toBe(false);
		expect(out.message).toBe("");
	});

	it("does not block a regression", async () => {
		const file = path.join(cwd, "regression.ts");
		fs.mkdirSync(path.join(cwd, ".aislop"), { recursive: true });
		fs.writeFileSync(file, "export const value = 1;\n");
		fs.writeFileSync(path.join(cwd, ".aislop", "baseline.json"), JSON.stringify({ schema: "aislop.baseline.v2", score: 100, findingFingerprints: [] }));
		let written = "";
		await runOpenCodeHook({
			stdin: async () => JSON.stringify({ cwd, file_paths: [file] }),
			write: (s) => { written += s; },
			scan: async () => ({ diagnostics: [{ filePath: file, line: 1, rule: "test/regression", severity: "error", category: "Test", message: "Regression" }], score: 90, rootDirectory: cwd }),
		});
		const out = JSON.parse(written);
		expect(out.feedback.regressed).toBe(true);
		expect(out.block).toBe(false);
	});

	it("scans the singular file_path payload", async () => {
		const file = path.join(cwd, "singular.ts");
		fs.writeFileSync(file, "export const value = 1;\n");
		let written = "";
		const scan = vi.fn(async (_cwd: string, files: string[]) => ({ diagnostics: [], score: 100, rootDirectory: cwd }));
		await runOpenCodeHook({ stdin: async () => JSON.stringify({ cwd, file_path: file }), write: (s) => { written += s; }, scan });
		expect(scan).toHaveBeenCalledWith(cwd, [file]);
		expect(JSON.parse(written).schema).toBe("aislop.hook.v2");
	});

	it("returns 0 without writing when no file path is supplied", async () => {
		let written = "";
		const code = await runOpenCodeHook({
			stdin: async () => JSON.stringify({ cwd }),
			write: (s) => {
				written += s;
			},
		});
		expect(code).toBe(0);
		expect(written).toBe("");
		expect(spawnSync).not.toHaveBeenCalled();
	});
});

describe("OpenCode path keys", () => {
	it("accepts both file_paths and file_path", () => {
		expect(parseOpenCodeStdin('{"file_paths":["a.ts"]}').file_paths).toEqual(["a.ts"]);
		expect(parseOpenCodeStdin('{"file_path":"a.ts"}').file_path).toBe("a.ts");
	});
});
