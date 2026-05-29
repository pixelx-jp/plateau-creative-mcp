#!/usr/bin/env python3
"""JSON-over-stdio query adapter for plateau-creative-mcp.

Protocol: read one JSON object {command, args} from stdin, write
{result} or {error, type} to stdout. Exits non-zero on error.

Supported commands:
- load_area {artifact_dir, bbox, dataset_year?}
- query_buildings {artifact_dir, bbox, filter, limit?}
- get_geometry {artifact_dir, building_uids, with_footprints?}

Dependencies: duckdb. Spatial extension is loaded lazily and silently
falls back to centroid-only geometry when it cannot be installed.
"""
from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any

try:
    import duckdb
except ImportError as exc:  # pragma: no cover
    print(json.dumps({"error": f"duckdb not installed: {exc}", "type": "ImportError"}))
    sys.exit(2)


_AVAILABLE_ATTRS = [
    "height",
    "usage",
    "structure",
    "year_built",
    "zoning_use",
    "far_max",
    "river_flood_depth_max",
    "inland_flood_depth_max",
    "tsunami_depth_max",
    "storm_surge_depth_max",
]


def _con() -> "duckdb.DuckDBPyConnection":
    con = duckdb.connect()
    return con


def _try_spatial(con: "duckdb.DuckDBPyConnection") -> bool:
    try:
        con.execute("LOAD spatial")
        return True
    except Exception:
        try:
            con.execute("INSTALL spatial; LOAD spatial;")
            return True
        except Exception:
            return False


def _parquet(artifact_dir: str) -> str:
    p = Path(artifact_dir) / "buildings.parquet"
    if not p.exists():
        raise FileNotFoundError(f"buildings.parquet not found under {artifact_dir}")
    return str(p)


def _manifest(artifact_dir: str) -> dict[str, Any]:
    p = Path(artifact_dir) / "manifest.json"
    if not p.exists():
        raise FileNotFoundError(f"manifest.json not found under {artifact_dir}")
    return json.loads(p.read_text())


def cmd_load_area(args: dict[str, Any]) -> dict[str, Any]:
    artifact_dir = args["artifact_dir"]
    bbox = args["bbox"]
    dataset_year = args.get("dataset_year")
    manifest = _manifest(artifact_dir)
    if dataset_year and dataset_year != manifest.get("dataset_year"):
        raise ValueError(
            f"dataset_year mismatch: requested {dataset_year}, artifact {manifest.get('dataset_year')}"
        )
    parquet = _parquet(artifact_dir)
    con = _con()
    spatial = _try_spatial(con)
    rows = con.execute(
        """
        SELECT building_uid FROM read_parquet(?)
        WHERE centroid_lon BETWEEN ? AND ? AND centroid_lat BETWEEN ? AND ?
        ORDER BY building_uid
        """,
        [parquet, bbox[0], bbox[2], bbox[1], bbox[3]],
    ).fetchall()
    sources = [s.get("url") for s in (manifest.get("sources") or {}).values() if s.get("url")]
    return {
        "artifact_dir": artifact_dir,
        "manifest": manifest,
        "building_uids": [r[0] for r in rows],
        "available_attributes": _AVAILABLE_ATTRS + (["footprint_polygon"] if spatial else []),
        "attribution": {
            "license": "CC BY 4.0",
            "datasets": manifest.get("datasets", []),
            "source_urls": list(dict.fromkeys(sources)),
            "notes": [manifest.get("attribution", "")],
        },
    }


def _filter_clause(filt: dict[str, Any], params: list[Any]) -> list[str]:
    where: list[str] = []
    if "bbox" in filt:
        bb = filt["bbox"]
        where.append("centroid_lon BETWEEN ? AND ? AND centroid_lat BETWEEN ? AND ?")
        params.extend([bb[0], bb[2], bb[1], bb[3]])
    for col, key in [
        ("height", "height_min"),
        ("height", "height_max"),
        ("year_built", "year_min"),
        ("year_built", "year_max"),
    ]:
        if key in filt:
            op = ">=" if key.endswith("_min") else "<="
            where.append(f"{col} {op} ?")
            params.append(filt[key])
    for col, key in [("usage", "use"), ("zoning_use", "zoning_use")]:
        vals = filt.get(key)
        if vals:
            placeholders = ",".join("?" for _ in vals)
            where.append(f"{col} IN ({placeholders})")
            params.extend(vals)
    structure_vals = filt.get("structure") or []
    structure_codes: list[int] = []
    for s in structure_vals:
        try:
            structure_codes.append(int(s))
        except (TypeError, ValueError):
            continue
    if structure_codes:
        placeholders = ",".join("?" for _ in structure_codes)
        where.append(f"structure IN ({placeholders})")
        params.extend(structure_codes)
    if "far_max_min" in filt:
        where.append("far_max >= ?")
        params.append(filt["far_max_min"])
    if "flood_depth_min" in filt:
        v = filt["flood_depth_min"]
        where.append(
            "(COALESCE(river_flood_depth_max,0) >= ? OR COALESCE(inland_flood_depth_max,0) >= ? "
            "OR COALESCE(tsunami_depth_max,0) >= ? OR COALESCE(storm_surge_depth_max,0) >= ?)"
        )
        params.extend([v, v, v, v])
    uids = filt.get("building_uids")
    if uids:
        placeholders = ",".join("?" for _ in uids)
        where.append(f"building_uid IN ({placeholders})")
        params.extend(uids)
    return where


def cmd_query_buildings(args: dict[str, Any]) -> dict[str, Any]:
    parquet = _parquet(args["artifact_dir"])
    bbox = args["bbox"]
    filt = args.get("filter") or {}
    limit = args.get("limit")
    con = _con()
    params: list[Any] = [parquet, bbox[0], bbox[2], bbox[1], bbox[3]]
    where = ["centroid_lon BETWEEN ? AND ? AND centroid_lat BETWEEN ? AND ?"]
    where.extend(_filter_clause(filt, params))
    sql = (
        f"SELECT building_uid FROM read_parquet(?) WHERE {' AND '.join(where)} "
        f"ORDER BY building_uid"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    # read_parquet param is first in params; reshuffle
    parquet_param = params.pop(0)
    params.insert(0, parquet_param)
    rows = con.execute(sql, params).fetchall()
    return {"building_uids": [r[0] for r in rows]}


def cmd_get_geometry(args: dict[str, Any]) -> dict[str, Any]:
    parquet = _parquet(args["artifact_dir"])
    uids = args["building_uids"]
    if not uids:
        return {"rows": []}
    con = _con()
    spatial = _try_spatial(con) if args.get("with_footprints", True) else False
    geom_col = ", ST_AsGeoJSON(geometry) AS geom_json" if spatial else ""
    placeholders = ",".join("?" for _ in uids)
    sql = (
        f"SELECT building_uid, centroid_lon, centroid_lat, height, usage, structure, year_built, "
        f"zoning_use, far_max{geom_col} FROM read_parquet(?) WHERE building_uid IN ({placeholders})"
    )
    rows = con.execute(sql, [parquet, *uids]).fetchall()
    keys = [
        "building_uid",
        "centroid_lon",
        "centroid_lat",
        "height",
        "usage",
        "structure",
        "year_built",
        "zoning_use",
        "far_max",
    ]
    out = []
    for r in rows:
        rec: dict[str, Any] = {k: r[i] for i, k in enumerate(keys)}
        if spatial:
            rec["geom_json"] = r[len(keys)]
        out.append(rec)
    return {"rows": out, "spatial": spatial}


HANDLERS = {
    "load_area": cmd_load_area,
    "query_buildings": cmd_query_buildings,
    "get_geometry": cmd_get_geometry,
}


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        sys.stdout.write(json.dumps({"error": f"invalid stdin JSON: {exc}", "type": "ValueError"}))
        return 2
    cmd = payload.get("command")
    handler = HANDLERS.get(cmd)
    if not handler:
        sys.stdout.write(json.dumps({"error": f"unknown command: {cmd}", "type": "KeyError"}))
        return 2
    try:
        result = handler(payload.get("args") or {})
        sys.stdout.write(json.dumps({"result": result}))
        return 0
    except FileNotFoundError as exc:
        sys.stdout.write(json.dumps({"error": str(exc), "type": "FileNotFoundError"}))
        return 3
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(
            json.dumps(
                {
                    "error": str(exc),
                    "type": type(exc).__name__,
                    "trace": traceback.format_exc(limit=4),
                }
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
