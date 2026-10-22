// Payload type for the cost panels (Alex, 2026-10-22). DELTA's typed money
// columns are empty; the only money held is the value DesInventar recorded
// per record (valorloc, valorus), which does not separate damage from
// losses. Ruling: each country's values are taken to be in its own currency
// (the tenant's currency), shown as recorded, and converted to US dollars at
// the World Bank official rate for the record's year. Every view carries the
// disclaimer. These figures never feed Sendai C-1.

import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";

/** One money figure in both presentations. */
export interface Money {
	/** In the country's currency (as recorded, or derived from USD). */
	local: number | null;
	/** In current US dollars. */
	usd: number | null;
}

export interface CostPanels {
	currency: { code: string; name: string };
	/** The single rate used for US dollars; label it on every USD view. */
	fxRate: {
		source: string;
		indicator: string;
		label: string;
		/** The World Bank release in use (its last-updated date), or null when none is loaded. */
		release: string | null;
	};
	/** Small print for every cost view, with the assumption stated. */
	disclaimer: string;
	/** The people measure the cost-per-person figures use. */
	peopleMeasure: "affected_direct" | "affected_indirect";
	/** Total source-reported value over costed records. */
	total: Money & { records: number };
	/** How much of the record is costed at all. */
	coverage: {
		records: { total: number; costed: number; notCosted: number };
		events: { total: number; costed: number; notCosted: number };
		people: { costed: PanelCell; notCosted: PanelCell };
		/** Total value / total people, over records reporting both. */
		costPerPerson: Money & { records: number };
	};
	/** Values left out of every figure, by reason; counted, never hidden. */
	excluded: {
		/** Dated before the country's change of currency unit. */
		beforeCurrencyChange: number;
		/** Local value equal to the US dollar value in a non-dollar country (a copy). */
		copiedFromUsd: number;
		/** No exchange rate for the year (before 1960, after the series, no year). */
		noRate: number;
	};
	/** Per specific HIPs hazard (cluster where no hazard is coded). */
	byHazard: {
		key: string;
		label: string;
		costedRecords: number;
		notCostedRecords: number;
		total: Money;
		/** Median value per costed record. */
		medianPerRecord: Money;
		/** Median value per person affected, over records reporting both; null under the minimum. */
		medianPerPerson: Money & { records: number };
		/** People affected in records with no value. */
		peopleNotCosted: number | null;
		/**
		 * Illustrative only: medianPerPerson x peopleNotCosted. Not a loss
		 * estimate, never added to any total; null when medianPerPerson is.
		 */
		projectionNotCosted: Money | null;
	}[];
	/**
	 * Per start year, from the first year with a value to the last year with
	 * a record; years between with no record are present with 0 records and
	 * an empty total. Empty when no record carries a value.
	 */
	byYear: {
		year: number;
		records: number;
		costedRecords: number;
		notCostedRecords: number;
		/** Empty (null) when no record that year carries a value; never 0. */
		total: Money;
	}[];
	/** Records with no start year: in every other figure, not in byYear. */
	recordsNoYear: number;
	/** Records dated before the first year with a value: counted, not drawn. */
	recordsBeforeFirstYear: number;
	projectionNote: string;
	meta: PanelMeta;
}
