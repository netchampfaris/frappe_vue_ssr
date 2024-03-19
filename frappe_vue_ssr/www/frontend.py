# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and Contributors

from __future__ import unicode_literals
import frappe


def get_context():
    html = get_html_from_vue()
    frappe.response.content = html

def get_html_from_vue():
    # get html from vue
    return run_script('node build.js')
