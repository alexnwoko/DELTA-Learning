import { parseToolName } from "./utils";

/**
 * Deployment policy for the MCP endpoint (Architecture plan item 12, D-08).
 *
 * Environment:
 * - MCP_ENABLED: "true" to serve /api/mcp. Off by default: the endpoint
 *   returns 404 until the D-08 AI and data-residency policy is ruled.
 * - MCP_READ_ONLY: on unless set to "false". Write tools are neither listed
 *   nor callable while it is on.
 * - MCP_TOOL_ALLOWLIST: optional comma-separated tool names. When set, only
 *   those tools are listed and callable, and read-only mode still applies.
 */
export interface McpPolicy {
	enabled: boolean;
	readOnly: boolean;
	allowlist: Set<string> | null;
}

export function mcpPolicyFromEnv(
	env: Record<string, string | undefined> = process.env,
): McpPolicy {
	const names = (env.MCP_TOOL_ALLOWLIST ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter(Boolean);
	return {
		enabled: env.MCP_ENABLED === "true",
		readOnly: env.MCP_READ_ONLY !== "false",
		allowlist: names.length > 0 ? new Set(names) : null,
	};
}

const WRITE_ACTIONS = new Set([
	"add",
	"update",
	"save",
	"clear",
	"category-presence-save",
]);

export function isWriteTool(toolName: string): boolean {
	if (toolName === "docs") return false;
	try {
		return WRITE_ACTIONS.has(parseToolName(toolName).action);
	} catch {
		// An unparseable name is treated as a write, so it is never permitted by default.
		return true;
	}
}

export function isToolPermitted(toolName: string, policy: McpPolicy): boolean {
	if (policy.allowlist && !policy.allowlist.has(toolName)) return false;
	if (policy.readOnly && isWriteTool(toolName)) return false;
	return true;
}

/**
 * An error whose message is safe to return to the MCP client: it describes
 * the caller's own input. Any other error is logged and replaced with a
 * generic message, because it can carry internal API responses.
 */
export class McpInputError extends Error {}

export const GENERIC_TOOL_ERROR = "Tool execution failed";

export function clientSafeErrorMessage(error: unknown): string {
	return error instanceof McpInputError ? error.message : GENERIC_TOOL_ERROR;
}
