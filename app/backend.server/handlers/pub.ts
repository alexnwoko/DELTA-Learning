import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { PubRefusalError } from "~/backend.server/models/pub/publish";
import { authActionWithPerm, authLoaderWithPerm } from "~/utils/auth";
import { getCountryAccountsIdFromSession } from "~/utils/session";

export interface PubRequestContext {
	countryAccountsId: string;
	userId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string | undefined): v is string {
	return typeof v === "string" && UUID.test(v);
}

export function pubRefusal(code: string, message: string, status: number) {
	return Response.json({ error: { code, message } }, { status });
}

/**
 * Consent and publication are national-administrator acts (consent model,
 * ruled 2026-10-05): session only, ManageCountrySettings, one tenant. API
 * keys cannot grant consent or publish.
 */
async function context(
	request: Request,
	userSession: { user: { id: string } } | undefined,
): Promise<PubRequestContext> {
	const countryAccountsId = await getCountryAccountsIdFromSession(request);
	const userId = userSession?.user.id;
	if (!countryAccountsId || !isUuid(userId)) {
		throw new Response("Unauthorized", { status: 401 });
	}
	return { countryAccountsId, userId };
}

async function guard(run: () => Promise<Response>): Promise<Response> {
	try {
		return await run();
	} catch (err) {
		if (err instanceof PubRefusalError) {
			return pubRefusal(err.code, err.message, err.status);
		}
		throw err;
	}
}

type PubHandler<A> = (args: A, ctx: PubRequestContext) => Promise<Response>;

export function pubLoader(handler: PubHandler<LoaderFunctionArgs>) {
	return authLoaderWithPerm("ManageCountrySettings", async (args: LoaderFunctionArgs) => {
		const ctx = await context(args.request, (args as unknown as { userSession?: { user: { id: string } } }).userSession);
		return guard(() => handler(args, ctx));
	});
}

export function pubAction(handler: PubHandler<ActionFunctionArgs>) {
	return authActionWithPerm("ManageCountrySettings", async (args: ActionFunctionArgs) => {
		if (args.request.method !== "POST") {
			return new Response("Method Not Allowed", { status: 405 });
		}
		const ctx = await context(args.request, (args as unknown as { userSession?: { user: { id: string } } }).userSession);
		return guard(() => handler(args, ctx));
	});
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
