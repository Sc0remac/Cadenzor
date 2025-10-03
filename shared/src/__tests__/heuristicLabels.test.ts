import { describe, expect, it } from "vitest";
import { heuristicLabels } from "../heuristicLabels";

describe("heuristicLabels", () => {
  it("returns booking offer label when subject matches", () => {
    const result = heuristicLabels("Exclusive offer for summer tour", "Let's discuss details");
    expect(result).toContain("BOOKING/Offer");
  });

  it("returns finance invoice label when body matches keyword", () => {
    const result = heuristicLabels("Re: April statement", "Attached is the invoice for services rendered.");
    expect(result).toContain("FINANCE/Invoice");
  });

  it("falls back to subject prefix when no regex matches", () => {
    const result = heuristicLabels("FAN/Request - catch up soon", "No explicit keywords here");
    expect(result).toEqual(["FAN/Request"]);
  });

  it("deduplicates labels from subject and body", () => {
    const result = heuristicLabels("Invoice", "Here is your invoice");
    expect(result).toEqual(["FINANCE/Invoice"]);
  });
});
