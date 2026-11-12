"""Composio Marketplace & FastMCP Industrial Catalog Router.

Integrates:
1. Real composio.dev Connector Catalog (30+ SaaS, CRM, DevOps, Productivity & Finance connectors).
2. Live Composio Backend API sync (with in-memory TTL caching and connection initiation).
3. Industrial FastMCP Servers (SAP S/4HANA, Siemens Xcelerator, Rockwell FactoryTalk, Dassault 3DEXPERIENCE, PTC Windchill, Oracle SCM).
"""
import datetime
import json
import os
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
import httpx
from pydantic import BaseModel

from . import connectors
from .auth import Ctx, current, require
from .sqlite_adapter import get_connection

try:
    from .composio_toolkits_catalog import (
        COMPOSIO_TOOLKITS_1640,
        get_composio_toolkit_by_key,
        get_composio_toolkits,
        get_toolkit_categories,
    )
except ImportError:
    COMPOSIO_TOOLKITS_1640 = None
    get_composio_toolkit_by_key = None
    get_composio_toolkits = None
    get_toolkit_categories = None

router = APIRouter()

# ---------------------------------------------------------------------------
# Curated Composio.dev Catalog (30+ enterprise SaaS, DevOps, CRM, Finance)
# ---------------------------------------------------------------------------
COMPOSIO_CATALOG: list[dict[str, Any]] = [
    {
        "key": "slack",
        "name": "Slack",
        "category": "Communication",
        "provider": "composio",
        "composio_app": "SLACK",
        "description": "Send production alerts, approval notifications, and shift summaries to Slack channels.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/slack",
        "default_action": "composio_slack_send_message",
        "modules": ["Messaging", "Channels", "Webhooks"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_slack_send_message",
                "action": "SLACK_SEND_MESSAGE",
                "module": "Messaging",
                "description": "Post a message or alert to a Slack channel via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["channel", "text"],
                    "properties": {
                        "channel": {"type": "string", "description": "Slack channel name or ID (e.g. #ops-alerts)"},
                        "text": {"type": "string", "description": "Message body to post"},
                    },
                },
                "connector": "composio",
                "secret_ref": "slack:composio_slack_send_message",
                "risk": "low",
            }
        ],
    },
    {
        "key": "github",
        "name": "GitHub",
        "category": "Engineering",
        "provider": "composio",
        "composio_app": "GITHUB",
        "description": "Track engineering change orders (ECOs), open issues, and link CAD revision PRs.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/github",
        "default_action": "composio_github_create_issue",
        "modules": ["Issues", "Pull Requests", "Repositories"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_github_create_issue",
                "action": "GITHUB_CREATE_ISSUE",
                "module": "Issues",
                "description": "Create a GitHub issue for an engineering or quality deviation via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["repo", "title"],
                    "properties": {
                        "repo": {"type": "string", "description": "owner/repo"},
                        "title": {"type": "string", "description": "Issue title"},
                        "body": {"type": "string", "description": "Issue description"},
                    },
                },
                "connector": "composio",
                "secret_ref": "github:composio_github_create_issue",
                "risk": "low",
            }
        ],
    },
    {
        "key": "gmail",
        "name": "Gmail",
        "category": "Communication",
        "provider": "composio",
        "composio_app": "GMAIL",
        "description": "Dispatch vendor RFQs, PO confirmations, and quality inspection reports via Gmail.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/gmail",
        "default_action": "composio_gmail_send_email",
        "modules": ["Mail Dispatch", "Drafts", "Thread Sync"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_gmail_send_email",
                "action": "GMAIL_SEND_EMAIL",
                "module": "Mail Dispatch",
                "description": "Send a structured email via Composio Gmail integration",
                "input_schema": {
                    "type": "object",
                    "required": ["to", "subject", "body"],
                    "properties": {
                        "to": {"type": "string", "description": "Recipient email address"},
                        "subject": {"type": "string", "description": "Email subject line"},
                        "body": {"type": "string", "description": "Email content"},
                    },
                },
                "connector": "composio",
                "secret_ref": "gmail:composio_gmail_send_email",
                "risk": "medium",
            }
        ],
    },
    {
        "key": "googlesheets",
        "name": "Google Sheets",
        "category": "Docs & Sheets",
        "provider": "composio",
        "composio_app": "GOOGLESHEETS",
        "description": "Append extracted BOM rows, inspection logs, and cycle-time telemetry to Google Sheets.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/googlesheets",
        "default_action": "composio_sheets_append_row",
        "modules": ["Spreadsheet Sync", "Row Appends", "Formulas"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_sheets_append_row",
                "action": "GOOGLESHEETS_APPEND_ROW",
                "module": "Row Appends",
                "description": "Append a row of extracted document data to a Google Sheet via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["spreadsheet_id", "values"],
                    "properties": {
                        "spreadsheet_id": {"type": "string", "description": "Target spreadsheet ID"},
                        "sheet_name": {"type": "string", "description": "Worksheet tab name"},
                        "values": {
                            "type": "array",
                            "items": {"type": ["string", "number", "boolean"]},
                            "description": "Row cell values",
                        },
                    },
                },
                "connector": "composio",
                "secret_ref": "googlesheets:composio_sheets_append_row",
                "risk": "low",
            }
        ],
    },
    {
        "key": "googledrive",
        "name": "Google Drive",
        "category": "Docs & Sheets",
        "provider": "composio",
        "composio_app": "GOOGLEDRIVE",
        "description": "Store technical drawings, CAD exports, and supplier compliance PDFs in Google Drive.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/googledrive",
        "default_action": "composio_drive_upload_file",
        "modules": ["File Vault", "Folder Hierarchy", "Permissions"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_drive_upload_file",
                "action": "GOOGLEDRIVE_UPLOAD_FILE",
                "module": "File Vault",
                "description": "Upload a drawing or specification document to Google Drive via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["file_name", "folder_id"],
                    "properties": {
                        "file_name": {"type": "string", "description": "Document filename"},
                        "folder_id": {"type": "string", "description": "Destination folder identifier"},
                        "content_base64": {"type": "string", "description": "Base64 encoded payload"},
                    },
                },
                "connector": "composio",
                "secret_ref": "googledrive:composio_drive_upload_file",
                "risk": "low",
            }
        ],
    },
    {
        "key": "googlecalendar",
        "name": "Google Calendar",
        "category": "Productivity",
        "provider": "composio",
        "composio_app": "GOOGLECALENDAR",
        "description": "Schedule preventive maintenance windows, shift handovers, and supplier audit meetings.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/googlecalendar",
        "default_action": "composio_calendar_create_event",
        "modules": ["Maintenance Events", "Schedules", "Reminders"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_calendar_create_event",
                "action": "GOOGLECALENDAR_CREATE_EVENT",
                "module": "Maintenance Events",
                "description": "Create a calendar event for a maintenance shutdown or quality audit",
                "input_schema": {
                    "type": "object",
                    "required": ["summary", "start_time", "end_time"],
                    "properties": {
                        "summary": {"type": "string", "description": "Event summary or title"},
                        "start_time": {"type": "string", "description": "ISO timestamp for event start"},
                        "end_time": {"type": "string", "description": "ISO timestamp for event end"},
                    },
                },
                "connector": "composio",
                "secret_ref": "googlecalendar:composio_calendar_create_event",
                "risk": "low",
            }
        ],
    },
    {
        "key": "linear",
        "name": "Linear",
        "category": "Engineering",
        "provider": "composio",
        "composio_app": "LINEAR",
        "description": "Create and triage manufacturing engineering tasks and non-conformance tickets in Linear.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/linear",
        "default_action": "composio_linear_create_issue",
        "modules": ["Issue Tracking", "Cycles", "Roadmaps"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_linear_create_issue",
                "action": "LINEAR_CREATE_ISSUE",
                "module": "Issue Tracking",
                "description": "Create a Linear issue for engineering triage via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["team_key", "title"],
                    "properties": {
                        "team_key": {"type": "string", "description": "Linear team key (e.g. ENG)"},
                        "title": {"type": "string", "description": "Issue title"},
                        "description": {"type": "string", "description": "Detailed description"},
                    },
                },
                "connector": "composio",
                "secret_ref": "linear:composio_linear_create_issue",
                "risk": "low",
            }
        ],
    },
    {
        "key": "jira",
        "name": "Jira",
        "category": "Engineering",
        "provider": "composio",
        "composio_app": "JIRA",
        "description": "Sync CAPA workflows, supplier quality tickets, and plant maintenance issues with Jira.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/jira",
        "default_action": "composio_jira_create_issue",
        "modules": ["CAPA Tracking", "Maintenance Tickets", "Workflows"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_jira_create_issue",
                "action": "JIRA_CREATE_ISSUE",
                "module": "CAPA Tracking",
                "description": "Create a Jira issue in the specified project via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["project_key", "summary"],
                    "properties": {
                        "project_key": {"type": "string", "description": "Jira project key (e.g. OPS)"},
                        "summary": {"type": "string", "description": "Issue summary"},
                        "issue_type": {"type": "string", "description": "Task, Bug, or Story"},
                    },
                },
                "connector": "composio",
                "secret_ref": "jira:composio_jira_create_issue",
                "risk": "low",
            }
        ],
    },
    {
        "key": "confluence",
        "name": "Confluence",
        "category": "Docs & Sheets",
        "provider": "composio",
        "composio_app": "CONFLUENCE",
        "description": "Publish engineering specifications, SOP revisions, and plant safety guidelines to Confluence spaces.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/confluence",
        "default_action": "composio_confluence_create_page",
        "modules": ["Spaces", "Knowledge Base", "Version History"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_confluence_create_page",
                "action": "CONFLUENCE_CREATE_PAGE",
                "module": "Knowledge Base",
                "description": "Create a knowledge base page or SOP in Confluence via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["space_key", "title", "content"],
                    "properties": {
                        "space_key": {"type": "string", "description": "Target Confluence space key"},
                        "title": {"type": "string", "description": "Page title"},
                        "content": {"type": "string", "description": "HTML or storage-format body"},
                    },
                },
                "connector": "composio",
                "secret_ref": "confluence:composio_confluence_create_page",
                "risk": "low",
            }
        ],
    },
    {
        "key": "notion",
        "name": "Notion",
        "category": "Docs & Sheets",
        "provider": "composio",
        "composio_app": "NOTION",
        "description": "Publish SOPs, shift handover notes, and compliance audit summaries to Notion workspaces.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/notion",
        "default_action": "composio_notion_create_page",
        "modules": ["Databases", "Workspaces", "Rich Docs"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_notion_create_page",
                "action": "NOTION_CREATE_PAGE",
                "module": "Rich Docs",
                "description": "Create a Notion page with structured operational notes via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["title", "content"],
                    "properties": {
                        "parent_id": {"type": "string", "description": "Parent page or database ID"},
                        "title": {"type": "string", "description": "Page title"},
                        "content": {"type": "string", "description": "Markdown or text body"},
                    },
                },
                "connector": "composio",
                "secret_ref": "notion:composio_notion_create_page",
                "risk": "low",
            }
        ],
    },
    {
        "key": "hubspot",
        "name": "HubSpot",
        "category": "CRM & Sales",
        "provider": "composio",
        "composio_app": "HUBSPOT",
        "description": "Synchronize industrial accounts, customer purchase inquiries, and lead qualification.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/hubspot",
        "default_action": "composio_hubspot_create_contact",
        "modules": ["Contacts", "Companies", "Deals Pipeline"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_hubspot_create_contact",
                "action": "HUBSPOT_CREATE_CONTACT",
                "module": "Contacts",
                "description": "Create or update an enterprise client contact in HubSpot CRM",
                "input_schema": {
                    "type": "object",
                    "required": ["email", "firstname", "lastname"],
                    "properties": {
                        "email": {"type": "string", "description": "Contact email"},
                        "firstname": {"type": "string", "description": "First name"},
                        "lastname": {"type": "string", "description": "Last name"},
                    },
                },
                "connector": "composio",
                "secret_ref": "hubspot:composio_hubspot_create_contact",
                "risk": "low",
            }
        ],
    },
    {
        "key": "salesforce",
        "name": "Salesforce",
        "category": "CRM & Sales",
        "provider": "composio",
        "composio_app": "SALESFORCE",
        "description": "Sync customer purchase orders, manufacturing quotes, and contracts to Salesforce CRM.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/salesforce",
        "default_action": "composio_salesforce_create_lead",
        "modules": ["Accounts", "Opportunities", "Contract Sync"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_salesforce_create_lead",
                "action": "SALESFORCE_CREATE_LEAD",
                "module": "Accounts",
                "description": "Register an industrial customer lead or RFQ in Salesforce",
                "input_schema": {
                    "type": "object",
                    "required": ["company", "last_name", "email"],
                    "properties": {
                        "company": {"type": "string", "description": "Company name"},
                        "last_name": {"type": "string", "description": "Contact surname"},
                        "email": {"type": "string", "description": "Contact email"},
                    },
                },
                "connector": "composio",
                "secret_ref": "salesforce:composio_salesforce_create_lead",
                "risk": "low",
            }
        ],
    },
    {
        "key": "zendesk",
        "name": "Zendesk",
        "category": "Support",
        "provider": "composio",
        "composio_app": "ZENDESK",
        "description": "Manage field engineering service tickets, warranty claims, and RMA replacement workflows.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/zendesk",
        "default_action": "composio_zendesk_create_ticket",
        "modules": ["Field Tickets", "Warranty Claims", "RMA"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_zendesk_create_ticket",
                "action": "ZENDESK_CREATE_TICKET",
                "module": "Field Tickets",
                "description": "Open a field service or warranty replacement ticket in Zendesk",
                "input_schema": {
                    "type": "object",
                    "required": ["subject", "comment"],
                    "properties": {
                        "subject": {"type": "string", "description": "Ticket subject line"},
                        "comment": {"type": "string", "description": "Detailed incident description"},
                        "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
                    },
                },
                "connector": "composio",
                "secret_ref": "zendesk:composio_zendesk_create_ticket",
                "risk": "low",
            }
        ],
    },
    {
        "key": "asana",
        "name": "Asana",
        "category": "Productivity",
        "provider": "composio",
        "composio_app": "ASANA",
        "description": "Coordinate plant commissioning milestones, cross-functional sprints, and safety checklist tasks.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/asana",
        "default_action": "composio_asana_create_task",
        "modules": ["Project Portfolios", "Tasks", "Milestones"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_asana_create_task",
                "action": "ASANA_CREATE_TASK",
                "module": "Tasks",
                "description": "Create an action task in an Asana project for manufacturing operations",
                "input_schema": {
                    "type": "object",
                    "required": ["project_id", "name"],
                    "properties": {
                        "project_id": {"type": "string", "description": "Asana project ID"},
                        "name": {"type": "string", "description": "Task name"},
                        "notes": {"type": "string", "description": "Action instructions"},
                    },
                },
                "connector": "composio",
                "secret_ref": "asana:composio_asana_create_task",
                "risk": "low",
            }
        ],
    },
    {
        "key": "trello",
        "name": "Trello",
        "category": "Productivity",
        "provider": "composio",
        "composio_app": "TRELLO",
        "description": "Kanban board tracking for maintenance repairs, tooling changeovers, and shift tasks.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/trello",
        "default_action": "composio_trello_create_card",
        "modules": ["Kanban", "Tooling Boards", "Lists"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_trello_create_card",
                "action": "TRELLO_CREATE_CARD",
                "module": "Kanban",
                "description": "Post a tooling card to a Trello maintenance board",
                "input_schema": {
                    "type": "object",
                    "required": ["list_id", "name"],
                    "properties": {
                        "list_id": {"type": "string", "description": "Trello list ID"},
                        "name": {"type": "string", "description": "Card title"},
                        "desc": {"type": "string", "description": "Description"},
                    },
                },
                "connector": "composio",
                "secret_ref": "trello:composio_trello_create_card",
                "risk": "low",
            }
        ],
    },
    {
        "key": "monday",
        "name": "monday.com",
        "category": "Productivity",
        "provider": "composio",
        "composio_app": "MONDAY",
        "description": "Plan production schedules, equipment readiness, and supplier delivery dates on monday.com.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/monday",
        "default_action": "composio_monday_create_item",
        "modules": ["Production Boards", "Schedule Sync", "Columns"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_monday_create_item",
                "action": "MONDAY_CREATE_ITEM",
                "module": "Production Boards",
                "description": "Create a scheduled production item on monday.com",
                "input_schema": {
                    "type": "object",
                    "required": ["board_id", "item_name"],
                    "properties": {
                        "board_id": {"type": "string", "description": "Target board ID"},
                        "item_name": {"type": "string", "description": "Item or order name"},
                    },
                },
                "connector": "composio",
                "secret_ref": "monday:composio_monday_create_item",
                "risk": "low",
            }
        ],
    },
    {
        "key": "airtable",
        "name": "Airtable",
        "category": "Docs & Sheets",
        "provider": "composio",
        "composio_app": "AIRTABLE",
        "description": "Relational tracking of tool calibrations, inspection certifications, and raw material lots.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/airtable",
        "default_action": "composio_airtable_create_record",
        "modules": ["Lot Tracking", "Bases", "Linked Records"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_airtable_create_record",
                "action": "AIRTABLE_CREATE_RECORD",
                "module": "Lot Tracking",
                "description": "Append a calibration record or lot inspection into Airtable",
                "input_schema": {
                    "type": "object",
                    "required": ["base_id", "table_name", "fields"],
                    "properties": {
                        "base_id": {"type": "string", "description": "Airtable Base ID"},
                        "table_name": {"type": "string", "description": "Table name"},
                        "fields": {"type": "object", "description": "Record fields dictionary"},
                    },
                },
                "connector": "composio",
                "secret_ref": "airtable:composio_airtable_create_record",
                "risk": "low",
            }
        ],
    },
    {
        "key": "stripe",
        "name": "Stripe",
        "category": "Finance",
        "provider": "composio",
        "composio_app": "STRIPE",
        "description": "Generate customer invoices for tooling fabrication, milestone billing, and recurring spare parts.",
        "auth_schemes": ["API_KEY"],
        "docs_url": "https://composio.dev/tools/stripe",
        "default_action": "composio_stripe_create_invoice",
        "modules": ["Invoicing", "Milestone Billing", "Customers"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_stripe_create_invoice",
                "action": "STRIPE_CREATE_INVOICE",
                "module": "Invoicing",
                "description": "Create a customer invoice in Stripe for tooling or batch production",
                "input_schema": {
                    "type": "object",
                    "required": ["customer_id", "amount_cents", "currency"],
                    "properties": {
                        "customer_id": {"type": "string", "description": "Stripe customer ID"},
                        "amount_cents": {"type": "integer", "description": "Amount in cents"},
                        "currency": {"type": "string", "default": "usd"},
                    },
                },
                "connector": "composio",
                "secret_ref": "stripe:composio_stripe_create_invoice",
                "risk": "medium",
            }
        ],
    },
    {
        "key": "quickbooks",
        "name": "QuickBooks",
        "category": "Finance",
        "provider": "composio",
        "composio_app": "QUICKBOOKS",
        "description": "Post vendor bills for raw materials, sync purchase receipts, and track plant COGS.",
        "auth_schemes": ["OAUTH2"],
        "docs_url": "https://composio.dev/tools/quickbooks",
        "default_action": "composio_quickbooks_create_bill",
        "modules": ["Vendor Bills", "COGS Ledger", "Purchase Receipts"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_quickbooks_create_bill",
                "action": "QUICKBOOKS_CREATE_BILL",
                "module": "Vendor Bills",
                "description": "Record a raw material vendor bill in QuickBooks Online",
                "input_schema": {
                    "type": "object",
                    "required": ["vendor_id", "total_amount"],
                    "properties": {
                        "vendor_id": {"type": "string", "description": "Vendor identifier"},
                        "total_amount": {"type": "number", "description": "Total bill amount"},
                    },
                },
                "connector": "composio",
                "secret_ref": "quickbooks:composio_quickbooks_create_bill",
                "risk": "medium",
            }
        ],
    },
    {
        "key": "netsuite",
        "name": "NetSuite ERP",
        "category": "Finance",
        "provider": "composio",
        "composio_app": "NETSUITE",
        "description": "Sync assembly build work orders, inventory receipts, and general ledger postings in NetSuite.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/netsuite",
        "default_action": "composio_netsuite_sync_order",
        "modules": ["Work Orders", "Item Fulfillment", "GL Journal"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_netsuite_sync_order",
                "action": "NETSUITE_SYNC_ORDER",
                "module": "Work Orders",
                "description": "Sync a manufacturing work order into Oracle NetSuite ERP",
                "input_schema": {
                    "type": "object",
                    "required": ["order_id", "item_code", "quantity"],
                    "properties": {
                        "order_id": {"type": "string", "description": "Internal work order reference"},
                        "item_code": {"type": "string", "description": "Item SKU in NetSuite"},
                        "quantity": {"type": "number", "description": "Assembly batch quantity"},
                    },
                },
                "connector": "composio",
                "secret_ref": "netsuite:composio_netsuite_sync_order",
                "risk": "medium",
            }
        ],
    },
    {
        "key": "microsoft_teams",
        "name": "Microsoft Teams",
        "category": "Communication",
        "provider": "composio",
        "composio_app": "MICROSOFT_TEAMS",
        "description": "Post urgent machine downtime alerts, quality holds, and shift summaries to Teams channels.",
        "auth_schemes": ["OAUTH2"],
        "docs_url": "https://composio.dev/tools/microsoft_teams",
        "default_action": "composio_teams_send_message",
        "modules": ["Channel Alerts", "Direct Cards", "Shift Handoffs"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_teams_send_message",
                "action": "TEAMS_SEND_MESSAGE",
                "module": "Channel Alerts",
                "description": "Post an operational alert message to a Microsoft Teams channel",
                "input_schema": {
                    "type": "object",
                    "required": ["channel_id", "content"],
                    "properties": {
                        "channel_id": {"type": "string", "description": "Teams channel ID"},
                        "content": {"type": "string", "description": "Message HTML or text"},
                    },
                },
                "connector": "composio",
                "secret_ref": "microsoft_teams:composio_teams_send_message",
                "risk": "low",
            }
        ],
    },
    {
        "key": "outlook",
        "name": "Microsoft Outlook",
        "category": "Communication",
        "provider": "composio",
        "composio_app": "OUTLOOK",
        "description": "Dispatch purchasing orders and technical RFQ packages via enterprise Exchange / Outlook.",
        "auth_schemes": ["OAUTH2"],
        "docs_url": "https://composio.dev/tools/outlook",
        "default_action": "composio_outlook_send_mail",
        "modules": ["Mail Sync", "Calendar", "Attachments"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_outlook_send_mail",
                "action": "OUTLOOK_SEND_MAIL",
                "module": "Mail Sync",
                "description": "Send an email via Microsoft Outlook / Office 365",
                "input_schema": {
                    "type": "object",
                    "required": ["to", "subject", "body"],
                    "properties": {
                        "to": {"type": "string", "description": "Recipient email"},
                        "subject": {"type": "string", "description": "Subject header"},
                        "body": {"type": "string", "description": "Body message"},
                    },
                },
                "connector": "composio",
                "secret_ref": "outlook:composio_outlook_send_mail",
                "risk": "medium",
            }
        ],
    },
    {
        "key": "dropbox",
        "name": "Dropbox",
        "category": "Docs & Sheets",
        "provider": "composio",
        "composio_app": "DROPBOX",
        "description": "Synchronize CAD drawing revisions, CNC G-code programs, and CMM inspection outputs.",
        "auth_schemes": ["OAUTH2"],
        "docs_url": "https://composio.dev/tools/dropbox",
        "default_action": "composio_dropbox_upload_file",
        "modules": ["File Sync", "Revisions", "Shared Links"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_dropbox_upload_file",
                "action": "DROPBOX_UPLOAD_FILE",
                "module": "File Sync",
                "description": "Upload a CNC program or CMM report to Dropbox",
                "input_schema": {
                    "type": "object",
                    "required": ["path", "content_base64"],
                    "properties": {
                        "path": {"type": "string", "description": "Remote Dropbox filepath"},
                        "content_base64": {"type": "string", "description": "File payload"},
                    },
                },
                "connector": "composio",
                "secret_ref": "dropbox:composio_dropbox_upload_file",
                "risk": "low",
            }
        ],
    },
    {
        "key": "box",
        "name": "Box",
        "category": "Docs & Sheets",
        "provider": "composio",
        "composio_app": "BOX",
        "description": "Compliant 21 CFR Part 11 / ITAR encrypted document repository for defense and medical drawings.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/box",
        "default_action": "composio_box_upload_file",
        "modules": ["Compliant Vault", "ITAR Records", "Retention"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_box_upload_file",
                "action": "BOX_UPLOAD_FILE",
                "module": "Compliant Vault",
                "description": "Securely store defense or medical drawing revisions in Box",
                "input_schema": {
                    "type": "object",
                    "required": ["folder_id", "filename"],
                    "properties": {
                        "folder_id": {"type": "string", "description": "Box folder ID"},
                        "filename": {"type": "string", "description": "File name"},
                    },
                },
                "connector": "composio",
                "secret_ref": "box:composio_box_upload_file",
                "risk": "low",
            }
        ],
    },
    {
        "key": "figma",
        "name": "Figma",
        "category": "Engineering",
        "provider": "composio",
        "composio_app": "FIGMA",
        "description": "Sync HMI screen mockups, control panel layouts, and interactive industrial operator UI designs.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/figma",
        "default_action": "composio_figma_post_comment",
        "modules": ["HMI Designs", "Comments", "Design Tokens"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_figma_post_comment",
                "action": "FIGMA_POST_COMMENT",
                "module": "HMI Designs",
                "description": "Post an operator feedback comment on a machine HMI design file in Figma",
                "input_schema": {
                    "type": "object",
                    "required": ["file_key", "message"],
                    "properties": {
                        "file_key": {"type": "string", "description": "Figma file key"},
                        "message": {"type": "string", "description": "Feedback message"},
                    },
                },
                "connector": "composio",
                "secret_ref": "figma:composio_figma_post_comment",
                "risk": "low",
            }
        ],
    },
    {
        "key": "pagerduty",
        "name": "PagerDuty",
        "category": "Operations",
        "provider": "composio",
        "composio_app": "PAGERDUTY",
        "description": "Trigger on-call maintenance escalation for critical machine outages and environmental alarms.",
        "auth_schemes": ["API_KEY"],
        "docs_url": "https://composio.dev/tools/pagerduty",
        "default_action": "composio_pagerduty_trigger_incident",
        "modules": ["Incident Escalation", "On-Call Schedules", "Services"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_pagerduty_trigger_incident",
                "action": "PAGERDUTY_TRIGGER_INCIDENT",
                "module": "Incident Escalation",
                "description": "Trigger an urgent on-call incident for critical plant equipment failure",
                "input_schema": {
                    "type": "object",
                    "required": ["routing_key", "summary", "severity"],
                    "properties": {
                        "routing_key": {"type": "string", "description": "PagerDuty service integration key"},
                        "summary": {"type": "string", "description": "Incident summary"},
                        "severity": {"type": "string", "enum": ["critical", "error", "warning", "info"]},
                    },
                },
                "connector": "composio",
                "secret_ref": "pagerduty:composio_pagerduty_trigger_incident",
                "risk": "high",
            }
        ],
    },
    {
        "key": "datadog",
        "name": "Datadog",
        "category": "Operations",
        "provider": "composio",
        "composio_app": "DATADOG",
        "description": "Stream industrial edge gateway metrics, telemetry anomalies, and PLC packet drop rates.",
        "auth_schemes": ["API_KEY"],
        "docs_url": "https://composio.dev/tools/datadog",
        "default_action": "composio_datadog_post_event",
        "modules": ["Telemetry Metrics", "Edge Monitors", "Events"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_datadog_post_event",
                "action": "DATADOG_POST_EVENT",
                "module": "Events",
                "description": "Send a manufacturing edge telemetry event to Datadog",
                "input_schema": {
                    "type": "object",
                    "required": ["title", "text"],
                    "properties": {
                        "title": {"type": "string", "description": "Event headline"},
                        "text": {"type": "string", "description": "Event details"},
                        "alert_type": {"type": "string", "enum": ["error", "warning", "info", "success"]},
                    },
                },
                "connector": "composio",
                "secret_ref": "datadog:composio_datadog_post_event",
                "risk": "low",
            }
        ],
    },
    {
        "key": "supabase",
        "name": "Supabase",
        "category": "Engineering",
        "provider": "composio",
        "composio_app": "SUPABASE",
        "description": "Direct PostgreSQL telemetry storage for high-frequency sensor streams, batch logs, and vector embeddings.",
        "auth_schemes": ["API_KEY"],
        "docs_url": "https://composio.dev/tools/supabase",
        "default_action": "composio_supabase_query_table",
        "modules": ["Postgres Tables", "Edge Storage", "Vector Store"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_supabase_query_table",
                "action": "SUPABASE_QUERY_TABLE",
                "module": "Postgres Tables",
                "description": "Execute a parameterized query or select from Supabase tables",
                "input_schema": {
                    "type": "object",
                    "required": ["table_name"],
                    "properties": {
                        "table_name": {"type": "string", "description": "Database table name"},
                        "select": {"type": "string", "default": "*"},
                        "limit": {"type": "integer", "default": 20},
                    },
                },
                "connector": "composio",
                "secret_ref": "supabase:composio_supabase_query_table",
                "risk": "low",
            }
        ],
    },
    {
        "key": "snowflake",
        "name": "Snowflake",
        "category": "Operations",
        "provider": "composio",
        "composio_app": "SNOWFLAKE",
        "description": "Enterprise cloud data lake for fleet-wide machine vibration analytics, yield modeling, and scrap prediction.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/snowflake",
        "default_action": "composio_snowflake_execute_query",
        "modules": ["Data Warehouse", "Yield Modeling", "Fleet Telemetry"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_snowflake_execute_query",
                "action": "SNOWFLAKE_EXECUTE_QUERY",
                "module": "Data Warehouse",
                "description": "Query historical manufacturing analytics from Snowflake Data Cloud",
                "input_schema": {
                    "type": "object",
                    "required": ["sql_statement"],
                    "properties": {
                        "sql_statement": {"type": "string", "description": "SQL statement"},
                        "warehouse": {"type": "string", "description": "Compute warehouse name"},
                    },
                },
                "connector": "composio",
                "secret_ref": "snowflake:composio_snowflake_execute_query",
                "risk": "medium",
            }
        ],
    },
    {
        "key": "servicenow",
        "name": "ServiceNow",
        "category": "Operations",
        "provider": "composio",
        "composio_app": "SERVICENOW",
        "description": "Enterprise IT/OT service management, plant asset tracking, and change advisory board approvals.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/servicenow",
        "default_action": "composio_servicenow_create_incident",
        "modules": ["OT Change Mgmt", "Asset CMDB", "Incidents"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_servicenow_create_incident",
                "action": "SERVICENOW_CREATE_INCIDENT",
                "module": "Incidents",
                "description": "Create an OT infrastructure incident or change notice in ServiceNow",
                "input_schema": {
                    "type": "object",
                    "required": ["short_description", "urgency"],
                    "properties": {
                        "short_description": {"type": "string", "description": "Brief incident summary"},
                        "urgency": {"type": "string", "enum": ["1", "2", "3"]},
                        "comments": {"type": "string", "description": "Detailed notes"},
                    },
                },
                "connector": "composio",
                "secret_ref": "servicenow:composio_servicenow_create_incident",
                "risk": "medium",
            }
        ],
    },
    {
        "key": "erp_webhook",
        "name": "SAP / NetSuite ERP Bridge",
        "category": "ERP & Operations",
        "provider": "composio",
        "composio_app": "ERP_WEBHOOK",
        "description": "Push validated purchase orders, work orders, and inventory adjustments to ERP endpoints.",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://composio.dev/tools/erp_webhook",
        "default_action": "composio_erp_sync_order",
        "modules": ["Orders", "BOM", "Inventory"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "composio_erp_sync_order",
                "action": "ERP_SYNC_ORDER",
                "module": "Orders",
                "description": "Sync a validated production or purchase order to ERP via Composio",
                "input_schema": {
                    "type": "object",
                    "required": ["order_id", "quantity"],
                    "properties": {
                        "order_id": {"type": "string", "description": "Order or drawing identifier"},
                        "material": {"type": "string", "description": "Material specification"},
                        "quantity": {"type": "number", "description": "Order quantity"},
                    },
                },
                "connector": "composio",
                "secret_ref": "erp_webhook:composio_erp_sync_order",
                "risk": "medium",
            }
        ],
    },
]

# ---------------------------------------------------------------------------
# Fallback definitions for Industrial FastMCP Apps (guarantees immediate availability)
# ---------------------------------------------------------------------------
FALLBACK_INDUSTRIAL_APPS: list[dict[str, Any]] = [
    {
        "key": "sap_s4hana",
        "name": "SAP S/4HANA & Business Suite",
        "category": "ERP & Supply Chain",
        "provider": "fastmcp",
        "composio_app": "SAP_S4HANA_MCP",
        "description": "Enterprise FastMCP server covering 7 core SAP modules: MM, PP, SD, QM, PM/EAM, FI/CO, and EWM via OData APIs.",
        "auth_schemes": ["API_KEY", "OAUTH2", "BASIC"],
        "docs_url": "https://api.sap.com/package/SAPS4HANACloud",
        "default_action": "sap_mm_get_material_master",
        "modules": ["MM (Materials)", "PP (Production)", "SD (Sales)", "QM (Quality)", "PM/EAM (Maintenance)", "FI/CO (Costing)", "EWM (Warehouse)"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "sap_mm_get_material_master",
                "action": "SAP_MM_GET_MATERIAL_MASTER",
                "module": "MM (Materials)",
                "endpoint": "/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product",
                "description": "Fetch material master (MARA/MARC) specification, valuation class, and replenishment policy from SAP",
                "input_schema": {"type": "object", "required": ["material_id"], "properties": {"material_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_mm_get_material_master",
                "risk": "low",
            },
            {
                "name": "sap_mm_create_purchase_order",
                "action": "SAP_MM_CREATE_PURCHASE_ORDER",
                "module": "MM (Materials)",
                "endpoint": "/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder",
                "description": "Generate an official SAP Purchase Order for raw material lots",
                "input_schema": {"type": "object", "required": ["vendor", "material", "quantity"], "properties": {"vendor": {"type": "string"}, "material": {"type": "string"}, "quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_mm_create_purchase_order",
                "risk": "medium",
            },
            {
                "name": "sap_mm_check_stock_overview",
                "action": "SAP_MM_CHECK_STOCK_OVERVIEW",
                "module": "MM (Materials)",
                "endpoint": "/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod",
                "description": "Query unrestricted, blocked, and in-inspection stock across storage locations in SAP",
                "input_schema": {"type": "object", "required": ["material_id"], "properties": {"material_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_mm_check_stock_overview",
                "risk": "low",
            },
            {
                "name": "sap_pp_create_production_order",
                "action": "SAP_PP_CREATE_PRODUCTION_ORDER",
                "module": "PP (Production)",
                "endpoint": "/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder_2",
                "description": "Create a SAP S/4HANA production order with routing and component allocation",
                "input_schema": {"type": "object", "required": ["material", "quantity"], "properties": {"material": {"type": "string"}, "quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_pp_create_production_order",
                "risk": "medium",
            },
            {
                "name": "sap_pp_explode_bom",
                "action": "SAP_PP_EXPLODE_BOM",
                "module": "PP (Production)",
                "endpoint": "/sap/opu/odata/sap/API_BILL_OF_MATERIAL_SRV/A_BillOfMaterial",
                "description": "Multi-level Bill of Materials explosion for assemblies and child items in SAP",
                "input_schema": {"type": "object", "required": ["material_id"], "properties": {"material_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_pp_explode_bom",
                "risk": "low",
            },
            {
                "name": "sap_pp_confirm_operation",
                "action": "SAP_PP_CONFIRM_OPERATION",
                "module": "PP (Production)",
                "endpoint": "/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/A_ProdOrderConfirmation_2",
                "description": "Confirm completed manufacturing operation yield and scrap in SAP",
                "input_schema": {"type": "object", "required": ["order_id", "yield_quantity"], "properties": {"order_id": {"type": "string"}, "yield_quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_pp_confirm_operation",
                "risk": "medium",
            },
            {
                "name": "sap_sd_create_sales_order",
                "action": "SAP_SD_CREATE_SALES_ORDER",
                "module": "SD (Sales)",
                "endpoint": "/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder",
                "description": "Book a sales order with pricing and billing schedule in SAP S/4HANA",
                "input_schema": {"type": "object", "required": ["sold_to_party", "material", "quantity"], "properties": {"sold_to_party": {"type": "string"}, "material": {"type": "string"}, "quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_sd_create_sales_order",
                "risk": "medium",
            },
            {
                "name": "sap_sd_check_atp_delivery",
                "action": "SAP_SD_CHECK_ATP_DELIVERY",
                "module": "SD (Sales)",
                "endpoint": "/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV/A_OutbDeliveryHeader",
                "description": "Available-to-Promise (ATP) delivery feasibility and lead time check in SAP",
                "input_schema": {"type": "object", "required": ["material_id", "quantity"], "properties": {"material_id": {"type": "string"}, "quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_sd_check_atp_delivery",
                "risk": "low",
            },
            {
                "name": "sap_qm_create_inspection_lot",
                "action": "SAP_QM_CREATE_INSPECTION_LOT",
                "module": "QM (Quality)",
                "endpoint": "/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLot",
                "description": "Create an inspection lot for incoming receiving or in-line manufacturing quality control",
                "input_schema": {"type": "object", "required": ["material_id", "quantity"], "properties": {"material_id": {"type": "string"}, "quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_qm_create_inspection_lot",
                "risk": "low",
            },
            {
                "name": "sap_qm_record_usage_decision",
                "action": "SAP_QM_RECORD_USAGE_DECISION",
                "module": "QM (Quality)",
                "endpoint": "/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspLotUsageDecision",
                "description": "Record usage decision (Accept, Reject, Quarantine) for a QA inspection lot",
                "input_schema": {"type": "object", "required": ["lot_id", "decision_code"], "properties": {"lot_id": {"type": "string"}, "decision_code": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_qm_record_usage_decision",
                "risk": "medium",
            },
            {
                "name": "sap_pm_create_maintenance_notification",
                "action": "SAP_PM_CREATE_MAINTENANCE_NOTIFICATION",
                "module": "PM/EAM (Maintenance)",
                "endpoint": "/sap/opu/odata/sap/API_MAINTNOTIFICATION/A_MaintenanceNotification",
                "description": "File a plant maintenance breakdown notification for work centers or machines",
                "input_schema": {"type": "object", "required": ["equipment_id", "description"], "properties": {"equipment_id": {"type": "string"}, "description": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_pm_create_maintenance_notification",
                "risk": "low",
            },
            {
                "name": "sap_pm_create_work_order",
                "action": "SAP_PM_CREATE_WORK_ORDER",
                "module": "PM/EAM (Maintenance)",
                "endpoint": "/sap/opu/odata/sap/API_MAINTENANCEORDER/A_MaintenanceOrder",
                "description": "Issue an authorized plant maintenance work order for corrective repairs",
                "input_schema": {"type": "object", "required": ["equipment_id", "order_type"], "properties": {"equipment_id": {"type": "string"}, "order_type": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_pm_create_work_order",
                "risk": "medium",
            },
            {
                "name": "sap_fico_post_cost_allocation",
                "action": "SAP_FICO_POST_COST_ALLOCATION",
                "module": "FI/CO (Costing)",
                "endpoint": "/sap/opu/odata/sap/API_JOURNALENTRY_SRV/A_JournalEntry",
                "description": "Post machine hour and labor cost allocations to manufacturing cost centers in SAP",
                "input_schema": {"type": "object", "required": ["cost_center", "amount"], "properties": {"cost_center": {"type": "string"}, "amount": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_fico_post_cost_allocation",
                "risk": "medium",
            },
            {
                "name": "sap_fico_get_production_variance",
                "action": "SAP_FICO_GET_PRODUCTION_VARIANCE",
                "module": "FI/CO (Costing)",
                "endpoint": "/sap/opu/odata/sap/API_JOURNALENTRY_SRV/ProductionVariance",
                "description": "Analyze standard cost versus actual production variance across orders",
                "input_schema": {"type": "object", "required": ["order_id"], "properties": {"order_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_fico_get_production_variance",
                "risk": "low",
            },
            {
                "name": "sap_ewm_create_warehouse_task",
                "action": "SAP_EWM_CREATE_WAREHOUSE_TASK",
                "module": "EWM (Warehouse)",
                "endpoint": "/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK_2/A_WarehouseTask",
                "description": "Create an automated putaway or picking warehouse task in SAP Extended Warehouse Management",
                "input_schema": {"type": "object", "required": ["warehouse", "product", "quantity"], "properties": {"warehouse": {"type": "string"}, "product": {"type": "string"}, "quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "sap_s4hana:sap_ewm_create_warehouse_task",
                "risk": "medium",
            },
        ],
    },
    {
        "key": "siemens_xcelerator",
        "name": "Siemens Xcelerator (Teamcenter, Opcenter, NX, MindSphere)",
        "category": "PLM & CAD/CAE",
        "provider": "fastmcp",
        "composio_app": "SIEMENS_XCELERATOR_MCP",
        "description": "FastMCP server covering Teamcenter PLM, Opcenter MES, NX CAD/PMI, Simcenter CAE, MindSphere IIoT, and Tecnomatix.",
        "auth_schemes": ["API_KEY", "OAUTH2", "BASIC"],
        "docs_url": "https://developer.siemens.com",
        "default_action": "siemens_tc_get_item_revision",
        "modules": ["Teamcenter PLM", "Opcenter MES", "NX CAD", "Simcenter CAE", "MindSphere IIoT", "Tecnomatix"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "siemens_tc_get_item_revision",
                "action": "SIEMENS_TC_GET_ITEM_REVISION",
                "module": "Teamcenter PLM",
                "endpoint": "/tc/RestServices/Core-2011-06-DataManagement/getItem",
                "description": "Query CAD drawing item revisions, engineering maturity, and release status from Teamcenter",
                "input_schema": {"type": "object", "required": ["item_id"], "properties": {"item_id": {"type": "string"}, "revision": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_tc_get_item_revision",
                "risk": "low",
            },
            {
                "name": "siemens_tc_create_ecn",
                "action": "SIEMENS_TC_CREATE_ECN",
                "module": "Teamcenter PLM",
                "endpoint": "/tc/RestServices/ChangeManagement/createChangeNotice",
                "description": "Initiate an Engineering Change Notice (ECN) workflow in Siemens Teamcenter",
                "input_schema": {"type": "object", "required": ["item_id", "title", "description"], "properties": {"item_id": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_tc_create_ecn",
                "risk": "medium",
            },
            {
                "name": "siemens_tc_get_ebom",
                "action": "SIEMENS_TC_GET_EBOM",
                "module": "Teamcenter PLM",
                "endpoint": "/tc/RestServices/StructureManagement/getBOMWindows",
                "description": "Fetch Engineering Bill of Materials (EBOM) structure tree from Teamcenter",
                "input_schema": {"type": "object", "required": ["item_id"], "properties": {"item_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_tc_get_ebom",
                "risk": "low",
            },
            {
                "name": "siemens_opcenter_dispatch_work_order",
                "action": "SIEMENS_OPCENTER_DISPATCH_WORK_ORDER",
                "module": "Opcenter MES",
                "endpoint": "/opcenter/api/v1/WorkOrders/Dispatch",
                "description": "Dispatch an electronic work order to a shop floor work center in Siemens Opcenter MES",
                "input_schema": {"type": "object", "required": ["order_id", "work_center"], "properties": {"order_id": {"type": "string"}, "work_center": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_opcenter_dispatch_work_order",
                "risk": "medium",
            },
            {
                "name": "siemens_opcenter_log_nonconformance",
                "action": "SIEMENS_OPCENTER_LOG_NONCONFORMANCE",
                "module": "Opcenter MES",
                "endpoint": "/opcenter/api/v1/NonConformance",
                "description": "Log an in-process part non-conformance and quarantine the unit in Opcenter",
                "input_schema": {"type": "object", "required": ["serial_number", "defect_code"], "properties": {"serial_number": {"type": "string"}, "defect_code": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_opcenter_log_nonconformance",
                "risk": "medium",
            },
            {
                "name": "siemens_opcenter_get_oee",
                "action": "SIEMENS_OPCENTER_GET_OEE",
                "module": "Opcenter MES",
                "endpoint": "/opcenter/api/v1/Equipment/OEE",
                "description": "Query Overall Equipment Effectiveness (Availability, Performance, Quality) from Opcenter",
                "input_schema": {"type": "object", "required": ["work_center"], "properties": {"work_center": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_opcenter_get_oee",
                "risk": "low",
            },
            {
                "name": "siemens_nx_extract_pmi_tolerances",
                "action": "SIEMENS_NX_EXTRACT_PMI_TOLERANCES",
                "module": "NX CAD",
                "endpoint": "/nx/api/v1/pmi/extract",
                "description": "Extract 3D Product and Manufacturing Information (PMI), GD&T, and datum callouts from Siemens NX model",
                "input_schema": {"type": "object", "required": ["model_path"], "properties": {"model_path": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_nx_extract_pmi_tolerances",
                "risk": "low",
            },
            {
                "name": "siemens_simcenter_run_thermal_stress_check",
                "action": "SIEMENS_SIMCENTER_RUN_THERMAL_STRESS_CHECK",
                "module": "Simcenter CAE",
                "endpoint": "/simcenter/api/v1/simulation/verify",
                "description": "Trigger Simcenter FEA thermal-mechanical stress analysis on revised CAD geometry",
                "input_schema": {"type": "object", "required": ["model_path", "load_case"], "properties": {"model_path": {"type": "string"}, "load_case": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_simcenter_run_thermal_stress_check",
                "risk": "medium",
            },
            {
                "name": "siemens_edge_read_plc_tags",
                "action": "SIEMENS_EDGE_READ_PLC_TAGS",
                "module": "MindSphere IIoT",
                "endpoint": "/iot/api/v3/timeseries",
                "description": "Sample live S7-1500 PLC DB registers and spindle telemetry via Siemens Industrial Edge",
                "input_schema": {"type": "object", "required": ["device_id", "tags"], "properties": {"device_id": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_edge_read_plc_tags",
                "risk": "low",
            },
            {
                "name": "siemens_mindsphere_query_timeseries",
                "action": "SIEMENS_MINDSPHERE_QUERY_TIMESERIES",
                "module": "MindSphere IIoT",
                "endpoint": "/api/iottimeseries/v3/timeseries",
                "description": "Query multi-day sensor time series from Insights Hub / MindSphere cloud",
                "input_schema": {"type": "object", "required": ["asset_id", "property_set"], "properties": {"asset_id": {"type": "string"}, "property_set": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_mindsphere_query_timeseries",
                "risk": "low",
            },
            {
                "name": "siemens_tecnomatix_validate_bop_routing",
                "action": "SIEMENS_TECNOMATIX_VALIDATE_BOP_ROUTING",
                "module": "Tecnomatix",
                "endpoint": "/tecnomatix/api/v1/bop/validate",
                "description": "Simulate and validate Bill of Process (BOP) assembly sequence against work cell kinematics",
                "input_schema": {"type": "object", "required": ["routing_id"], "properties": {"routing_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "siemens_xcelerator:siemens_tecnomatix_validate_bop_routing",
                "risk": "low",
            },
        ],
    },
    {
        "key": "rockwell_factorytalk",
        "name": "Rockwell Automation (FactoryTalk, Studio 5000, Plex, Fiix)",
        "category": "MES & Shopfloor IIoT",
        "provider": "fastmcp",
        "composio_app": "ROCKWELL_FACTORYTALK_MCP",
        "description": "FastMCP server covering FactoryTalk ProductionCentre MES, Studio 5000 Logix PLC, Plex ERP/QMS, and Fiix CMMS.",
        "auth_schemes": ["API_KEY", "OAUTH2", "BASIC"],
        "docs_url": "https://www.rockwellautomation.com/en-us/products/software/factorytalk.html",
        "default_action": "rockwell_ft_dispatch_batch",
        "modules": ["FactoryTalk MES", "Studio 5000 Logix", "Plex Smart QMS", "Fiix CMMS"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "rockwell_ft_dispatch_batch",
                "action": "ROCKWELL_FT_DISPATCH_BATCH",
                "module": "FactoryTalk MES",
                "endpoint": "/factorytalk/api/v2/production/dispatch",
                "description": "Dispatch a production batch to Rockwell FactoryTalk ProductionCentre MES",
                "input_schema": {"type": "object", "required": ["batch_id", "recipe_id"], "properties": {"batch_id": {"type": "string"}, "recipe_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "rockwell_factorytalk:rockwell_ft_dispatch_batch",
                "risk": "medium",
            },
            {
                "name": "rockwell_ft_record_scrap",
                "action": "ROCKWELL_FT_RECORD_SCRAP",
                "module": "FactoryTalk MES",
                "endpoint": "/factorytalk/api/v2/production/scrap",
                "description": "Record part scrap and cause code into FactoryTalk MES",
                "input_schema": {"type": "object", "required": ["batch_id", "scrap_count", "reason_code"], "properties": {"batch_id": {"type": "string"}, "scrap_count": {"type": "number"}, "reason_code": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "rockwell_factorytalk:rockwell_ft_record_scrap",
                "risk": "medium",
            },
            {
                "name": "rockwell_plc_read_cip_tags",
                "action": "ROCKWELL_PLC_READ_CIP_TAGS",
                "module": "Studio 5000 Logix",
                "endpoint": "/cip/v1/logix/tags/read",
                "description": "Read ControlLogix / CompactLogix CIP tags over EtherNet/IP",
                "input_schema": {"type": "object", "required": ["plc_ip", "tag_names"], "properties": {"plc_ip": {"type": "string"}, "tag_names": {"type": "array", "items": {"type": "string"}}}},
                "connector": "fastmcp",
                "secret_ref": "rockwell_factorytalk:rockwell_plc_read_cip_tags",
                "risk": "low",
            },
            {
                "name": "rockwell_plex_check_lot_traceability",
                "action": "ROCKWELL_PLEX_CHECK_LOT_TRACEABILITY",
                "module": "Plex Smart QMS",
                "endpoint": "/plex/api/v1/quality/lots/trace",
                "description": "Perform forward and backward heat lot traceability in Plex Cloud QMS",
                "input_schema": {"type": "object", "required": ["lot_number"], "properties": {"lot_number": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "rockwell_factorytalk:rockwell_plex_check_lot_traceability",
                "risk": "low",
            },
            {
                "name": "rockwell_plex_get_inventory_balance",
                "action": "ROCKWELL_PLEX_GET_INVENTORY_BALANCE",
                "module": "Plex Smart QMS",
                "endpoint": "/plex/api/v1/inventory/balance",
                "description": "Fetch bin-level raw material balance in Plex Smart Manufacturing ERP",
                "input_schema": {"type": "object", "required": ["part_no"], "properties": {"part_no": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "rockwell_factorytalk:rockwell_plex_get_inventory_balance",
                "risk": "low",
            },
            {
                "name": "rockwell_fiix_create_work_request",
                "action": "ROCKWELL_FIIX_CREATE_WORK_REQUEST",
                "module": "Fiix CMMS",
                "endpoint": "/fiix/api/v1/workorders/request",
                "description": "Create a corrective maintenance work order in Fiix CMMS",
                "input_schema": {"type": "object", "required": ["asset_id", "problem_description"], "properties": {"asset_id": {"type": "string"}, "problem_description": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "rockwell_factorytalk:rockwell_fiix_create_work_request",
                "risk": "low",
            },
        ],
    },
    {
        "key": "dassault_3dexperience",
        "name": "Dassault Systèmes (3DEXPERIENCE, ENOVIA, DELMIA, SOLIDWORKS)",
        "category": "PLM & CAD/CAE",
        "provider": "fastmcp",
        "composio_app": "DASSAULT_3DEXPERIENCE_MCP",
        "description": "FastMCP server covering ENOVIA PLM, DELMIA & Apriso MES, SOLIDWORKS PDM, and SIMULIA CAE.",
        "auth_schemes": ["API_KEY", "OAUTH2", "BASIC"],
        "docs_url": "https://www.3ds.com/products/3dexperience-platform",
        "default_action": "dassault_enovia_get_engineering_bom",
        "modules": ["ENOVIA PLM", "DELMIA Apriso MES", "SOLIDWORKS PDM", "SIMULIA CAE"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "dassault_enovia_get_engineering_bom",
                "action": "DASSAULT_ENOVIA_GET_ENGINEERING_BOM",
                "module": "ENOVIA PLM",
                "endpoint": "/3dexperience/api/v1/enovia/ebom",
                "description": "Extract configured product structure and engineering BOM from ENOVIA",
                "input_schema": {"type": "object", "required": ["part_number"], "properties": {"part_number": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "dassault_3dexperience:dassault_enovia_get_engineering_bom",
                "risk": "low",
            },
            {
                "name": "dassault_enovia_promote_maturity",
                "action": "DASSAULT_ENOVIA_PROMOTE_MATURITY",
                "module": "ENOVIA PLM",
                "endpoint": "/3dexperience/api/v1/enovia/maturity/promote",
                "description": "Promote CAD revision maturity state (In Work -> Frozen -> Released) in ENOVIA",
                "input_schema": {"type": "object", "required": ["part_number", "target_state"], "properties": {"part_number": {"type": "string"}, "target_state": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "dassault_3dexperience:dassault_enovia_promote_maturity",
                "risk": "medium",
            },
            {
                "name": "dassault_delmia_generate_mbom",
                "action": "DASSAULT_DELMIA_GENERATE_MBOM",
                "module": "DELMIA Apriso MES",
                "endpoint": "/3dexperience/api/v1/delmia/mbom/generate",
                "description": "Transform EBOM into manufacturing MBOM with shop floor station assignments",
                "input_schema": {"type": "object", "required": ["ebom_id"], "properties": {"ebom_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "dassault_3dexperience:dassault_delmia_generate_mbom",
                "risk": "medium",
            },
            {
                "name": "dassault_apriso_track_work_center",
                "action": "DASSAULT_APRISO_TRACK_WORK_CENTER",
                "module": "DELMIA Apriso MES",
                "endpoint": "/apriso/api/v1/workcenters/status",
                "description": "Monitor shop floor work center throughput and WIP queues in DELMIA Apriso MES",
                "input_schema": {"type": "object", "required": ["work_center_id"], "properties": {"work_center_id": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "dassault_3dexperience:dassault_apriso_track_work_center",
                "risk": "low",
            },
            {
                "name": "dassault_pdm_get_drawing_metadata",
                "action": "DASSAULT_PDM_GET_DRAWING_METADATA",
                "module": "SOLIDWORKS PDM",
                "endpoint": "/solidworks/pdm/api/v1/documents/metadata",
                "description": "Query SOLIDWORKS PDM file revision data card and check-out status",
                "input_schema": {"type": "object", "required": ["file_path"], "properties": {"file_path": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "dassault_3dexperience:dassault_pdm_get_drawing_metadata",
                "risk": "low",
            },
            {
                "name": "dassault_simulia_verify_structural_margin",
                "action": "DASSAULT_SIMULIA_VERIFY_STRUCTURAL_MARGIN",
                "module": "SIMULIA CAE",
                "endpoint": "/simulia/api/v1/analysis/structural_margin",
                "description": "Run SIMULIA Abaqus solver structural yield margin verification",
                "input_schema": {"type": "object", "required": ["cad_model", "material_yield_mpa"], "properties": {"cad_model": {"type": "string"}, "material_yield_mpa": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "dassault_3dexperience:dassault_simulia_verify_structural_margin",
                "risk": "medium",
            },
        ],
    },
    {
        "key": "ptc_windchill",
        "name": "PTC (Windchill PLM, MPMLink, ThingWorx IIoT, Creo)",
        "category": "PLM & CAD/CAE",
        "provider": "fastmcp",
        "composio_app": "PTC_WINDCHILL_MCP",
        "description": "FastMCP server covering Windchill PDMLink, MPMLink manufacturing process plans, ThingWorx IIoT, and Creo CAD.",
        "auth_schemes": ["API_KEY", "OAUTH2", "BASIC"],
        "docs_url": "https://www.ptc.com/en/products/windchill",
        "default_action": "ptc_windchill_get_part_structure",
        "modules": ["Windchill PDMLink", "MPMLink Process Plans", "ThingWorx IIoT", "Creo CAD"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "ptc_windchill_get_part_structure",
                "action": "PTC_WINDCHILL_GET_PART_STRUCTURE",
                "module": "Windchill PDMLink",
                "endpoint": "/Windchill/servlet/rest/netmarkets/partStructure",
                "description": "Query part structure, assembly hierarchy, and CAD documents from Windchill PDMLink",
                "input_schema": {"type": "object", "required": ["part_number"], "properties": {"part_number": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "ptc_windchill:ptc_windchill_get_part_structure",
                "risk": "low",
            },
            {
                "name": "ptc_windchill_create_change_request",
                "action": "PTC_WINDCHILL_CREATE_CHANGE_REQUEST",
                "module": "Windchill PDMLink",
                "endpoint": "/Windchill/servlet/rest/netmarkets/changeRequest",
                "description": "File a formal Change Request (ECR) for part dimensional modifications in Windchill",
                "input_schema": {"type": "object", "required": ["part_number", "title", "reason"], "properties": {"part_number": {"type": "string"}, "title": {"type": "string"}, "reason": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "ptc_windchill:ptc_windchill_create_change_request",
                "risk": "medium",
            },
            {
                "name": "ptc_mpmlink_sync_process_plan",
                "action": "PTC_MPMLINK_SYNC_PROCESS_PLAN",
                "module": "MPMLink Process Plans",
                "endpoint": "/Windchill/servlet/rest/mpmlink/processPlans",
                "description": "Sync manufacturing process plan operations and standard hours with shop floor MES",
                "input_schema": {"type": "object", "required": ["assembly_number"], "properties": {"assembly_number": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "ptc_windchill:ptc_mpmlink_sync_process_plan",
                "risk": "low",
            },
            {
                "name": "ptc_thingworx_get_asset_health",
                "action": "PTC_THINGWORX_GET_ASSET_HEALTH",
                "module": "ThingWorx IIoT",
                "endpoint": "/Thingworx/Things/Asset/Properties",
                "description": "Retrieve live machine health, temperature, and anomaly scoring from PTC ThingWorx IIoT",
                "input_schema": {"type": "object", "required": ["thing_name"], "properties": {"thing_name": {"type": "string"}}},
                "connector": "fastmcp",
                "secret_ref": "ptc_windchill:ptc_thingworx_get_asset_health",
                "risk": "low",
            },
        ],
    },
    {
        "key": "oracle_scm",
        "name": "Oracle Cloud SCM & NetSuite Manufacturing",
        "category": "ERP & Supply Chain",
        "provider": "fastmcp",
        "composio_app": "ORACLE_SCM_MCP",
        "description": "FastMCP server covering Oracle Cloud SCM Work-in-Process (WIP), shop floor operations, inventory, and procurement.",
        "auth_schemes": ["API_KEY", "OAUTH2", "BASIC"],
        "docs_url": "https://docs.oracle.com/en/cloud/saas/supply-chain-management/rest-apis.html",
        "default_action": "oracle_scm_create_work_order",
        "modules": ["WIP & Manufacturing", "Inventory & Procurement", "Cost Accounting"],
        "free_tier_included": True,
        "whitelabel_ready": True,
        "tools": [
            {
                "name": "oracle_scm_create_work_order",
                "action": "ORACLE_SCM_CREATE_WORK_ORDER",
                "module": "WIP & Manufacturing",
                "endpoint": "/fscmRestAppApi/resources/11.13.18.05/workOrders",
                "description": "Create a discrete manufacturing work order in Oracle Cloud SCM",
                "input_schema": {"type": "object", "required": ["item_number", "quantity"], "properties": {"item_number": {"type": "string"}, "quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "oracle_scm:oracle_scm_create_work_order",
                "risk": "medium",
            },
            {
                "name": "oracle_scm_report_operation_transaction",
                "action": "ORACLE_SCM_REPORT_OPERATION_TRANSACTION",
                "module": "WIP & Manufacturing",
                "endpoint": "/fscmRestAppApi/resources/11.13.18.05/operationTransactions",
                "description": "Report completion of machining, assembly, or inspection operation in Oracle SCM",
                "input_schema": {"type": "object", "required": ["work_order_id", "completed_quantity"], "properties": {"work_order_id": {"type": "string"}, "completed_quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "oracle_scm:oracle_scm_report_operation_transaction",
                "risk": "medium",
            },
            {
                "name": "oracle_scm_reserve_components",
                "action": "ORACLE_SCM_RESERVE_COMPONENTS",
                "module": "Inventory & Procurement",
                "endpoint": "/fscmRestAppApi/resources/11.13.18.05/inventoryReservations",
                "description": "Reserve raw material and hardware inventory lots for an active manufacturing order",
                "input_schema": {"type": "object", "required": ["item_number", "quantity"], "properties": {"item_number": {"type": "string"}, "quantity": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "oracle_scm:oracle_scm_reserve_components",
                "risk": "low",
            },
            {
                "name": "oracle_scm_create_purchase_requisition",
                "action": "ORACLE_SCM_CREATE_PURCHASE_REQUISITION",
                "module": "Inventory & Procurement",
                "endpoint": "/fscmRestAppApi/resources/11.13.18.05/purchaseRequisitions",
                "description": "Issue an automated purchase requisition in Oracle Cloud Procurement",
                "input_schema": {"type": "object", "required": ["item_number", "quantity", "unit_price"], "properties": {"item_number": {"type": "string"}, "quantity": {"type": "number"}, "unit_price": {"type": "number"}}},
                "connector": "fastmcp",
                "secret_ref": "oracle_scm:oracle_scm_create_purchase_requisition",
                "risk": "medium",
            },
        ],
    },
]

# ---------------------------------------------------------------------------
# Helper: fetch industrial MCP apps (from .industrial_mcp if available, else fallback)
# ---------------------------------------------------------------------------
def _get_industrial_apps() -> list[dict[str, Any]]:
    try:
        from .industrial_mcp import INDUSTRIAL_MCP_APPS
        if INDUSTRIAL_MCP_APPS:
            return INDUSTRIAL_MCP_APPS
    except Exception:
        try:
            import importlib
            mod = importlib.import_module("services.execution.app.industrial_mcp")
            apps = getattr(mod, "INDUSTRIAL_MCP_APPS", None)
            if apps:
                return apps
        except Exception:
            pass
    return FALLBACK_INDUSTRIAL_APPS


def _get_composio_catalog() -> list[dict[str, Any]]:
    curated_by_key = {item["key"]: item for item in COMPOSIO_CATALOG}
    try:
        from .composio_toolkits_catalog import COMPOSIO_TOOLKITS_1640
        if COMPOSIO_TOOLKITS_1640 and len(COMPOSIO_TOOLKITS_1640) >= 1:
            merged = []
            for item in COMPOSIO_TOOLKITS_1640:
                k = item["key"]
                if k in curated_by_key:
                    merged.append(curated_by_key[k])
                else:
                    merged.append(item)
            return merged
    except Exception:
        try:
            import importlib
            mod = importlib.import_module("services.execution.app.composio_toolkits_catalog")
            toolkits = getattr(mod, "COMPOSIO_TOOLKITS_1640", None)
            if toolkits:
                merged = []
                for item in toolkits:
                    k = item["key"]
                    if k in curated_by_key:
                        merged.append(curated_by_key[k])
                    else:
                        merged.append(item)
                return merged
        except Exception:
            pass
    return COMPOSIO_CATALOG


# Combined catalog indexed by key
def _get_all_catalog() -> list[dict[str, Any]]:
    composio_apps = _get_composio_catalog()
    ind_apps = _get_industrial_apps()
    return list(composio_apps) + list(ind_apps)


def _get_catalog_by_key() -> dict[str, dict[str, Any]]:
    return {item["key"]: item for item in _get_all_catalog()}


def _find_app_by_key(app_key: str) -> dict[str, Any] | None:
    # First check curated COMPOSIO_CATALOG for schema fidelity
    for item in COMPOSIO_CATALOG:
        if item.get("key") == app_key:
            return item
    for item in _get_industrial_apps():
        if item.get("key") == app_key:
            return item
    try:
        from .composio_toolkits_catalog import get_composio_toolkit_by_key
        found = get_composio_toolkit_by_key(app_key)
        if found:
            return found
    except Exception:
        pass
    all_map = _get_catalog_by_key()
    return all_map.get(app_key)


# ---------------------------------------------------------------------------
# In-memory TTL cache for live Composio API query
# ---------------------------------------------------------------------------
_LIVE_CACHE: dict[str, Any] = {
    "timestamp": 0.0,
    "apps": [],
}
CACHE_TTL_SECONDS = 300.0


def _fetch_live_composio_apps(api_key: str | None = None) -> list[dict[str, Any]]:
    now = time.time()
    if _LIVE_CACHE["apps"] and (now - _LIVE_CACHE["timestamp"]) < CACHE_TTL_SECONDS:
        return _LIVE_CACHE["apps"]

    base_url = (os.environ.get("COMPOSIO_BASE_URL") or "https://backend.composio.dev/api/v1").rstrip("/")
    key = api_key or (os.environ.get("COMPOSIO_API_KEY") or "").strip()
    mock_ai = os.environ.get("MOCK_AI", "1") == "1"

    if mock_ai and not key:
        return []

    headers = {"Accept": "application/json"}
    if key:
        headers["x-api-key"] = key

    try:
        r = httpx.get(f"{base_url}/apps", headers=headers, timeout=3.0)
        if r.status_code == 200:
            data = r.json()
            items = data if isinstance(data, list) else data.get("items") or data.get("apps") or []
            if isinstance(items, list):
                _LIVE_CACHE["timestamp"] = now
                _LIVE_CACHE["apps"] = items
                return items
    except Exception:
        pass
    return []


# ---------------------------------------------------------------------------
# Pydantic In models
# ---------------------------------------------------------------------------
class ConnectIn(BaseModel):
    app_key: str
    auth_mode: str | None = None
    entity_id: str = "default"
    custom_client_id: str | None = None
    custom_client_secret: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    config: dict[str, Any] = {}


def _get_tier_info() -> dict[str, Any]:
    tier = (os.environ.get("COMPOSIO_TIER") or "free").strip().lower()
    if tier not in ("free", "pro"):
        tier = "free"
    whitelabel_enabled = (
        os.environ.get("COMPOSIO_WHITELABEL_ENABLED", "0").strip() == "1" or tier == "pro"
    )
    api_key_configured = bool((os.environ.get("COMPOSIO_API_KEY") or "").strip())
    base_url = (os.environ.get("COMPOSIO_BASE_URL") or "https://backend.composio.dev/api/v1").rstrip("/")
    return {
        "tier": tier,
        "whitelabel_enabled": whitelabel_enabled,
        "api_key_configured": api_key_configured,
        "composio_api_configured": api_key_configured,
        "composio_base_url": base_url,
    }


def _sanitize_tool_schema(raw_schema: dict[str, Any] | None) -> dict[str, Any]:
    if not raw_schema or not isinstance(raw_schema, dict):
        return {"type": "object", "properties": {}}
    schema = dict(raw_schema)
    props = dict(schema.get("properties") or {})
    req = list(schema.get("required") or [])
    # Remove synthetic kwargs/args from inspection
    req = [r for r in req if r not in ("kwargs", "args") and "default" not in props.get(r, {})]
    clean_props = {k: v for k, v in props.items() if k not in ("kwargs", "args")}
    schema["properties"] = clean_props
    schema["required"] = req
    return schema


def _audit(c, tenant_id: str, event: str, detail: dict, actor: str = "system"):
    c.execute(
        "insert into audit_log (tenant_id, actor, service, event, workflow_id, detail) values (%s,%s,'execution',%s,%s,%s)",
        (tenant_id, actor, event, None, json.dumps(detail or {})),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/apps")
def list_marketplace_apps(
    provider: str | None = Query(None, description="Filter by provider: all, composio, fastmcp"),
    category: str | None = Query(None, description="Filter by category"),
    search: str | None = Query(None, description="Search query across name, key, description, modules"),
    limit: int = Query(50, ge=0, description="Max apps to return (0 for all)"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    ctx: Ctx = Depends(current),
):
    tenant_id = ctx.tenant_id
    info = _get_tier_info()
    with get_connection() as c:
        rows = c.execute(
            "select id, app_key, app_name, status, auth_mode, entity_id, connected_by, config, created_at "
            "from marketplace_connections where tenant_id=%s",
            (tenant_id,),
        ).fetchall()
    conn_by_key = {}
    for r in rows:
        cfg = json.loads(r["config"]) if isinstance(r.get("config"), str) else (r.get("config") or {})
        conn_by_key[r["app_key"]] = {
            "id": str(r["id"]),
            "status": r["status"],
            "auth_mode": r["auth_mode"],
            "entity_id": r["entity_id"] or "default",
            "connected_by": r.get("connected_by"),
            "created_at": str(r["created_at"]),
            "redirect_url": cfg.get("redirect_url"),
            "config": cfg,
        }

    all_catalog = _get_all_catalog()

    # Unfiltered counts across entire catalog
    total_count = len(all_catalog)
    composio_count = sum(1 for a in all_catalog if a.get("provider") == "composio")
    fastmcp_count = sum(1 for a in all_catalog if a.get("provider") == "fastmcp")
    connected_count = sum(1 for a in all_catalog if conn_by_key.get(a["key"], {}).get("status") in ("connected", "pending_auth"))
    counts = {
        "total": total_count,
        "composio": composio_count,
        "fastmcp": fastmcp_count,
        "connected": connected_count,
    }

    # Aggregate categories across all_catalog
    cats_dict: dict[str, int] = {}
    for a in all_catalog:
        cat_name = a.get("category") or "General"
        cats_dict[cat_name] = cats_dict.get(cat_name, 0) + 1
    categories_list = [
        {"name": c_name, "count": c_count}
        for c_name, c_count in sorted(cats_dict.items(), key=lambda x: -x[1])
    ]

    # Filter by provider
    filtered_apps = all_catalog
    if provider and provider.strip().lower() != "all":
        p = provider.strip().lower()
        filtered_apps = [a for a in filtered_apps if a.get("provider", "").strip().lower() == p]

    # Filter by category
    if category and category.strip().lower() != "all":
        c_low = category.strip().lower()

        def _cat_match(cat_str: str) -> bool:
            c1 = (cat_str or "").strip().lower()
            if c1 == c_low:
                return True
            # Handle unencoded URL query '&' splits (e.g. 'Developer Tools ' matching 'Developer Tools & DevOps')
            if c1.startswith(c_low) or c_low.startswith(c1):
                return True
            target_words = set(c_low.replace("&", " ").split())
            item_words = set(c1.replace("&", " ").split())
            return bool(target_words and target_words.issubset(item_words))

        filtered_apps = [a for a in filtered_apps if _cat_match(a.get("category", ""))]

    # Filter by search
    if search and search.strip():
        s = search.strip().lower()

        def _matches_search(a: dict[str, Any]) -> bool:
            if s in a.get("name", "").lower():
                return True
            if s in a.get("key", "").lower():
                return True
            if s in a.get("description", "").lower():
                return True
            for m in a.get("modules", []):
                if s in str(m).lower():
                    return True
            for t in a.get("tools", []):
                if s in t.get("name", "").lower() or s in t.get("action", "").lower() or s in t.get("description", "").lower():
                    return True
            return False

        filtered_apps = [a for a in filtered_apps if _matches_search(a)]

    total_filtered = len(filtered_apps)

    # Pagination: limit=50 by default, 0 returns all
    if limit > 0:
        paged_items = filtered_apps[offset : offset + limit]
        has_more = (offset + limit) < total_filtered
    else:
        paged_items = filtered_apps[offset:]
        has_more = False

    pagination = {
        "total": total_filtered,
        "limit": limit,
        "offset": offset,
        "has_more": has_more,
    }

    apps = []
    for item in paged_items:
        cn = conn_by_key.get(item["key"])
        is_connected = cn is not None and cn.get("status") in ("connected", "pending_auth")
        apps.append({
            **item,
            "connected": is_connected,
            "connection": cn,
        })

    return {
        **info,
        "apps": apps,
        "counts": counts,
        "pagination": pagination,
        "categories": categories_list,
    }


@router.post("/connect")
def connect_marketplace_app(req: ConnectIn, ctx: Ctx = Depends(require("admin", "engineer"))):
    app_def = _find_app_by_key(req.app_key)
    if not app_def:
        raise HTTPException(404, f"Unknown marketplace integration: {req.app_key}")

    info = _get_tier_info()
    auth_mode = req.auth_mode or ("fastmcp" if app_def.get("provider") == "fastmcp" else "composio")

    if auth_mode == "whitelabel_oauth" and not info["whitelabel_enabled"]:
        raise HTTPException(
            402,
            "White-label custom OAuth requires COMPOSIO_TIER=pro (or COMPOSIO_WHITELABEL_ENABLED=1). Use Free Tier managed connection for now.",
        )

    tenant_id = ctx.tenant_id
    api_key = req.api_key or req.config.get("composio_api_key") or (os.environ.get("COMPOSIO_API_KEY") or "").strip()
    base_url = info["composio_base_url"]
    redirect_url = None
    remote_conn_id = None

    if app_def.get("provider") == "composio":
        if api_key and os.environ.get("MOCK_AI", "1") != "1":
            try:
                # 1. Attempt live call to Composio Platform API
                headers = {"x-api-key": api_key, "Content-Type": "application/json"}
                # Try v3 connected_accounts/link
                link_url = "https://backend.composio.dev/api/v3/connected_accounts/link"
                payload = {
                    "user_id": tenant_id,
                    "auth_config_id": req.app_key,
                    "callback_url": f"http://localhost:3000/marketplace?status=connected&app={req.app_key}",
                }
                r = httpx.post(link_url, headers=headers, json=payload, timeout=5.0)
                if r.status_code >= 400:
                    # Try v1/connectedAccounts
                    r = httpx.post(
                        f"{base_url}/connectedAccounts",
                        headers=headers,
                        json={
                            "appName": app_def.get("composio_app", req.app_key.upper()),
                            "entityId": req.entity_id or "default",
                        },
                        timeout=5.0,
                    )
                if r.status_code < 400:
                    data = r.json()
                    redirect_url = data.get("redirect_url") or data.get("redirectUrl") or data.get("link")
                    remote_conn_id = data.get("connectionId") or data.get("id")
            except Exception:
                pass

        # 2. If no API key or call fails/offline, generate authentic direct Composio Connect link URL
        if not redirect_url:
            redirect_url = f"https://connect.composio.dev/link/new?toolkit={req.app_key}&tenant={tenant_id}"

    conn_id = str(uuid.uuid4())
    now_str = datetime.datetime.now(datetime.timezone.utc).isoformat()
    cfg = {
        "whitelabel": auth_mode == "whitelabel_oauth",
        "has_custom_oauth": bool(req.custom_client_id),
        "base_url": req.base_url or req.config.get("base_url"),
        "has_api_key": bool(api_key or req.api_key),
        "redirect_url": redirect_url,
        "remote_connection_id": remote_conn_id,
        **req.config,
    }

    from .main import ensure_seeded

    with get_connection() as c:
        ensure_seeded(c, tenant_id)
        c.execute(
            "insert into marketplace_connections (id, tenant_id, app_key, app_name, status, auth_mode, entity_id, connected_by, config) "
            "values (%s,%s,%s,%s,'connected',%s,%s,%s,%s) "
            "on conflict (tenant_id, app_key) do update set "
            "status='connected', auth_mode=excluded.auth_mode, entity_id=excluded.entity_id, "
            "connected_by=excluded.connected_by, config=excluded.config",
            (
                conn_id,
                tenant_id,
                req.app_key,
                app_def["name"],
                auth_mode,
                req.entity_id or "default",
                ctx.email,
                json.dumps(cfg),
            ),
        )
        registered_tools = []
        is_fastmcp = app_def.get("provider") == "fastmcp"
        connector_name = "fastmcp" if is_fastmcp else "composio"

        for t in app_def.get("tools", []):
            secret_ref = f"{req.app_key}:{t['name']}"
            sanitized_schema = _sanitize_tool_schema(t.get("input_schema"))
            c.execute(
                "insert into tools (tenant_id, name, description, input_schema, connector, secret_ref, risk) "
                "values (%s,%s,%s,%s,%s,%s,%s) "
                "on conflict (tenant_id, name) do update set "
                "description=excluded.description, input_schema=excluded.input_schema, "
                "connector=excluded.connector, secret_ref=excluded.secret_ref, risk=excluded.risk",
                (
                    tenant_id,
                    t["name"],
                    t.get("description", ""),
                    json.dumps(sanitized_schema),
                    connector_name,
                    secret_ref,
                    t.get("risk", "medium"),
                ),
            )
            registered_tools.append(t["name"])

        _audit(
            c,
            tenant_id,
            "marketplace.connected",
            {"app_key": req.app_key, "auth_mode": auth_mode, "tools": registered_tools},
            actor=ctx.email,
        )
        row = c.execute(
            "select id, status, auth_mode, entity_id, connected_by, created_at "
            "from marketplace_connections where tenant_id=%s and app_key=%s",
            (tenant_id, req.app_key),
        ).fetchone()
        c.commit()

    connection_out = {
        "id": str(row["id"]) if row else conn_id,
        "status": row["status"] if row else "connected",
        "auth_mode": row["auth_mode"] if row else auth_mode,
        "entity_id": (row["entity_id"] if row else req.entity_id) or "default",
        "connected_by": row.get("connected_by") if row else ctx.email,
        "created_at": str(row["created_at"]) if row else now_str,
    }
    if redirect_url:
        connection_out["redirect_url"] = redirect_url

    return {
        "ok": True,
        "status": "connected",
        "app_key": req.app_key,
        "redirect_url": redirect_url,
        "registered_tools": registered_tools,
        "tools_registered": len(registered_tools),
        "message": f"Direct connect initiated for {req.app_key}. Redirecting to Composio Connect.",
        "connection": connection_out,
    }


@router.delete("/connections/{app_key}")
def disconnect_marketplace_app(app_key: str, ctx: Ctx = Depends(require("admin", "engineer"))):
    app_def = _find_app_by_key(app_key)
    if not app_def:
        raise HTTPException(404, f"Unknown marketplace integration: {app_key}")

    tenant_id = ctx.tenant_id
    with get_connection() as c:
        c.execute(
            "delete from marketplace_connections where tenant_id=%s and app_key=%s",
            (tenant_id, app_key),
        )
        for t in app_def.get("tools", []):
            c.execute(
                "delete from tools where tenant_id=%s and name=%s",
                (tenant_id, t["name"]),
            )
        _audit(c, tenant_id, "marketplace.disconnected", {"app_key": app_key}, actor=ctx.email)
        c.commit()

    return {"ok": True, "app_key": app_key}


@router.post("/test/{app_key}")
def test_marketplace_app(
    app_key: str,
    payload: dict[str, Any] | None = None,
    ctx: Ctx = Depends(require("admin", "engineer")),
):
    app_def = _find_app_by_key(app_key)
    if not app_def:
        raise HTTPException(404, f"Unknown marketplace integration: {app_key}")

    tenant_id = ctx.tenant_id
    with get_connection() as c:
        row = c.execute(
            "select * from marketplace_connections where tenant_id=%s and app_key=%s and status='connected'",
            (tenant_id, app_key),
        ).fetchone()
        if not row:
            raise HTTPException(404, f"Integration '{app_key}' is not connected for this tenant")

        # Determine target tool and action
        action_name = None
        if payload and isinstance(payload, dict):
            action_name = payload.get("action") or payload.get("tool_name")

        tool_def = None
        if action_name and app_def.get("tools"):
            for t in app_def["tools"]:
                if t.get("action") == action_name or t.get("name") == action_name:
                    tool_def = t
                    break

        if not tool_def:
            tool_def = app_def["tools"][0] if app_def.get("tools") else {"name": f"{app_key}_test"}

        tool_name = tool_def.get("name", f"{app_key}_test")
        chosen_action = action_name or tool_name
        secret_ref = f"{app_key}:{tool_name}"
        conn_config = json.loads(row.get("config") or "{}") if isinstance(row.get("config"), str) else (row.get("config") or {})

        test_params = {
            "action": chosen_action,
            "tool_name": tool_name,
            "app_key": app_key,
            "entity_id": row.get("entity_id") or "default",
            "test_ping": True,
            "config": conn_config,
            **(payload or {}),
        }

        if app_def.get("provider") == "fastmcp":
            out = connectors.get("fastmcp").execute("fastmcp", secret_ref, test_params)
        else:
            out = connectors.get("composio").execute("composio", secret_ref, test_params)

        _audit(
            c,
            tenant_id,
            "marketplace.tested",
            {"app_key": app_key, "tool": tool_name, "simulated": out.get("simulated", True)},
            actor=ctx.email,
        )
        c.commit()

    return {"ok": True, "app_key": app_key, "result": out}
