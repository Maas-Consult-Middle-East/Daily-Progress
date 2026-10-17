frappe.ui.form.on('Project', {
    setup(frm) {
        if (frm.__daily_progress_listener) return;
        frm.__daily_progress_listener = ({ project }) => {
            if (frm.doc.name === project && !frm.is_dirty()) {
                frm.trigger('refresh');
            }
        };
        frappe.realtime.on('daily_progress_updated', frm.__daily_progress_listener);
    },

    async refresh(frm) {

        if (frm.is_new()) {
            return;
        }

        if (frm.__project_progress_running) {
            return;
        }

        frm.__project_progress_running = true;

        try {

            await calculate_project_daily_progress(frm);

        } catch (error) {

            console.error('PROJECT PROGRESS ERROR:', error);
            frm.fields_dict.custom_task_progress_summary?.$wrapper.html(
                '<div class="text-danger">Unable to load Project progress. Please reload.</div>'
            );

        } finally {

            frm.__project_progress_running = false;

        }
    }

});

async function calculate_project_daily_progress(frm) {
    show_task_progress_loading(frm);
    const { message: summary } = await frappe.call({
        method: 'daily_progress.project_progress.get_project_progress',
        args: { project: frm.doc.name }
    });
    // These totals are persisted by the entry's submit/cancel hooks.
    // Rendering a Project should not mark it as unsaved.
    frm.doc.custom_daily_progress_completion_ = summary.overall_progress;
    frm.refresh_field('custom_daily_progress_completion_');
    if (frm.doc.percent_complete_method === 'Manual') {
        frm.doc.percent_complete = summary.overall_progress;
        frm.refresh_field('percent_complete');
    }
    render_task_progress_summary(frm, summary.rows, summary.overall_progress,
        summary.civil_progress, summary.mechanical_progress);
}

function render_task_progress_summary(
    frm,
    rows,
    overall_progress,
    civil_progress,
    mechanical_progress
) {

    if (
        !frm.fields_dict
            .custom_task_progress_summary
    ) {

        return;

    }


    let civil_count =
        rows.filter(function(row) {
            return row.task_type === 'Civil';
        }).length;


    let mechanical_count =
        rows.filter(function(row) {
            return row.task_type === 'Mechanical';
        }).length;


    let html = `

        <div style="
            padding: 8px 0 20px 0;
        ">


            <!-- ==========================================
                 CIVIL + MECHANICAL SUMMARY
            =========================================== -->

            <div style="
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 15px;
                margin-bottom: 18px;
            ">


                <!-- CIVIL -->

                <div style="
                    border: 1px solid var(--border-color);
                    border-radius: 10px;
                    padding: 18px;
                ">

                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 12px;
                    ">

                        <div>

                            <strong style="
                                font-size: 16px;
                            ">
                                Civil Progress
                            </strong>

                            <div
                                class="text-muted"
                                style="
                                    font-size: 11px;
                                    margin-top: 3px;
                                "
                            >
                                ${civil_count} Sub Area(s)
                            </div>

                        </div>


                        <strong style="
                            font-size: 25px;
                        ">
                            ${civil_progress.toFixed(2)}%
                        </strong>

                    </div>


                    <div style="
                        width: 100%;
                        height: 11px;
                        background: var(--control-bg);
                        border-radius: 20px;
                        overflow: hidden;
                    ">

                        <div style="
                            width: ${civil_progress}%;
                            height: 100%;
                            background: #28a745;
                            border-radius: 20px;
                        ">
                        </div>

                    </div>

                </div>


                <!-- MECHANICAL -->

                <div style="
                    border: 1px solid var(--border-color);
                    border-radius: 10px;
                    padding: 18px;
                ">

                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 12px;
                    ">

                        <div>

                            <strong style="
                                font-size: 16px;
                            ">
                                Mechanical Progress
                            </strong>

                            <div
                                class="text-muted"
                                style="
                                    font-size: 11px;
                                    margin-top: 3px;
                                "
                            >
                                ${mechanical_count} Sub Area(s)
                            </div>

                        </div>


                        <strong style="
                            font-size: 25px;
                        ">
                            ${mechanical_progress.toFixed(2)}%
                        </strong>

                    </div>


                    <div style="
                        width: 100%;
                        height: 11px;
                        background: var(--control-bg);
                        border-radius: 20px;
                        overflow: hidden;
                    ">

                        <div style="
                            width: ${mechanical_progress}%;
                            height: 100%;
                            background: #28a745;
                            border-radius: 20px;
                        ">
                        </div>

                    </div>

                </div>

            </div>


            <!-- ==========================================
                 OVERALL PROJECT PROGRESS
            =========================================== -->

            <div style="
                border: 1px solid var(--border-color);
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 22px;
            ">

                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 14px;
                ">

                    <strong style="
                        font-size: 17px;
                    ">
                        Overall Project Progress
                    </strong>


                    <strong style="
                        font-size: 30px;
                    ">
                        ${overall_progress.toFixed(2)}%
                    </strong>

                </div>


                <div style="
                    width: 100%;
                    height: 14px;
                    background: var(--control-bg);
                    border-radius: 20px;
                    overflow: hidden;
                ">

                    <div style="
                        width: ${overall_progress}%;
                        height: 100%;
                        background: #28a745;
                        border-radius: 20px;
                    ">
                    </div>

                </div>

            </div>


            <!-- ==========================================
                 TASK SUMMARY
            =========================================== -->

            <div style="
                font-size: 16px;
                font-weight: 600;
                margin-bottom: 10px;
            ">
                Task Progress Summary
            </div>


            <div style="
                border: 1px solid var(--border-color);
                border-radius: 10px;
                overflow: hidden;
            ">

                <table
                    class="table"
                    style="
                        width: 100%;
                        margin: 0;
                    "
                >

                    <thead>

                        <tr>

                            <th style="
                                width: 40%;
                            ">
                                Task
                            </th>

                            <th style="
                                width: 40%;
                            ">
                                Progress
                            </th>

                            <th style="
                                width: 20%;
                                text-align: center;
                            ">
                                Status
                            </th>

                        </tr>

                    </thead>


                    <tbody>

    `;


    rows.forEach(
        function(row) {

            let progress =
                flt(
                    row.progress
                );


            let status =
                'Not Started';


            if (progress >= 100) {

                status =
                    'Completed';

            }

            else if (progress > 0) {

                status =
                    'In Progress';

            }


            html += `

                <tr>

                    <td>

                        <strong>

                            ${
                                frappe.utils.escape_html(
                                    row.subject ||
                                    row.task
                                )
                            }

                        </strong>


                        <div
                            class="text-muted"
                            style="
                                font-size: 11px;
                                margin-top: 3px;
                            "
                        >

                            ${
                                frappe.utils.escape_html(
                                    row.task
                                )
                            }

                            ${
                                row.task_type
                                ? ' • ' +
                                  frappe.utils.escape_html(
                                      row.task_type
                                  )
                                : ''
                            }

                        </div>

                    </td>


                    <td>

                        <div style="
                            display: flex;
                            align-items: center;
                            gap: 12px;
                        ">

                            <div style="
                                flex: 1;
                                height: 10px;
                                background:
                                    var(--control-bg);
                                border-radius: 20px;
                                overflow: hidden;
                            ">

                                <div style="
                                    width: ${progress}%;
                                    height: 100%;
                                    background: #28a745;
                                    border-radius: 20px;
                                ">
                                </div>

                            </div>


                            <strong style="
                                min-width: 70px;
                                text-align: right;
                            ">

                                ${progress.toFixed(2)}%

                            </strong>

                        </div>

                    </td>


                    <td style="
                        text-align: center;
                    ">

                        ${status}

                    </td>

                </tr>

            `;

        }
    );


    html += `

                    </tbody>

                </table>

            </div>

        </div>

    `;


    frm.fields_dict
        .custom_task_progress_summary
        .$wrapper
        .html(html);

}

function show_task_progress_loading(frm) {

    if (
        !frm.fields_dict
            .custom_task_progress_summary
    ) {

        return;

    }


    frm.fields_dict
        .custom_task_progress_summary
        .$wrapper
        .html(`

            <div
                class="text-muted"
                style="
                    padding: 15px 0;
                "
            >

                Loading Project progress...

            </div>

        `);

}