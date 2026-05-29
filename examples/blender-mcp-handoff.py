"""
Reference implementation of what BlenderMCP runs when Claude says
"import the .glb returned by plateau-creative".

This is meant as a *reference* — BlenderMCP itself wraps this behind
its own tool surface; the snippet here is what to do in plain Blender
Python (bpy) when you're driving things directly.

It illustrates two things the cross-MCP demo depends on:

  1. The GLB import preserves the merged mesh plus the
     KHR_mesh_quantization extension (Blender 4.x decodes both natively).

  2. The companion .buildings.json sidecar lets you recover per-building
     identity *after* import — even though the GLB itself is one merged
     mesh, you can re-select / re-edit individual buildings by uid.

Run inside Blender with:

    blender --background --python blender-mcp-handoff.py -- \\
        /abs/path/shibuya_skyline.glb /abs/path/shibuya_skyline.buildings.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
import bmesh


def parse_argv() -> tuple[Path, Path]:
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1 :]
    else:
        argv = sys.argv[1:]
    if len(argv) < 2:
        raise SystemExit("usage: blender-mcp-handoff.py <scene.glb> <scene.buildings.json>")
    return Path(argv[0]).resolve(), Path(argv[1]).resolve()


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def import_glb(glb: Path) -> bpy.types.Object:
    bpy.ops.import_scene.gltf(filepath=str(glb))
    obj = next(o for o in bpy.context.selected_objects if o.type == "MESH")
    obj.name = "PLATEAU_buildings"
    return obj


def build_uid_lookup(obj: bpy.types.Object, sidecar: Path) -> dict[str, list[int]]:
    """Return {building_uid: [face_index, ...]} using the sidecar ranges."""
    data = json.loads(sidecar.read_text())
    ranges = data["ranges"]
    out: dict[str, list[int]] = {}
    for uid, intervals in ranges.items():
        faces: list[int] = []
        for interval in intervals:
            start = interval["triangle_start"]
            count = interval["triangle_count"]
            faces.extend(range(start, start + count))
        out[uid] = faces
    return out


def assign_per_building_face_groups(obj: bpy.types.Object, lookup: dict[str, list[int]]) -> None:
    """Tag every face with its building_uid via a face-int attribute. The string uids are
    indexed into a list stored on the mesh; the face attribute is the index into that list."""
    mesh = obj.data
    uids = list(lookup.keys())
    mesh["plateau_building_uids"] = uids

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    layer = bm.faces.layers.int.new("plateau_building_index")

    face_to_uid_idx = [-1] * len(bm.faces)
    for uid_idx, uid in enumerate(uids):
        for face_idx in lookup[uid]:
            if 0 <= face_idx < len(face_to_uid_idx):
                face_to_uid_idx[face_idx] = uid_idx

    for face_idx, uid_idx in enumerate(face_to_uid_idx):
        bm.faces[face_idx][layer] = uid_idx

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def select_building_by_uid(obj: bpy.types.Object, uid: str) -> int:
    """Return the number of faces selected."""
    mesh = obj.data
    uids = mesh.get("plateau_building_uids")
    if not uids or uid not in uids:
        return 0
    target_index = list(uids).index(uid)

    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.select_all(action="DESELECT")

    bm = bmesh.from_edit_mesh(mesh)
    layer = bm.faces.layers.int.get("plateau_building_index")
    selected = 0
    for face in bm.faces:
        if face[layer] == target_index:
            face.select = True
            selected += 1
    bmesh.update_edit_mesh(mesh)
    bpy.ops.object.mode_set(mode="OBJECT")
    return selected


def main() -> None:
    glb, sidecar = parse_argv()
    reset_scene()
    obj = import_glb(glb)
    lookup = build_uid_lookup(obj, sidecar)
    assign_per_building_face_groups(obj, lookup)

    sample_uid = next(iter(lookup))
    n = select_building_by_uid(obj, sample_uid)
    print(f"imported {len(obj.data.polygons)} faces, indexed {len(lookup)} buildings, "
          f"selecting uid {sample_uid!r} selected {n} faces")


if __name__ == "__main__":
    main()
