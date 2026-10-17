# Copyright (c) 2026, salmandayatt and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class DailyProgressEntry(Document):
	def on_submit(self):
		from daily_progress.project_progress import sync_project_progress

		sync_project_progress(self.project)

	def on_cancel(self):
		from daily_progress.project_progress import sync_project_progress

		sync_project_progress(self.project)
