import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useApp } from "../app/store";
import { useMasters } from "../db/hooks";
import { execute, select } from "../db/client";
import { Card, Confirm, PageHeader, Table, Td, cn } from "../ui/components";
import type { EstateProfile } from "../domain/types";

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => void;
}

const PROFILE_FLAGS: [keyof EstateProfile, string][] = [
  ["rotation", "Rotation"],
  ["arrangements", "Arrangements"],
  ["smokehouse", "Smokehouse"],
  ["barrelCapacityCheck", "Barrel capacity check"],
  ["autoFillBarrels", "Auto-fill barrels"],
  ["customSaleGrades", "Custom sale grades"],
  ["photos", "Photos"],
  ["attendance", "Attendance"],
  ["gapAlerts", "Gap alerts"],
  ["seasonGranularity", "Season granularity"],
  ["leaseProductionEntry", "Lease production entry"],
];

const KIND_TITLES: Record<string, string> = {
  expenseCat: "Expense categories",
  purchaseCat: "Purchase categories",
  workType: "Work types",
  weather: "Weather options",
  reason: "Reasons",
  bucket: "Buckets",
  sheetGrade: "Sheet grades",
};

const KIND_PREFIX: Record<string, string> = {
  expenseCat: "E",
  purchaseCat: "P",
  workType: "W",
  weather: "W",
  reason: "R",
  bucket: "B",
  sheetGrade: "G",
};

const KINDS = [
  "expenseCat",
  "purchaseCat",
  "workType",
  "weather",
  "reason",
  "bucket",
  "sheetGrade",
];

function nextBlockCode(codes: string[]): string {
  let bestPrefix = "";
  let bestN = 0;
  let seen = false;
  for (const c of codes) {
    const m = /^(.*?)(\d+)$/.exec(c);
    if (!m) continue;
    const n = Number(m[2]);
    if (!seen || n >= bestN) {
      seen = true;
      bestN = n;
      bestPrefix = m[1];
    }
  }
  return seen ? `${bestPrefix}${bestN + 1}` : "B1";
}

function nextBarrelNumber(codes: string[]): number {
  let max = 0;
  for (const c of codes) {
    const m = /^BR-(\d+)$/.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function nextConfigCode(kind: string, codes: string[]): string {
  const prefix = KIND_PREFIX[kind] ?? "X";
  let max = 0;
  for (const c of codes) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

const textCls = "input border-0 bg-transparent px-1 py-0.5";
const numCls = "input w-[74px] border-0 bg-transparent px-1 py-0.5 text-right";

export function MastersPage() {
  const estate = useApp((s) => s.estate)!;
  const setEstate = useApp((s) => s.setEstate);
  const bump = useApp((s) => s.bump);
  const masters = useMasters(estate.id);
  const profile = estate.profile;
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const updateBlock = async (id: number, field: string, value: string | number | null) => {
    await execute(`UPDATE blocks SET ${field}=$1 WHERE id=$2`, [value, id]);
    bump();
  };
  const updateTapper = async (id: number, field: string, value: string | number | null) => {
    await execute(`UPDATE tappers SET ${field}=$1 WHERE id=$2`, [value, id]);
    bump();
  };
  const updateBarrel = async (id: number, field: string, value: string | number | null) => {
    await execute(`UPDATE barrels SET ${field}=$1 WHERE id=$2`, [value, id]);
    bump();
  };
  const updateConfig = async (id: number, field: string, value: string | number | null) => {
    await execute(`UPDATE config_lists SET ${field}=$1 WHERE id=$2`, [value, id]);
    bump();
  };
  const updateBuyer = async (id: number, field: string, value: string | number | null) => {
    await execute(`UPDATE buyers SET ${field}=$1 WHERE id=$2`, [value, id]);
    bump();
  };
  const updateVendor = async (id: number, field: string, value: string | number | null) => {
    await execute(`UPDATE vendors SET ${field}=$1 WHERE id=$2`, [value, id]);
    bump();
  };
  const updateItem = async (id: number, field: string, value: string | number | null) => {
    await execute(`UPDATE stock_items SET ${field}=$1 WHERE id=$2`, [value, id]);
    bump();
  };

  const addBlock = async () => {
    const code = nextBlockCode(masters.blocks.map((b) => b.code));
    await execute(
      "INSERT INTO blocks (estate_id, code, name, trees, arrangement, active) VALUES ($1,$2,$3,0,'Direct',1)",
      [estate.id, code, code]
    );
    bump();
    toast.success(`Block ${code} added`);
  };

  const askDeleteBlock = (id: number, code: string) => {
    void (async () => {
      const rows = await select<{ n: number }>(
        "SELECT COUNT(*) AS n FROM entry_rows WHERE block_id=$1",
        [id]
      );
      const n = rows[0]?.n ?? 0;
      setConfirm({
        title: "Delete block",
        message:
          n > 0
            ? `Block ${code} is referenced by ${n} entry row(s) of history. It cannot be deleted while history exists — mark it inactive instead.`
            : `Delete block ${code}? This cannot be undone.`,
        onConfirm: () => {
          void (async () => {
            const again = await select<{ n: number }>(
              "SELECT COUNT(*) AS n FROM entry_rows WHERE block_id=$1",
              [id]
            );
            const cnt = again[0]?.n ?? 0;
            if (cnt > 0) {
              toast.error(`Cannot delete — ${code} is referenced by ${cnt} entry row(s)`);
              return;
            }
            await execute("DELETE FROM blocks WHERE id=$1", [id]);
            bump();
            toast.success(`Block ${code} deleted`);
          })();
        },
      });
    })();
  };

  const addTapper = async () => {
    const n = masters.tappers.length + 1;
    await execute(
      "INSERT INTO tappers (estate_id, name, type, tap_days, status, sort_order) VALUES ($1,$2,'Employee',2,'Active',$3)",
      [estate.id, `Tapper ${n}`, masters.tappers.length]
    );
    bump();
  };

  const askDeleteTapper = (id: number, name: string) => {
    void (async () => {
      const rows = await select<{ n: number }>(
        "SELECT COUNT(*) AS n FROM entry_rows WHERE tapper_id=$1",
        [id]
      );
      const n = rows[0]?.n ?? 0;
      setConfirm({
        title: "Delete tapper",
        message:
          n > 0
            ? `${name} is referenced by ${n} entry row(s) of history. The tapper cannot be deleted while history exists — set status to Inactive instead.`
            : `Delete tapper ${name}? This cannot be undone.`,
        onConfirm: () => {
          void (async () => {
            const again = await select<{ n: number }>(
              "SELECT COUNT(*) AS n FROM entry_rows WHERE tapper_id=$1",
              [id]
            );
            const cnt = again[0]?.n ?? 0;
            if (cnt > 0) {
              toast.error(`Cannot delete — ${name} is referenced by ${cnt} entry row(s)`);
              return;
            }
            await execute("DELETE FROM tappers WHERE id=$1", [id]);
            bump();
            toast.success(`Tapper ${name} deleted`);
          })();
        },
      });
    })();
  };

  const addBarrels = async (count: number) => {
    let n = nextBarrelNumber(masters.barrels.map((b) => b.code));
    for (let i = 0; i < count; i++, n++) {
      await execute(
        "INSERT INTO barrels (estate_id, code, capacity, active) VALUES ($1,$2,$3,1)",
        [estate.id, `BR-${n}`, profile.defaultBarrelCapacity]
      );
    }
    bump();
    toast.success(`${count} barrel(s) added`);
  };

  const askDeleteBarrel = (id: number, code: string) => {
    void (async () => {
      const rows = await select<{ n: number }>(
        "SELECT (SELECT COUNT(*) FROM entry_row_barrels WHERE barrel_id=$1) + (SELECT COUNT(*) FROM invoice_barrels WHERE barrel_id=$1) AS n",
        [id]
      );
      const n = rows[0]?.n ?? 0;
      setConfirm({
        title: "Delete barrel",
        message:
          n > 0
            ? `Barrel ${code} is referenced by ${n} allocation/invoice record(s). It cannot be deleted while history exists — mark it inactive instead.`
            : `Delete barrel ${code}? This cannot be undone.`,
        onConfirm: () => {
          void (async () => {
            const again = await select<{ n: number }>(
              "SELECT (SELECT COUNT(*) FROM entry_row_barrels WHERE barrel_id=$1) + (SELECT COUNT(*) FROM invoice_barrels WHERE barrel_id=$1) AS n",
              [id]
            );
            const cnt = again[0]?.n ?? 0;
            if (cnt > 0) {
              toast.error(`Cannot delete — ${code} is referenced by ${cnt} record(s)`);
              return;
            }
            await execute("DELETE FROM barrels WHERE id=$1", [id]);
            bump();
            toast.success(`Barrel ${code} deleted`);
          })();
        },
      });
    })();
  };

  const addConfig = async (kind: string) => {
    const items = masters.list(kind);
    const code = nextConfigCode(kind, items.map((c) => c.code));
    await execute(
      "INSERT INTO config_lists (estate_id, kind, code, label, locked, sort_order) VALUES ($1,$2,$3,$4,0,$5)",
      [estate.id, kind, code, code, items.length]
    );
    bump();
  };

  const askDeleteConfig = (id: number, label: string) => {
    setConfirm({
      title: "Delete list item",
      message: `Delete "${label}"? History keeps past values.`,
      onConfirm: () => {
        void (async () => {
          await execute("DELETE FROM config_lists WHERE id=$1", [id]);
          bump();
          toast.success(`"${label}" deleted`);
        })();
      },
    });
  };

  const addBuyer = async () => {
    await execute("INSERT INTO buyers (estate_id, name, contact, active) VALUES ($1,'New buyer','',1)", [
      estate.id,
    ]);
    bump();
  };

  const addVendor = async () => {
    await execute("INSERT INTO vendors (estate_id, name, contact, active) VALUES ($1,'New vendor','',1)", [
      estate.id,
    ]);
    bump();
  };

  const addItem = async () => {
    await execute("INSERT INTO stock_items (estate_id, name, unit, active) VALUES ($1,'New item','kg',1)", [
      estate.id,
    ]);
    bump();
  };

  const askDeactivate = (title: string, name: string, onConfirm: () => void) => {
    setConfirm({
      title,
      message: `Deactivate "${name}"? It stays in history and can be re-activated later.`,
      onConfirm,
    });
  };

  const toggleFlag = async (key: keyof EstateProfile, checked: boolean) => {
    const next = { ...profile, [key]: checked } as EstateProfile;
    await execute("UPDATE estates SET profile_json=$1 WHERE id=$2", [JSON.stringify(next), estate.id]);
    setEstate({ ...estate, profile: next });
    bump();
  };

  const tapDayOptions = profile.tapCycleOptions.length ? profile.tapCycleOptions : [1, 2, 3, 4];

  return (
    <div>
      <PageHeader title="Estate setup" subtitle={`Masters for ${estate.name}`} />

      <Card
        className="mb-4"
        title="Blocks"
        pad={false}
        right={
          <button className="btn btn-secondary" onClick={() => void addBlock()}>
            <Plus size={14} /> Add block
          </button>
        }
      >
        <Table headers={["Code", "Name", "Trees", "Tapper", "Arrangement", "Lease rate", "Active", ""]}>
          {masters.blocks.map((b) => (
            <tr key={b.id} className={cn(!b.active && "opacity-50")}>
              <td className="font-semibold whitespace-nowrap">{b.code}</td>
              <td>
                <input
                  className={textCls}
                  defaultValue={b.name}
                  onBlur={(e) => void updateBlock(b.id, "name", e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  className={numCls}
                  defaultValue={b.trees}
                  onBlur={(e) => void updateBlock(b.id, "trees", Number(e.target.value) || 0)}
                />
              </td>
              <td>
                <select
                  className={textCls}
                  value={b.tapper_id ?? ""}
                  onChange={(e) => void updateBlock(b.id, "tapper_id", Number(e.target.value) || null)}
                >
                  <option value="">—</option>
                  {masters.tappers.map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {tp.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className={textCls}
                  value={b.arrangement}
                  onChange={(e) => void updateBlock(b.id, "arrangement", e.target.value)}
                >
                  <option>Direct</option>
                  <option>Flat-rate</option>
                  <option>Revenue-share</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  className={numCls}
                  defaultValue={b.lease_rate ?? ""}
                  onBlur={(e) =>
                    void updateBlock(b.id, "lease_rate", e.target.value === "" ? null : Number(e.target.value))
                  }
                />
              </td>
              <td className="text-center">
                <input
                  type="checkbox"
                  checked={Boolean(b.active)}
                  onChange={(e) => void updateBlock(b.id, "active", e.target.checked ? 1 : 0)}
                />
              </td>
              <td className="w-8 text-center">
                <button className="text-danger" onClick={() => askDeleteBlock(b.id, b.code)}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card
        className="mb-4"
        title="Tappers"
        pad={false}
        right={
          <button className="btn btn-secondary" onClick={() => void addTapper()}>
            <Plus size={14} /> Add tapper
          </button>
        }
      >
        <Table headers={["Name", "Type", "Tap days", "Status", ""]}>
          {masters.tappers.map((tp) => (
            <tr key={tp.id} className={cn(tp.status !== "Active" && "opacity-50")}>
              <td>
                <input
                  className={textCls}
                  defaultValue={tp.name}
                  onBlur={(e) => void updateTapper(tp.id, "name", e.target.value)}
                />
              </td>
              <td>
                <select
                  className={textCls}
                  value={tp.type}
                  onChange={(e) => void updateTapper(tp.id, "type", e.target.value)}
                >
                  <option>Employee</option>
                  <option>Contract</option>
                  <option>Lease</option>
                </select>
              </td>
              <td>
                <select
                  className={textCls}
                  value={tp.tap_days}
                  onChange={(e) => void updateTapper(tp.id, "tap_days", Number(e.target.value))}
                >
                  {tapDayOptions.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className={textCls}
                  value={tp.status}
                  onChange={(e) => void updateTapper(tp.id, "status", e.target.value)}
                >
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </td>
              <td className="w-8 text-center">
                <button className="text-danger" onClick={() => askDeleteTapper(tp.id, tp.name)}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card
        className="mb-4"
        title="Barrels"
        pad={false}
        right={
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary" onClick={() => void addBarrels(1)}>
              <Plus size={14} /> Add barrel
            </button>
            <button className="btn btn-secondary" onClick={() => void addBarrels(10)}>
              <Plus size={14} /> Add 10
            </button>
          </div>
        }
      >
        <Table headers={["Code", "Capacity (kg)", "Tare weight (kg)", "Active", ""]}>
          {masters.barrels.map((b) => (
            <tr key={b.id} className={cn(!b.active && "opacity-50")}>
              <td className="font-semibold whitespace-nowrap">{b.code}</td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  className={numCls}
                  defaultValue={b.capacity}
                  onBlur={(e) => void updateBarrel(b.id, "capacity", Number(e.target.value) || 0)}
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.1"
                  className={numCls}
                  defaultValue={b.tare_weight ?? ""}
                  onBlur={(e) =>
                    void updateBarrel(b.id, "tare_weight", e.target.value === "" ? null : Number(e.target.value))
                  }
                />
              </td>
              <td className="text-center">
                <input
                  type="checkbox"
                  checked={Boolean(b.active)}
                  onChange={(e) => void updateBarrel(b.id, "active", e.target.checked ? 1 : 0)}
                />
              </td>
              <td className="w-8 text-center">
                <button className="text-danger" onClick={() => askDeleteBarrel(b.id, b.code)}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {KINDS.map((kind) => {
          const items = masters.list(kind);
          return (
            <Card
              key={kind}
              title={KIND_TITLES[kind] ?? kind}
              pad={false}
              right={
                <button className="btn btn-secondary" onClick={() => void addConfig(kind)}>
                  <Plus size={14} /> Add
                </button>
              }
            >
              <Table headers={["Code", "Label", ""]}>
                {items.map((it) => (
                  <tr key={it.id}>
                    <Td className="w-[80px]">
                      <input
                        className={textCls}
                        defaultValue={it.code}
                        onBlur={(e) => void updateConfig(it.id, "code", e.target.value)}
                      />
                    </Td>
                    <td>
                      <input
                        className={textCls}
                        defaultValue={it.label}
                        onBlur={(e) => void updateConfig(it.id, "label", e.target.value)}
                      />
                    </td>
                    <Td className="w-8 text-center">
                      {!it.locked && (
                        <button className="text-danger" onClick={() => askDeleteConfig(it.id, it.label)}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          );
        })}
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card
          title="Buyers"
          pad={false}
          right={
            <button className="btn btn-secondary" onClick={() => void addBuyer()}>
              <Plus size={14} /> Add buyer
            </button>
          }
        >
          <Table headers={["Name", "Contact", "Active", ""]}>
            {masters.buyers.map((b) => (
              <tr key={b.id} className={cn(!b.active && "opacity-50")}>
                <td>
                  <input
                    className={textCls}
                    defaultValue={b.name}
                    onBlur={(e) => void updateBuyer(b.id, "name", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className={textCls}
                    defaultValue={b.contact}
                    onBlur={(e) => void updateBuyer(b.id, "contact", e.target.value)}
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={Boolean(b.active)}
                    onChange={(e) => void updateBuyer(b.id, "active", e.target.checked ? 1 : 0)}
                  />
                </td>
                <td className="w-8 text-center">
                  <button
                    className="text-danger"
                    onClick={() =>
                      askDeactivate("Deactivate buyer", b.name, () => {
                        void (async () => {
                          await execute("UPDATE buyers SET active=0 WHERE id=$1", [b.id]);
                          bump();
                          toast.success(`${b.name} deactivated`);
                        })();
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card
          title="Vendors"
          pad={false}
          right={
            <button className="btn btn-secondary" onClick={() => void addVendor()}>
              <Plus size={14} /> Add vendor
            </button>
          }
        >
          <Table headers={["Name", "Contact", "Active", ""]}>
            {masters.vendors.map((v) => (
              <tr key={v.id} className={cn(!v.active && "opacity-50")}>
                <td>
                  <input
                    className={textCls}
                    defaultValue={v.name}
                    onBlur={(e) => void updateVendor(v.id, "name", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className={textCls}
                    defaultValue={v.contact}
                    onBlur={(e) => void updateVendor(v.id, "contact", e.target.value)}
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={Boolean(v.active)}
                    onChange={(e) => void updateVendor(v.id, "active", e.target.checked ? 1 : 0)}
                  />
                </td>
                <td className="w-8 text-center">
                  <button
                    className="text-danger"
                    onClick={() =>
                      askDeactivate("Deactivate vendor", v.name, () => {
                        void (async () => {
                          await execute("UPDATE vendors SET active=0 WHERE id=$1", [v.id]);
                          bump();
                          toast.success(`${v.name} deactivated`);
                        })();
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card
          title="Stock items"
          pad={false}
          right={
            <button className="btn btn-secondary" onClick={() => void addItem()}>
              <Plus size={14} /> Add item
            </button>
          }
        >
          <Table headers={["Name", "Unit", "Active", ""]}>
            {masters.items.map((it) => (
              <tr key={it.id} className={cn(!it.active && "opacity-50")}>
                <td>
                  <input
                    className={textCls}
                    defaultValue={it.name}
                    onBlur={(e) => void updateItem(it.id, "name", e.target.value)}
                  />
                </td>
                <td>
                  <select
                    className={textCls}
                    value={it.unit}
                    onChange={(e) => void updateItem(it.id, "unit", e.target.value)}
                  >
                    <option value="kg">kg</option>
                    <option value="count">count</option>
                  </select>
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={Boolean(it.active)}
                    onChange={(e) => void updateItem(it.id, "active", e.target.checked ? 1 : 0)}
                  />
                </td>
                <td className="w-8 text-center">
                  <button
                    className="text-danger"
                    onClick={() =>
                      askDeactivate("Deactivate stock item", it.name, () => {
                        void (async () => {
                          await execute("UPDATE stock_items SET active=0 WHERE id=$1", [it.id]);
                          bump();
                          toast.success(`${it.name} deactivated`);
                        })();
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Estate profile flags">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 md:grid-cols-3">
            {PROFILE_FLAGS.map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-light">
                <input
                  type="checkbox"
                  checked={Boolean(profile[key])}
                  onChange={(e) => void toggleFlag(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </Card>
      </div>

      <Confirm
        open={Boolean(confirm)}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
