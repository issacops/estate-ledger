import { describe, it, expect } from "vitest";
import {
  describeMove, liveBlocks, planMove, tapperLoads, unassignedBlocks,
  type AssignBlock, type AssignTapper,
} from "./assignments";

const b = (id: number, code: string, trees: number, tapper_id: number | null, active = 1): AssignBlock =>
  ({ id, code, trees, tapper_id, active });
const T: AssignTapper[] = [
  { id: 1, name: "John", type: "Employee", status: "Active" },
  { id: 2, name: "Reji Kumar", type: "Lease", status: "Active" },
  { id: 3, name: "Biju", type: "Contract", status: "Active" },
];
const BLOCKS = [b(1, "K1", 400, 1), b(2, "K2", 400, 1), b(3, "K3", 2400, 2), b(4, "K4", 1500, 3)];

describe("who holds what", () => {
  it("lists each tapper's blocks and tree count", () => {
    const l = tapperLoads(BLOCKS, T);
    expect(l[0].blocks.map((x) => x.code)).toEqual(["K1", "K2"]);
    expect(l[0].trees).toBe(800);
    expect(l[1].trees).toBe(2400);
  });
  it("sorts block codes the way people read them", () => {
    const l = liveBlocks([b(1, "B10", 1, 1), b(2, "B2", 1, 1), b(3, "B1", 1, 1)]);
    expect(l.map((x) => x.code)).toEqual(["B1", "B2", "B10"]);
  });
  it("ignores a retired block", () => {
    const l = tapperLoads([...BLOCKS, b(9, "K9", 100, 1, 0)], T);
    expect(l[0].blocks.map((x) => x.code)).toEqual(["K1", "K2"]);
    expect(unassignedBlocks([b(9, "K9", 100, null, 0)], T)).toEqual([]);
  });
  it("finds blocks with no tapper, or a tapper that no longer exists", () => {
    const u = unassignedBlocks([...BLOCKS, b(5, "K5", 10, null), b(6, "K6", 10, 99)], T);
    expect(u.map((x) => x.code)).toEqual(["K5", "K6"]);
  });
});

describe("moving a block", () => {
  it("takes it from the current holder", () => {
    expect(planMove(BLOCKS, 3, 1)).toEqual({ blockId: 3, from: 2, to: 1, changed: true });
  });
  it("sees that nothing would change", () => {
    expect(planMove(BLOCKS, 1, 1).changed).toBe(false);
  });
  it("can leave a block with nobody", () => {
    expect(planMove(BLOCKS, 1, null)).toMatchObject({ from: 1, to: null, changed: true });
  });
  it("describes each case for the confirmation", () => {
    expect(describeMove(planMove(BLOCKS, 3, 1), BLOCKS, T)).toBe("K3 moved from Reji Kumar to John");
    expect(describeMove(planMove(BLOCKS, 1, null), BLOCKS, T)).toBe("K1 is no longer assigned to John");
    expect(describeMove(planMove([b(5, "K5", 1, null)], 5, 2), [b(5, "K5", 1, null)], T)).toBe("K5 given to Reji Kumar");
  });
});
