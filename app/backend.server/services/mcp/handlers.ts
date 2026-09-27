import {
	isReadOnly,
	getEntityPath,
	parseToolName,
	isValidEntity,
	isActionAllowed,
} from "./utils";
import { getReadOnlyEntityFields } from "./tools";
import { callInternalApi } from "./client";
import { McpInputError } from "./policy";
import { DOCS, HUMAN_EFFECTS_DOCS } from "./docs";

export async function executeFields(
	request: Request,
	lang: string,
	entity: string,
	args: any,
): Promise<string> {
	if (isReadOnly(entity)) {
		const fields = getReadOnlyEntityFields(entity);
		return JSON.stringify(fields, null, 2);
	}

	const entityPath = getEntityPath(entity);

	if (entity === "human-effects") {
		const recordId = args.recordId;
		const table = args.table || "Deaths";

		if (!recordId) {
			throw new McpInputError("recordId is required for human-effects");
		}

		const validTables = [
			"Deaths",
			"Injured",
			"Missing",
			"Affected",
			"Displaced",
		];
		if (!validTables.includes(table)) {
			throw new McpInputError(`table must be one of: ${validTables.join(", ")}`);
		}

		const data = await callInternalApi(
			request,
			`/${encodeURIComponent(lang)}/api/${entityPath}/list?recordId=${encodeURIComponent(recordId)}&table=${encodeURIComponent(table)}`,
		);

		const columnNames = data.defs.map((def: any) => def.jsName || def.dbName);
		return JSON.stringify(
			{
				columns: columnNames,
				defs: data.defs,
			},
			null,
			2,
		);
	}

	const response = await callInternalApi(
		request,
		`/${encodeURIComponent(lang)}/api/${entityPath}/fields`,
	);

	return JSON.stringify(response, null, 2);
}

export async function executeList(
	request: Request,
	lang: string,
	entity: string,
	args: any,
): Promise<string> {
	if (entity === "human-effects") {
		const recordId = args.recordId;
		const table = args.table || "Deaths";

		if (!recordId) {
			throw new McpInputError("recordId is required for human-effects");
		}

		const validTables = [
			"Deaths",
			"Injured",
			"Missing",
			"Affected",
			"Displaced",
		];
		if (!validTables.includes(table)) {
			throw new McpInputError(`table must be one of: ${validTables.join(", ")}`);
		}

		const entityPath = getEntityPath(entity);
		const result = await callInternalApi(
			request,
			`/${encodeURIComponent(lang)}/api/${entityPath}/list?recordId=${encodeURIComponent(recordId)}&table=${encodeURIComponent(table)}`,
		);

		return JSON.stringify(result, null, 2);
	}

	const page = args.page || 1;
	const pageSize = args.pageSize || 50;

	if (page < 1) {
		throw new McpInputError("page must be >= 1");
	}
	if (pageSize < 1 || pageSize > 1000) {
		throw new McpInputError("pageSize must be between 1 and 1000");
	}

	const entityPath = getEntityPath(entity);
	const result = await callInternalApi(
		request,
		`/${encodeURIComponent(lang)}/api/${entityPath}/list?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(pageSize)}`,
	);

	return JSON.stringify(result.data, null, 2);
}

export async function executeAdd(
	request: Request,
	lang: string,
	entity: string,
	args: any,
): Promise<string> {
	const records = args.records;

	if (!Array.isArray(records)) {
		throw new McpInputError("records must be an array");
	}
	if (records.length === 0) {
		throw new McpInputError("records array cannot be empty");
	}
	if (records.length > 100) {
		throw new McpInputError("records array cannot exceed 100 items");
	}

	const entityPath = getEntityPath(entity);
	const result = await callInternalApi(
		request,
		`/${encodeURIComponent(lang)}/api/${entityPath}/add`,
		"POST",
		records,
	);

	return JSON.stringify(result, null, 2);
}

export async function executeUpdate(
	request: Request,
	lang: string,
	entity: string,
	args: any,
): Promise<string> {
	const records = args.records;

	if (!Array.isArray(records)) {
		throw new McpInputError("records must be an array");
	}
	if (records.length === 0) {
		throw new McpInputError("records array cannot be empty");
	}
	if (records.length > 100) {
		throw new McpInputError("records array cannot exceed 100 items");
	}

	for (const record of records) {
		if (!record.id) {
			throw new McpInputError("each record must include an id field for update");
		}
	}

	const entityPath = getEntityPath(entity);
	const result = await callInternalApi(
		request,
		`/${encodeURIComponent(lang)}/api/${entityPath}/update`,
		"POST",
		records,
	);

	return JSON.stringify(result, null, 2);
}

export async function executeHumanEffectsSave(
	request: Request,
	lang: string,
	args: any,
): Promise<string> {
	const data = args.data;

	if (!data) {
		throw new McpInputError("data is required for human-effects");
	}
	if (!data.recordId) {
		throw new McpInputError("recordId is required for human-effects");
	}
	if (!data.table) {
		throw new McpInputError("table is required for human-effects");
	}

	const validTables = ["Deaths", "Injured", "Missing", "Affected", "Displaced"];
	if (!validTables.includes(data.table)) {
		throw new McpInputError(`table must be one of: ${validTables.join(", ")}`);
	}

	const result = await callInternalApi(
		request,
		`/${encodeURIComponent(lang)}/api/human-effects/save?recordId=${encodeURIComponent(data.recordId)}`,
		"POST",
		data,
	);

	return JSON.stringify(result, null, 2);
}

export async function executeHumanEffectsClear(
	request: Request,
	lang: string,
	args: any,
): Promise<string> {
	const recordId = args.recordId;
	const table = args.table;

	if (!recordId) {
		throw new McpInputError("recordId is required for human-effects");
	}
	if (!table) {
		throw new McpInputError("table is required for human-effects");
	}

	const validTables = ["Deaths", "Injured", "Missing", "Affected", "Displaced"];
	if (!validTables.includes(table)) {
		throw new McpInputError(`table must be one of: ${validTables.join(", ")}`);
	}

	const result = await callInternalApi(
		request,
		`/${encodeURIComponent(lang)}/api/human-effects/clear?recordId=${encodeURIComponent(recordId)}&table=${encodeURIComponent(table)}`,
		"POST",
	);

	return JSON.stringify(result, null, 2);
}

export async function executeHumanEffectsCategoryPresenceSave(
	request: Request,
	lang: string,
	args: any,
): Promise<string> {
	const data = args.data;

	if (!data) {
		throw new McpInputError("data is required for human-effects");
	}
	if (!data.recordId) {
		throw new McpInputError("recordId is required for human-effects");
	}
	if (!data.table) {
		throw new McpInputError("table is required for human-effects");
	}

	const validTables = ["Deaths", "Injured", "Missing", "Affected", "Displaced"];
	if (!validTables.includes(data.table)) {
		throw new McpInputError(`table must be one of: ${validTables.join(", ")}`);
	}

	const result = await callInternalApi(
		request,
		`/${encodeURIComponent(lang)}/api/human-effects/category-presence-save?recordId=${encodeURIComponent(data.recordId)}`,
		"POST",
		data,
	);

	return JSON.stringify(result, null, 2);
}

export async function executeHumanEffectsDocs(): Promise<string> {
	return HUMAN_EFFECTS_DOCS;
}

export async function executeDocs(): Promise<string> {
	return DOCS;
}

export async function executeTool(
	request: Request,
	lang: string,
	toolName: string,
	args: any,
): Promise<string> {
	if (toolName === "docs") {
		return await executeDocs();
	}

	const { entity, action } = parseToolName(toolName);

	if (!isValidEntity(entity)) {
		throw new McpInputError(`Invalid entity: ${entity}`);
	}

	if (!isActionAllowed(entity, action)) {
		throw new McpInputError(`${entity} is read-only, cannot ${action}`);
	}

	switch (action) {
		case "fields":
			return await executeFields(request, lang, entity, args);
		case "list":
			return await executeList(request, lang, entity, args);
		case "add":
			return await executeAdd(request, lang, entity, args);
		case "update":
			return await executeUpdate(request, lang, entity, args);
		case "save":
			if (entity === "human-effects") {
				return await executeHumanEffectsSave(request, lang, args);
			}
			throw new McpInputError(`save action not supported for ${entity}`);
		case "clear":
			if (entity === "human-effects") {
				return await executeHumanEffectsClear(request, lang, args);
			}
			throw new McpInputError(`clear action not supported for ${entity}`);
		case "category-presence-save":
			if (entity === "human-effects") {
				return await executeHumanEffectsCategoryPresenceSave(
					request,
					lang,
					args,
				);
			}
			throw new McpInputError(
				`category-presence-save action not supported for ${entity}`,
			);
		case "docs":
			if (entity === "human-effects") {
				return await executeHumanEffectsDocs();
			}
			throw new McpInputError(`docs action not supported for ${entity}`);
		default:
			throw new McpInputError(`Unknown action: ${action}`);
	}
}
