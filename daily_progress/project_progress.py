"""Project progress from the latest submitted entry for each BOQ sub-area."""

import frappe
from frappe.utils import flt


def _clamp(value):
    return min(max(flt(value), 0), 100)


def calculate_project_progress(project):
    task_fields = ['name', 'subject', 'status', 'type']
    has_custom_task_type = frappe.get_meta('Task').has_field('custom_task_type')
    if has_custom_task_type:
        task_fields.append('custom_task_type')
    tasks = frappe.get_all('Task', filters={'project': project}, fields=task_fields,
                           order_by='creation asc')
    task_names = [task.name for task in tasks]
    boms = frappe.get_all('BOM', filters={'project': project, 'docstatus': 1}, pluck='name')
    if task_names:
        # Legacy BOQs can link to a project only through their item sub-areas.
        boms += frappe.get_all('BOM', filters=[
            ['BOM', 'docstatus', '=', 1],
            ['BOM', 'project', 'is', 'not set'],
            ['BOM Item', 'custom_sub_area', 'in', task_names],
        ], pluck='name', distinct=True)
    linked_tasks = set()
    if boms:
        linked_tasks = set(frappe.get_all('BOM Item', filters={
            'parent': ['in', list(set(boms))], 'parenttype': 'BOM',
        }, pluck='custom_sub_area'))

    entries = frappe.get_all('Daily Progress Entry',
        filters={'project': project, 'docstatus': 1},
        fields=['name', 'sub_area', 'completion_', 'posting_date'],
        order_by='posting_date desc, creation desc')
    latest = {}
    for entry in entries:
        latest.setdefault(entry.sub_area, entry)
    rows = []
    for task in tasks:
        if task.name not in linked_tasks:
            continue
        entry = latest.get(task.name)
        rows.append({
            'task': task.name, 'subject': task.subject, 'task_status': task.status,
            'task_type': ((task.get('custom_task_type') or '').strip()
                          or (task.get('type') or '').strip()),
            'progress': _clamp(entry.completion_) if entry else 0,
            'dpe': entry.name if entry else None,
            'posting_date': entry.posting_date if entry else None,
        })

    def average(selected):
        return sum(row['progress'] for row in selected) / len(selected) if selected else 0

    return {
        'rows': rows, 'overall_progress': average(rows),
        'civil_progress': average([row for row in rows if row['task_type'] == 'Civil']),
        'mechanical_progress': average([row for row in rows if row['task_type'] == 'Mechanical']),
        'has_task_type': True,
    }


@frappe.whitelist()
def get_project_progress(project):
    frappe.get_doc('Project', project).check_permission('read')
    return calculate_project_progress(project)


def sync_project_progress(project):
    if not project:
        return
    summary = calculate_project_progress(project)
    doc = frappe.get_doc('Project', project)
    values = {'custom_daily_progress_completion_': summary['overall_progress']}
    # ERPNext owns percent_complete when an automatic task-based method is selected.
    if doc.percent_complete_method == 'Manual':
        values['percent_complete'] = summary['overall_progress']
    doc.db_set(values, notify=True)
    frappe.publish_realtime('daily_progress_updated', {'project': project},
                           doctype='Project', docname=project, after_commit=True)
