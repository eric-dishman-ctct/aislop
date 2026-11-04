import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	extractFiles,
	parseClaudeStdin,
	renderClaudeOutput,
	runClaudeHook,
	runClaudeStopHook,
} from "../../src/hooks/adapters/claude.js";

const tempDirs: string[] = [];
const tempDir = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-hook-"));
	tempDirs.push(dir);
	return dir;
};

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const writeBaseline = (cwd: string): void => {
	fs.mkdirSync(path.join(cwd, ".aislop"), { recursive: true });
	fs.writeFileSync(
		path.join(cwd, ".aislop", "baseline.json"),
		JSON.stringify({ schema: "aislop.baseline.v2", score: 100, findingFingerprints: [] }),
	);
};

const scanResult = (cwd: string, regressed: boolean) => ({
	diagnostics: regressed
		? [{ filePath: path.join(cwd, "F.ts"), line: 1, rule: "test/regression", severity: "error" }]
		: [],
	score: regressed ? 90 : 100,
	rootDirectory: cwd,
});

describe("parseClaudeStdin", () => {
	it("returns {} for empty input", () => {
		expect(parseClaudeStdin("")).toEqual({});
		expect(parseClaudeStdin("   ")).toEqual({});
	});

	it("returns {} for malformed JSON", () => {
		expect(parseClaudeStdin("not json")).toEqual({});
	});

	it("parses a PostToolUse Edit payload", () => {
		const raw = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: { file_path: "/abs/file.ts" },
			cwd: "/abs",
		});
		const parsed = parseClaudeStdin(raw);
		expect(parsed.tool_name).toBe("Edit");
		expect(parsed.tool_input?.file_path).toBe("/abs/file.ts");
	});

	it("parses the Copilot snake_case path payload", () => {
		const raw = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: { path: "/abs/copilot.ts" },
		});
		expect(extractFiles(parseClaudeStdin(raw))).toEqual(["/abs/copilot.ts"]);
	});

	it("does not scan or write for the native camelCase Copilot capture", async () => {
		const scan = vi.fn();
		const write = vi.fn();
		const capture = JSON.parse(
			fs.readFileSync(path.join(import.meta.dirname, "fixtures", "copilot-E-postToolUse.json"), "utf8"),
		)[0];

		const code = await runClaudeHook({ stdin: async () => JSON.stringify(capture), scan, write });

		expect(code).toBe(0);
		expect(scan).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});
});

describe("runClaudeStopHook", () => {
	it("does not scan or write when no session record exists", async () => {
		const cwd = tempDir();
		writeBaseline(cwd);
		const scan = vi.fn();
		const write = vi.fn();

		await expect(runClaudeStopHook({ stdin: async () => JSON.stringify({ cwd }), scan, write })).resolves.toBe(0);
		expect(scan).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});

	it("blocks after it rescans a recorded file with a regression", async () => {
		const cwd = tempDir();
		const file = path.join(cwd, "F.ts");
		writeBaseline(cwd);
		fs.writeFileSync(path.join(cwd, ".aislop", "session.jsonl"), `${JSON.stringify({ files: [file] })}\n`);
		fs.writeFileSync(file, "const regression = true;\n");
		const scan = vi.fn(async (_cwd: string, files: string[]) => scanResult(cwd, true));
		const write = vi.fn();

		await runClaudeStopHook({
			stdin: async () => JSON.stringify({ cwd }),
			scan,
			write,
			commandPrefix: "'/node' '/cli.js'",
		});
		expect(scan).toHaveBeenCalledWith(cwd, [file]);
		const output = JSON.parse(write.mock.calls[0][0]);
		expect(output.decision).toBe("block");
		expect(output.reason).toContain("do not run bare aislop");
		const feedback = JSON.parse(output.hookSpecificOutput.additionalContext);
		expect(feedback.suggestedActions).toContainEqual(
			expect.objectContaining({ id: "verify_fix", command: "'/node' '/cli.js' scan --changes" }),
		);
	});

	it("uses portable guidance when the verify command uses the portable prefix", async () => {
		const cwd = tempDir();
		const file = path.join(cwd, "F.ts");
		writeBaseline(cwd);
		fs.writeFileSync(path.join(cwd, ".aislop", "session.jsonl"), `${JSON.stringify({ files: [file] })}\n`);
		fs.writeFileSync(file, "const regression = true;\n");
		const scan = vi.fn(async () => scanResult(cwd, true));
		const write = vi.fn();

		await runClaudeStopHook({
			stdin: async () => JSON.stringify({ cwd }),
			scan,
			write,
			commandPrefix: "aislop",
		});

		const output = JSON.parse(write.mock.calls[0][0]);
		expect(output.reason).toContain("Use the verify_fix command in suggestedActions to confirm.");
		expect(output.reason).not.toContain("bare aislop");
		const feedback = JSON.parse(output.hookSpecificOutput.additionalContext);
		expect(feedback.suggestedActions).toContainEqual(
			expect.objectContaining({ id: "verify_fix", command: "aislop scan --changes" }),
		);
	});

	it("clears session records without writing after a clean rescan", async () => {
		const cwd = tempDir();
		const file = path.join(cwd, "F.ts");
		writeBaseline(cwd);
		fs.writeFileSync(path.join(cwd, ".aislop", "session.jsonl"), `${JSON.stringify({ files: [file] })}\n`);
		fs.writeFileSync(file, "const clean = true;\n");
		const scan = vi.fn(async () => scanResult(cwd, false));
		const write = vi.fn();

		await runClaudeStopHook({ stdin: async () => JSON.stringify({ cwd }), scan, write });
		expect(write).not.toHaveBeenCalled();
		expect(fs.existsSync(path.join(cwd, ".aislop", "session.jsonl"))).toBe(false);
	});

	it("returns before it reads state when a previous Stop block is active", async () => {
		const scan = vi.fn();
		const write = vi.fn();
		await expect(
			runClaudeStopHook({ stdin: async () => JSON.stringify({ cwd: "/missing", stop_hook_active: true }), scan, write }),
		).resolves.toBe(0);
		expect(scan).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});
});

describe("renderClaudeOutput", () => {
	it("wraps additionalContext in the PostToolUse envelope", () => {
		const out = renderClaudeOutput('{"score":90}');
		expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
		expect(out.hookSpecificOutput.additionalContext).toBe('{"score":90}');
		expect(out.decision).toBeUndefined();
	});

	it("emits block decision with reason when provided", () => {
		const out = renderClaudeOutput('{"score":40}', { reason: "regressed" });
		expect(out.decision).toBe("block");
		expect(out.reason).toBe("regressed");
	});
});
