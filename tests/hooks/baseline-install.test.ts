import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hookInstall } from "../../src/commands/hook.js";
import { baselinePath } from "../../src/hooks/quality-gate/baseline.js";

const dirs: string[] = [];
const temp = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-baseline-install-"));
	dirs.push(dir);
	return dir;
};

const install = async (home: string, cwd: string, dryRun = false): Promise<string> => {
	const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	vi.spyOn(os, "homedir").mockReturnValue(home);
	vi.spyOn(process, "cwd").mockReturnValue(cwd);
	await hookInstall({
		agents: ["claude"],
		scope: "project",
		dryRun,
		yes: true,
		qualityGate: true,
	});
	return stdout.mock.calls.map(([text]) => String(text)).join("");
};

afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("U6 baseline install", () => {
	it("captures a missing baseline, keeps an existing baseline byte-identical, and skips it without the gate", async () => {
		const home = temp();
		const cwd = temp();
		fs.writeFileSync(path.join(cwd, "source.ts"), "export const value = 1;\n");
		const captured = await install(home, cwd);
		const target = baselinePath(cwd);
		expect(fs.existsSync(target)).toBe(true);
		expect(captured).toMatch(/Baseline\s+captured, score 100,/);
		const original = fs.readFileSync(target, "utf8");
		const kept = await install(home, cwd);
		expect(fs.readFileSync(target, "utf8")).toBe(original);
		expect(kept).toMatch(/Baseline\s+kept, score 100/);
		const other = temp();
		vi.restoreAllMocks();
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.spyOn(process, "cwd").mockReturnValue(other);
		await hookInstall({
			agents: ["claude"],
			scope: "project",
			dryRun: false,
			yes: true,
			qualityGate: false,
		});
		expect(fs.existsSync(baselinePath(other))).toBe(false);
	});

	it("plans the baseline without writing it during a dry run", async () => {
		const home = temp();
		const cwd = temp();
		const output = await install(home, cwd, true);
		expect(fs.existsSync(baselinePath(cwd))).toBe(false);
		expect(output).toMatch(/Baseline\s+planned/);
	});
});
