// TASK - CREATE VARIATION ORDER
// All projects. No additional custom fields.
// Creates a NEW, INACTIVE BOQ with ONLY the selected Task's components.

frappe.ui.form.on("Task", {
    custom_create_variation_order(frm) {
        if (frm.is_new()) {
            frappe.msgprint("Please save the Task first.");
            return;
        }

        if (!frm.doc.project) {
            frappe.msgprint("Please assign a Project to this Task first.");
            return;
        }

        frappe.prompt(
            [{
                fieldname: "source_boq",
                label: "Source BOQ",
                fieldtype: "Link",
                options: "BOM",
                reqd: 1
            }],
            async function (values) {
                try {
                    // Fetch the full BOQ chosen by the user.
                    const source = await frappe.db.get_doc("BOM", values.source_boq);

                    if (source.project && source.project !== frm.doc.project) {
                        frappe.msgprint("The selected BOQ belongs to another Project.");
                        return;
                    }

                    // The source must be the original active, submitted BOQ.
                    if (Number(source.docstatus) !== 1 || Number(source.is_active) !== 1) {
                        frappe.msgprint("Please select an active, submitted project BOQ.");
                        return;
                    }

                    if (!source.item) {
                        frappe.msgprint("The selected BOQ has no Item to Manufacture.");
                        return;
                    }

                    // Find ONLY the current Task's rows.
                    const task_items = (source.items || []).filter(
                        row => row.custom_sub_area === frm.doc.name
                    );

                    if (!task_items.length) {
                        frappe.msgprint("No BOQ items are linked to this Task in the selected BOQ.");
                        return;
                    }

                    await new Promise(resolve => {
                        frappe.model.with_doctype("BOM", resolve);
                    });

                    // Copy the source to a new draft (do not modify the source).
                    const variation = frappe.model.copy_doc(source);

                    variation.item = source.item;
                    variation.project = frm.doc.project;

                    // Crucial: keep ONLY the selected Task's components.
                    variation.items = (variation.items || []).filter(
                        row => row.custom_sub_area === frm.doc.name
                    );

                    variation.items.forEach((row, index) => {
                        row.idx = index + 1;
                    });

                    // Crucial: do NOT let this separate BOQ replace the active
                    // complete project BOQ used by Daily Progress Entry.
                    variation.is_active = 0;
                    variation.is_default = 0;

                    frappe.set_route("Form", "BOM", variation.name);

                } catch (error) {
                    console.error("Create Variation Order error:", error);
                    frappe.msgprint(
                        "Could not create the BOQ. Please check the selected BOQ and your permissions."
                    );
                }
            },
            "Select Source BOQ",
            "Create Variation"
        );
    }
});