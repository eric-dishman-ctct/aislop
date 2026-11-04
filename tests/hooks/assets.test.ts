import { describe, expect, it } from "vitest";
import { CONFIG_FILE, RULES_FILE } from "../../src/config/index.js";
import { AISLOP_MD_BODY } from "../../src/hooks/assets.js";

describe("AISLOP_MD_BODY", () => {
	it("references the config file names the loader actually reads", () => {
		expect(AISLOP_MD_BODY).toContain(`.aislop/${CONFIG_FILE}`);
		expect(AISLOP_MD_BODY).toContain(`.aislop/${RULES_FILE}`);
		expect(AISLOP_MD_BODY).not.toMatch(/\.aislop\/(?:config|rules)\.yaml/);
	});

	it("U5 instruction text: tells the agent to use the suggested command", () => {
		expect(AISLOP_MD_BODY).toContain(
		"The hook output is the authoritative scan. Run `aislop` only with the exact command from `suggestedActions[].command`. The CLI may not be on PATH in this environment.",
	);
	});
});
