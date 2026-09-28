import { useEffect, useState, useCallback } from "react";
import { select, type SqlValue } from "./client";
import { useApp } from "../app/store";
import type {
  Block,
  Tapper,
  Barrel,
  ConfigItem,
  Buyer,
  Vendor,
  StockItem,
  EntryDay,
  EntryRow,
  EntryRowBucket,
  EntryRowBarrel,
  LabourRow,
  SmokehouseLog,
  Invoice,
  Payment,
  CashbookRow,
  Purchase,
  VendorPayment,
} from "../domain/types";

export function useQuery<T>(
  fn: () => Promise<T[]>,
  deps: unknown[]
): { rows: T[]; reload: () => void; loading: boolean } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const dataVersion = useApp((s) => s.dataVersion);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e) => console.error(e))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion, tick]);

  return { rows, reload, loading };
}

export interface Masters {
  blocks: Block[];
  tappers: Tapper[];
  barrels: Barrel[];
  config: ConfigItem[];
  buyers: Buyer[];
  vendors: Vendor[];
  items: StockItem[];
  byId: {
    block: Map<number, Block>;
    tapper: Map<number, Tapper>;
    barrel: Map<number, Barrel>;
    buyer: Map<number, Buyer>;
    vendor: Map<number, Vendor>;
    item: Map<number, StockItem>;
  };
  list: (kind: string) => ConfigItem[];
}

export function useMasters(estateId: number): Masters {
  const empty: Masters = {
    blocks: [],
    tappers: [],
    barrels: [],
    config: [],
    buyers: [],
    vendors: [],
    items: [],
    byId: {
      block: new Map(),
      tapper: new Map(),
      barrel: new Map(),
      buyer: new Map(),
      vendor: new Map(),
      item: new Map(),
    },
    list: () => [],
  };
  const [m, setM] = useState<Masters>(empty);
  const dataVersion = useApp((s) => s.dataVersion);

  useEffect(() => {
    if (!estateId) return;
    let alive = true;
    (async () => {
      const [blocks, tappers, barrels, config, buyers, vendors, items] =
        await Promise.all([
          select<Block>("SELECT * FROM blocks WHERE estate_id=$1 ORDER BY code", [estateId]),
          select<Tapper>("SELECT * FROM tappers WHERE estate_id=$1 ORDER BY sort_order, name", [estateId]),
          select<Barrel>("SELECT * FROM barrels WHERE estate_id=$1 ORDER BY code", [estateId]),
          select<ConfigItem>("SELECT * FROM config_lists WHERE estate_id=$1 ORDER BY kind, sort_order", [estateId]),
          select<Buyer>("SELECT * FROM buyers WHERE estate_id=$1 ORDER BY name", [estateId]),
          select<Vendor>("SELECT * FROM vendors WHERE estate_id=$1 ORDER BY name", [estateId]),
          select<StockItem>("SELECT * FROM stock_items WHERE estate_id=$1 ORDER BY name", [estateId]),
        ]);
      if (!alive) return;
      setM({
        blocks,
        tappers,
        barrels,
        config,
        buyers,
        vendors,
        items,
        byId: {
          block: new Map(blocks.map((b) => [b.id, b])),
          tapper: new Map(tappers.map((t) => [t.id, t])),
          barrel: new Map(barrels.map((b) => [b.id, b])),
          buyer: new Map(buyers.map((b) => [b.id, b])),
          vendor: new Map(vendors.map((v) => [v.id, v])),
          item: new Map(items.map((i) => [i.id, i])),
        },
        list: (kind: string) => config.filter((c) => c.kind === kind),
      });
    })();
    return () => {
      alive = false;
    };
  }, [estateId, dataVersion]);

  return m;
}

export async function getDayBundle(estateId: number, date: string) {
  const days = await select<EntryDay>(
    "SELECT * FROM entry_days WHERE estate_id=$1 AND date=$2",
    [estateId, date]
  );
  const day = days[0] ?? null;
  if (!day) {
    return {
      day: null,
      rows: [] as EntryRow[],
      buckets: [] as EntryRowBucket[],
      barrels: [] as EntryRowBarrel[],
      labour: [] as LabourRow[],
    };
  }
  const [rows, buckets, barrels, labour] = await Promise.all([
    select<EntryRow>("SELECT * FROM entry_rows WHERE day_id=$1", [day.id]),
    select<EntryRowBucket>(
      "SELECT b.* FROM entry_row_buckets b JOIN entry_rows r ON r.id=b.row_id WHERE r.day_id=$1",
      [day.id]
    ),
    select<EntryRowBarrel>(
      "SELECT bb.* FROM entry_row_barrels bb JOIN entry_rows r ON r.id=bb.row_id WHERE r.day_id=$1",
      [day.id]
    ),
    select<LabourRow>("SELECT * FROM labour_rows WHERE day_id=$1 ORDER BY sort_order", [day.id]),
  ]);
  return { day, rows, buckets, barrels, labour };
}

export type {
  EntryDay,
  EntryRow,
  EntryRowBucket,
  EntryRowBarrel,
  LabourRow,
  SmokehouseLog,
  Invoice,
  Payment,
  CashbookRow,
  Purchase,
  VendorPayment,
};

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = []
): Promise<T[]> {
  return select<T>(sql, params);
}
