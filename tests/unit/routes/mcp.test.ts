import { describe, expect, it, vi, beforeEach } from "vitest";
import { action, loader } from "~/routes/$lang+/api+/mcp";
import * as apiAuthModule from "~/backend.server/models/api_key";

vi.mock("~/backend.server/models/api_key", () => ({
	apiAuth: vi.fn(),
}));

const callInternalApiMock = vi.fn();
vi.mock("~/backend.server/services/mcp/client", () => ({
	callInternalApi: (...args: any[]) => callInternalApiMock(...args),
}));

const BASE_URL = "http://localhost:3000/en/api/mcp";

function createRequest(body: unknown, headers?: HeadersInit): Request {
	return new Request(BASE_URL, {
		method: "POST",
		body: typeof body === "string" ? body : JSON.stringify(body),
		headers: { "Content-Type": "application/json", ...headers },
	});
}

async function callAction(request: Request): Promise<Response> {
	return await action({ request, params: {}, context: {} } as any);
}

async function callLoader(request: Request): Promise<Response> {
	return await loader({ request, params: {}, context: {} } as any);
}

describe("mcp.ts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
		// The endpoint is off by default (plan item 12); these tests exercise it enabled.
		vi.stubEnv("MCP_ENABLED", "true");
	});

	describe("action", () => {
		describe("authentication", () => {
			it("should return 401 when no API key provided", async () => {
				vi.mocked(apiAuthModule.apiAuth).mockRejectedValue(
					new Error("Unauthorized"),
				);

				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "initialize",
				});

				const response = await callAction(request);
				expect(response.status).toBe(401);

				const data = await response.json();
				expect(data.error.code).toBe(-32000);
			});

			it("should return 401 when API key has no country accounts ID", async () => {
				vi.mocked(apiAuthModule.apiAuth).mockResolvedValue({
					countryAccountsId: null,
				} as any);

				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "initialize",
				});

				const response = await callAction(request);
				expect(response.status).toBe(401);

				const data = await response.json();
				expect(data.error.message).toContain("No country accounts ID");
			});
		});

		describe("request validation", () => {
			beforeEach(() => {
				vi.mocked(apiAuthModule.apiAuth).mockResolvedValue({
					countryAccountsId: "test-id",
				} as any);
			});

			it("should return 400 for invalid JSON", async () => {
				const request = createRequest("invalid json");

				const response = await callAction(request);
				expect(response.status).toBe(400);

				const data = await response.json();
				expect(data.error.code).toBe(-32700);
				expect(data.error.message).toContain("Parse error");
			});

			it("should return error for invalid jsonrpc version", async () => {
				const request = createRequest({
					jsonrpc: "1.0",
					id: "test-id",
					method: "initialize",
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.error.code).toBe(-32600);
				expect(data.error.message).toContain("jsonrpc version must be 2.0");
			});

			it("should return error for missing method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.error.code).toBe(-32600);
				expect(data.error.message).toContain("method is required");
			});
		});

		describe("method handling", () => {
			beforeEach(() => {
				vi.mocked(apiAuthModule.apiAuth).mockResolvedValue({
					countryAccountsId: "test-id",
				} as any);
			});

			it("should handle initialize method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "initialize",
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.jsonrpc).toBe("2.0");
				expect(data.id).toBe("test-id");
				expect(data.result.protocolVersion).toBe("2024-11-05");
				expect(data.result.capabilities.tools).toBeDefined();
				expect(data.result.capabilities.prompts).toBeDefined();
				expect(data.result.capabilities.resources).toBeDefined();
				expect(data.result.serverInfo.name).toBe("dts-mcp");
			});

			it("should handle tools/list method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "tools/list",
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.result.tools).toBeDefined();
				expect(Array.isArray(data.result.tools)).toBe(true);
				expect(data.result.tools.length).toBeGreaterThan(0);
			});

			it("should handle shutdown method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "shutdown",
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.result).toBeNull();
			});

			it("should return error for unknown method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "unknown_method",
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.error.code).toBe(-32601);
				expect(data.error.message).toContain("Method not found");
			});

			it("should handle prompts/list method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "prompts/list",
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.result.prompts).toBeDefined();
				expect(Array.isArray(data.result.prompts)).toBe(true);
				expect(data.result.prompts.length).toBeGreaterThan(0);
				expect(data.result.prompts[0]).toHaveProperty("name");
				expect(data.result.prompts[0]).toHaveProperty("title");
				expect(data.result.prompts[0]).toHaveProperty("description");
			});

			it("should handle prompts/get method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "prompts/get",
					params: {
						name: "add-disaster-data",
					},
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.result.description).toBeDefined();
				expect(data.result.messages).toBeDefined();
				expect(Array.isArray(data.result.messages)).toBe(true);
				expect(data.result.messages[0].role).toBe("user");
				expect(data.result.messages[0].content.type).toBe("text");
				expect(data.result.messages[0].content.text).toContain("disaster");
			});

			it("should return error for prompts/get without name", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "prompts/get",
					params: {},
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.error.code).toBe(-32602);
				expect(data.error.message).toContain("name is required");
			});

			it("should return error for unknown prompt", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "prompts/get",
					params: {
						name: "unknown-prompt",
					},
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.error.code).toBe(-32000);
				expect(data.error.message).toContain("Unknown prompt");
			});

			it("should handle resources/list method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "resources/list",
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.result.resources).toBeDefined();
				expect(Array.isArray(data.result.resources)).toBe(true);
				expect(data.result.resources.length).toBe(2);
				expect(data.result.resources[0]).toHaveProperty("uri");
				expect(data.result.resources[0]).toHaveProperty("name");
				expect(data.result.resources[0]).toHaveProperty("mimeType");
			});

			it("should handle resources/read method", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "resources/read",
					params: {
						uri: "docs://docs",
					},
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.result.contents).toBeDefined();
				expect(Array.isArray(data.result.contents)).toBe(true);
				expect(data.result.contents[0].uri).toBe("docs://docs");
				expect(data.result.contents[0].mimeType).toBe("text/plain");
				expect(data.result.contents[0].text).toContain("DTS Data Model");
			});

			it("should return error for resources/read without uri", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "resources/read",
					params: {},
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.error.code).toBe(-32602);
				expect(data.error.message).toContain("uri is required");
			});

			it("should return error for unknown resource", async () => {
				const request = createRequest({
					jsonrpc: "2.0",
					id: "test-id",
					method: "resources/read",
					params: {
						uri: "unknown://resource",
					},
				});

				const response = await callAction(request);
				const data = await response.json();

				expect(data.error.code).toBe(-32000);
				expect(data.error.message).toContain("Unknown resource");
			});
		});
	});

	describe("loader", () => {
		it("should return JSON message for normal request", async () => {
			const request = new Request(BASE_URL);
			const response = await callLoader(request);
			const data = await response.json();

			expect(data.message).toBe("MCP endpoint - use POST for MCP requests");
		});

		it("should return SSE stream for text/event-stream with a valid tenant key", async () => {
			vi.mocked(apiAuthModule.apiAuth).mockResolvedValue({
				countryAccountsId: "tenant-1",
			} as any);
			const request = new Request(BASE_URL, {
				headers: { Accept: "text/event-stream", "X-Auth": "key" },
			});

			const response = await callLoader(request);

			expect(response.headers.get("Content-Type")).toBe("text/event-stream");
			expect(response.headers.get("Cache-Control")).toBe("no-cache");
			expect(response.headers.get("Connection")).toBe("keep-alive");
			expect(response.body).toBeInstanceOf(ReadableStream);
		});
	});
});

describe("mcp.ts platform security (plan item 12)", () => {
	const authed = () =>
		vi.mocked(apiAuthModule.apiAuth).mockResolvedValue({
			countryAccountsId: "tenant-1",
		} as any);

	const rpc = (method: string, params?: unknown) =>
		createRequest({ jsonrpc: "2.0", id: "t", method, params }, { "X-Auth": "key" });

	beforeEach(() => {
		vi.clearAllMocks();
		vi.unstubAllEnvs();
	});

	it("answers 404 on POST and GET while MCP_ENABLED is not set", async () => {
		authed();
		expect((await callAction(rpc("tools/list"))).status).toBe(404);
		const sse = new Request(BASE_URL, {
			headers: { Accept: "text/event-stream", "X-Auth": "key" },
		});
		expect((await callLoader(sse)).status).toBe(404);
	});

	it("refuses to open the SSE stream without a valid key", async () => {
		vi.stubEnv("MCP_ENABLED", "true");
		vi.mocked(apiAuthModule.apiAuth).mockRejectedValue(
			new Response("Unauthorized", { status: 401 }),
		);
		const sse = new Request(BASE_URL, { headers: { Accept: "text/event-stream" } });
		const res = await callLoader(sse);
		expect(res.status).toBe(401);
		expect(res.headers.get("Content-Type")).not.toBe("text/event-stream");
	});

	it("refuses to open the SSE stream for a key with no tenant", async () => {
		vi.stubEnv("MCP_ENABLED", "true");
		vi.mocked(apiAuthModule.apiAuth).mockResolvedValue({
			countryAccountsId: null,
		} as any);
		const sse = new Request(BASE_URL, {
			headers: { Accept: "text/event-stream", "X-Auth": "key" },
		});
		expect((await callLoader(sse)).status).toBe(401);
	});

	it("lists and runs no write tools by default (read-only)", async () => {
		vi.stubEnv("MCP_ENABLED", "true");
		authed();
		const list = await (await callAction(rpc("tools/list"))).json();
		const names: string[] = list.result.tools.map((t: any) => t.name);
		expect(names).toContain("disaster-record_list");
		expect(names.some((n) => /_(add|update|save|clear|category-presence-save)$/.test(n))).toBe(false);

		const call = await (
			await callAction(
				rpc("tools/call", { name: "disaster-record_add", arguments: { records: [{}] } }),
			)
		).json();
		expect(call.error.message).toBe("Tool not available");
		expect(callInternalApiMock).not.toHaveBeenCalled();
	});

	it("lists write tools only when MCP_READ_ONLY=false", async () => {
		vi.stubEnv("MCP_ENABLED", "true");
		vi.stubEnv("MCP_READ_ONLY", "false");
		authed();
		const list = await (await callAction(rpc("tools/list"))).json();
		const names: string[] = list.result.tools.map((t: any) => t.name);
		expect(names).toContain("disaster-record_add");
	});

	it("limits tools to MCP_TOOL_ALLOWLIST when it is set", async () => {
		vi.stubEnv("MCP_ENABLED", "true");
		vi.stubEnv("MCP_TOOL_ALLOWLIST", "docs, disaster-record_list");
		authed();
		const list = await (await callAction(rpc("tools/list"))).json();
		expect(list.result.tools.map((t: any) => t.name).sort()).toEqual([
			"disaster-record_list",
			"docs",
		]);
		const call = await (
			await callAction(rpc("tools/call", { name: "hazardous-event_list", arguments: {} }))
		).json();
		expect(call.error.message).toBe("Tool not available");
	});

	it("returns a generic message when the internal API fails", async () => {
		vi.stubEnv("MCP_ENABLED", "true");
		authed();
		callInternalApiMock.mockRejectedValue(
			new Error('{"ok":false,"detail":"internal row 42 of another tenant"}'),
		);
		const call = await (
			await callAction(rpc("tools/call", { name: "disaster-record_list", arguments: {} }))
		).json();
		expect(call.error.message).toBe("Tool execution failed");
		expect(JSON.stringify(call)).not.toContain("another tenant");
	});

	it("keeps input validation messages that describe the caller's own input", async () => {
		vi.stubEnv("MCP_ENABLED", "true");
		authed();
		const call = await (
			await callAction(
				rpc("tools/call", { name: "disaster-record_list", arguments: { page: -1 } }),
			)
		).json();
		expect(call.error.message).toBe("page must be >= 1");
	});

	it("encodes ids in internal API URLs", async () => {
		vi.stubEnv("MCP_ENABLED", "true");
		authed();
		callInternalApiMock.mockResolvedValue({ data: [] });
		await callAction(
			rpc("tools/call", {
				name: "human-effects_list",
				arguments: { recordId: "a&table=Deaths/../x?y=1", table: "Deaths" },
			}),
		);
		const endpoint: string = callInternalApiMock.mock.calls[0][1];
		expect(endpoint).toContain(
			"recordId=" + encodeURIComponent("a&table=Deaths/../x?y=1"),
		);
		expect(endpoint.match(/table=/g)?.length).toBe(1);
	});
});
