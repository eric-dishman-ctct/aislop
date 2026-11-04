import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHookRuntime } from "../../src/hooks/runtime/resolve.js";
import {
	installGemini,
	resolveGeminiPaths,
	uninstallGemini,
} from "../../src/hooks/install/gemini.js";

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

describe("installGemini", () => {
	it("writes AfterTool hook and rules file", () => {
		const opts = { home, cwd, scope: "global" as const };
		installGemini(opts);
		const paths = resolveGeminiPaths(opts);
		const settings = JSON.parse(fs.readFileSync(paths.settings, "utf-8"));
		expect(settings.hooks.AfterTool).toHaveLength(1);
		expect(settings.hooks.AfterTool[0].matcher).toBe("write_file|replace");
		expect(settings.hooks.AfterTool[0].hooks[0].command).toBe("aislop hook gemini");
		expect(fs.readFileSync(paths.aislopMd, "utf-8")).toContain("<!-- aislop:begin");
		expect(fs.readFileSync(paths.geminiMd, "utf-8")).toContain("@AISLOP.md");
	});

	it("uses portable and absolute commands from the selected form", () => {
		const opts = { home, cwd, scope: "global" as const, absolute: false };
		installGemini(opts);
		const paths = resolveGeminiPaths(opts);
		const before = JSON.parse(fs.readFileSync(paths.settings, "utf8")).hooks.AfterTool[0].hooks[0];
		expect(before.command).toBe("aislop hook gemini");
		const result = installGemini({ ...opts, absolute: true });
		expect(result.rewrittenFromPortable).toBe(true);
		const after = JSON.parse(fs.readFileSync(paths.settings, "utf8")).hooks.AfterTool[0].hooks[0];
		expect(after.command).toContain(resolveHookRuntime().nodePath);
		expect(after.command).toContain(resolveHookRuntime().cliPath);
		expect(after.command).toMatch(/['"]hook['"] ['"]gemini['"]/);
		expect(after.__aislop.hash).not.toBe(before.__aislop.hash);
	});

	it("uninstalls cleanly", () => {
		const opts = { home, cwd, scope: "global" as const };
		installGemini(opts);
		uninstallGemini(opts);
		const paths = resolveGeminiPaths(opts);
		expect(fs.existsSync(paths.aislopMd)).toBe(false);
	});
});
