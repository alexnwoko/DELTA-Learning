import { type ActionFunctionArgs } from "react-router";
import { getPinoLogger } from "~/infrastructure/logging/PinoLogger.server";

// Receives Content-Security-Policy violation reports (report-uri) while the
// policy runs in Report-Only mode. Logs a bounded summary and stores nothing.
const MAX_REPORT_BYTES = 8 * 1024;

function truncate(value: unknown): string | undefined {
	return typeof value === "string" ? value.slice(0, 300) : undefined;
}

export async function action({ request }: ActionFunctionArgs) {
	if (request.method !== "POST") {
		return new Response(null, { status: 405 });
	}
	const body = (await request.text()).slice(0, MAX_REPORT_BYTES);
	try {
		const parsed = JSON.parse(body);
		const report = parsed["csp-report"] ?? parsed;
		getPinoLogger().warn({
			msg: "csp-violation",
			documentUri: truncate(report["document-uri"]),
			violatedDirective: truncate(report["violated-directive"]),
			effectiveDirective: truncate(report["effective-directive"]),
			blockedUri: truncate(report["blocked-uri"]),
			disposition: truncate(report.disposition),
		});
	} catch {
		// Malformed reports are dropped; browsers do not retry.
	}
	return new Response(null, { status: 204 });
}

export function loader() {
	return new Response(null, { status: 405 });
}
