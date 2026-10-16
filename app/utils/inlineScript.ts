/**
 * Escaping for the HTML pages that map previews write into a new tab.
 *
 * Those tabs share DELTA's origin, so a value written into them must never
 * close a script element, end a string literal or become markup.
 */

/**
 * Serialise a value as a JavaScript expression for an inline script.
 * "<", ">" and "&" are escaped so the value cannot close the script element;
 * U+2028 and U+2029 are escaped because older engines end a line on them.
 */
export function jsonForInlineScript(value: unknown): string {
	return (JSON.stringify(value) ?? "null")
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

/** Escape a value for use as HTML text or a quoted attribute. */
export function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
