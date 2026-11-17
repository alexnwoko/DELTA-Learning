import { describe, it, expect } from "vitest";
import { currencyName, currencyUnitFrom } from "~/utils/currencyHistory";

describe("currency history", () => {
	it("refuses old-unit years: first full year of the current unit", () => {
		expect(currencyUnitFrom("TUR")).toBe(2006);
		expect(currencyUnitFrom("MEX")).toBe(1994);
		expect(currencyUnitFrom("ETH")).toBeNull();
	});
	it("names currencies from the built-in ISO 4217 list", () => {
		expect(currencyName("AOA")).toBe("Angolan Kwanza");
		expect(currencyName("XOF")).toBe("West African CFA Franc");
	});
});
