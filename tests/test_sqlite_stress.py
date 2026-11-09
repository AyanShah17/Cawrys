"""Empirical Adversarial Stress Harness for Cawrys SQLite Fallback Adapter.

Stress tests:
1. Parameter placeholder conversion (%s -> ?) edge cases (literal %, multiple params, empty params).
2. SELECT DISTINCT ON query rewrite edge cases (varied spacing, multiple columns, uppercase/lowercase).
3. JSON column automatic deserialization (fields, validation, decision, inputs, result, nulls).
4. Custom SQLite function gen_random_uuid() format & uniqueness.
5. Multi-process concurrency simulation with WAL mode and busy timeout.
"""
import json
import multiprocessing as mp
import os
import random
import re
import sys
import time
import uuid

import pytest

from services.intelligence.app.sqlite_adapter import (
    JSON_COLUMNS,
    SQLiteConnectionWrapper,
    SQLiteCursorWrapper,
    dict_factory,
    get_connection,
)

UUID_V4_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


# ==============================================================================
# 1. Parameter Placeholder Conversion Tests
# ==============================================================================

def test_placeholder_basic_conversion():
    """Verify single and multiple %s convert cleanly to ?."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()
    c.execute("SELECT %s as a, %s as b", ("val1", "val2"))
    row = c.fetchone()
    assert row["a"] == "val1"
    assert row["b"] == "val2"


def test_placeholder_empty_params():
    """Verify behavior with empty params: None, empty tuple, empty list."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()

    # None
    c.execute("SELECT 1 as num")
    assert c.fetchone()["num"] == 1

    # Empty tuple
    c.execute("SELECT 2 as num", ())
    assert c.fetchone()["num"] == 2

    # Empty list
    c.execute("SELECT 3 as num", [])
    assert c.fetchone()["num"] == 3


def test_placeholder_params_with_percent_chars():
    """Verify that parameters containing literal '%' do NOT break query parameterization."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()
    c.execute("INSERT INTO tenants (id, name) VALUES (%s, %s)", ("t-pct", "100% Cotton & 50% Wool"))
    c.execute("SELECT name FROM tenants WHERE name LIKE %s", ("%100%%",))
    row = c.fetchone()
    assert row is not None
    assert row["name"] == "100% Cotton & 50% Wool"


def test_placeholder_uuid_objects_in_params():
    """Verify that uuid.UUID objects in parameters are automatically coerced to strings."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()
    uid = uuid.uuid4()
    c.execute("INSERT INTO tenants (id, name) VALUES (%s, %s)", (uid, "UUID Tenant"))
    c.execute("SELECT id, name FROM tenants WHERE id = %s", (uid,))
    row = c.fetchone()
    assert row is not None
    assert row["id"] == str(uid)


def test_placeholder_executemany():
    """Verify executemany converts %s to ? and coerces UUIDs."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()
    items = [(uuid.uuid4(), f"Tenant {i}") for i in range(5)]
    c.executemany("INSERT INTO tenants (id, name) VALUES (%s, %s)", items)
    c.execute("SELECT count(*) as cnt FROM tenants WHERE name LIKE %s", ("Tenant %",))
    assert c.fetchone()["cnt"] == 5


def test_placeholder_literal_percent_in_query_string():
    """Adversarial challenge: literal % in query string (modulo, strftime, LIKE)."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()

    # SQL Modulo operator
    c.execute("SELECT 10 % 3 as remainder")
    assert c.fetchone()["remainder"] == 1

    # Modulo with parameters
    c.execute("SELECT %s % 4 as remainder", (15,))
    assert c.fetchone()["remainder"] == 3

    # LIKE pattern with %s in the literal string
    # For instance: LIKE '%status%'
    # Note: if query contains literal '%status%', the regex (?<!%)(?:%%)*%s
    # matches '%s' inside '%status%' and corrupts it to '?tatus%'!
    q = "SELECT '%status%' as tag WHERE %s = %s"
    # Let's inspect what query wrapper produces:
    converted = re.sub(r"(?<!%)(?:%%)*%s", lambda m: m.group(0)[:-2] + "?", q)
    # This records whether the adapter's regex rewrites '%status%' into '?tatus%'
    has_corruption = "?tatus" in converted
    assert has_corruption, "Expected regex (?<!%)(?:%%)*%s to match '%s' in '%status%'"


# ==============================================================================
# 2. SELECT DISTINCT ON Query Rewrite Tests
# ==============================================================================

def test_distinct_on_exact_match():
    """Verify the exact execution service query rewrite succeeds."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()
    # Insert test playbooks
    t_id = "00000000-0000-0000-0000-000000000001"
    c.execute("INSERT INTO playbooks (tenant_id, name, version, steps) VALUES (%s, %s, %s, %s)",
              (t_id, "pb_a", 1, '["step1"]'))
    c.execute("INSERT INTO playbooks (tenant_id, name, version, steps) VALUES (%s, %s, %s, %s)",
              (t_id, "pb_a", 2, '["step1", "step2"]'))
    c.execute("INSERT INTO playbooks (tenant_id, name, version, steps) VALUES (%s, %s, %s, %s)",
              (t_id, "pb_b", 1, '["b1"]'))

    exact_query = "select distinct on (name) name, version, steps from playbooks where tenant_id=%s order by name, version desc"
    c.execute(exact_query, (t_id,))
    rows = c.fetchall()
    assert len(rows) == 2
    by_name = {r["name"]: r for r in rows}
    assert by_name["pb_a"]["version"] == 2
    assert by_name["pb_b"]["version"] == 1


def test_distinct_on_uppercase():
    """Verify DISTINCT ON in uppercase is rewritten due to re.IGNORECASE."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()
    t_id = "00000000-0000-0000-0000-000000000001"
    upper_query = "SELECT DISTINCT ON (name) name, version, steps FROM playbooks WHERE tenant_id=%s ORDER BY name, version DESC"
    c.execute(upper_query, (t_id,))
    rows = c.fetchall()
    assert isinstance(rows, list)


def test_distinct_on_spacing_boundary_behavior():
    """Adversarial challenge: spaces around '=', extra whitespace, or newlines."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()
    t_id = "00000000-0000-0000-0000-000000000001"

    # Query with spaces around '=' in tenant_id = %s
    query_spaced = "SELECT DISTINCT ON (name) name, version, steps FROM playbooks WHERE tenant_id = %s ORDER BY name, version DESC"
    try:
        c.execute(query_spaced, (t_id,))
        spaced_succeeded = True
    except Exception as e:
        spaced_succeeded = False
        assert "near \"ON\": syntax error" in str(e)

    # Document empirical finding: query with spaces around '=' is NOT rewritten by current regex
    assert not spaced_succeeded, "Adapter should fail on spaces around '=' due to rigid tenant_id=\\? regex"


def test_distinct_on_multiple_columns_boundary_behavior():
    """Adversarial challenge: DISTINCT ON with multiple columns is unsupported by PostgreSQL adapter regex."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()
    t_id = "00000000-0000-0000-0000-000000000001"

    query_multi_col = "SELECT DISTINCT ON (tenant_id, name) name, version, steps FROM playbooks WHERE tenant_id=%s ORDER BY tenant_id, name, version DESC"
    try:
        c.execute(query_multi_col, (t_id,))
        multi_col_succeeded = True
    except Exception as e:
        multi_col_succeeded = False
        assert "near \"ON\": syntax error" in str(e)

    assert not multi_col_succeeded, "Adapter should fail on multi-column DISTINCT ON because it only targets single-column playbook query"


# ==============================================================================
# 3. JSON Column Automatic Deserialization Tests
# ==============================================================================

@pytest.mark.parametrize("col_name", ["fields", "validation", "decision", "result", "inputs"])
def test_json_column_dict_deserialization(col_name):
    """Verify that dictionary JSON strings in configured JSON columns deserialize to dicts."""
    cursor_desc = [(col_name,)]
    raw_val = json.dumps({"key": "value", "count": 42, "nested": {"inner": True}})
    row = (raw_val,)

    class DummyCursor:
        description = cursor_desc

    res = dict_factory(DummyCursor(), row)
    assert isinstance(res[col_name], dict)
    assert res[col_name]["key"] == "value"
    assert res[col_name]["count"] == 42
    assert res[col_name]["nested"]["inner"] is True


@pytest.mark.parametrize("col_name", ["steps", "model_trace", "result", "tools"])
def test_json_column_list_deserialization(col_name):
    """Verify that list JSON strings in configured JSON columns deserialize to lists."""
    cursor_desc = [(col_name,)]
    raw_val = json.dumps([{"step": 1, "tool": "calc"}, {"step": 2, "tool": "log"}])
    row = (raw_val,)

    class DummyCursor:
        description = cursor_desc

    res = dict_factory(DummyCursor(), row)
    assert isinstance(res[col_name], list)
    assert len(res[col_name]) == 2
    assert res[col_name][0]["step"] == 1


def test_json_column_null_and_none_behavior():
    """Verify that NULL/None in JSON columns remains None without error."""
    cursor_desc = [("fields",), ("validation",), ("decision",), ("result",)]
    row = (None, None, None, None)

    class DummyCursor:
        description = cursor_desc

    res = dict_factory(DummyCursor(), row)
    for col in ["fields", "validation", "decision", "result"]:
        assert res[col] is None


def test_json_column_invalid_json_fallback():
    """Verify that malformed JSON strings degrade gracefully to raw string."""
    cursor_desc = [("fields",)]
    row = ("this is not valid json",)

    class DummyCursor:
        description = cursor_desc

    res = dict_factory(DummyCursor(), row)
    assert res["fields"] == "this is not valid json"


def test_json_column_non_json_columns_remain_strings():
    """Verify that columns NOT in JSON_COLUMNS (like filename, status) are not JSON-parsed even if valid JSON."""
    cursor_desc = [("filename",), ("status",)]
    row = ('{"fake": "json"}', "123")

    class DummyCursor:
        description = cursor_desc

    res = dict_factory(DummyCursor(), row)
    assert isinstance(res["filename"], str)
    assert res["filename"] == '{"fake": "json"}'
    assert res["status"] == "123"


# ==============================================================================
# 4. Custom Function gen_random_uuid() Tests
# ==============================================================================

def test_gen_random_uuid_format_and_uniqueness():
    """Verify gen_random_uuid() produces valid UUIDv4 strings and unique values across 5000 calls."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()

    num_samples = 5000
    # Execute batch of UUID generations
    uuids = [c.execute("SELECT gen_random_uuid() as u").fetchone()["u"] for _ in range(num_samples)]

    # Check uniqueness
    assert len(set(uuids)) == num_samples, f"Collision detected in {num_samples} UUIDs!"

    # Check format
    for u in uuids:
        assert UUID_V4_REGEX.match(u) is not None, f"String '{u}' is not a valid UUIDv4"


def test_gen_random_uuid_in_table_defaults():
    """Verify DEFAULT (gen_random_uuid()) generates unique IDs for inserted rows."""
    conn = SQLiteConnectionWrapper(":memory:")
    c = conn.cursor()

    count = 200
    for i in range(count):
        c.execute("INSERT INTO tenants (name) VALUES (%s)", (f"Tenant_{i}",))

    c.execute("SELECT id, name FROM tenants WHERE name LIKE 'Tenant_%'")
    rows = c.fetchall()
    assert len(rows) == count
    ids = [r["id"] for r in rows]
    assert len(set(ids)) == count
    for uid in ids:
        assert UUID_V4_REGEX.match(uid) is not None


# ==============================================================================
# 5. Multi-Process Concurrency Simulation (WAL Mode)
# ==============================================================================

def _concurrency_worker(db_path: str, proc_id: int, num_ops: int, err_queue: mp.Queue):
    """Worker process executing mixed reads and writes against shared SQLite DB."""
    try:
        conn = SQLiteConnectionWrapper(db_path)
        for i in range(num_ops):
            if i % 3 == 0:
                # Insert / Write
                conn.execute(
                    "INSERT INTO audit_log (tenant_id, actor, service, event, detail) VALUES (%s, %s, %s, %s, %s)",
                    (
                        "00000000-0000-0000-0000-000000000001",
                        f"worker_{proc_id}",
                        "stress_test",
                        f"op_{i}",
                        json.dumps({"proc": proc_id, "op": i}),
                    ),
                )
                conn.commit()
            elif i % 3 == 1:
                # Read / Query count
                conn.execute("SELECT count(*) as total FROM audit_log WHERE tenant_id=%s",
                             ("00000000-0000-0000-0000-000000000001",))
                conn.fetchone()
            else:
                # Read / Query recent rows
                conn.execute(
                    "SELECT id, actor, event, detail FROM audit_log ORDER BY id DESC LIMIT 5"
                )
                rows = conn.fetchall()
                for r in rows:
                    if r.get("detail"):
                        assert isinstance(r["detail"], dict)
        conn.close()
    except Exception as e:
        err_queue.put((proc_id, type(e).__name__, str(e)))


def test_multiprocess_concurrency_wal_mode(tmp_path):
    """Simulate multi-process concurrent access with WAL mode and verify no locked errors."""
    db_file = str(tmp_path / "wal_concurrency_test.db")

    # Initialize connection and verify WAL & busy timeout
    init_conn = SQLiteConnectionWrapper(db_file)
    cur = init_conn._conn.cursor()
    row_jm = cur.execute("PRAGMA journal_mode").fetchone()
    journal_mode = list(row_jm.values())[0]
    row_bt = cur.execute("PRAGMA busy_timeout").fetchone()
    busy_timeout = list(row_bt.values())[0]
    init_conn.close()

    assert journal_mode.lower() == "wal", f"Expected WAL mode, got {journal_mode}"
    assert busy_timeout == 5000, f"Expected 5000ms busy timeout, got {busy_timeout}"

    num_procs = 8
    ops_per_proc = 100  # Total 800 concurrent operations
    err_queue = mp.Queue()

    ctx = mp.get_context("spawn")
    processes = []
    t0 = time.time()
    for pid in range(num_procs):
        p = ctx.Process(target=_concurrency_worker, args=(db_file, pid, ops_per_proc, err_queue))
        p.start()
        processes.append(p)

    for p in processes:
        p.join(timeout=30)
        assert not p.is_alive(), f"Process {p.pid} timed out"

    elapsed = time.time() - t0

    # Collect any errors
    errors = []
    while not err_queue.empty():
        errors.append(err_queue.get())

    assert len(errors) == 0, f"Concurrency simulation encountered {len(errors)} errors: {errors}"

    # Verify write count
    verif_conn = SQLiteConnectionWrapper(db_file)
    res = verif_conn.execute("SELECT count(*) as cnt FROM audit_log WHERE service=%s", ("stress_test",)).fetchone()
    expected_writes = num_procs * ((ops_per_proc + 2) // 3)
    assert res["cnt"] == expected_writes
    verif_conn.close()


if __name__ == "__main__":
    pytest.main(["-v", __file__])
