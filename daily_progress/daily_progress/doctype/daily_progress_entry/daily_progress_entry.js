frappe.ui.form.on('Daily Progress Entry', {
    setup(frm) {

        frm.set_query('project', function () {
            let projects =
                frm.__assigned_projects || [];
            if (!projects.length) {
                return {
                    filters: {
                        name: [
                            'in',
                            ['__none__']
                        ]
                    }
                };
            }
            return {
                filters: {
                    name: [
                        'in',
                        projects
                    ]
                }
            };

        });


        frm.set_query('sub_area', function () {

            if (!frm.doc.project) {

                return {
                    filters: {
                        name: [
                            'in',
                            ['__none__']
                        ]
                    }
                };
            }


            let assigned_tasks =
                frm.__assigned_tasks || [];
            if (!assigned_tasks.length) {
                return {
                    filters: {
                        name: [
                            'in',
                            ['__none__']
                        ]
                    }
                };
            }
            return {
                filters: {

                    project:
                        frm.doc.project,

                    name: [
                        'in',
                        assigned_tasks
                    ]

                }
            };

        });

        frm.set_query('boq', function () {

            if (!frm.doc.project) {

                return {
                    filters: {
                        name: [
                            'in',
                            ['__none__']
                        ]
                    }
                };
            }


            if (!frm.__current_bom) {

                return {
                    filters: {
                        name: [
                            'in',
                            ['__none__']
                        ]
                    }
                };
            }
            return {
                filters: {

                    name:
                        frm.__current_bom,

                    docstatus:
                        1

                }
            };

        });

    },
    async refresh(frm) {

        if (frm.is_new()) {
            if (!frm.doc.posting_date) {

                await frm.set_value(
                    'posting_date',
                    frappe.datetime.get_today()
                );
            }
            if (!frm.doc.supervisor) {

                await frm.set_value(
                    'supervisor',
                    frappe.session.user
                );
            }
            await load_user_assignments(frm);
            if (
                !frm.doc.project &&
                frm.__assigned_projects &&
                frm.__assigned_projects.length === 1
            ) {

                await frm.set_value(
                    'project',
                    frm.__assigned_projects[0]
                );
            }
            if (frm.doc.project) {

                await load_assigned_tasks_for_project(frm);

                await auto_select_boq(frm);
            }

        }


        lock_supervisor_form(frm);

    },
    async project(frm) {

        frm.__current_bom = null;


        await frm.set_value(
            'boq',
            ''
        );


        await frm.set_value(
            'sub_area',
            ''
        );


        clear_progress_table(frm);


        if (!frm.doc.project) {
            return;
        }


        await load_assigned_tasks_for_project(frm);


        await auto_select_boq(frm);


        lock_supervisor_form(frm);

    },
    async boq(frm) {

        await frm.set_value(
            'sub_area',
            ''
        );


        clear_progress_table(frm);


        lock_supervisor_form(frm);

    },
    async sub_area(frm) {

        await load_task_boq_items(frm);


        lock_supervisor_form(frm);

    },
    validate(frm) {

        calculate_all_rows(frm);


        update_daily_progress_summary(frm);

    }

});
frappe.ui.form.on('Daily Progress Item', {

    today_executed_qty(frm, cdt, cdn) {

        calculate_progress_row(
            frm,
            cdt,
            cdn
        );

    }

});
async function load_user_assignments(frm) {

    frm.__all_assigned_tasks = [];

    frm.__assigned_projects = [];


    try {
        let todos =
            await frappe.db.get_list(
                'ToDo',
                {
                    filters: {

                        allocated_to:
                            frappe.session.user,

                        reference_type:
                            'Task',

                        status:
                            'Open'

                    },

                    fields: [
                        'reference_name'
                    ],

                    limit: 500
                }
            );


        let task_names =
            (todos || [])
                .map(function (row) {
                    return row.reference_name;
                })
                .filter(Boolean);


        if (!task_names.length) {

            frm.__all_assigned_tasks = [];

            frm.__assigned_projects = [];

            return;
        }
        let tasks =
            await frappe.db.get_list(
                'Task',
                {
                    filters: {

                        name: [
                            'in',
                            task_names
                        ]

                    },

                    fields: [
                        'name',
                        'subject',
                        'project'
                    ],

                    limit: 500
                }
            );


        frm.__all_assigned_tasks =
            tasks || [];
        let projects =
            (tasks || [])
                .map(function (row) {
                    return row.project;
                })
                .filter(Boolean);


        frm.__assigned_projects =
            [...new Set(projects)];


        console.log(
            'Assigned Projects:',
            frm.__assigned_projects
        );


        console.log(
            'Assigned Tasks:',
            frm.__all_assigned_tasks
        );

    }

    catch (error) {

        console.error(
            'SUPERVISOR ASSIGNMENT ERROR:',
            error
        );


        frm.__all_assigned_tasks = [];

        frm.__assigned_projects = [];
    }

}
async function load_assigned_tasks_for_project(frm) {

    frm.__assigned_tasks = [];


    if (!frm.doc.project) {
        return;
    }


    if (
        !frm.__all_assigned_tasks ||
        !frm.__all_assigned_tasks.length
    ) {

        await load_user_assignments(frm);

    }


    frm.__assigned_tasks =
        (frm.__all_assigned_tasks || [])

            .filter(function (row) {

                return (
                    row.project ===
                    frm.doc.project
                );

            })

            .map(function (row) {
                return row.name;
            });


    console.log(
        'Available Tasks:',
        frm.__assigned_tasks
    );
    if (
        frm.doc.sub_area &&
        !frm.__assigned_tasks.includes(
            frm.doc.sub_area
        )
    ) {

        await frm.set_value(
            'sub_area',
            ''
        );


        clear_progress_table(frm);

    }

}

async function auto_select_boq(frm) {

    if (!frm.doc.project) {
        return;
    }


    try {
        let boms =
            await frappe.db.get_list(
                'BOM',
                {
                    filters: {

                        project:
                            frm.doc.project,

                        docstatus:
                            1

                    },

                    fields: [
                        'name',
                        'modified',
                        'creation',
                        'is_default'
                    ],

                    order_by:
                        'creation desc, modified desc',

                    limit: 100
                }
            );
        // Older BOQs may only link to the project through their item sub-areas.
        // Only consider unlinked BOQs containing a task assigned in this project.
        if (!boms?.length && frm.__assigned_tasks?.length) {
            boms = await frappe.db.get_list('BOM', {
                filters: [
                    ['BOM', 'docstatus', '=', 1],
                    ['BOM', 'project', 'is', 'not set'],
                    ['BOM Item', 'custom_sub_area', 'in', frm.__assigned_tasks]
                ],
                fields: ['name', 'modified', 'creation', 'is_default'],
                order_by: 'creation desc, modified desc',
                distinct: true,
                limit: 100
            });
        }
        if (!boms || !boms.length) {

            frm.__current_bom = null;


            if (frm.doc.boq) {

                await frm.set_value(
                    'boq',
                    ''
                );
            }


            frm.set_df_property(
                'boq',
                'read_only',
                1
            );


            frappe.show_alert({
                message:
                    'No submitted BOQ is available for this Project.',
                indicator:
                    'orange'
            });


            return;
        }

        let current_bom =
            boms[0].name;


        frm.__current_bom =
            current_bom;
        if (
            frm.doc.boq !==
            current_bom
        ) {

            await frm.set_value(
                'boq',
                current_bom
            );
        }

        frm.set_df_property(
            'boq',
            'read_only',
            1
        );
        if (
            frm.__assigned_projects &&
            frm.__assigned_projects.length === 1
        ) {

            frm.set_df_property(
                'project',
                'read_only',
                1
            );

        }

        else {

            frm.set_df_property(
                'project',
                'read_only',
                0
            );

        }


        console.log(
            'Submitted BOQs:',
            boms
        );


        console.log(
            'Current BOQ:',
            current_bom
        );

    }

    catch (error) {

        console.error(
            'BOQ AUTO SELECT ERROR:',
            error
        );

    }

}
async function load_task_boq_items(frm) {
    frm.clear_table(
        'item_progress'
    );


    frm.refresh_field(
        'item_progress'
    );


    reset_summary(frm);

    if (
        !frm.doc.project ||
        !frm.doc.boq ||
        !frm.doc.sub_area
    ) {

        return;

    }
    if (
        frm.__assigned_tasks &&
        !frm.__assigned_tasks.includes(
            frm.doc.sub_area
        )
    ) {

        frappe.msgprint(
            'This Task is not assigned to the logged-in supervisor.'
        );


        await frm.set_value(
            'sub_area',
            ''
        );


        return;

    }
    let bom_response;


    try {

        bom_response =
            await frappe.call({
                method:
                    'frappe.client.get',

                args: {
                    doctype:
                        'BOM',

                    name:
                        frm.doc.boq
                }
            });

    }

    catch (error) {

        console.error(
            'BOQ FETCH ERROR:',
            error
        );


        frappe.msgprint(
            'Unable to load the current BOQ.'
        );


        return;

    }


    let bom =
        bom_response.message;


    if (
        !bom ||
        !bom.items
    ) {

        frappe.msgprint(
            'No BOQ items found.'
        );


        return;

    }
    let task_items =
        bom.items.filter(
            function (item) {

                return (
                    item.custom_sub_area ===
                    frm.doc.sub_area
                );

            }
        );


    if (!task_items.length) {

        frappe.msgprint(
            'No BOQ items are linked to this Task.'
        );


        return;

    }

    let previous_map = {};


    try {

        previous_map =
            await get_previous_progress(
                frm, task_items
            );

    }

    catch (error) {

        console.error(
            'PREVIOUS PROGRESS ERROR:',
            error
        );


        previous_map = {};

    }


    console.log(
        'Previous Progress:',
        previous_map
    );

    task_items.forEach(
        function (item) {

            let planned =
                flt(
                    item.qty
                );

            let previous =
                flt(
                    previous_map[
                        item.name
                    ] || 0
                );

            previous =
                Math.min(
                    previous,
                    planned
                );

            let today = 0;
 
            let total =
                previous + today;

            let remaining =
                Math.max(
                    planned - total,
                    0
                );

            let completion =
                planned > 0
                    ? (
                        total /
                        planned
                    ) * 100
                    : 0;


            completion =
                Math.min(
                    completion,
                    100
                );

            let child =
                frm.add_child(
                    'item_progress'
                );


            child.boq_item = item.name;
            child.item =
                item.item_code;


            child.planned_qty =
                planned;


            child.previous_executed_qty =
                previous;


            child.today_executed_qty =
                0;


            child.total_executed_qty =
                total;


            child.remaining_qty =
                remaining;


            child.completion_ =
                completion;

        }
    );


    frm.refresh_field(
        'item_progress'
    );


    update_daily_progress_summary(frm);


    lock_supervisor_form(frm);

}

async function get_previous_progress(frm, task_items) {

    let previous_map = {};


    if (
        !frm.doc.project ||
        !frm.doc.sub_area
    ) {

        return previous_map;

    }


    let previous_response =
        await frappe.call({
            method:
                'frappe.client.get_list',

            args: {

                doctype:
                    'Daily Progress Entry',

                filters: {

                    project:
                        frm.doc.project,

                    sub_area:
                        frm.doc.sub_area,

                    docstatus: 1,
                    name: ['!=', frm.doc.name],
                    posting_date: ['<=', frm.doc.posting_date]

                },

                fields: [
                    'name',
                    'posting_date',
                    'creation'
                ],

                order_by:
                    'posting_date desc, creation desc',

                limit_page_length:
                    1

            }
        });


    let previous_entries =
        previous_response.message || [];


    if (!previous_entries.length) {

        return previous_map;

    }


    let previous_name =
        previous_entries[0].name;


    let previous_doc_response =
        await frappe.call({
            method:
                'frappe.client.get',

            args: {
                doctype:
                    'Daily Progress Entry',

                name:
                    previous_name
            }
        });


    let previous_doc =
        previous_doc_response.message;


    previous_map = match_previous_boq_rows(
        task_items,
        previous_doc?.item_progress || [],
        previous_doc?.boq === frm.doc.boq
    );

    console.log(
        'Previous DPE:',
        previous_name
    );


    return previous_map;

}

// Match each previous row at most once. Item codes alone are not row identities.
function match_previous_boq_rows(items, previous_rows, same_boq) {
    const result = {};
    const used = new Set();
    // Reserve exact BOQ row matches before attempting legacy/revision matching.
    for (const item of items) {
        const index = previous_rows.findIndex((row, index) =>
            !used.has(index) && row.boq_item === item.name && row.item === item.item_code
        );
        if (index !== -1) {
            used.add(index);
            result[item.name] = flt(previous_rows[index].total_executed_qty);
        }
    }
    for (const item of items) {
        if (Object.hasOwn(result, item.name)) continue;
        // Older entries have no source row ID; revisions have new source IDs.
        // Match an equivalent quantity line, consuming it only once.
        const index = previous_rows.findIndex((row, index) =>
            !used.has(index) && (!same_boq || !row.boq_item) &&
            row.item === item.item_code && flt(row.planned_qty) === flt(item.qty)
        );
        result[item.name] = index === -1 ? 0 : flt(previous_rows[index].total_executed_qty);
        if (index !== -1) used.add(index);
    }
    return result;
}

function calculate_progress_row(
    frm,
    cdt,
    cdn
) {

    let row =
        locals[cdt][cdn];


    let planned =
        flt(
            row.planned_qty
        );


    let previous =
        flt(
            row.previous_executed_qty
        );


    let today =
        flt(
            row.today_executed_qty
        );

    if (today < 0) {

        frappe.msgprint(
            'Today Executed Qty cannot be negative.'
        );


        frappe.model.set_value(
            cdt,
            cdn,
            'today_executed_qty',
            0
        );


        return;

    }


    let total =
        previous + today;

    if (total > planned) {

        let allowed =
            Math.max(
                planned - previous,
                0
            );


        frappe.msgprint(
            `Maximum allowed Today Executed Qty is ${allowed}.`
        );


        today =
            allowed;


        total =
            previous + today;


        frappe.model.set_value(
            cdt,
            cdn,
            'today_executed_qty',
            allowed
        );

    }


    let remaining =
        Math.max(
            planned - total,
            0
        );


    let completion =
        planned > 0
            ? (
                total /
                planned
            ) * 100
            : 0;


    frappe.model.set_value(
        cdt,
        cdn,
        'total_executed_qty',
        total
    );


    frappe.model.set_value(
        cdt,
        cdn,
        'remaining_qty',
        remaining
    );


    frappe.model.set_value(
        cdt,
        cdn,
        'completion_',
        Math.min(
            completion,
            100
        )
    );


    update_daily_progress_summary(frm);

}

function calculate_all_rows(frm) {

    (
        frm.doc.item_progress ||
        []
    ).forEach(
        function (row) {

            let planned =
                flt(
                    row.planned_qty
                );


            let previous =
                flt(
                    row.previous_executed_qty
                );


            let today =
                flt(
                    row.today_executed_qty
                );


            if (today < 0) {

                today = 0;

                row.today_executed_qty =
                    0;

            }


            let allowed =
                Math.max(
                    planned - previous,
                    0
                );


            if (today > allowed) {

                today =
                    allowed;


                row.today_executed_qty =
                    allowed;

            }


            let total =
                previous + today;


            row.total_executed_qty =
                total;


            row.remaining_qty =
                Math.max(
                    planned - total,
                    0
                );


            row.completion_ =
                planned > 0
                    ? Math.min(
                        (
                            total /
                            planned
                        ) * 100,
                        100
                    )
                    : 0;

        }
    );


    frm.refresh_field(
        'item_progress'
    );

}


function update_daily_progress_summary(frm) {

    let planned = 0;

    let previous = 0;

    let today = 0;

    let total = 0;

    let remaining = 0;


    (
        frm.doc.item_progress ||
        []
    ).forEach(
        function (row) {

            planned +=
                flt(
                    row.planned_qty
                );


            previous +=
                flt(
                    row.previous_executed_qty
                );


            today +=
                flt(
                    row.today_executed_qty
                );


            total +=
                flt(
                    row.total_executed_qty
                );


            remaining +=
                flt(
                    row.remaining_qty
                );

        }
    );


    let completion =
        planned > 0
            ? (
                total /
                planned
            ) * 100
            : 0;


    frm.set_value(
        'planned_qty',
        planned
    );


    frm.set_value(
        'previous_executed_qty',
        previous
    );


    frm.set_value(
        'today_executed_qty',
        today
    );


    frm.set_value(
        'total_executed_qty',
        total
    );


    frm.set_value(
        'remaining_qty',
        remaining
    );


    frm.set_value(
        'completion_',
        Math.min(
            completion,
            100
        )
    );

}


function clear_progress_table(frm) {

    frm.clear_table(
        'item_progress'
    );


    frm.refresh_field(
        'item_progress'
    );


    reset_summary(frm);

}

function reset_summary(frm) {

    frm.set_value(
        'planned_qty',
        0
    );


    frm.set_value(
        'previous_executed_qty',
        0
    );


    frm.set_value(
        'today_executed_qty',
        0
    );


    frm.set_value(
        'total_executed_qty',
        0
    );


    frm.set_value(
        'remaining_qty',
        0
    );


    frm.set_value(
        'completion_',
        0
    );

}

function lock_supervisor_form(frm) {

    frm.set_df_property(
        'posting_date',
        'read_only',
        1
    );

    frm.set_df_property(
        'supervisor',
        'read_only',
        1
    );

    frm.set_df_property(
        'boq',
        'read_only',
        1
    );

    if (
        frm.__assigned_projects &&
        frm.__assigned_projects.length === 1
    ) {

        frm.set_df_property(
            'project',
            'read_only',
            1
        );

    }

    [
        'planned_qty',
        'previous_executed_qty',
        'today_executed_qty',
        'total_executed_qty',
        'remaining_qty',
        'completion_'
    ].forEach(
        function (fieldname) {

            frm.set_df_property(
                fieldname,
                'read_only',
                1
            );

        }
    );

    if (
        !frm.fields_dict.item_progress ||
        !frm.fields_dict.item_progress.grid
    ) {

        return;

    }


    let grid =
        frm.fields_dict
            .item_progress
            .grid;


    grid.update_docfield_property(
        'item',
        'read_only',
        1
    );


    grid.update_docfield_property(
        'planned_qty',
        'read_only',
        1
    );


    grid.update_docfield_property(
        'previous_executed_qty',
        'read_only',
        1
    );



    grid.update_docfield_property(
        'today_executed_qty',
        'read_only',
        0
    );


    grid.update_docfield_property(
        'total_executed_qty',
        'read_only',
        1
    );


    grid.update_docfield_property(
        'remaining_qty',
        'read_only',
        1
    );


    grid.update_docfield_property(
        'completion_',
        'read_only',
        1
    );


    grid.cannot_add_rows =
        true;


    grid.cannot_delete_rows =
        true;


    grid.refresh();

}