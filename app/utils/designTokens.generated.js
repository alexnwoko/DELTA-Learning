/**
 * Do not edit directly, this file was auto-generated.
 */

// Data-layer design tokens (FE-Tokens-01). Generated from
// design-tokens/data/*.json; edit the JSON, then run yarn build:tokens.
//
// map.noRecords and state.notReported are different things: no record
// in scope for the area, against records in scope that reported nothing
// (TR-076). Never merge them, even when their values match.
export const dataTokens = {
	"state": {
		"zeroConfirmed": {
			"fill": "#ffffff",
			"stroke": "#4b5563",
			"strokeWidth": 1.2,
			"dash": "4 3",
			"pattern": "none"
		},
		"notReported": {
			"fill": "#c9ced6",
			"stroke": "#8a929c",
			"strokeWidth": 1,
			"dash": "none",
			"pattern": "none"
		},
		"insufficientReporting": {
			"fill": "#ffffff",
			"stroke": "#6b7280",
			"strokeWidth": 1.2,
			"dash": "1 3",
			"pattern": "hatch"
		},
		"notApplicable": {
			"fill": "#f3f4f6",
			"stroke": "#6b7280",
			"strokeWidth": 1,
			"dash": "8 3 1 3",
			"pattern": "dots"
		},
		"suppressed": {
			"fill": "#e5e7eb",
			"stroke": "#374151",
			"strokeWidth": 2,
			"dash": "none",
			"pattern": "crosshatch"
		}
	},
	"map": {
		"noRecords": {
			"fill": "#f9fafb",
			"stroke": "#d1d5db",
			"strokeWidth": 0.8
		},
		"areaBoundary": {
			"stroke": "#ffffff",
			"strokeWidth": 0.8
		},
		"selectedOutline": {
			"stroke": "#111827",
			"strokeWidth": 2.5
		},
		"plausibilityMarker": {
			"stroke": "#b45309",
			"strokeWidth": 2.5
		},
		"notAppliedNote": {
			"border": "#b45309",
			"borderWidth": 3,
			"background": "#fff7ed"
		},
		"canvas": {
			"background": "#f3f4f6"
		}
	},
	"ramp": {
		"people": [
			"#dbe7f3",
			"#a9c8e4",
			"#6fa4d0",
			"#3d7cb4",
			"#1d548f"
		],
		"housing": [
			"#fdd0a2",
			"#fdae6b",
			"#fd8d3c",
			"#e6550d",
			"#a63603"
		],
		"money": [
			"#c7e9c0",
			"#a1d99b",
			"#74c476",
			"#31a354",
			"#006d2c"
		],
		"events": [
			"#dadaeb",
			"#bcbddc",
			"#9e9ac8",
			"#756bb1",
			"#54278f"
		]
	},
	"flag": {
		"reviewChip": {
			"background": "#fef3c7",
			"text": "#78350f"
		}
	},
	"chart": {
		"axis": "#6b7280"
	},
	"notice": {
		"provisional": {
			"border": "#d97706",
			"background": "#fffbeb"
		}
	},
	"hazard": {
		"meteorologicalHydrological": "#1f6fb2",
		"geological": "#8c5a2b",
		"biological": "#2e7d32",
		"environmental": "#6b7a12",
		"chemical": "#8e3fa8",
		"technological": "#c2410c",
		"societal": "#b0306a",
		"extraterrestrial": "#0f7c8c",
		"unclassified": "#6b7280"
	},
	"icon": "#004f91"
};
