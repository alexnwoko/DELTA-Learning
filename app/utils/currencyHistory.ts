// Changes of currency unit in DELTA tenant countries (ISO 4217 historic
// codes; DELTA_Money_Convention_Proposal.md section 2.4, 2026-10-22). World
// Bank exchange-rate series state old years in today's unit (Turkey 1990:
// 0.0026 TRY per USD), so a value recorded in the old unit would convert
// wrongly by up to a factor of 1,000,000. A source value dated before its
// country's change year is refused, not converted, until the country confirms
// the unit. Entries marked unverified carry an unconfirmed date.

export interface CurrencyChange {
	iso3: string;
	/**
	 * First full year of the current unit; values dated earlier are refused.
	 * A change year itself can still hold old-unit values, so it is refused.
	 */
	fromYear: number;
	change: string;
	unverified?: true;
}

export const CURRENCY_CHANGES: readonly CurrencyChange[] = [
	{ iso3: "TUR", fromYear: 2006, change: "TRL to TRY (2005-12-31)" },
	{
		iso3: "MEX",
		fromYear: 1994,
		change: "MXP to MXN (old unit until 1993-03-31)",
	},
	{ iso3: "PER", fromYear: 1992, change: "PEI (inti) to PEN (1991-10-01)" },
	{ iso3: "VEN", fromYear: 2008, change: "VEB to VEF (2008), then VES (2018)" },
	{
		iso3: "ECU",
		fromYear: 2001,
		change: "ECS (sucre) to USD (sucre until 2000-02-29)",
	},
	{
		iso3: "CHL",
		fromYear: 1975,
		change: "escudo to peso (1975)",
		unverified: true,
	},
	{
		iso3: "URY",
		fromYear: 1994,
		change: "UYP to UYU (old unit until 1993-03-01)",
	},
	{ iso3: "BOL", fromYear: 1987, change: "BOP to BOB (1987)" },
	{
		iso3: "MOZ",
		fromYear: 2007,
		change: "MZM to MZN (old unit until 2006-06-30)",
	},
	{ iso3: "ZMB", fromYear: 2013, change: "ZMK to ZMW (2013)" },
	{
		iso3: "SLV",
		fromYear: 2001,
		change: "colon to USD (2001)",
		unverified: true,
	},
	{
		iso3: "AGO",
		fromYear: 2000,
		change: "pre-AOA units (1999)",
		unverified: true,
	},
	{
		iso3: "MNE",
		fromYear: 2002,
		change: "pre-euro units (2002)",
		unverified: true,
	},
	{ iso3: "SRB", fromYear: 1995, change: "pre-1994 dinar", unverified: true },
];

/** First year of the country's current unit, or null when it has not changed since 1960. */
export function currencyUnitFrom(iso3: string): number | null {
	return CURRENCY_CHANGES.find((c) => c.iso3 === iso3)?.fromYear ?? null;
}

/** The currency's English name (built-in ISO 4217 names), or the code. */
export function currencyName(code: string): string {
	try {
		return new Intl.DisplayNames(["en"], { type: "currency" }).of(code) ?? code;
	} catch {
		return code;
	}
}
