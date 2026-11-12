"""Industrial FastMCP Enterprise Servers & Tool Integrations.

Provides dedicated FastMCP server instances and REST/OData-backed tools for:
- SAP S/4HANA & Business Suite (MM, PP, SD, QM, PM/EAM, FI/CO, EWM)
- Siemens Xcelerator (Teamcenter PLM, Opcenter MES, NX CAD, Simcenter CAE, MindSphere IIoT, Tecnomatix)
- Rockwell Automation (FactoryTalk MES, Studio 5000 Logix PLC, Plex Smart Mfg, Fiix CMMS)
- Dassault Systèmes (ENOVIA PLM, DELMIA & Apriso MES, SOLIDWORKS PDM, SIMULIA CAE)
- PTC (Windchill PDMLink, MPMLink Manufacturing, ThingWorx IIoT, Creo CAD)
- Oracle Cloud SCM & NetSuite Manufacturing (WIP, Inventory, Procurement)
"""
from __future__ import annotations

import datetime
import inspect
import json
import logging
import os
import uuid
from typing import Any, Callable, Dict, List, Optional, Union

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

logger = logging.getLogger("execution.industrial_mcp")

# ==============================================================================
# FastMCP Compatibility Layer & Fallback
# ==============================================================================

try:
    from fastmcp import FastMCP as RealFastMCP
    _HAS_FASTMCP = True
except Exception:
    RealFastMCP = None
    _HAS_FASTMCP = False


class ToolMetadata:
    """Stores schema and callable metadata for an MCP registered tool."""

    def __init__(
        self,
        name: str,
        description: str,
        fn: Callable[..., Any],
        parameters_schema: dict[str, Any],
        module: str = "",
        endpoint: str = "",
        action: str = "",
        risk: str = "low",
    ):
        self.name = name
        self.description = description
        self.fn = fn
        self.parameters_schema = parameters_schema
        self.module = module
        self.endpoint = endpoint
        self.action = action or name.upper()
        self.risk = risk


def _type_to_schema(type_hint: Any) -> dict[str, Any]:
    if type_hint in (str,):
        return {"type": "string"}
    elif type_hint in (int,):
        return {"type": "integer"}
    elif type_hint in (float,):
        return {"type": "number"}
    elif type_hint in (bool,):
        return {"type": "boolean"}
    elif type_hint in (list, List):
        return {"type": "array", "items": {"type": "string"}}
    elif type_hint in (dict, Dict):
        return {"type": "object"}
    return {"type": "string"}


def _generate_schema_from_fn(fn: Callable[..., Any]) -> dict[str, Any]:
    """Inspect function parameters and build a standard JSON Schema."""
    sig = inspect.signature(fn)
    properties: dict[str, Any] = {}
    required: list[str] = []

    for param_name, param in sig.parameters.items():
        if param_name in ("config", "self"):
            continue
        type_schema = {"type": "string"}
        if param.annotation != inspect.Parameter.empty:
            type_schema = _type_to_schema(param.annotation)

        if param.default != inspect.Parameter.empty and param.default is not None:
            type_schema["default"] = param.default
        elif param.default == inspect.Parameter.empty:
            required.append(param_name)

        properties[param_name] = type_schema

    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


class FastMCP:
    """FastMCP server wrapping upstream FastMCP or providing resilient in-memory tool dispatch."""

    def __init__(self, name: str = "IndustrialMCP", **kwargs: Any) -> None:
        self.name = name
        self.tools: dict[str, Callable[..., Any]] = {}
        self.tool_metadata: dict[str, ToolMetadata] = {}

        if _HAS_FASTMCP and RealFastMCP is not None:
            try:
                self._real_mcp = RealFastMCP(name, **kwargs)
            except Exception:
                self._real_mcp = None
        else:
            self._real_mcp = None

    def tool(
        self,
        name: Optional[str] = None,
        description: Optional[str] = None,
        module: str = "",
        endpoint: str = "",
        action: str = "",
        risk: str = "low",
        custom_schema: Optional[dict[str, Any]] = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator to register an MCP tool."""

        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            tool_name = name or fn.__name__
            tool_desc = description or (fn.__doc__ or "").strip().split("\n")[0]
            schema = custom_schema or _generate_schema_from_fn(fn)

            meta = ToolMetadata(
                name=tool_name,
                description=tool_desc,
                fn=fn,
                parameters_schema=schema,
                module=module,
                endpoint=endpoint,
                action=action or tool_name.upper(),
                risk=risk,
            )
            self.tools[tool_name] = fn
            self.tool_metadata[tool_name] = meta

            if self._real_mcp and hasattr(self._real_mcp, "tool"):
                try:
                    self._real_mcp.tool(name=tool_name, description=tool_desc)(fn)
                except Exception:
                    pass
            return fn

        return decorator

    def call_tool(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        """Invoke tool by name with arguments, filtering out unaccepted keywords."""
        if tool_name not in self.tools:
            raise KeyError(f"Tool '{tool_name}' not registered on server '{self.name}'")
        fn = self.tools[tool_name]
        sig = inspect.signature(fn)
        has_kwargs = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())

        if has_kwargs:
            filtered_args = arguments
        else:
            valid_keys = set(sig.parameters.keys())
            filtered_args = {k: v for k, v in arguments.items() if k in valid_keys}

        return fn(**filtered_args)


# ==============================================================================
# FastMCP Server Instances
# ==============================================================================

sap_mcp = FastMCP("sap_s4hana")
siemens_mcp = FastMCP("siemens_xcelerator")
rockwell_mcp = FastMCP("rockwell_factorytalk")
dassault_mcp = FastMCP("dassault_3dexperience")
ptc_mcp = FastMCP("ptc_windchill")
oracle_mcp = FastMCP("oracle_scm")


# ==============================================================================
# SAP S/4HANA & Business Suite Tools
# Modules: MM, PP, SD, QM, PM/EAM, FI/CO, EWM
# ==============================================================================

@sap_mcp.tool(
    name="sap_mm_get_material_master",
    action="SAP_MM_GET_MATERIAL_MASTER",
    module="MM (Materials Management)",
    endpoint="/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product",
    description="Retrieve S/4HANA Material Master record (MARA/MARC) via OData API_PRODUCT_SRV",
    risk="low",
)
def sap_mm_get_material_master(material_id: str = "MAT-100-24", plant: str = "1000", **kwargs: Any) -> dict[str, Any]:
    """Query material master record."""
    is_raw = material_id.upper().startswith("RAW")
    return {
        "d": {
            "Product": material_id,
            "ProductType": "ROH" if is_raw else "FERT",
            "BaseUnit": "KG" if is_raw else "EA",
            "ProductGroup": "01",
            "GrossWeight": 14.5,
            "NetWeight": 12.2,
            "WeightUnit": "KG",
            "Plant": plant,
            "PurchasingGroup": "001",
            "ValuationClass": "3000" if is_raw else "7920",
            "StandardPrice": 85.50 if is_raw else 450.00,
            "Currency": "USD",
            "Status": "Active",
            "Description": f"Industrial Engineered Component {material_id}",
            "CreatedOn": "2026-01-15T00:00:00Z",
        }
    }


@sap_mcp.tool(
    name="sap_mm_create_purchase_order",
    action="SAP_MM_CREATE_PURCHASE_ORDER",
    module="MM (Materials Management)",
    endpoint="/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder",
    description="Create standard Purchase Order in S/4HANA via API_PURCHASEORDER_PROCESS_SRV",
    risk="medium",
)
def sap_mm_create_purchase_order(
    supplier: str = "VEND-00129",
    items: Optional[list[dict[str, Any]]] = None,
    company_code: str = "1000",
    purchasing_org: str = "1000",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create purchase order."""
    num_suffix = abs(hash(supplier + company_code)) % 90000 + 10000
    po_num = f"45000{num_suffix}"
    item_list = items or [{"material": "RAW-ALU-6061", "quantity": 100, "net_price": 28.50}]
    return {
        "PurchaseOrder": po_num,
        "CompanyCode": company_code,
        "PurchasingOrganization": purchasing_org,
        "Supplier": supplier,
        "DocumentType": "NB",
        "Status": "Created",
        "TotalNetPrice": round(sum(i.get("quantity", 1) * i.get("net_price", 25.0) for i in item_list), 2),
        "Currency": "USD",
        "CreatedDate": datetime.date.today().isoformat(),
        "ItemsCount": len(item_list),
    }


@sap_mcp.tool(
    name="sap_mm_check_stock_overview",
    action="SAP_MM_CHECK_STOCK_OVERVIEW",
    module="MM (Materials Management)",
    endpoint="/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MatlStkInAcctMod",
    description="Check unrestricted, inspection, blocked and reserved stock levels",
    risk="low",
)
def sap_mm_check_stock_overview(
    material_id: str = "MAT-100-24",
    plant: str = "1000",
    storage_location: str = "0001",
    **kwargs: Any,
) -> dict[str, Any]:
    """Check stock availability across bins."""
    return {
        "Material": material_id,
        "Plant": plant,
        "StorageLocation": storage_location,
        "UnrestrictedStock": 1420.0,
        "QualityInspectionStock": 50.0,
        "BlockedStock": 0.0,
        "ReservedStock": 120.0,
        "UnitOfMeasure": "EA",
        "BatchManaged": True,
    }


@sap_mcp.tool(
    name="sap_pp_create_production_order",
    action="SAP_PP_CREATE_PRODUCTION_ORDER",
    module="PP (Production Planning)",
    endpoint="/sap/opu/odata/sap/API_PRODUCTION_ORDER_2_SRV/A_ProductionOrder2",
    description="Create production order with routing explosion and component allocation",
    risk="medium",
)
def sap_pp_create_production_order(
    material_id: str = "MAT-100-24",
    target_quantity: float = 250.0,
    start_date: str = "",
    plant: str = "1000",
    order_type: str = "PP01",
    **kwargs: Any,
) -> dict[str, Any]:
    """Dispatch production order."""
    ord_num = f"100{abs(hash(material_id)) % 90000 + 10000}"
    return {
        "ProductionOrder": ord_num,
        "ProductionPlant": plant,
        "Material": material_id,
        "OrderType": order_type,
        "TargetQuantity": target_quantity,
        "Unit": "EA",
        "OrderStatus": "CRTD REL",
        "PlannedStartDate": start_date or datetime.date.today().isoformat(),
        "RoutingNumber": "ROUT-50029",
        "OperationsCount": 4,
    }


@sap_mcp.tool(
    name="sap_pp_explode_bom",
    action="SAP_PP_EXPLODE_BOM",
    module="PP (Production Planning)",
    endpoint="/sap/opu/odata/sap/API_BILL_OF_MATERIAL_SRV/A_BillOfMaterial",
    description="Explode multi-level Bill of Materials (BOM) for manufacturing assembly",
    risk="low",
)
def sap_pp_explode_bom(
    material_id: str = "MAT-100-24",
    plant: str = "1000",
    bom_usage: str = "1",
    alternative: str = "1",
    **kwargs: Any,
) -> dict[str, Any]:
    """Explode BOM structure."""
    return {
        "BOMHeader": {
            "Material": material_id,
            "Plant": plant,
            "BOMUsage": bom_usage,
            "AlternativeBOM": alternative,
            "Status": "Active",
        },
        "Components": [
            {"ItemNumber": "0010", "Component": "RAW-ALU-6061", "Description": "Aluminum Billet 6061-T6", "Quantity": 2.5, "Unit": "KG", "ScrapRate": 2.0},
            {"ItemNumber": "0020", "Component": "FAST-M8-BOLT", "Description": "Grade 8.8 M8 Hex Flange Bolt", "Quantity": 8.0, "Unit": "EA", "ScrapRate": 0.5},
            {"ItemNumber": "0030", "Component": "SEAL-NBR-O", "Description": "NBR Nitrile O-Ring 32x3mm", "Quantity": 2.0, "Unit": "EA", "ScrapRate": 1.0},
        ],
    }


@sap_mcp.tool(
    name="sap_pp_confirm_operation",
    action="SAP_PP_CONFIRM_OPERATION",
    module="PP (Production Planning)",
    endpoint="/sap/opu/odata/sap/API_PROD_ORDER_CONFIRMATION_2_SRV/A_ProdOrderConf2",
    description="Confirm operation yield, scrap, and actual machine/labor hours",
    risk="medium",
)
def sap_pp_confirm_operation(
    order_id: str = "10029341",
    operation_number: str = "0010",
    yield_quantity: float = 50.0,
    scrap_quantity: float = 1.0,
    personnel_number: str = "EMP001",
    **kwargs: Any,
) -> dict[str, Any]:
    """Confirm production order operation execution."""
    return {
        "Confirmation": f"CONF-{abs(hash(order_id + operation_number)) % 900000 + 100000}",
        "ProductionOrder": order_id,
        "Operation": operation_number,
        "YieldQuantity": yield_quantity,
        "ScrapQuantity": scrap_quantity,
        "ConfirmationType": "Final",
        "LaborHoursActual": round(yield_quantity * 0.15, 2),
        "MachineHoursActual": round(yield_quantity * 0.22, 2),
        "PersonnelNumber": personnel_number,
        "Status": "CNF",
    }


@sap_mcp.tool(
    name="sap_sd_create_sales_order",
    action="SAP_SD_CREATE_SALES_ORDER",
    module="SD (Sales & Distribution)",
    endpoint="/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder",
    description="Create customer Sales Order with pricing condition resolution",
    risk="medium",
)
def sap_sd_create_sales_order(
    sold_to_party: str = "CUST-8801",
    order_type: str = "OR",
    items: Optional[list[dict[str, Any]]] = None,
    sales_org: str = "1000",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create customer sales order."""
    so_num = f"00000{abs(hash(sold_to_party)) % 90000 + 10000}"
    return {
        "SalesOrder": so_num,
        "OrderType": order_type,
        "SalesOrganization": sales_org,
        "SoldToParty": sold_to_party,
        "NetValue": 32500.00,
        "Currency": "USD",
        "PricingDate": datetime.date.today().isoformat(),
        "DeliveryStatus": "Not Delivered",
    }


@sap_mcp.tool(
    name="sap_sd_check_atp_delivery",
    action="SAP_SD_CHECK_ATP_DELIVERY",
    module="SD (Sales & Distribution)",
    endpoint="/sap/opu/odata/sap/API_OUTBOUND_DELIVERY_SRV/A_OutbDeliveryHeader",
    description="Run Available-to-Promise (ATP) check and delivery scheduling",
    risk="low",
)
def sap_sd_check_atp_delivery(
    material_id: str = "MAT-100-24",
    required_quantity: float = 100.0,
    delivery_date: str = "",
    plant: str = "1000",
    **kwargs: Any,
) -> dict[str, Any]:
    """Execute ATP delivery confirmation."""
    return {
        "Material": material_id,
        "Plant": plant,
        "RequestedQuantity": required_quantity,
        "ConfirmedQuantity": required_quantity,
        "ATPStatus": "CONFIRMED",
        "ConfirmedDeliveryDate": delivery_date or datetime.date.today().isoformat(),
        "AvailableStock": 1420.0,
    }


@sap_mcp.tool(
    name="sap_qm_create_inspection_lot",
    action="SAP_QM_CREATE_INSPECTION_LOT",
    module="QM (Quality Management)",
    endpoint="/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLot",
    description="Trigger QM inspection lot generation with sampling procedure",
    risk="low",
)
def sap_qm_create_inspection_lot(
    material_id: str = "MAT-100-24",
    plant: str = "1000",
    origin: str = "01",
    lot_quantity: float = 50.0,
    **kwargs: Any,
) -> dict[str, Any]:
    """Create quality inspection lot."""
    lot_id = f"01000{abs(hash(material_id)) % 900000 + 100000}"
    return {
        "InspectionLot": lot_id,
        "Material": material_id,
        "Plant": plant,
        "InspectionLotOrigin": origin,
        "LotQuantity": lot_quantity,
        "Status": "REL",
        "SamplingProcedure": "ISO2859_S3_NORMAL",
        "SampleSize": 8,
    }


@sap_mcp.tool(
    name="sap_qm_record_usage_decision",
    action="SAP_QM_RECORD_USAGE_DECISION",
    module="QM (Quality Management)",
    endpoint="/sap/opu/odata/sap/API_INSPECTIONLOT_SRV/A_InspectionLotUD",
    description="Record quality usage decision (UD) and trigger inventory posting",
    risk="medium",
)
def sap_qm_record_usage_decision(
    lot_id: str = "0100029481",
    decision_code: str = "A",
    quality_score: int = 100,
    comments: str = "Inspected and approved per ISO9001 specs",
    **kwargs: Any,
) -> dict[str, Any]:
    """Record usage decision."""
    return {
        "InspectionLot": lot_id,
        "UsageDecision": decision_code,
        "Valuation": "Accepted" if decision_code == "A" else "Rejected",
        "QualityScore": quality_score,
        "InventoryPosting": "PostedToUnrestricted" if decision_code == "A" else "PostedToBlocked",
        "DecidedBy": "QM_AGENT",
        "Comments": comments,
    }


@sap_mcp.tool(
    name="sap_pm_create_maintenance_notification",
    action="SAP_PM_CREATE_MAINTENANCE_NOTIFICATION",
    module="PM/EAM (Plant Maintenance)",
    endpoint="/sap/opu/odata/sap/API_MAINTNOTIFICATION/A_MaintenanceNotification",
    description="Create plant maintenance notification for equipment anomaly or breakdown",
    risk="low",
)
def sap_pm_create_maintenance_notification(
    equipment_id: str = "EQ-CNC-04",
    notification_type: str = "M1",
    description: str = "Spindle bearing abnormal vibration detected",
    priority: str = "2",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create equipment maintenance notification."""
    notif_num = f"1000{abs(hash(equipment_id)) % 90000 + 10000}"
    return {
        "NotificationNumber": notif_num,
        "Equipment": equipment_id,
        "NotificationType": notification_type,
        "Description": description,
        "Priority": priority,
        "Status": "OSNO",
        "Breakdown": False,
    }


@sap_mcp.tool(
    name="sap_pm_create_work_order",
    action="SAP_PM_CREATE_WORK_ORDER",
    module="PM/EAM (Plant Maintenance)",
    endpoint="/sap/opu/odata/sap/API_MAINTENANCEORDER/A_MaintenanceOrder",
    description="Dispatch corrective or preventive Maintenance Work Order (PM01/PM02)",
    risk="medium",
)
def sap_pm_create_work_order(
    equipment_id: str = "EQ-CNC-04",
    order_type: str = "PM01",
    description: str = "Replace spindle bearing assembly",
    planner_group: str = "100",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create maintenance order."""
    ord_num = f"4000{abs(hash(equipment_id)) % 90000 + 10000}"
    return {
        "MaintenanceOrder": ord_num,
        "Equipment": equipment_id,
        "OrderType": order_type,
        "Description": description,
        "PlannerGroup": planner_group,
        "Status": "CRTD",
        "AssignedWorkCenter": "MECH-01",
        "EstimatedHours": 4.5,
    }


@sap_mcp.tool(
    name="sap_fico_post_cost_allocation",
    action="SAP_FICO_POST_COST_ALLOCATION",
    module="FI/CO (Finance & Controlling)",
    endpoint="/sap/opu/odata/sap/API_JOURNALENTRY_SRV/A_JournalEntryCreate",
    description="Post direct internal activity and cost allocation journal entry",
    risk="medium",
)
def sap_fico_post_cost_allocation(
    company_code: str = "1000",
    cost_center: str = "CC-PROD-01",
    amount: float = 1250.00,
    currency: str = "USD",
    gl_account: str = "600100",
    **kwargs: Any,
) -> dict[str, Any]:
    """Post cost journal entry."""
    doc_num = f"1000{abs(hash(cost_center)) % 900000 + 100000}"
    return {
        "JournalEntry": doc_num,
        "CompanyCode": company_code,
        "FiscalYear": "2026",
        "CostCenter": cost_center,
        "GLAccount": gl_account,
        "Amount": amount,
        "Currency": currency,
        "Status": "Posted",
    }


@sap_mcp.tool(
    name="sap_fico_get_production_variance",
    action="SAP_FICO_GET_PRODUCTION_VARIANCE",
    module="FI/CO (Finance & Controlling)",
    endpoint="/sap/opu/odata/sap/API_JOURNALENTRY_SRV/A_ProdOrderVariance",
    description="Calculate target vs actual production variances (price, quantity, total)",
    risk="low",
)
def sap_fico_get_production_variance(
    order_id: str = "10029341",
    fiscal_period: str = "011/2026",
    **kwargs: Any,
) -> dict[str, Any]:
    """Query production cost variance."""
    return {
        "ProductionOrder": order_id,
        "FiscalPeriod": fiscal_period,
        "TargetCost": 22400.00,
        "ActualCost": 21850.00,
        "TotalVariance": -550.00,
        "PriceVariance": -120.00,
        "QuantityVariance": -430.00,
        "VariancePercent": -2.45,
    }


@sap_mcp.tool(
    name="sap_ewm_create_warehouse_task",
    action="SAP_EWM_CREATE_WAREHOUSE_TASK",
    module="EWM (Extended Warehouse)",
    endpoint="/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK_2/A_WarehouseTask",
    description="Create S/4HANA EWM warehouse task for putaway or pick wave",
    risk="medium",
)
def sap_ewm_create_warehouse_task(
    warehouse_number: str = "W001",
    source_bin: str = "REC-STAGE",
    destination_bin: str = "RACK-A12-04",
    material_id: str = "MAT-100-24",
    quantity: float = 50.0,
    **kwargs: Any,
) -> dict[str, Any]:
    """Create EWM warehouse task."""
    wt_num = f"WT-800{abs(hash(source_bin + destination_bin)) % 90000 + 10000}"
    return {
        "WarehouseTask": wt_num,
        "WarehouseNumber": warehouse_number,
        "Material": material_id,
        "SourceBin": source_bin,
        "DestinationBin": destination_bin,
        "Quantity": quantity,
        "Unit": "EA",
        "Status": "Open",
        "AssignedResource": "FORKLIFT-03",
    }


# ==============================================================================
# Siemens Xcelerator Tools
# Modules: Teamcenter PLM, Opcenter MES, NX CAD, Simcenter CAE, MindSphere IIoT, Tecnomatix
# ==============================================================================

@siemens_mcp.tool(
    name="siemens_tc_get_item_revision",
    action="SIEMENS_TC_GET_ITEM_REVISION",
    module="Teamcenter PLM",
    endpoint="/tc/RestServices/Core-2011-06-DataManagement/getItem",
    description="Query Teamcenter PLM Item Revision, lifecycle status and attached CAD datasets",
    risk="low",
)
def siemens_tc_get_item_revision(
    item_id: str = "002914",
    revision_id: str = "A",
    **kwargs: Any,
) -> dict[str, Any]:
    """Retrieve item revision details."""
    return {
        "itemId": item_id,
        "revisionId": revision_id,
        "objectName": f"Structural Bracket Housing {item_id}",
        "releaseStatus": "Approved",
        "owningUser": "eng_lead_01",
        "owningGroup": "Aerospace_Structures",
        "datasets": [
            {"name": f"{item_id}-{revision_id}.prt", "type": "UGPART", "lastModified": "2026-02-10T14:22:00Z"},
            {"name": f"{item_id}-{revision_id}.pdf", "type": "PDF", "lastModified": "2026-02-10T14:25:00Z"},
        ],
    }


@siemens_mcp.tool(
    name="siemens_tc_create_ecn",
    action="SIEMENS_TC_CREATE_ECN",
    module="Teamcenter PLM",
    endpoint="/tc/RestServices/ChangeManagement/createChangeNotice",
    description="Initiate Engineering Change Notice (ECN) workflow with affected items",
    risk="medium",
)
def siemens_tc_create_ecn(
    change_title: str = "Redesign Bracket Mount for Stiffness",
    reason: str = "FEA fatigue deflection optimization",
    affected_items: Optional[list[str]] = None,
    change_type: str = "ECN",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create engineering change notice."""
    ecn_id = f"ECN-2026-{abs(hash(change_title)) % 9000 + 1000}"
    return {
        "changeNoticeId": ecn_id,
        "changeTitle": change_title,
        "changeType": change_type,
        "reason": reason,
        "affectedItems": affected_items or ["002914/A", "002915/A"],
        "workflowState": "Submitted",
        "workflowInstanceId": "WF-994821",
    }


@siemens_mcp.tool(
    name="siemens_tc_get_ebom",
    action="SIEMENS_TC_GET_EBOM",
    module="Teamcenter PLM",
    endpoint="/tc/RestServices/StructureManagement/getBOMWindows",
    description="Extract Engineering Bill of Materials (EBOM) structure and occurrences",
    risk="low",
)
def siemens_tc_get_ebom(
    item_id: str = "002914",
    revision_rule: str = "Latest Released",
    **kwargs: Any,
) -> dict[str, Any]:
    """Extract EBOM structure."""
    return {
        "rootItemId": item_id,
        "revisionRule": revision_rule,
        "occurrencesCount": 3,
        "occurrences": [
            {"findNum": 10, "itemId": "002915", "rev": "A", "name": "Bushing Inner", "qty": 2.0, "unit": "EA"},
            {"findNum": 20, "itemId": "002916", "rev": "B", "name": "Reinforcement Rib", "qty": 1.0, "unit": "EA"},
            {"findNum": 30, "itemId": "002917", "rev": "A", "name": "Flange Retainer", "qty": 4.0, "unit": "EA"},
        ],
    }


@siemens_mcp.tool(
    name="siemens_opcenter_dispatch_work_order",
    action="SIEMENS_OPCENTER_DISPATCH_WORK_ORDER",
    module="Opcenter MES",
    endpoint="/opcenter/api/v1/WorkOrders/Dispatch",
    description="Dispatch work order to machine center with tooling and recipe interlock",
    risk="medium",
)
def siemens_opcenter_dispatch_work_order(
    work_order_id: str = "WO-OP-8821",
    work_center_id: str = "CELL-MILL-02",
    target_start_time: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """Dispatch MES work order."""
    return {
        "workOrderId": work_order_id,
        "workCenterId": work_center_id,
        "dispatchStatus": "Dispatched",
        "queuePosition": 1,
        "toolingVerification": "Passed",
        "cncProgramLoaded": "PRG_BRACKET_OP10.NC",
        "targetStartTime": target_start_time or datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


@siemens_mcp.tool(
    name="siemens_opcenter_log_nonconformance",
    action="SIEMENS_OPCENTER_LOG_NONCONFORMANCE",
    module="Opcenter MES",
    endpoint="/opcenter/api/v1/NonConformance",
    description="File Non-Conformance Report (NCR) and activate physical containment hold",
    risk="medium",
)
def siemens_opcenter_log_nonconformance(
    serial_number: str = "SN-2026-0881",
    defect_code: str = "SURF_DEFECT_04",
    severity: str = "Major",
    notes: str = "Roughness Ra exceeded 1.6um threshold",
    **kwargs: Any,
) -> dict[str, Any]:
    """File MES non-conformance record."""
    ncr_id = f"NCR-{abs(hash(serial_number)) % 90000 + 10000}"
    return {
        "ncrId": ncr_id,
        "serialNumber": serial_number,
        "defectCode": defect_code,
        "severity": severity,
        "notes": notes,
        "containmentHold": "Active",
        "mrbDispositionRequired": True,
    }


@siemens_mcp.tool(
    name="siemens_opcenter_get_oee",
    action="SIEMENS_OPCENTER_GET_OEE",
    module="Opcenter MES",
    endpoint="/opcenter/api/v1/Equipment/OEE",
    description="Retrieve Overall Equipment Effectiveness (OEE) metrics for work center",
    risk="low",
)
def siemens_opcenter_get_oee(
    equipment_id: str = "EQ-MILL-02",
    shift: str = "1",
    **kwargs: Any,
) -> dict[str, Any]:
    """Query OEE metrics."""
    return {
        "equipmentId": equipment_id,
        "shift": shift,
        "oee": 87.4,
        "availability": 92.1,
        "performance": 96.3,
        "quality": 98.7,
        "totalUnits": 450,
        "goodUnits": 444,
        "scrapUnits": 6,
    }


@siemens_mcp.tool(
    name="siemens_nx_extract_pmi_tolerances",
    action="SIEMENS_NX_EXTRACT_PMI_TOLERANCES",
    module="NX CAD",
    endpoint="/nx/api/v1/pmi/extract",
    description="Extract Product and Manufacturing Information (PMI), GD&T, and datum callouts from NX CAD",
    risk="low",
)
def siemens_nx_extract_pmi_tolerances(
    part_number: str = "002914",
    drawing_sheet: int = 1,
    **kwargs: Any,
) -> dict[str, Any]:
    """Extract 3D PMI GD&T tolerances."""
    return {
        "partNumber": part_number,
        "sheet": drawing_sheet,
        "pmiFeatures": [
            {"feature": "Bore Diameter", "nominal": 45.0, "upperTol": 0.025, "lowerTol": 0.0, "unit": "mm"},
            {"feature": "Mounting Hole True Position", "characteristic": "Position", "tolerance": 0.05, "materialCondition": "MMC", "datums": ["A", "B", "C"]},
            {"feature": "Base Surface Flatness", "characteristic": "Flatness", "tolerance": 0.02, "unit": "mm"},
        ],
    }


@siemens_mcp.tool(
    name="siemens_simcenter_run_thermal_stress_check",
    action="SIEMENS_SIMCENTER_RUN_THERMAL_STRESS_CHECK",
    module="Simcenter CAE",
    endpoint="/simcenter/api/v1/simulation/verify",
    description="Execute FEA structural margin and thermal stress simulation verification",
    risk="low",
)
def siemens_simcenter_run_thermal_stress_check(
    cad_model_id: str = "CAD-002914-V3",
    load_kn: float = 12.5,
    max_temperature_c: float = 180.0,
    **kwargs: Any,
) -> dict[str, Any]:
    """Run FEA structural stress check."""
    return {
        "cadModelId": cad_model_id,
        "loadKn": load_kn,
        "maxTempC": max_temperature_c,
        "peakVonMisesStressMPa": 142.6,
        "materialYieldStrengthMPa": 276.0,
        "factorOfSafety": 1.94,
        "thermalExpansionMm": 0.038,
        "simulationStatus": "PASSED",
        "reserveMargin": "+94%",
    }


@siemens_mcp.tool(
    name="siemens_edge_read_plc_tags",
    action="SIEMENS_EDGE_READ_PLC_TAGS",
    module="MindSphere IIoT",
    endpoint="/iot/api/v3/timeseries",
    description="Read real-time Industrial Edge device PLC tags via OPC UA / S7 connector",
    risk="low",
)
def siemens_edge_read_plc_tags(
    asset_id: str = "EDGE-CNC-01",
    tags: Optional[list[str]] = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Read Edge PLC telemetry tags."""
    return {
        "assetId": asset_id,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "readings": {
            "SpindleSpeed_RPM": 4500.0,
            "MotorCurrent_A": 14.2,
            "BearingTemp_C": 48.6,
            "VibrationRMS_mm_s": 0.034,
            "AxisFeedRate_mm_min": 250.0,
        },
    }


@siemens_mcp.tool(
    name="siemens_mindsphere_query_timeseries",
    action="SIEMENS_MINDSPHERE_QUERY_TIMESERIES",
    module="MindSphere IIoT",
    endpoint="/api/iottimeseries/v3/timeseries",
    description="Query historical IIoT telemetry timeseries and asset health index",
    risk="low",
)
def siemens_mindsphere_query_timeseries(
    entity_id: str = "PUMP_STATION_3",
    property_set_name: str = "HydraulicVitals",
    limit: int = 10,
    **kwargs: Any,
) -> dict[str, Any]:
    """Query MindSphere timeseries data."""
    return {
        "entityId": entity_id,
        "propertySet": property_set_name,
        "healthIndex": 96.2,
        "pointsCount": min(limit, 5),
        "data": [
            {"_time": "2026-11-11T12:00:00Z", "FlowRate_LPM": 42.1, "Pressure_Bar": 182.4, "OilTemp_C": 55.2},
            {"_time": "2026-11-11T12:05:00Z", "FlowRate_LPM": 42.0, "Pressure_Bar": 182.6, "OilTemp_C": 55.4},
            {"_time": "2026-11-11T12:10:00Z", "FlowRate_LPM": 41.9, "Pressure_Bar": 182.9, "OilTemp_C": 55.7},
        ],
    }


@siemens_mcp.tool(
    name="siemens_tecnomatix_validate_bop_routing",
    action="SIEMENS_TECNOMATIX_VALIDATE_BOP_ROUTING",
    module="Tecnomatix",
    endpoint="/tecnomatix/api/v1/bop/validate",
    description="Validate Bill of Process (BOP) line balancing, cycle times, and ergonomics",
    risk="low",
)
def siemens_tecnomatix_validate_bop_routing(
    process_id: str = "BOP-ASSY-LINE-1",
    plant_id: str = "PLANT_MUNICH",
    **kwargs: Any,
) -> dict[str, Any]:
    """Validate digital manufacturing routing."""
    return {
        "processId": process_id,
        "plantId": plant_id,
        "validationStatus": "VALID",
        "totalCycleTimeSec": 148.2,
        "taktTimeSec": 160.0,
        "bottleneckOperation": "Station 30 Press Fit",
        "ergonomicsScore": "EAWS 22 (Green)",
        "collisionClearance": "Verified",
    }


# ==============================================================================
# Rockwell Automation Tools
# Modules: FactoryTalk MES, Studio 5000 Logix PLC, Plex Smart Mfg, Fiix CMMS
# ==============================================================================

@rockwell_mcp.tool(
    name="rockwell_ft_dispatch_batch",
    action="ROCKWELL_FT_DISPATCH_BATCH",
    module="FactoryTalk MES",
    endpoint="/factorytalk/api/v1/batch/dispatch",
    description="Dispatch batch manufacturing order in FactoryTalk ProductionCentre",
    risk="medium",
)
def rockwell_ft_dispatch_batch(
    recipe_id: str = "RCP-POLYMER-A",
    batch_size: float = 500.0,
    line_id: str = "LINE_01",
    **kwargs: Any,
) -> dict[str, Any]:
    """Dispatch batch to FactoryTalk."""
    batch_id = f"BATCH-2026-{abs(hash(recipe_id)) % 9000 + 1000}"
    return {
        "batchId": batch_id,
        "recipeId": recipe_id,
        "batchSize": batch_size,
        "lineId": line_id,
        "status": "Executing",
        "phases": ["Pre-heat", "Dose", "Mix", "Discharge"],
        "dispatchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


@rockwell_mcp.tool(
    name="rockwell_ft_record_scrap",
    action="ROCKWELL_FT_RECORD_SCRAP",
    module="FactoryTalk MES",
    endpoint="/factorytalk/api/v1/batch/scrap",
    description="Record scrap event and root cause in FactoryTalk MES",
    risk="medium",
)
def rockwell_ft_record_scrap(
    batch_id: str = "BATCH-2026-904",
    quantity: float = 4.5,
    reason_code: str = "OFF_SPEC_VISCOSITY",
    **kwargs: Any,
) -> dict[str, Any]:
    """Record batch scrap."""
    return {
        "scrapRecordId": f"SCRAP-{abs(hash(batch_id + reason_code)) % 90000 + 10000}",
        "batchId": batch_id,
        "scrapQuantity": quantity,
        "reasonCode": reason_code,
        "cumulativeScrapRatePercent": 0.9,
    }


@rockwell_mcp.tool(
    name="rockwell_plc_read_cip_tags",
    action="ROCKWELL_PLC_READ_CIP_TAGS",
    module="Studio 5000 PLC",
    endpoint="/logix/api/v1/cip/tags/read",
    description="Read EtherNet/IP CIP data tags directly from ControlLogix / CompactLogix PLC",
    risk="low",
)
def rockwell_plc_read_cip_tags(
    ip_address: str = "192.168.1.10",
    slot: int = 0,
    tag_names: Optional[list[str]] = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Read ControlLogix CIP tags."""
    return {
        "ipAddress": ip_address,
        "slot": slot,
        "cipStatus": "SUCCESS",
        "tags": {
            "Program:Main.HydraulicPressure_PSI": 2150.4,
            "Program:Main.CycleCount": 14920,
            "Program:Main.FaultCode": 0,
            "Program:Main.SafetyInterlockOk": True,
            "Program:Main.MotorSpeed_RPM": 1780.0,
        },
    }


@rockwell_mcp.tool(
    name="rockwell_plex_check_lot_traceability",
    action="ROCKWELL_PLEX_CHECK_LOT_TRACEABILITY",
    module="Plex Smart Mfg",
    endpoint="/plex/api/v1/lots/trace",
    description="Query end-to-end genealogy and raw material lot traceability in Plex",
    risk="low",
)
def rockwell_plex_check_lot_traceability(
    lot_number: str = "LOT-2026-X88",
    **kwargs: Any,
) -> dict[str, Any]:
    """Trace lot genealogy in Plex."""
    return {
        "lotNumber": lot_number,
        "status": "APPROVED",
        "supplierHeatNumber": "HEAT-ALU-992",
        "workOrder": "WO-PLEX-4819",
        "operatorId": "OP_3881",
        "inspectionCertificate": "CERT-ISO9001-OK",
        "genealogyTreeDepth": 3,
    }


@rockwell_mcp.tool(
    name="rockwell_plex_get_inventory_balance",
    action="ROCKWELL_PLEX_GET_INVENTORY_BALANCE",
    module="Plex Smart Mfg",
    endpoint="/plex/api/v1/inventory/balance",
    description="Retrieve inventory balances (on-hand, WIP, finished goods) from Plex MES",
    risk="low",
)
def rockwell_plex_get_inventory_balance(
    part_number: str = "P-10042",
    facility: str = "MAIN",
    **kwargs: Any,
) -> dict[str, Any]:
    """Query Plex inventory balances."""
    return {
        "partNumber": part_number,
        "facility": facility,
        "onHandQuantity": 840,
        "wipQuantity": 120,
        "finishedGoods": 720,
        "allocatedQuantity": 150,
        "availableToShip": 570,
    }


@rockwell_mcp.tool(
    name="rockwell_fiix_create_work_request",
    action="ROCKWELL_FIIX_CREATE_WORK_REQUEST",
    module="Fiix CMMS",
    endpoint="/fiix/api/v1/workorders/request",
    description="Generate maintenance work request ticket in Fiix CMMS",
    risk="low",
)
def rockwell_fiix_create_work_request(
    asset_id: str = "AST-PUMP-02",
    issue_description: str = "Seal leak detected on coolant pump",
    urgency: str = "Medium",
    **kwargs: Any,
) -> dict[str, Any]:
    """Submit Fiix maintenance ticket."""
    req_id = f"FIX-{abs(hash(asset_id)) % 9000 + 1000}"
    return {
        "workRequestId": req_id,
        "assetId": asset_id,
        "issueDescription": issue_description,
        "urgency": urgency,
        "assignedTechnician": "TECH_BOB",
        "slaHours": 24,
        "status": "Open",
    }


# ==============================================================================
# Dassault Systèmes Tools
# Modules: ENOVIA PLM, DELMIA & Apriso, SOLIDWORKS PDM, SIMULIA CAE
# ==============================================================================

@dassault_mcp.tool(
    name="dassault_enovia_get_engineering_bom",
    action="DASSAULT_ENOVIA_GET_ENGINEERING_BOM",
    module="ENOVIA PLM",
    endpoint="/enovia/api/v1/ebom",
    description="Retrieve 3DEXPERIENCE ENOVIA Engineering BOM and assembly hierarchy",
    risk="low",
)
def dassault_enovia_get_engineering_bom(
    part_physical_id: str = "PHYS-883910-A",
    depth: int = 2,
    **kwargs: Any,
) -> dict[str, Any]:
    """Extract ENOVIA EBOM."""
    return {
        "physicalId": part_physical_id,
        "revision": "B.2",
        "maturity": "RELEASED",
        "totalMassKg": 28.4,
        "children": [
            {"physicalId": "PHYS-883911-A", "title": "Main Cast Casing", "qty": 1, "massKg": 22.0},
            {"physicalId": "PHYS-883912-B", "title": "Impeller Rotor", "qty": 1, "massKg": 5.2},
            {"physicalId": "PHYS-883913-A", "title": "Gasket Flange", "qty": 2, "massKg": 0.6},
        ],
    }


@dassault_mcp.tool(
    name="dassault_enovia_promote_maturity",
    action="DASSAULT_ENOVIA_PROMOTE_MATURITY",
    module="ENOVIA PLM",
    endpoint="/enovia/api/v1/lifecycle/promote",
    description="Promote 3DEXPERIENCE lifecycle maturity state (e.g., IN_WORK -> RELEASED)",
    risk="medium",
)
def dassault_enovia_promote_maturity(
    part_physical_id: str = "PHYS-883910-A",
    target_state: str = "RELEASED",
    **kwargs: Any,
) -> dict[str, Any]:
    """Promote ENOVIA lifecycle state."""
    return {
        "physicalId": part_physical_id,
        "previousState": "IN_WORK",
        "currentState": target_state,
        "promotedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "electronicSignature": "SIG_VALID_2026_DS",
    }


@dassault_mcp.tool(
    name="dassault_delmia_generate_mbom",
    action="DASSAULT_DELMIA_GENERATE_MBOM",
    module="DELMIA & Apriso",
    endpoint="/delmia/api/v1/mbom/generate",
    description="Derive Manufacturing BOM (MBOM) from EBOM with plant line routing",
    risk="medium",
)
def dassault_delmia_generate_mbom(
    ebom_root_id: str = "PHYS-883910-A",
    plant_code: str = "PLANT_A",
    **kwargs: Any,
) -> dict[str, Any]:
    """Generate DELMIA MBOM."""
    return {
        "ebomRootId": ebom_root_id,
        "plantCode": plant_code,
        "mbomId": f"MBOM-{abs(hash(ebom_root_id)) % 90000 + 10000}",
        "reconciliationScore": 100.0,
        "manufacturingPartsCount": 14,
        "status": "GENERATED",
    }


@dassault_mcp.tool(
    name="dassault_apriso_track_work_center",
    action="DASSAULT_APRISO_TRACK_WORK_CENTER",
    module="DELMIA & Apriso",
    endpoint="/apriso/api/v1/workcenters/status",
    description="Track Apriso MES shopfloor work center throughput and job status",
    risk="low",
)
def dassault_apriso_track_work_center(
    work_center_code: str = "WC-ROBOT-WELD-01",
    **kwargs: Any,
) -> dict[str, Any]:
    """Track Apriso MES work center."""
    return {
        "workCenter": work_center_code,
        "operationalStatus": "RUNNING",
        "activeWorkOrder": "WO-WELD-912",
        "jobEfficiency": 94.2,
        "currentOperator": "EMP_OPERATOR_08",
        "partsProducedThisShift": 84,
    }


@dassault_mcp.tool(
    name="dassault_pdm_get_drawing_metadata",
    action="DASSAULT_PDM_GET_DRAWING_METADATA",
    module="SOLIDWORKS PDM",
    endpoint="/solidworks/pdm/api/v1/drawing",
    description="Retrieve SOLIDWORKS PDM vault drawing status, check-out state, and revision",
    risk="low",
)
def dassault_pdm_get_drawing_metadata(
    document_number: str = "DWG-10029-REV3",
    **kwargs: Any,
) -> dict[str, Any]:
    """Query SOLIDWORKS PDM metadata."""
    return {
        "documentNumber": document_number,
        "vaultState": "Approved",
        "isCheckedOut": False,
        "checkedOutBy": None,
        "cadVersion": "SOLIDWORKS 2026 SP1",
        "drawingPdfUrl": f"https://pdm.internal/drawings/{document_number}.pdf",
    }


@dassault_mcp.tool(
    name="dassault_simulia_verify_structural_margin",
    action="DASSAULT_SIMULIA_VERIFY_STRUCTURAL_MARGIN",
    module="SIMULIA CAE",
    endpoint="/simulia/api/v1/fea/margin",
    description="Verify SIMULIA Abaqus FEA stress convergence and reserve margin factor",
    risk="low",
)
def dassault_simulia_verify_structural_margin(
    sim_job_id: str = "SIM-FEA-9921",
    **kwargs: Any,
) -> dict[str, Any]:
    """Verify SIMULIA FEA job."""
    return {
        "simJobId": sim_job_id,
        "solver": "SIMULIA Abaqus 2026",
        "convergenceStatus": "CONVERGED_SUCCESS",
        "iterations": 12,
        "maxPrincipalStressMPa": 110.2,
        "reserveFactor": 1.68,
        "compliance": "AEROSPACE_FAR25_PASS",
    }


# ==============================================================================
# PTC Tools
# Modules: Windchill PDMLink, MPMLink Manufacturing, ThingWorx IIoT, Creo CAD
# ==============================================================================

@ptc_mcp.tool(
    name="ptc_windchill_get_part_structure",
    action="PTC_WINDCHILL_GET_PART_STRUCTURE",
    module="Windchill PDMLink",
    endpoint="/Windchill/servlet/odata/ProdMgmt/Parts",
    description="Query PTC Windchill OData Part entity and assembly product structure",
    risk="low",
)
def ptc_windchill_get_part_structure(
    part_number: str = "0000000042",
    **kwargs: Any,
) -> dict[str, Any]:
    """Query Windchill part structure."""
    return {
        "partNumber": part_number,
        "version": "B.1",
        "name": f"Turbine Nozzle Assembly {part_number}",
        "lifecycleState": "Under Review",
        "view": "Design",
        "subAssembliesCount": 2,
        "subAssemblies": [
            {"number": "0000000043", "name": "Vane Segment", "quantity": 12},
            {"number": "0000000044", "name": "Shroud Ring", "quantity": 1},
        ],
    }


@ptc_mcp.tool(
    name="ptc_windchill_create_change_request",
    action="PTC_WINDCHILL_CREATE_CHANGE_REQUEST",
    module="Windchill PDMLink",
    endpoint="/Windchill/servlet/odata/ChangeMgmt/ChangeRequests",
    description="Submit Windchill Change Request (WTChangeRequest2) via OData API",
    risk="medium",
)
def ptc_windchill_create_change_request(
    name: str = "CR-Flange-Thickness-Increase",
    description: str = "Increase wall thickness from 3mm to 4.5mm to meet pressure test",
    priority: str = "High",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create Windchill change request."""
    cr_num = f"CR-000{abs(hash(name)) % 9000 + 1000}"
    return {
        "changeRequestId": cr_num,
        "name": name,
        "description": description,
        "priority": priority,
        "lifecycleState": "Pending Analysis",
        "submittedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


@ptc_mcp.tool(
    name="ptc_mpmlink_sync_process_plan",
    action="PTC_MPMLINK_SYNC_PROCESS_PLAN",
    module="MPMLink Manufacturing",
    endpoint="/Windchill/servlet/odata/MPMLink/ProcessPlans",
    description="Synchronize manufacturing process plan operations and plant work centers",
    risk="medium",
)
def ptc_mpmlink_sync_process_plan(
    plan_id: str = "PP-MACHINING-01",
    target_plant: str = "PLANT_01",
    **kwargs: Any,
) -> dict[str, Any]:
    """Synchronize MPMLink process plan."""
    return {
        "processPlanId": plan_id,
        "targetPlant": target_plant,
        "syncStatus": "SYNCHRONIZED",
        "operationsSynced": 6,
        "workCentersAllocated": ["WC_CNC_01", "WC_DEBURR", "WC_CMM_INSPECT"],
    }


@ptc_mcp.tool(
    name="ptc_thingworx_get_asset_health",
    action="PTC_THINGWORX_GET_ASSET_HEALTH",
    module="ThingWorx IIoT",
    endpoint="/Thingworx/Things/Asset/Services/GetHealthStatus",
    description="Query PTC ThingWorx asset telemetry, operating status, and health index",
    risk="low",
)
def ptc_thingworx_get_asset_health(
    thing_name: str = "Motor_Drive_Line2",
    **kwargs: Any,
) -> dict[str, Any]:
    """Query ThingWorx asset health."""
    return {
        "thingName": thing_name,
        "connectionStatus": "ONLINE",
        "healthScore": 94.8,
        "anomalyAlertsCount": 0,
        "telemetry": {
            "bearingTempC": 52.3,
            "loadPercentage": 68.4,
            "rpm": 1490,
            "voltageV": 401.2,
        },
    }


# ==============================================================================
# Oracle Cloud SCM & NetSuite Manufacturing Tools
# Modules: WIP & Manufacturing, Inventory & Procurement, Cost Management
# ==============================================================================

@oracle_mcp.tool(
    name="oracle_scm_create_work_order",
    action="ORACLE_SCM_CREATE_WORK_ORDER",
    module="WIP & Manufacturing",
    endpoint="/fscmRestApi/resources/11.13.18.05/workOrders",
    description="Create Discrete Work Order in Oracle Fusion Cloud SCM",
    risk="medium",
)
def oracle_scm_create_work_order(
    item_number: str = "AS68001",
    quantity: float = 100.0,
    organization_code: str = "M1",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create Oracle Cloud SCM work order."""
    wo_num = f"WO-{abs(hash(item_number)) % 90000 + 10000}"
    return {
        "WorkOrderNumber": wo_num,
        "ItemNumber": item_number,
        "PlannedQuantity": quantity,
        "OrganizationCode": organization_code,
        "Status": "RELEASED",
        "PlannedStartDate": datetime.date.today().isoformat(),
        "OperationsCount": 3,
    }


@oracle_mcp.tool(
    name="oracle_scm_report_operation_transaction",
    action="ORACLE_SCM_REPORT_OPERATION_TRANSACTION",
    module="WIP & Manufacturing",
    endpoint="/fscmRestApi/resources/11.13.18.05/workOrderOperations",
    description="Report completed units and scrap on Oracle SCM work order operation",
    risk="medium",
)
def oracle_scm_report_operation_transaction(
    work_order_number: str = "WO-98214",
    operation_sequence: int = 10,
    completed_quantity: float = 50.0,
    **kwargs: Any,
) -> dict[str, Any]:
    """Report operation transaction."""
    return {
        "TransactionId": f"TXN-{abs(hash(work_order_number)) % 900000 + 100000}",
        "WorkOrderNumber": work_order_number,
        "OperationSequence": operation_sequence,
        "CompletedQuantity": completed_quantity,
        "ScrappedQuantity": 0.0,
        "TransactionStatus": "PROCESSED",
    }


@oracle_mcp.tool(
    name="oracle_scm_reserve_components",
    action="ORACLE_SCM_RESERVE_COMPONENTS",
    module="Inventory & Procurement",
    endpoint="/fscmRestApi/resources/11.13.18.05/inventoryReservations",
    description="Reserve inventory components against production work order demand",
    risk="medium",
)
def oracle_scm_reserve_components(
    item_number: str = "RAW-ALU-6061",
    quantity: float = 250.0,
    demand_source_header: str = "WO-98214",
    **kwargs: Any,
) -> dict[str, Any]:
    """Reserve inventory components."""
    return {
        "ReservationId": f"RSV-{abs(hash(item_number + demand_source_header)) % 90000 + 10000}",
        "ItemNumber": item_number,
        "ReservedQuantity": quantity,
        "DemandSourceHeader": demand_source_header,
        "Subinventory": "STORES",
        "Locator": "A-1-2",
        "Status": "RESERVED",
    }


@oracle_mcp.tool(
    name="oracle_scm_create_purchase_requisition",
    action="ORACLE_SCM_CREATE_PURCHASE_REQUISITION",
    module="Inventory & Procurement",
    endpoint="/fscmRestApi/resources/11.13.18.05/purchaseRequisitions",
    description="Generate purchase requisition in Oracle Cloud Procurement",
    risk="medium",
)
def oracle_scm_create_purchase_requisition(
    preparer: str = "john.doe@company.com",
    items: Optional[list[dict[str, Any]]] = None,
    deliver_to_location: str = "BAY_4",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create purchase requisition."""
    req_num = f"REQ-{abs(hash(preparer)) % 900000 + 100000}"
    item_list = items or [{"item": "RAW-ALU-6061", "quantity": 500}]
    return {
        "RequisitionNumber": req_num,
        "Preparer": preparer,
        "DeliverToLocation": deliver_to_location,
        "Status": "APPROVED",
        "LinesCount": len(item_list),
        "ApprovedAmount": 12500.00,
        "Currency": "USD",
    }


# ==============================================================================
# Master Catalog & Application Definition
# ==============================================================================

MCP_SERVERS: dict[str, FastMCP] = {
    "sap_s4hana": sap_mcp,
    "siemens_xcelerator": siemens_mcp,
    "rockwell_factorytalk": rockwell_mcp,
    "dassault_3dexperience": dassault_mcp,
    "ptc_windchill": ptc_mcp,
    "oracle_scm": oracle_mcp,
}


def _build_app_tools(server: FastMCP, app_key: str) -> list[dict[str, Any]]:
    """Convert registered tools on FastMCP server to marketplace app tools."""
    tools: list[dict[str, Any]] = []
    for tool_name, meta in server.tool_metadata.items():
        tools.append({
            "name": meta.name,
            "action": meta.action,
            "module": meta.module,
            "endpoint": meta.endpoint,
            "description": meta.description,
            "input_schema": meta.parameters_schema,
            "risk": meta.risk,
            "connector": "fastmcp",
            "secret_ref": f"{app_key}:{meta.name}",
        })
    return tools


INDUSTRIAL_MCP_APPS: list[dict[str, Any]] = [
    {
        "key": "sap_s4hana",
        "name": "SAP S/4HANA & Business Suite",
        "category": "ERP & Supply Chain",
        "provider": "fastmcp",
        "modules": [
            "MM (Materials Management)",
            "PP (Production Planning)",
            "SD (Sales & Distribution)",
            "QM (Quality Management)",
            "PM/EAM (Plant Maintenance)",
            "FI/CO (Finance & Controlling)",
            "EWM (Extended Warehouse)",
        ],
        "description": "Comprehensive SAP S/4HANA OData & REST MCP server for materials (MARA/MARC), production orders, BOM explosion, sales orders, quality inspection, maintenance, and warehouse tasks.",
        "composio_app": "SAP_S4HANA_MCP",
        "auth_schemes": ["API_KEY", "OAUTH2", "BASIC"],
        "docs_url": "https://api.sap.com/package/SAPS4HANACloud/all",
        "default_action": "sap_mm_get_material_master",
        "tools": _build_app_tools(sap_mcp, "sap_s4hana"),
    },
    {
        "key": "siemens_xcelerator",
        "name": "Siemens Xcelerator (Teamcenter, Opcenter, NX, MindSphere)",
        "category": "PLM & CAD/CAE",
        "provider": "fastmcp",
        "modules": [
            "Teamcenter PLM",
            "Opcenter MES",
            "NX CAD",
            "Simcenter CAE",
            "MindSphere IIoT",
            "Tecnomatix",
        ],
        "description": "Unified Siemens digital thread MCP server: Teamcenter item revisions and ECNs, Opcenter MES dispatch, NX 3D PMI GD&T extraction, Simcenter FEA, and MindSphere Edge PLC tags.",
        "composio_app": "SIEMENS_XCELERATOR_MCP",
        "auth_schemes": ["API_KEY", "OAUTH2"],
        "docs_url": "https://developer.siemens.com/xcelerator.html",
        "default_action": "siemens_tc_get_item_revision",
        "tools": _build_app_tools(siemens_mcp, "siemens_xcelerator"),
    },
    {
        "key": "rockwell_factorytalk",
        "name": "Rockwell Automation (FactoryTalk, Studio 5000, Plex, Fiix)",
        "category": "MES & Shopfloor IIoT",
        "provider": "fastmcp",
        "modules": [
            "FactoryTalk MES",
            "Studio 5000 PLC",
            "Plex Smart Mfg",
            "Fiix CMMS",
        ],
        "description": "Rockwell Connected Enterprise MCP server: FactoryTalk batch dispatch and scrap tracking, ControlLogix CIP tag reading, Plex traceability, and Fiix work requests.",
        "composio_app": "ROCKWELL_FACTORYTALK_MCP",
        "auth_schemes": ["API_KEY", "BASIC"],
        "docs_url": "https://www.rockwellautomation.com/en-us/capabilities/connected-enterprise.html",
        "default_action": "rockwell_ft_dispatch_batch",
        "tools": _build_app_tools(rockwell_mcp, "rockwell_factorytalk"),
    },
    {
        "key": "dassault_3dexperience",
        "name": "Dassault Systèmes (3DEXPERIENCE, ENOVIA, DELMIA, SOLIDWORKS)",
        "category": "PLM & CAD/CAE",
        "provider": "fastmcp",
        "modules": [
            "ENOVIA PLM",
            "DELMIA & Apriso",
            "SOLIDWORKS PDM",
            "SIMULIA CAE",
        ],
        "description": "Dassault 3DEXPERIENCE MCP server covering ENOVIA EBOM and maturity promotion, DELMIA MBOM, Apriso MES work centers, SOLIDWORKS PDM metadata, and SIMULIA FEA verification.",
        "composio_app": "DASSAULT_3DEXPERIENCE_MCP",
        "auth_schemes": ["OAUTH2", "API_KEY"],
        "docs_url": "https://www.3ds.com/products/3dexperience-platform",
        "default_action": "dassault_enovia_get_engineering_bom",
        "tools": _build_app_tools(dassault_mcp, "dassault_3dexperience"),
    },
    {
        "key": "ptc_windchill",
        "name": "PTC (Windchill PLM, MPMLink, ThingWorx IIoT, Creo)",
        "category": "PLM & CAD/CAE",
        "provider": "fastmcp",
        "modules": [
            "Windchill PDMLink",
            "MPMLink Manufacturing",
            "ThingWorx IIoT",
            "Creo CAD",
        ],
        "description": "PTC enterprise digital thread MCP server: Windchill OData part structure and change requests, MPMLink process plan sync, and ThingWorx IIoT machine health telemetry.",
        "composio_app": "PTC_WINDCHILL_MCP",
        "auth_schemes": ["BASIC", "OAUTH2"],
        "docs_url": "https://www.ptc.com/en/products/windchill",
        "default_action": "ptc_windchill_get_part_structure",
        "tools": _build_app_tools(ptc_mcp, "ptc_windchill"),
    },
    {
        "key": "oracle_scm",
        "name": "Oracle Cloud SCM & NetSuite Manufacturing",
        "category": "ERP & Supply Chain",
        "provider": "fastmcp",
        "modules": [
            "WIP & Manufacturing",
            "Inventory & Procurement",
            "Cost Management",
        ],
        "description": "Oracle Fusion Cloud SCM & Manufacturing MCP server for discrete work orders, operation reporting, inventory component reservations, and purchase requisitions.",
        "composio_app": "ORACLE_SCM_MCP",
        "auth_schemes": ["BASIC", "OAUTH2"],
        "docs_url": "https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24c/farws/",
        "default_action": "oracle_scm_create_work_order",
        "tools": _build_app_tools(oracle_mcp, "oracle_scm"),
    },
]

INDUSTRIAL_APPS_BY_KEY: dict[str, dict[str, Any]] = {
    app["key"]: app for app in INDUSTRIAL_MCP_APPS
}


# ==============================================================================
# Tool Execution Engine (Live HTTP + Structured Industrial Fallback)
# ==============================================================================

def execute_industrial_mcp_tool(
    app_key: str,
    action: str,
    payload: dict[str, Any],
    config: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Execute an industrial MCP tool via live HTTP REST/OData or FastMCP instance."""
    app_def = INDUSTRIAL_APPS_BY_KEY.get(app_key)
    if not app_def:
        raise KeyError(f"Unknown industrial MCP server: '{app_key}'")

    server = MCP_SERVERS.get(app_key)
    if not server:
        raise KeyError(f"No FastMCP server instance registered for '{app_key}'")

    config = config or {}

    # Normalize action / tool name
    raw_action = str(action)
    clean_action = raw_action.split(":")[-1].strip()

    # Find matching tool
    tool_meta: Optional[ToolMetadata] = None
    for name, meta in server.tool_metadata.items():
        if (
            meta.name.lower() == clean_action.lower()
            or meta.action.lower() == clean_action.lower()
            or name.lower() == clean_action.lower()
        ):
            tool_meta = meta
            break

    if not tool_meta:
        # Fallback: check if clean_action matches any tool
        if clean_action in server.tools:
            tool_name = clean_action
            fn = server.tools[clean_action]
            sim_data = fn(**payload)
            return {
                "ok": True,
                "provider": "fastmcp",
                "server": app_key,
                "action": action,
                "tool": tool_name,
                "simulated": True,
                "data": sim_data,
                "result": sim_data,
            }
        raise KeyError(f"Action/tool '{clean_action}' not found on MCP server '{app_key}'")

    tool_name = tool_meta.name
    endpoint = tool_meta.endpoint
    module_name = tool_meta.module

    # Resolve configured live base URL & auth
    env_prefix = app_key.upper()
    base_url = (
        config.get("base_url")
        or config.get(f"{app_key}_base_url")
        or os.environ.get(f"{env_prefix}_BASE_URL")
        or ""
    ).rstrip("/")

    api_key = (
        config.get("api_key")
        or config.get(f"{app_key}_api_key")
        or os.environ.get(f"{env_prefix}_API_KEY")
        or ""
    )
    auth_token = config.get("auth_token") or config.get("bearer_token")
    mock_mode = os.environ.get("MOCK_AI", "1") == "1" and not config.get("force_live")

    # If live host configured and not in mock mode, try real HTTP call
    if base_url and not mock_mode:
        url = f"{base_url}/{endpoint.lstrip('/')}"
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if api_key:
            headers["x-api-key"] = api_key
            headers["apikey"] = api_key
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        method = "POST" if ("create" in tool_name or "dispatch" in tool_name or "record" in tool_name or "post" in tool_name) else "GET"

        try:
            with httpx.Client(timeout=15.0) as client:
                if method == "POST":
                    resp = client.post(url, json=payload, headers=headers)
                else:
                    resp = client.get(url, params=payload, headers=headers)

                if resp.status_code < 400:
                    body = resp.json() if resp.content else {}
                    return {
                        "ok": True,
                        "provider": "fastmcp",
                        "server": app_key,
                        "action": tool_meta.action,
                        "tool": tool_name,
                        "module": module_name,
                        "endpoint": endpoint,
                        "simulated": False,
                        "status_code": resp.status_code,
                        "data": body,
                        "result": body,
                    }
                else:
                    logger.warning(
                        f"Live HTTP error {resp.status_code} for {app_key}:{tool_name}, falling back to deterministic response"
                    )
        except Exception as exc:
            logger.info(
                f"External host unreachable for {app_key}:{tool_name} ({exc}), using structured industrial simulation"
            )

    # Deterministic simulation via registered FastMCP tool function
    sim_data = server.call_tool(tool_name, payload)

    return {
        "ok": True,
        "provider": "fastmcp",
        "server": app_key,
        "action": tool_meta.action,
        "tool": tool_name,
        "module": module_name,
        "endpoint": endpoint,
        "simulated": True,
        "data": sim_data,
        "result": sim_data,
    }


# ==============================================================================
# FastAPI REST Router for FastMCP Servers
# ==============================================================================

router = APIRouter(prefix="/v1/mcp", tags=["industrial-mcp"])


class McpCallRequest(BaseModel):
    name: Optional[str] = None
    action: Optional[str] = None
    arguments: dict[str, Any] = Field(default_factory=dict)
    payload: Optional[dict[str, Any]] = None
    config: Optional[dict[str, Any]] = None


@router.get("/servers")
def list_mcp_servers() -> list[dict[str, Any]]:
    """List all registered FastMCP industrial servers, modules, and tool schemas."""
    return [
        {
            "key": app["key"],
            "name": app["name"],
            "category": app["category"],
            "provider": app["provider"],
            "modules": app["modules"],
            "description": app["description"],
            "composio_app": app["composio_app"],
            "auth_schemes": app["auth_schemes"],
            "docs_url": app["docs_url"],
            "default_action": app["default_action"],
            "tool_count": len(app["tools"]),
            "tools": app["tools"],
        }
        for app in INDUSTRIAL_MCP_APPS
    ]


@router.get("/servers/{server_key}/tools")
def get_mcp_server_tools(server_key: str) -> list[dict[str, Any]]:
    """Retrieve all MCP tools with JSON Schema and REST/OData endpoints for a server."""
    app_def = INDUSTRIAL_APPS_BY_KEY.get(server_key)
    if not app_def:
        raise HTTPException(status_code=404, detail=f"MCP server '{server_key}' not found")
    return app_def["tools"]


@router.post("/servers/{server_key}/call")
def call_mcp_server_tool(server_key: str, req: McpCallRequest) -> dict[str, Any]:
    """Execute a tool on an industrial MCP server."""
    app_def = INDUSTRIAL_APPS_BY_KEY.get(server_key)
    if not app_def:
        raise HTTPException(status_code=404, detail=f"MCP server '{server_key}' not found")

    target_action = req.action or req.name or app_def["default_action"]
    arguments = req.payload if req.payload is not None else req.arguments

    try:
        res = execute_industrial_mcp_tool(
            app_key=server_key,
            action=target_action,
            payload=arguments,
            config=req.config,
        )
        return res
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception(f"Tool execution failed for {server_key}:{target_action}")
        raise HTTPException(status_code=500, detail=str(exc))
