// Reads the vendored Mangrove token files and resolves a token path to its
// final value for one brand. Used to check DELTA's brand layer against the
// pinned Mangrove release; it is not part of the token build.
//
// Mangrove's files borrow DTCG vocabulary but are not DTCG (see the header
// of mangrove.yaml): `{path}` and `{=path}` are both references here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const LAYERS = { neutral: ["mangrove"], delta: ["mangrove", "undrr", "delta"] };

function merge(target, source) {
	for (const [key, value] of Object.entries(source)) {
		if (value && typeof value === "object" && !Array.isArray(value) && !("$value" in value)) {
			target[key] = merge(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
		} else {
			target[key] = value;
		}
	}
	return target;
}

export function loadMangrove(dir, brand) {
	const tree = {};
	for (const file of LAYERS[brand]) {
		merge(tree, YAML.parse(readFileSync(join(dir, `${file}.yaml`), "utf8")));
	}
	return tree;
}

export function resolveMangrove(tree, path, seen = new Set()) {
	if (seen.has(path)) throw new Error(`reference cycle at ${path}`);
	seen.add(path);
	let node = tree;
	for (const part of path.split(".")) {
		node = node?.[part];
		if (node === undefined) throw new Error(`no Mangrove token ${path}`);
	}
	const value = typeof node === "object" && "$value" in node ? node.$value : node;
	const ref = typeof value === "string" && value.match(/^\{=?([a-z0-9._-]+)\}$/i);
	return ref ? resolveMangrove(tree, ref[1], seen) : value;
}
