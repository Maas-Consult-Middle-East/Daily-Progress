frappe.ui.form.on('BOM', {

    refresh(frm) {

        update_task_planned_summary(frm);

    },

    items_on_form_rendered(frm) {

        update_task_planned_summary(frm);

    }

});


frappe.ui.form.on('BOM Item', {


    custom_sub_area(frm, cdt, cdn) {

        update_task_planned_summary(frm);

    },



    qty(frm, cdt, cdn) {

        update_task_planned_summary(frm);

    },


    uom(frm, cdt, cdn) {

        update_task_planned_summary(frm);

    },



    items_add(frm, cdt, cdn) {

        update_task_planned_summary(frm);

    },

    items_remove(frm, cdt, cdn) {

        update_task_planned_summary(frm);

    }

});


async function update_task_planned_summary(frm) {

    if (
        !frm.fields_dict.custom_task_planned_summary
    ) {
        return;
    }


    let items =
        frm.doc.items || [];


    if (!items.length) {

        frm.fields_dict
            .custom_task_planned_summary
            .$wrapper
            .html(`
                <div class="text-muted"
                     style="padding: 10px 0;">
                    No Task planned quantities available.
                </div>
            `);

        return;
    }

    let task_ids =
        [
            ...new Set(
                items
                    .map(row => row.custom_sub_area)
                    .filter(Boolean)
            )
        ];


    if (!task_ids.length) {

        frm.fields_dict
            .custom_task_planned_summary
            .$wrapper
            .html(`
                <div class="text-muted"
                     style="padding: 10px 0;">
                    No Tasks are linked to BOQ items.
                </div>
            `);

        return;
    }


    let task_rows = [];

    try {

        task_rows =
            await frappe.db.get_list(
                'Task',
                {
                    filters: {
                        name: [
                            'in',
                            task_ids
                        ]
                    },

                    fields: [
                        'name',
                        'subject'
                    ],

                    limit: 500
                }
            );

    } catch (error) {

        console.error(
            'TASK SUMMARY FETCH ERROR:',
            error
        );

    }


    let task_name_map = {};


    (task_rows || []).forEach(function (task) {

        task_name_map[task.name] =
            task.subject || task.name;

    });


    let summary = {};


    items.forEach(function (row) {

        if (!row.custom_sub_area) {
            return;
        }


        let task_id =
            row.custom_sub_area;


        let task_name =
            task_name_map[task_id] ||
            task_id;


        let uom =
            row.uom ||
            row.stock_uom ||
            '';


        let qty =
            flt(row.qty);


        if (!summary[task_id]) {

            summary[task_id] = {

                task:
                    task_name,

                quantities: {}

            };

        }


        if (!summary[task_id].quantities[uom]) {

            summary[task_id]
                .quantities[uom] = 0;

        }


        summary[task_id]
            .quantities[uom] += qty;

    });

    let html = `

        <div style="
            margin: 12px 0 18px 0;
            border: 1px solid var(--border-color);
            border-radius: 10px;
            overflow: hidden;
        ">

            <div style="
                padding: 12px 15px;
                font-size: 15px;
                font-weight: 600;
                background: var(--control-bg);
            ">
                Task Planned Quantity Summary
            </div>


            <table class="table"
                   style="
                       margin: 0;
                       width: 100%;
                   ">

                <thead>

                    <tr>

                        <th style="width: 55%;">
                            Task
                        </th>

                        <th style="
                            width: 45%;
                            text-align: right;
                        ">
                            Planned Quantity
                        </th>

                    </tr>

                </thead>

                <tbody>

    `;



    Object.values(summary)
        .forEach(function (row) {


            let qty_text =
                Object.entries(
                    row.quantities
                )

                .map(
                    ([uom, qty]) => {

                        let formatted_qty =
                            format_number(qty);


                        return uom
                            ? `${formatted_qty} ${frappe.utils.escape_html(uom)}`
                            : `${formatted_qty}`;

                    }
                )

                .join(' + ');


            html += `

                <tr>

                    <td>

                        <strong>

                            ${
                                frappe.utils.escape_html(
                                    row.task
                                )
                            }

                        </strong>

                    </td>


                    <td style="
                        text-align: right;
                        font-weight: 600;
                    ">

                        ${qty_text}

                    </td>

                </tr>

            `;

        });



    html += `

                </tbody>

            </table>

        </div>

    `;



    frm.fields_dict
        .custom_task_planned_summary
        .$wrapper
        .html(html);

}

function format_number(value) {

    let number =
        flt(value);


    if (
        Number.isInteger(number)
    ) {

        return number.toString();

    }


    return number
        .toFixed(2)
        .replace(/\.?0+$/, '');

}