/*
====================================================
DAILY PROGRESS ENTRY - ORIGINAL + REWORK TRACKING
====================================================
Original work and rework are separate cycles.
Previous progress is fetched by:
Project + Task + BOQ
New rework starts from zero.
Existing original work remains unchanged.
No additional custom fields required.
====================================================
*/
frappe.ui.form.on("Daily Progress Entry", {
	setup(frm) {
		frm.set_query("project", () => ({
			filters: {
				name: [
					"in",
					frm.__assigned_projects?.length ? frm.__assigned_projects : ["__none__"],
				],
			},
		}));
		frm.set_query("sub_area", () => ({
			filters: {
				project: frm.doc.project || "__none__",
				name: [
					"in",
					frm.doc.project && frm.__assigned_tasks?.length
						? frm.__assigned_tasks
						: ["__none__"],
				],
			},
		}));
		frm.set_query("boq", () => {
			const valid_names = [
				...new Set(
					[frm.__current_bom, frm.__selected_variation_bom, frm.doc.boq].filter(Boolean)
				),
			];
			return {
				filters: {
					name: ["in", valid_names.length ? valid_names : ["__none__"]],
					// Names above already include the validated legacy BOQ.
					docstatus: 1,
				},
			};
		});
	},
	async refresh(frm) {
		register_completed_event(frm);
		setup_completed_qty_lock(frm);
		snapshot_today_quantities(frm);
		if (frm.is_new()) {
			if (!frm.doc.posting_date) {
				await frm.set_value("posting_date", frappe.datetime.get_today());
			}
			if (!frm.doc.supervisor) {
				await frm.set_value("supervisor", frappe.session.user);
			}
			await load_user_assignments(frm);
			if (!frm.doc.project && frm.__assigned_projects.length === 1) {
				await frm.set_value("project", frm.__assigned_projects[0]);
			}
			if (frm.doc.project) {
				await load_assigned_tasks_for_project(frm);
				await auto_select_boq(frm);
				if (frm.doc.sub_area && !(frm.doc.item_progress || []).length) {
					frm.__dpe_load_seq = (frm.__dpe_load_seq || 0) + 1;
					await load_task_boq_items(frm);
				}
			}
		}
		lock_supervisor_form(frm);
		refresh_completed_qty_locks(frm);
	},
	async project(frm) {
		frm.__current_bom = null;
		frm.__selected_variation_bom = null;
		frm.__dpe_load_seq = (frm.__dpe_load_seq || 0) + 1;
		await frm.set_value("sub_area", "");
		await frm.set_value("boq", "");
		clear_progress_table(frm);
		if (!frm.doc.project) return;
		await load_assigned_tasks_for_project(frm);
		await auto_select_boq(frm);
		lock_supervisor_form(frm);
	},
	async boq(frm) {
		// Do not clear Task during automatic BOQ change.
		if (frm.__changing_bom_for_task) return;
		frm.__selected_variation_bom = null;
		frm.__dpe_load_seq = (frm.__dpe_load_seq || 0) + 1;
		await frm.set_value("sub_area", "");
		clear_progress_table(frm);
		lock_supervisor_form(frm);
	},
	async sub_area(frm) {
		frm.__dpe_load_seq = (frm.__dpe_load_seq || 0) + 1;
		await load_task_boq_items(frm);
		lock_supervisor_form(frm);
	},
	validate(frm) {
		if (frm.doc.sub_area && !(frm.doc.item_progress || []).length) {
			frappe.throw("No Item Progress rows loaded. Select the Task again before saving.");
		}
		calculate_all_rows(frm);
		update_daily_progress_summary(frm);
	},
});
// CHILD TABLE EVENTS
frappe.ui.form.on("Daily Progress Item", {
	today_executed_qty(frm, cdt, cdn) {
		const row = locals[cdt]?.[cdn];
		if (!row) return;
		snapshot_today_quantities(frm);
		if (is_completed(frm, row)) {
			const approved = flt(frm.__dpe_approved_today[cdn]);
			if (flt(row.today_executed_qty) !== approved) {
				frappe.model.set_value(cdt, cdn, "today_executed_qty", approved);
				frappe.show_alert({
					message: "This item is completed. Today Executed Qty is locked.",
					indicator: "orange",
				});
				return;
			}
		}
		calculate_progress_row(frm, cdt, cdn);
		if (!is_completed(frm, row)) {
			frm.__dpe_approved_today[cdn] = flt(row.today_executed_qty);
		}
	},
});
// COMPLETED FIELD DETECTION
function completed_fieldname(frm) {
	const table = frm.fields_dict.item_progress;
	const childtype = table?.df?.options || "Daily Progress Item";
	const fields = frappe.get_meta(childtype)?.fields || table?.grid?.docfields || [];
	const field = fields.find((df) => {
		const fieldname = (df.fieldname || "").toLowerCase();
		const label = (df.label || "").toLowerCase().trim();
		return (
			df.fieldtype === "Check" &&
			(fieldname === "mark_as_completed" ||
				fieldname === "custom_mark_as_completed" ||
				label === "mark as completed")
		);
	});
	return field?.fieldname || null;
}
function is_completed(frm, row) {
	const field = completed_fieldname(frm);
	return field ? Number(row[field]) === 1 : false;
}
// COMPLETION CHECKBOX EVENT
function register_completed_event(frm) {
	const field = completed_fieldname(frm);
	if (!field) {
		console.warn("Mark As Completed checkbox was not found.");
		return;
	}
	if (frm.__registered_completed_field === field) {
		return;
	}
	const childtype = frm.fields_dict.item_progress?.df?.options || "Daily Progress Item";
	frappe.ui.form.on(childtype, field, (form, cdt, cdn) => {
		snapshot_today_quantities(form);
		const row = locals[cdt]?.[cdn];
		if (row) {
			form.__dpe_approved_today[cdn] = flt(row.today_executed_qty);
			calculate_progress_row(form, cdt, cdn);
		}
		form.refresh_field("item_progress");
		refresh_completed_qty_locks(form);
	});
	frm.__registered_completed_field = field;
}
// QUANTITY SNAPSHOT
function snapshot_today_quantities(frm) {
	frm.__dpe_approved_today = frm.__dpe_approved_today || {};
	(frm.doc.item_progress || []).forEach((row) => {
		if (!Object.prototype.hasOwnProperty.call(frm.__dpe_approved_today, row.name)) {
			frm.__dpe_approved_today[row.name] = flt(row.today_executed_qty);
		}
	});
}
// COMPLETED ITEM LOCK
function apply_completed_qty_lock(frm, grid_row) {
	if (!grid_row || grid_row.grid?.df?.fieldname !== "item_progress") {
		return;
	}
	if (!grid_row.doc || typeof grid_row.toggle_editable !== "function") {
		return;
	}
	grid_row.toggle_editable("today_executed_qty", !is_completed(frm, grid_row.doc));
}
function refresh_completed_qty_locks(frm) {
	const grid = frm.fields_dict.item_progress?.grid;
	if (!grid) return;
	(frm.doc.item_progress || []).forEach((row) => {
		const grid_row = grid.grid_rows_by_docname?.[row.name];
		apply_completed_qty_lock(frm, grid_row);
	});
}
function setup_completed_qty_lock(frm) {
	const field = completed_fieldname(frm);
	const grid = frm.fields_dict.item_progress?.grid;
	if (!grid || !field) return;
	grid.update_docfield_property(
		"today_executed_qty",
		"read_only_depends_on",
		`eval:doc.${field}==1`
	);
	if (!frm.__dpe_qty_lock_bound) {
		frm.__dpe_qty_lock_bound = true;
		$(frm.wrapper).on("grid-row-render.dpe_completed_qty", function (event, grid_row) {
			apply_completed_qty_lock(frm, grid_row);
		});
	}
	refresh_completed_qty_locks(frm);
}
// SUPERVISOR ASSIGNMENTS
async function load_user_assignments(frm) {
	frm.__all_assigned_tasks = [];
	frm.__assigned_projects = [];
	try {
		const todos = await frappe.db.get_list("ToDo", {
			filters: {
				allocated_to: frappe.session.user,
				reference_type: "Task",
				status: "Open",
			},
			fields: ["reference_name"],
			limit: 500,
		});
		const names = [...new Set((todos || []).map((t) => t.reference_name).filter(Boolean))];
		if (!names.length) return;
		const tasks = await frappe.db.get_list("Task", {
			filters: {
				name: ["in", names],
			},
			fields: ["name", "subject", "project"],
			limit: 500,
		});
		frm.__all_assigned_tasks = tasks || [];
		frm.__assigned_projects = [
			...new Set((tasks || []).map((t) => t.project).filter(Boolean)),
		];
	} catch (error) {
		console.error("SUPERVISOR ASSIGNMENT ERROR:", error);
	}
}
// ASSIGNED TASKS FOR PROJECT
async function load_assigned_tasks_for_project(frm) {
	frm.__assigned_tasks = [];
	if (!frm.doc.project) return;
	if (!frm.__all_assigned_tasks?.length) {
		await load_user_assignments(frm);
	}
	frm.__assigned_tasks = (frm.__all_assigned_tasks || [])
		.filter((t) => t.project === frm.doc.project)
		.map((t) => t.name);
	if (frm.doc.sub_area && !frm.__assigned_tasks.includes(frm.doc.sub_area)) {
		await frm.set_value("sub_area", "");
		clear_progress_table(frm);
	}
}
// AUTOMATICALLY SELECT ORIGINAL ACTIVE BOQ
async function auto_select_boq(frm) {
	const project_name = frm.doc.project;
	const load_seq = frm.__dpe_load_seq;
	if (!frm.doc.project) return;
	try {
		let boms = await frappe.db.get_list("BOM", {
			filters: {
				project: frm.doc.project,
				docstatus: 1,
				is_active: 1,
			},
			fields: ["name", "creation", "modified", "is_default"],
			order_by: "is_default desc, creation desc",
			limit_page_length: 100,
		});
		if (!boms?.length && frm.__assigned_tasks?.length) {
			boms = await frappe.db.get_list("BOM", {
				filters: [
					["BOM", "docstatus", "=", 1],
					["BOM", "is_active", "=", 1],
					["BOM", "project", "is", "not set"],
					["BOM Item", "custom_sub_area", "in", frm.__assigned_tasks],
				],
				fields: ["name", "creation", "modified", "is_default"],
				order_by: "is_default desc, creation desc",
				distinct: true,
				limit_page_length: 100,
			});
		}
		if (frm.doc.project !== project_name || frm.__dpe_load_seq !== load_seq) return;
		if (!boms?.length) {
			frm.__current_bom = null;
			if (frm.doc.boq) await frm.set_value("boq", "");
			frappe.show_alert({
				message: "No active submitted complete BOQ exists for this Project.",
				indicator: "orange",
			});
			return;
		}
		frm.__current_bom = boms[0].name;
		// Do not overwrite an already selected
		// Task's rework BOQ on refresh.
		if (!frm.doc.sub_area && frm.doc.boq !== frm.__current_bom) {
			await frm.set_value("boq", frm.__current_bom);
		}
		frm.set_df_property("boq", "read_only", 1);
		frm.set_df_property("project", "read_only", frm.__assigned_projects?.length === 1 ? 1 : 0);
	} catch (error) {
		console.error("BOQ AUTO SELECT ERROR:", error);
		frappe.msgprint("Could not find the complete active project BOQ.");
	}
}
// FIND LATEST TASK VARIATION / REWORK BOQ
async function get_latest_task_boq_revision(frm, complete_boq, task_name) {
	// Legacy originals link to the project through their item tasks.
	const project_name = complete_boq?.project || frm.doc.project;
	if (!task_name || !project_name || !complete_boq?.item) {
		return null;
	}
	const page_size = 100;
	const filters = {
		project: project_name,
		item: complete_boq.item,
		docstatus: 1,
		is_active: 0,
	};
	// Only consider BOQs created after
	// the original complete BOQ.
	if (complete_boq.creation) {
		filters.creation = [">", complete_boq.creation];
	}
	for (let offset = 0; ; offset += page_size) {
		const candidates = await frappe.db.get_list("BOM", {
			fields: ["name"],
			filters: filters,
			order_by: "creation desc",
			limit_start: offset,
			limit_page_length: page_size,
		});
		for (const candidate of candidates || []) {
			const revision = await frappe.db.get_doc("BOM", candidate.name);
			const rows = revision?.items || [];
			const same_company =
				!complete_boq.company || revision.company === complete_boq.company;
			// All components must belong
			// to the selected Task.
			const selected_task_only =
				rows.length > 0 && rows.every((row) => row.custom_sub_area === task_name);
			if (
				Number(revision.docstatus) === 1 &&
				Number(revision.is_active) === 0 &&
				revision.project === project_name &&
				revision.item === complete_boq.item &&
				same_company &&
				selected_task_only
			) {
				return revision;
			}
		}
		if (!candidates || candidates.length < page_size) {
			break;
		}
	}
	return null;
}
// LOAD ORIGINAL OR REWORK BOQ ITEMS
async function load_task_boq_items(frm) {
	clear_progress_table(frm);
	const task_name = frm.doc.sub_area;
	const project_name = frm.doc.project;
	const load_seq = frm.__dpe_load_seq || 0;
	frm.__dpe_load_seq = load_seq;
	if (!task_name || !project_name) return;
	if (frm.__assigned_tasks && !frm.__assigned_tasks.includes(task_name)) {
		frappe.msgprint("This Task is not assigned to the logged-in supervisor.");
		await frm.set_value("sub_area", "");
		return;
	}
	try {
		if (!frm.__current_bom) {
			await auto_select_boq(frm);
		}
		if (
			frm.__dpe_load_seq !== load_seq ||
			frm.doc.sub_area !== task_name ||
			frm.doc.project !== project_name
		)
			return;
		if (!frm.__current_bom) return;
		// Load the original complete BOQ.
		const complete_boq = await frappe.db.get_doc("BOM", frm.__current_bom);
		if (
			(complete_boq.project && complete_boq.project !== project_name) ||
			Number(complete_boq.docstatus) !== 1 ||
			Number(complete_boq.is_active) !== 1
		) {
			frappe.msgprint("The complete project BOQ must be active and submitted.");
			return;
		}
		// Find the latest submitted Task-only BOQ.
		const revision = await get_latest_task_boq_revision(frm, complete_boq, task_name);
		// IMPORTANT:
		// Original job uses complete BOQ.
		// Rework job uses Variation BOQ.
		const work_boq = revision || complete_boq;
		const items = (work_boq.items || []).filter((row) => row.custom_sub_area === task_name);
		if (!items.length) {
			frappe.msgprint("No BOQ items are linked to this Task.");
			return;
		}
		// Prevent old asynchronous requests
		// from changing the selected Task.
		if (
			frm.__dpe_load_seq !== load_seq ||
			frm.doc.sub_area !== task_name ||
			frm.doc.project !== project_name
		) {
			return;
		}
		// IMPORTANT: SET THE ACTUAL WORK BOQ
		frm.__selected_variation_bom = revision ? revision.name : null;
		if (frm.doc.boq !== work_boq.name) {
			frm.__changing_bom_for_task = true;
			try {
				await frm.set_value("boq", work_boq.name);
			} finally {
				frm.__changing_bom_for_task = false;
			}
		}
		if (
			frm.__dpe_load_seq !== load_seq ||
			frm.doc.sub_area !== task_name ||
			frm.doc.project !== project_name
		) {
			return;
		}
		// FETCH HISTORY ONLY FROM SAME BOQ
		const history = await get_previous_progress(frm, work_boq.name, items);
		if (
			frm.__dpe_load_seq !== load_seq ||
			frm.doc.sub_area !== task_name ||
			frm.doc.project !== project_name
		) {
			return;
		}
		const completedField = completed_fieldname(frm);
		// Safety check for history within
		// the same BOQ only.
		const beyond_plan = items.filter(
			(item) => flt(history.quantities[item.name] || 0) > flt(item.qty)
		);
		if (beyond_plan.length) {
			frappe.msgprint({
				title: "Recorded execution exceeds planned quantity",
				indicator: "red",
				message:
					"Previous progress for this same BOQ exceeds the plan: " +
					beyond_plan
						.map(
							(item) =>
								frappe.utils.escape_html(item.item_code) +
								" (executed " +
								flt(history.quantities[item.name]) +
								", planned " +
								flt(item.qty) +
								")"
						)
						.join("; "),
			});
			return;
		}
		// LOAD COMPONENTS INTO ITEM PROGRESS
		items.forEach((item) => {
			const planned = flt(item.qty);
			const previous = flt(history.quantities[item.name] || 0);
			const completed = !!history.completed[item.name];
			const child = frm.add_child("item_progress");
			child.boq_item = item.name;
			child.item = item.item_code;
			child.planned_qty = planned;
			child.previous_executed_qty = previous;
			child.today_executed_qty = 0;
			child.total_executed_qty = previous;
			child.remaining_qty = Math.max(planned - previous, 0);
			child.completion_ = completed
				? 100
				: planned > 0
				? Math.min(100, (previous / planned) * 100)
				: 0;
			if (completedField) {
				child[completedField] = completed ? 1 : 0;
			}
		});
		frm.refresh_field("item_progress");
		snapshot_today_quantities(frm);
		update_daily_progress_summary(frm);
		lock_supervisor_form(frm);
		refresh_completed_qty_locks(frm);
		if (revision) {
			frappe.show_alert({
				message:
					"Rework BOQ: " +
					revision.name +
					". Progress tracked separately from original work.",
				indicator: "blue",
			});
		}
	} catch (error) {
		console.error("TASK / REWORK BOQ LOAD ERROR:", error);
		frappe.msgprint(
			"Could not load Task BOQ or its previous progress. Check permissions and retry."
		);
	}
}
// PREVIOUS PROGRESS - SAME PROJECT + TASK + BOQ
async function get_previous_progress(frm, work_bom_name, items) {
	const result = {
		quantities: {},
		completed: {},
	};
	if (!frm.doc.project || !frm.doc.sub_area || !work_bom_name) {
		return result;
	}
	const response = await frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "Daily Progress Entry",
			filters: {
				project: frm.doc.project,
				sub_area: frm.doc.sub_area,
				// IMPORTANT:
				// Original and variation histories are separate.
				boq: work_bom_name,
				docstatus: 1,
				name: ["!=", frm.doc.name],
				posting_date: ["<=", frm.doc.posting_date],
			},
			fields: ["name", "posting_date", "creation"],
			order_by: "posting_date desc, creation desc",
			limit_page_length: 1,
		},
	});
	const latest = (response.message || [])[0];
	// First day of rework:
	// no previous progress for this new BOQ.
	if (!latest) return result;
	const old = await frappe.call({
		method: "frappe.client.get",
		args: {
			doctype: "Daily Progress Entry",
			name: latest.name,
		},
	});
	const completedField = completed_fieldname(frm);
	const matched = match_previous_boq_rows(items, old.message?.item_progress || []);
	for (const item of items) {
		const row = matched[item.name];
		result.quantities[item.name] = flt(row?.total_executed_qty);
		result.completed[item.name] = !!(completedField && Number(row?.[completedField]) === 1);
	}
	return result;
}
// CALCULATE INDIVIDUAL ITEM PROGRESS
function calculate_progress_row(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (!row) return;
	const planned = flt(row.planned_qty);
	const previous = flt(row.previous_executed_qty);
	let today = flt(row.today_executed_qty);
	if (today < 0) {
		frappe.msgprint("Today Executed Qty cannot be negative.");
		frappe.model.set_value(cdt, cdn, "today_executed_qty", 0);
		return;
	}
	if (previous + today > planned) {
		today = Math.max(planned - previous, 0);
		frappe.msgprint(`Maximum allowed Today Executed Qty is ${today}.`);
		frappe.model.set_value(cdt, cdn, "today_executed_qty", today);
	}
	const total = previous + today;
	frappe.model.set_value(cdt, cdn, "total_executed_qty", total);
	frappe.model.set_value(cdt, cdn, "remaining_qty", Math.max(planned - total, 0));
	frappe.model.set_value(
		cdt,
		cdn,
		"completion_",
		is_completed(frm, row) ? 100 : planned > 0 ? Math.min(100, (total / planned) * 100) : 0
	);
	update_daily_progress_summary(frm);
}
// RECALCULATE ALL ROWS BEFORE SAVE
function calculate_all_rows(frm) {
	(frm.doc.item_progress || []).forEach((row) => {
		const planned = flt(row.planned_qty);
		const previous = flt(row.previous_executed_qty);
		const locked_today =
			is_completed(frm, row) &&
			frm.__dpe_approved_today &&
			Object.prototype.hasOwnProperty.call(frm.__dpe_approved_today, row.name)
				? flt(frm.__dpe_approved_today[row.name])
				: flt(row.today_executed_qty);
		const today = Math.min(Math.max(0, locked_today), Math.max(0, planned - previous));
		row.today_executed_qty = today;
		const total = previous + today;
		row.total_executed_qty = total;
		row.remaining_qty = Math.max(planned - total, 0);
		row.completion_ = is_completed(frm, row)
			? 100
			: planned > 0
			? Math.min(100, (total / planned) * 100)
			: 0;
	});
	frm.refresh_field("item_progress");
}
// DAILY PROGRESS SUMMARY
function update_daily_progress_summary(frm) {
	const totals = {
		planned_qty: 0,
		previous_executed_qty: 0,
		today_executed_qty: 0,
		total_executed_qty: 0,
		remaining_qty: 0,
	};
	let effective_completed_qty = 0;
	(frm.doc.item_progress || []).forEach((row) => {
		const planned = Math.max(0, flt(row.planned_qty));
		const executed = Math.min(planned, Math.max(0, flt(row.total_executed_qty)));
		totals.planned_qty += planned;
		totals.previous_executed_qty += flt(row.previous_executed_qty);
		totals.today_executed_qty += flt(row.today_executed_qty);
		totals.total_executed_qty += flt(row.total_executed_qty);
		totals.remaining_qty += flt(row.remaining_qty);
		effective_completed_qty += is_completed(frm, row) ? planned : executed;
	});
	const percent =
		totals.planned_qty > 0
			? Math.min(100, (effective_completed_qty / totals.planned_qty) * 100)
			: 0;
	Object.entries(totals).forEach(([field, value]) => {
		if (frm.doc[field] !== value) {
			frm.doc[field] = value;
			frm.refresh_field(field);
		}
	});
	const rounded = Math.round(percent * 1000) / 1000;
	if (frm.doc.completion_ !== rounded) {
		frm.doc.completion_ = rounded;
		frm.refresh_field("completion_");
	}
}
// CLEAR ITEM PROGRESS TABLE
function clear_progress_table(frm) {
	frm.__dpe_approved_today = {};
	frm.clear_table("item_progress");
	frm.refresh_field("item_progress");
	reset_summary(frm);
}
// RESET SUMMARY
function reset_summary(frm) {
	[
		"planned_qty",
		"previous_executed_qty",
		"today_executed_qty",
		"total_executed_qty",
		"remaining_qty",
		"completion_",
	].forEach((field) => frm.set_value(field, 0));
}
// LOCK SUPERVISOR FIELDS
function lock_supervisor_form(frm) {
	["posting_date", "supervisor", "boq"].forEach((field) => {
		frm.set_df_property(field, "read_only", 1);
	});
	if (frm.__assigned_projects?.length === 1) {
		frm.set_df_property("project", "read_only", 1);
	}
	[
		"planned_qty",
		"previous_executed_qty",
		"today_executed_qty",
		"total_executed_qty",
		"remaining_qty",
		"completion_",
	].forEach((field) => {
		frm.set_df_property(field, "read_only", 1);
	});
	const grid = frm.fields_dict.item_progress?.grid;
	if (!grid) return;
	[
		"item",
		"planned_qty",
		"previous_executed_qty",
		"total_executed_qty",
		"remaining_qty",
		"completion_",
	].forEach((field) => {
		grid.update_docfield_property(field, "read_only", 1);
	});
	grid.update_docfield_property("today_executed_qty", "read_only", 0);
	const completedField = completed_fieldname(frm);
	if (completedField) {
		grid.update_docfield_property(
			"today_executed_qty",
			"read_only_depends_on",
			`eval:doc.${completedField}==1`
		);
		grid.update_docfield_property(completedField, "read_only", 0);
	}
	grid.cannot_add_rows = true;
	grid.cannot_delete_rows = true;
	grid.refresh();
	refresh_completed_qty_locks(frm);
}
// Match each historical row at most once within the same BOQ.
function match_previous_boq_rows(items, previous_rows) {
	const result = {};
	const used = new Set();
	for (const item of items) {
		const index = previous_rows.findIndex(
			(row, index) =>
				!used.has(index) && row.boq_item === item.name && row.item === item.item_code
		);
		if (index !== -1) {
			used.add(index);
			result[item.name] = previous_rows[index];
		}
	}
	for (const item of items) {
		if (Object.hasOwn(result, item.name)) continue;
		const index = previous_rows.findIndex(
			(row, index) =>
				!used.has(index) &&
				!row.boq_item &&
				row.item === item.item_code &&
				flt(row.planned_qty) === flt(item.qty)
		);
		if (index !== -1) {
			used.add(index);
			result[item.name] = previous_rows[index];
		}
	}
	return result;
}
frappe.ui.form.on("Daily Progress Entry", {
    refresh(frm) {
        if (frm._mark_completed_registered) return;

        // Find the Item Progress child table
        const table = frm.meta.fields.find(df =>
            df.fieldtype === "Table" &&
            (df.fieldname === "item_progress" ||
             df.label === "Item Progress")
        );

        if (!table) return;

        const fields = frm.fields_dict[table.fieldname].grid.docfields;

        // Find fields from their labels
        function get_field(label, fallback) {
            const field = fields.find(df =>
                (df.label || "").toLowerCase() === label.toLowerCase()
            );
            return field ? field.fieldname : fallback;
        }

        const completed = get_field(
            "Mark As Completed", "mark_as_completed"
        );

        const percentage = get_field(
            "Completion Percentage", "completion_percentage"
        );

        const planned = get_field(
            "Planned Qty", "planned_qty"
        );

        const previous = get_field(
            "Previous Executed Qty", "previous_executed_qty"
        );

        const today = get_field(
            "Today Executed Qty", "today_executed_qty"
        );

        // Check required fields
        if (!fields.some(df => df.fieldname === completed) ||
            !fields.some(df => df.fieldname === percentage)) {
            console.warn("Mark Completed: Check child fieldnames");
            return;
        }

        // Register checkbox change event
        frappe.ui.form.on(table.options, completed,
            function(frm, cdt, cdn) {

                const row = locals[cdt][cdn];
                let percent = 0;

                if (Number(row[completed]) === 1) {

                    // Manually completed: always 100%
                    percent = 100;

                } else {

                    // Unchecked: restore actual progress
                    const planned_qty = flt(row[planned]);
                    const executed_qty =
                        flt(row[previous]) + flt(row[today]);

                    if (planned_qty > 0) {
                        percent = Math.min(
                            100,
                            (executed_qty / planned_qty) * 100
                        );
                    }
                }

                percent = Math.round(percent * 1000) / 1000;

                Promise.resolve(
                    frappe.model.set_value(
                        cdt, cdn, percentage, percent
                    )
                ).then(() => {
                    frm.refresh_field(table.fieldname);
                });
            }
        );

        frm._mark_completed_fields = {
            table: table.fieldname,
            completed: completed,
            percentage: percentage
        };

        frm._mark_completed_registered = true;
    },

    validate(frm) {
        // Preserve manual completion percentage before saving
        const config = frm._mark_completed_fields;
        if (!config) return;

        (frm.doc[config.table] || []).forEach(row => {
            if (Number(row[config.completed]) === 1) {
                row[config.percentage] = 100;
            }
        });
    }
});
