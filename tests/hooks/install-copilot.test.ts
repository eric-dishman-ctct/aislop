import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	installCopilot,
	resolveCopilotPaths,
	uninstallCopilot,
} from "../../src/hooks/install/copilot.js";

let home: string;
let cwd: string;

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-home-"));
	cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cwd-"));
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(cwd, { recursive: true, force: true });
});

const opts = (scope: "global" | "project", qualityGate = false) => ({
	home,
	cwd,
	scope,
	qualityGate,
});

const fixture = (name: string): string =>
	fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");

describe("Copilot runtime hooks", () => {
	it("matches the accepted hook-file groups without a version or FileChanged group", () => {
		installCopilot(opts("project", true));
		const generated = JSON.parse(fs.readFileSync(resolveCopilotPaths(opts("project")).hookFile, "utf8"));
		const capture = JSON.parse(fixture("copilot-B-hookfile.json"));
		capture.hooks.PostToolUse[0].hooks[0].command = "aislop hook claude";
		capture.hooks.Stop[0].hooks[0].command = "aislop hook claude --stop";

		expect(capture.hooks.FileChanged).toBeDefined();
		expect(generated.hooks.PostToolUse).toEqual(capture.hooks.PostToolUse);
		expect(generated.hooks.Stop).toEqual(capture.hooks.Stop);
		expect(generated).not.toHaveProperty("version");
		expect(Object.keys(generated.hooks).sort()).toEqual(["PostToolUse", "Stop"]);
	});

	it("adds Stop only when qualityGate is true and remains idempotent", () => {
		installCopilot(opts("project", true));
		installCopilot(opts("project", true));
		const paths = resolveCopilotPaths(opts("project"));
		const hooked = JSON.parse(fs.readFileSync(paths.hookFile, "utf8"));
		expect(hooked.hooks.PostToolUse).toHaveLength(1);
		expect(hooked.hooks.Stop).toHaveLength(1);
		installCopilot(opts("project"));
		const ungated = JSON.parse(fs.readFileSync(paths.hookFile, "utf8"));
		expect(ungated.hooks.Stop).toBeUndefined();
	});

	it("writes project rules but global scope writes only COPILOT_HOME hooks", () => {
		installCopilot(opts("project"));
		const projectPaths = resolveCopilotPaths(opts("project"));
		expect(fs.existsSync(projectPaths.hookFile)).toBe(true);
		expect(fs.readFileSync(projectPaths.instructionsFile, "utf8")).toContain("trusted folder");
		const other = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-global-cwd-"));
		try {
			installCopilot({ home, cwd: other, scope: "global" });
			const globalPaths = resolveCopilotPaths({ home, cwd: other, scope: "global" });
			expect(fs.existsSync(globalPaths.hookFile)).toBe(true);
			expect(fs.existsSync(path.join(other, ".github"))).toBe(false);
		} finally {
			fs.rmSync(other, { recursive: true, force: true });
		}
	});

	it("does not rewrite unmanaged instruction or foreign hook files", () => {
		const paths = resolveCopilotPaths(opts("project"));
		fs.mkdirSync(path.dirname(paths.hookFile), { recursive: true });
		fs.mkdirSync(path.dirname(paths.instructionsFile), { recursive: true });
		const hooks = '{\n  "hooks": { "PostToolUse": [{ "matcher": "Bash", "hooks": [{ "command": "keep" }] }] }\n}\n';
		const instructions = "# User instructions\nKeep this text.\n";
		fs.writeFileSync(paths.hookFile, hooks);
		fs.writeFileSync(paths.instructionsFile, instructions);

		uninstallCopilot(opts("project"));

		expect(fs.readFileSync(paths.hookFile, "utf8")).toBe(hooks);
		expect(fs.readFileSync(paths.instructionsFile, "utf8")).toBe(instructions);
	});

	it("removes only managed groups and the managed instruction fence", () => {
		installCopilot(opts("project", true));
		const paths = resolveCopilotPaths(opts("project"));
		const hookFile = JSON.parse(fs.readFileSync(paths.hookFile, "utf8"));
		hookFile.hooks.PostToolUse.push({ matcher: "Bash", hooks: [{ command: "keep" }] });
		fs.writeFileSync(paths.hookFile, `${JSON.stringify(hookFile, null, 2)}\n`);
		fs.appendFileSync(paths.instructionsFile, "\n# User rules\nKeep this.\n");
		uninstallCopilot(opts("project"));
		expect(fs.existsSync(paths.hookFile)).toBe(true);
		const after = JSON.parse(fs.readFileSync(paths.hookFile, "utf8"));
		expect(after.hooks.PostToolUse).toEqual([{ matcher: "Bash", hooks: [{ command: "keep" }] }]);
		expect(fs.existsSync(paths.instructionsFile)).toBe(true);
		const instructions = fs.readFileSync(paths.instructionsFile, "utf8");
		expect(instructions).toContain("User rules");
		expect(instructions).not.toContain("aislop:begin");
	});
});

const assertCaptureFixture = (capture: unknown): void => {
	expect(Array.isArray(capture)).toBe(true);
	if (!Array.isArray(capture)) return;
	expect(capture.length).toBeGreaterThanOrEqual(1);
	const first = capture[0];
	expect(first).toBeTypeOf("object");
	expect(first).not.toBeNull();
	const event = first as Record<string, unknown>;
	expect(typeof event.hook_event_name === "string" || typeof event.toolName === "string").toBe(true);
};

describe("Copilot fixture captures", () => {
	it("rejects a capture without an event field", () => {
		expect(() => assertCaptureFixture([{}])).toThrow();
	});
	for (const name of [
		"copilot-A-PostToolUse.json",
		"copilot-E-postToolUse.json",
		"copilot-A-regression-Stop.json",
	]) {
		it(`${name} starts with an event payload`, () => {
			assertCaptureFixture(JSON.parse(fixture(name)));
		});
	}
});
