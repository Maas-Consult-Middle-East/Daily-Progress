const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(
    __dirname,
    "../daily_progress/daily_progress/doctype/daily_progress_entry/daily_progress_entry.js"
  ),
  "utf8"
);
function setup() {
  const events = {};
  const context = {
    console,
    flt: (value) => Number(value) || 0,
    locals: {},
    frappe: {
      ui: {
        form: {
          on: (type, handlers) => {
            events[type] ||= {};
            for (const [event, handler] of Object.entries(handlers)) {
              const previous = events[type][event];
              events[type][event] = previous
                ? (...args) => { previous(...args); return handler(...args); }
                : handler;
            }
          },
        },
      },
      get_meta: () => ({
        fields: [{ fieldname: "mark_as_completed", fieldtype: "Check" }],
      }),
      model: {
        set_value: (type, name, field, value) => {
          context.locals[type][name][field] = value;
        },
      },
      db: {},
      msgprint() {},
      show_alert() {},
      throw: (message) => {
        throw new Error(message);
      },
      utils: { escape_html: (value) => value },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const frm = {
    doc: {
      name: "NEW",
      project: "P",
      sub_area: "T",
      boq: "B",
      posting_date: "2026-11-24",
      item_progress: [],
    },
    fields_dict: {},
    is_new: () => true,
    refresh_field() {},
    set_df_property() {},
    set_value: async (field, value) => {
      frm.doc[field] = value;
    },
    clear_table: () => {
      frm.doc.item_progress = [];
    },
    add_child: () => {
      const row = { name: `row-${frm.doc.item_progress.length}` };
      frm.doc.item_progress.push(row);
      return row;
    },
  };
  return { context, frm, events };
}
const items = [
  { name: "a", item_code: "X", qty: 10 },
  { name: "b", item_code: "X", qty: 10 },
];
test("duplicate item codes retain separate exact and legacy history", () => {
  const { context } = setup();
  const rows = [
    { item: "X", planned_qty: 10, total_executed_qty: 3 },
    { boq_item: "a", item: "X", total_executed_qty: 7 },
  ];
  const result = context.match_previous_boq_rows(items, rows);
  assert.equal(result.a.total_executed_qty, 7);
  assert.equal(result.b.total_executed_qty, 3);
});
test("history is BOQ-specific, date-limited, and carries completion by row", async () => {
  const { context, frm } = setup();
  context.frappe.call = async ({ args }) => {
    if (args.filters) {
      assert.equal(args.filters.boq, "B");
      assert.equal(args.filters.posting_date[0], "<=");
      assert.equal(args.filters.name[1], "NEW");
      return { message: [{ name: "OLD" }] };
    }
    return {
      message: {
        item_progress: [
          {
            boq_item: "a",
            item: "X",
            total_executed_qty: 4,
            mark_as_completed: 1,
          },
        ],
      },
    };
  };
  const result = await context.get_previous_progress(frm, "B", items);
  assert.equal(result.quantities.a, 4);
  assert.equal(result.completed.a, true);
  assert.equal(result.quantities.b, 0);
  context.frappe.call = async () => ({ message: [] });
  assert.equal(
    Object.keys(
      (await context.get_previous_progress(frm, "REWORK", items)).quantities
    ).length,
    0
  );
});
test("completed rows lock quantity and contribute full planned weight without inflating execution", () => {
  const { context, frm, events } = setup();
  const row = {
    name: "r",
    planned_qty: 10,
    previous_executed_qty: 2,
    today_executed_qty: 3,
    mark_as_completed: 1,
  };
  frm.doc.item_progress = [row];
  context.locals["Daily Progress Item"] = { r: row };
  context.snapshot_today_quantities(frm);
  row.today_executed_qty = 8;
  events["Daily Progress Item"].today_executed_qty(
    frm,
    "Daily Progress Item",
    "r"
  );
  assert.equal(row.today_executed_qty, 3);
  context.calculate_all_rows(frm);
  context.update_daily_progress_summary(frm);
  assert.equal(row.completion_, 100);
  assert.equal(frm.doc.completion_, 100);
  assert.equal(frm.doc.total_executed_qty, 5);
  assert.equal(frm.doc.remaining_qty, 5);
  row.mark_as_completed = 0;
  context.calculate_all_rows(frm);
  context.update_daily_progress_summary(frm);
  assert.equal(frm.doc.completion_, 50);
});
test("empty new entry cannot save", () => {
  const { frm, events } = setup();
  assert.throws(
    () => events["Daily Progress Entry"].validate(frm),
    /No Item Progress/
  );
});
test("revision selection rejects mixed tasks and wrong companies", async () => {
  const { context, frm } = setup();
  const original = {
    project: "P",
    item: "PRODUCT",
    company: "C",
    creation: "2026-01-01",
  };
  context.frappe.db.get_list = async () => [
    { name: "mixed" },
    { name: "wrong" },
    { name: "valid" },
  ];
  context.frappe.db.get_doc = async (type, name) => ({
    ...original,
    name,
    docstatus: 1,
    is_active: 0,
    company: name === "wrong" ? "OTHER" : "C",
    items: [
      { custom_sub_area: "T" },
      { custom_sub_area: name === "mixed" ? "OTHER" : "T" },
    ],
  });
  assert.equal(
    (await context.get_latest_task_boq_revision(frm, original, "T")).name,
    "valid"
  );
});
test("loading switches to rework without importing original progress", async () => {
  const { context, frm } = setup();
  frm.__current_bom = "B";
  frm.__dpe_load_seq = 1;
  const original = {
    name: "B",
    project: "P",
    item: "PRODUCT",
    company: "C",
    is_active: 1,
    docstatus: 1,
    items,
  };
  context.frappe.db.get_doc = async () => original;
  context.get_latest_task_boq_revision = async () => ({
    ...original,
    name: "R",
    is_active: 0,
    items: items.map((row) => ({ ...row, custom_sub_area: "T" })),
  });
  context.frappe.call = async ({ args }) => {
    assert.equal(args.filters.boq, "R");
    return { message: [] };
  };
  await context.load_task_boq_items(frm);
  assert.equal(frm.doc.boq, "R");
  assert.equal(frm.doc.item_progress.length, 2);
  assert.equal(frm.doc.item_progress[0].previous_executed_qty, 0);
  assert.equal(frm.doc.item_progress[0].boq_item, "a");
});
test("stale request cannot populate another task", async () => {
  const { context, frm } = setup();
  frm.__current_bom = "B";
  frm.__dpe_load_seq = 1;
  context.frappe.db.get_doc = async () => ({
    name: "B",
    project: "P",
    docstatus: 1,
    is_active: 1,
    items,
  });
  context.get_latest_task_boq_revision = async () => {
    frm.doc.sub_area = "OTHER";
    frm.__dpe_load_seq++;
    return {
      name: "R",
      items: items.map((row) => ({ ...row, custom_sub_area: "T" })),
    };
  };
  await context.load_task_boq_items(frm);
  assert.equal(frm.doc.boq, "B");
  assert.equal(frm.doc.item_progress.length, 0);
});
test("over-plan history blocks loading instead of silently truncating quantities", async () => {
  const { context, frm } = setup();
  frm.__current_bom = "B";
  frm.__dpe_load_seq = 1;
  context.frappe.db.get_doc = async () => ({
    name: "B",
    project: "P",
    docstatus: 1,
    is_active: 1,
    items: items.map((row) => ({ ...row, custom_sub_area: "T" })),
  });
  context.get_latest_task_boq_revision = async () => null;
  context.get_previous_progress = async () => ({
    quantities: { a: 11 },
    completed: {},
  });
  let warning;
  context.frappe.msgprint = (message) => {
    warning = message;
  };
  await context.load_task_boq_items(frm);
  assert.equal(frm.doc.item_progress.length, 0);
  assert.match(warning.title, /exceeds planned/);
});
test("failed history request does not load zero progress rows", async () => {
  const { context, frm } = setup();
  frm.__current_bom = "B";
  frm.__dpe_load_seq = 1;
  context.console = { error() {} };
  context.frappe.db.get_doc = async () => ({
    name: "B",
    project: "P",
    docstatus: 1,
    is_active: 1,
    items: items.map((row) => ({ ...row, custom_sub_area: "T" })),
  });
  context.get_latest_task_boq_revision = async () => null;
  context.frappe.call = async () => {
    throw new Error("Permission denied");
  };
  await context.load_task_boq_items(frm);
  assert.equal(frm.doc.item_progress.length, 0);
});
test("legacy original BOQ resolves rework using the selected project", async () => {
  const { context, frm } = setup();
  const original = { name: "BOM-Salman-001", project: null, item: "Salman", company: "C", creation: "2026-11-24 16:37:10" };
  context.frappe.db.get_list = async (doctype, args) => {
    assert.equal(args.filters.project, "P");
    return [{ name: "BOM-Salman-002" }];
  };
  context.frappe.db.get_doc = async () => ({ name: "BOM-Salman-002", project: "P", item: "Salman", company: "C", docstatus: 1, is_active: 0, items: [{ custom_sub_area: "T" }] });
  assert.equal((await context.get_latest_task_boq_revision(frm, original, "T"))?.name, "BOM-Salman-002");
});
test("BOQ link filter accepts the validated legacy BOQ without a project field", () => {
  const { frm, events } = setup();
  const queries = {};
  frm.__current_bom = "LEGACY";
  frm.set_query = (field, callback) => { queries[field] = callback; };
  events["Daily Progress Entry"].setup(frm);
  const filters = queries.boq().filters;
  assert.equal(filters.project, undefined);
  assert.ok(filters.name[1].includes("LEGACY"));
  assert.equal(filters.docstatus, 1);
});
