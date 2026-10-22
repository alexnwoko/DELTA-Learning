import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

describe("PrimeReact is frozen (TR-249)", () => {
	const frozen: string[] = readJson("tests/unit/frontend/primereact-frozen.json").files;
	const importsPrimeReact = (file: string) =>
		/from\s+["']primereact/.test(readFileSync(join(ROOT, file), "utf8"));
	const sources = (dir: string): string[] =>
		readdirSync(join(ROOT, dir)).flatMap((name) => {
			const rel = `${dir}/${name}`;
			if (statSync(join(ROOT, rel)).isDirectory()) return sources(rel);
			return /\.(tsx?|jsx?)$/.test(name) ? [rel] : [];
		});

	it("no file outside the frozen list imports PrimeReact", () => {
		const offenders = sources("app").filter((f) => importsPrimeReact(f) && !frozen.includes(f));
		expect(offenders, "rebuild new screens with React Aria Components (ADR-19)").toEqual([]);
	});

	it("the frozen list holds no file that has stopped importing PrimeReact", () => {
		const stale = frozen.filter((f) => {
			try {
				return !importsPrimeReact(f);
			} catch {
				return true;
			}
		});
		expect(stale, "remove rebuilt or deleted files from primereact-frozen.json").toEqual([]);
	});
});
