"""ConnectorProviderAdapter: swap Open Connector, Composio or native connectors here.

Connectors receive a secret_ref and resolve credentials themselves.
Credentials are never passed through models, playbooks or logs.
"""
from typing import Protocol

import httpx


class ConnectorProvider(Protocol):
    def execute(self, connector: str, secret_ref: str | None, params: dict) -> dict: ...


class HttpConnector:
    """Generic REST connector. params: {method, url, json?, headers?}. Auth injected from secret_ref."""

    def _resolve_secret(self, secret_ref: str | None) -> dict:
        # TODO: resolve from Vault / cloud secrets manager. Stub returns no auth.
        return {}

    def execute(self, connector: str, secret_ref: str | None, params: dict) -> dict:
        headers = {**params.get("headers", {}), **self._resolve_secret(secret_ref)}
        r = httpx.request(
            params.get("method", "GET"), params["url"], json=params.get("json"), headers=headers, timeout=30
        )
        return {"status_code": r.status_code, "body": r.text[:5000]}


class LogOnlyConnector:
    """Safe default: records intent, performs nothing."""

    def execute(self, connector: str, secret_ref: str | None, params: dict) -> dict:
        return {"simulated": True, "connector": connector, "params": params}


REGISTRY: dict[str, ConnectorProvider] = {"http": HttpConnector(), "log": LogOnlyConnector()}


def get(name: str) -> ConnectorProvider:
    return REGISTRY.get(name, REGISTRY["log"])
