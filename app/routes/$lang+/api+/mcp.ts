import { type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { apiAuth } from "~/backend.server/models/api_key";
import {
	errorResponse,
	successResponse,
	extractLangFromRequest,
} from "~/backend.server/services/mcp/utils";
import { getAllTools } from "~/backend.server/services/mcp/tools";
import { executeTool } from "~/backend.server/services/mcp/handlers";
import {
	getAllPrompts,
	getPromptContent,
} from "~/backend.server/services/mcp/prompts";
import {
	getAllResources,
	getResourceContent,
} from "~/backend.server/services/mcp/resources";
import {
	clientSafeErrorMessage,
	isToolPermitted,
	mcpPolicyFromEnv,
} from "~/backend.server/services/mcp/policy";
import { getPinoLogger } from "~/infrastructure/logging/PinoLogger.server";

// While MCP_ENABLED is off the endpoint does not exist for callers.
function notFound() {
	return new Response("Not Found", { status: 404 });
}

export async function action({ request }: ActionFunctionArgs) {
	const policy = mcpPolicyFromEnv();
	if (!policy.enabled) return notFound();

	try {
		const apiKey = await apiAuth(request);
		if (!apiKey.countryAccountsId) {
			return Response.json(
				errorResponse(null, -32000, "Unauthorized: No country accounts ID"),
				{ status: 401 },
			);
		}
	} catch (error) {
		return Response.json(
			errorResponse(null, -32000, "Unauthorized: Invalid API key"),
			{
				status: 401,
			},
		);
	}

	let req: any;
	try {
		req = await request.json();
	} catch (error) {
		return Response.json(
			errorResponse(null, -32700, "Parse error: Invalid JSON"),
			{ status: 400 },
		);
	}

	if (req.jsonrpc !== "2.0") {
		return Response.json(
			errorResponse(
				req.id,
				-32600,
				"Invalid Request: jsonrpc version must be 2.0",
			),
		);
	}

	if (!req.method) {
		return Response.json(
			errorResponse(req.id, -32600, "Invalid Request: method is required"),
		);
	}

	if (typeof req.method !== "string") {
		return Response.json(
			errorResponse(req.id, -32600, "Invalid Request: method must be a string"),
		);
	}

	const lang = extractLangFromRequest(request);

	switch (req.method) {
		case "initialize":
			return Response.json(
				successResponse(req.id, {
					protocolVersion: "2024-11-05",
					capabilities: {
						tools: {},
						prompts: {},
						resources: {},
					},
					serverInfo: {
						name: "dts-mcp",
						version: "1.0.0",
					},
				}),
			);

		case "tools/list":
			return Response.json(
				successResponse(req.id, {
					tools: getAllTools().filter((tool) =>
						isToolPermitted(tool.name, policy),
					),
				}),
			);

		case "tools/call":
			const params = req.params;
			if (!params) {
				return Response.json(
					errorResponse(
						req.id,
						-32602,
						"Invalid params: params object is required",
					),
				);
			}
			if (!params.name) {
				return Response.json(
					errorResponse(req.id, -32602, "Invalid params: name is required"),
				);
			}
			if (typeof params.name !== "string") {
				return Response.json(
					errorResponse(
						req.id,
						-32602,
						"Invalid params: name must be a string",
					),
				);
			}
			const name = params.name;
			const toolArgs = params.arguments || {};

			if (!isToolPermitted(name, policy)) {
				return Response.json(
					errorResponse(req.id, -32601, "Tool not available"),
				);
			}

			try {
				const result = await executeTool(request, lang, name, toolArgs);

				return Response.json(
					successResponse(req.id, {
						content: [
							{
								type: "text",
								text: result,
							},
						],
					}),
				);
			} catch (error) {
				// Internal API errors can carry other records or stack detail; log them, return a generic message.
				getPinoLogger().warn({ msg: "mcp tool failed", tool: name, err: error });
				return Response.json(
					errorResponse(req.id, -32000, clientSafeErrorMessage(error)),
				);
			}

		case "prompts/list":
			return Response.json(
				successResponse(req.id, { prompts: getAllPrompts() }),
			);

		case "prompts/get":
			const promptParams = req.params;
			if (!promptParams) {
				return Response.json(
					errorResponse(
						req.id,
						-32602,
						"Invalid params: params object is required",
					),
				);
			}
			if (!promptParams.name) {
				return Response.json(
					errorResponse(req.id, -32602, "Invalid params: name is required"),
				);
			}
			if (typeof promptParams.name !== "string") {
				return Response.json(
					errorResponse(
						req.id,
						-32602,
						"Invalid params: name must be a string",
					),
				);
			}
			const promptName = promptParams.name;

			try {
				const promptContent = getPromptContent(promptName);
				return Response.json(
					successResponse(req.id, {
						description: `Template for ${promptName}`,
						messages: [
							{
								role: "user",
								content: {
									type: "text",
									text: promptContent,
								},
							},
						],
					}),
				);
			} catch (error) {
				return Response.json(
					errorResponse(
						req.id,
						-32000,
						error instanceof Error ? error.message : String(error),
					),
				);
			}

		case "resources/list":
			return Response.json(
				successResponse(req.id, { resources: getAllResources() }),
			);

		case "resources/templates/list":
			return Response.json(
				successResponse(req.id, {
					resourceTemplates: [],
				}),
			);

		case "resources/read":
			const resourceParams = req.params;
			if (!resourceParams) {
				return Response.json(
					errorResponse(
						req.id,
						-32602,
						"Invalid params: params object is required",
					),
				);
			}
			if (!resourceParams.uri) {
				return Response.json(
					errorResponse(req.id, -32602, "Invalid params: uri is required"),
				);
			}
			if (typeof resourceParams.uri !== "string") {
				return Response.json(
					errorResponse(req.id, -32602, "Invalid params: uri must be a string"),
				);
			}

			const content = getResourceContent(resourceParams.uri);
			if (content === null) {
				return Response.json(
					errorResponse(
						req.id,
						-32000,
						`Unknown resource: ${resourceParams.uri}`,
					),
				);
			}

			return Response.json(
				successResponse(req.id, {
					contents: [
						{
							uri: resourceParams.uri,
							mimeType: "text/plain",
							text: content,
						},
					],
				}),
			);

		case "shutdown":
			return Response.json(successResponse(req.id, null));

		default:
			return Response.json(
				errorResponse(req.id, -32601, `Method not found: ${req.method}`),
			);
	}
}

export async function loader({ request }: LoaderFunctionArgs) {
	if (!mcpPolicyFromEnv().enabled) return notFound();

	const accept = request.headers.get("Accept") || "";

	if (accept.includes("text/event-stream")) {
		// The stream stays open for up to an hour, so only a valid tenant key may open it.
		try {
			const apiKey = await apiAuth(request);
			if (!apiKey.countryAccountsId) {
				return new Response("Unauthorized", { status: 401 });
			}
		} catch {
			return new Response("Unauthorized", { status: 401 });
		}

		const encoder = new TextEncoder();
		const postEndpoint = new URL(request.url).pathname;

		let keepAlive: ReturnType<typeof setInterval> | undefined;
		let closeTimer: ReturnType<typeof setTimeout> | undefined;
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(
					encoder.encode(`event: endpoint\ndata: ${postEndpoint}\n\n`),
				);

				keepAlive = setInterval(() => {
					controller.enqueue(encoder.encode(": keepalive\n\n"));
				}, 30000);

				closeTimer = setTimeout(() => {
					clearInterval(keepAlive);
					controller.close();
				}, 3600000);
			},
			// The client went away: stop the timers so they do not outlive it.
			cancel() {
				clearInterval(keepAlive);
				clearTimeout(closeTimer);
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	}

	return Response.json({ message: "MCP endpoint - use POST for MCP requests" });
}
