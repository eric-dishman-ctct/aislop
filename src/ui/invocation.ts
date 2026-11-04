import { fileURLToPath } from "node:url";
import { isTemporaryExecution } from "../hooks/runtime/resolve.js";

export const detectInvocation = (): string =>
	isTemporaryExecution(process.argv[1] ?? "") ||
	isTemporaryExecution(fileURLToPath(import.meta.url))
		? "npx aislop@latest"
		: "aislop";
