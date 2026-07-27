import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Set the DB path BEFORE any db function runs (the connection opens lazily).
process.env.TALLY_DB_PATH = join(mkdtempSync(join(tmpdir(), "tally-pricewatch-test-")), "test.db");

import type { CreatePriceWatchRequest } from "../../shared/priceWatch";
import { createWatch, listWatches } from "./priceWatch";

function req(over: Partial<CreatePriceWatchRequest> = {}): CreatePriceWatchRequest {
  return {
    reportId: "r_abc",
    rank: 1,
    pickName: "Sony WH-1000XM5",
    deviceId: "dev_abc123XYZ",
    ...over,
  };
}

describe("createWatch", () => {
  test("persists a watch and returns the stored row", () => {
    const watch = createWatch(req({ reportId: "r_persist", deviceId: "dev_persist01" }));
    expect(watch.id).toBeTruthy();
    expect(watch.reportId).toBe("r_persist");
    expect(watch.rank).toBe(1);
    expect(watch.pickName).toBe("Sony WH-1000XM5");
    expect(watch.createdAt).toBeTruthy();

    const list = listWatches("dev_persist01");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(watch.id);
  });

  test("is idempotent — same device+report+rank twice yields ONE row", () => {
    const first = createWatch(req({ reportId: "r_idem", deviceId: "dev_idem0001" }));
    const second = createWatch(req({ reportId: "r_idem", deviceId: "dev_idem0001" }));

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(listWatches("dev_idem0001")).toHaveLength(1);
  });

  test("distinct ranks on the same report are separate watches", () => {
    createWatch(req({ reportId: "r_ranks", deviceId: "dev_ranks001", rank: 1 }));
    createWatch(req({ reportId: "r_ranks", deviceId: "dev_ranks001", rank: 2 }));
    expect(listWatches("dev_ranks001")).toHaveLength(2);
  });
});

describe("listWatches", () => {
  test("returns only the given device's watches", () => {
    createWatch(req({ reportId: "r_scope", deviceId: "dev_scopeAAA" }));
    createWatch(req({ reportId: "r_scope", deviceId: "dev_scopeBBB" }));

    expect(listWatches("dev_scopeAAA")).toHaveLength(1);
    expect(listWatches("dev_scopeBBB")).toHaveLength(1);
    expect(listWatches("dev_nobody999")).toHaveLength(0);
  });
});
