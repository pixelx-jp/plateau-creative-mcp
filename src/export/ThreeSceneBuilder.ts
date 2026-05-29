import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BuildingRow, FootprintPolygon } from "../data/types.js";
import type { SceneState } from "../scene/SceneState.js";
import type { BuildingUid } from "../utils/ids.js";

const LAT_M = 110540;
const LON_M_AT_EQUATOR = 111320;
const DEFAULT_FOOTPRINT_HALF_M = 6;

export interface BuildingRange {
  triangle_start: number;
  triangle_count: number;
}

export interface BuiltScene {
  scene: THREE.Scene;
  origin: [lon: number, lat: number];
  included: number;
  totalTriangles: number;
  usedFootprints: number;
  usedBoxes: number;
  ranges: Record<BuildingUid, BuildingRange[]>;
  merged: boolean;
}

export class ThreeSceneBuilder {
  build(scene: Readonly<SceneState>, rows: BuildingRow[]): BuiltScene {
    const bbox = scene.source.bbox;
    const originLon = (bbox[0] + bbox[2]) / 2;
    const originLat = (bbox[1] + bbox[3]) / 2;
    const lonM = LON_M_AT_EQUATOR * Math.cos((originLat * Math.PI) / 180);

    const threeScene = new THREE.Scene();
    threeScene.name = scene.scene_id;
    const material = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 0.0,
      roughness: 0.8,
    });

    const pieces: Array<{ uid: BuildingUid; geom: THREE.BufferGeometry }> = [];
    let usedFootprints = 0;
    let usedBoxes = 0;
    let included = 0;

    for (const row of rows) {
      if (scene.buildings.deleted_uids.has(row.building_uid)) continue;
      const factor = scene.buildings.extrusions.get(row.building_uid)?.factor ?? 1;
      const height = Math.max(2, row.height * factor);

      if (row.footprints && row.footprints.length > 0) {
        let any = false;
        for (const poly of row.footprints) {
          const geom = this.buildFootprintGeometry(poly, height, originLon, originLat, lonM);
          if (!geom) continue;
          pieces.push({ uid: row.building_uid, geom });
          any = true;
        }
        if (any) usedFootprints += 1;
        else {
          pieces.push({
            uid: row.building_uid,
            geom: this.buildBoxGeometry(row, height, originLon, originLat, lonM),
          });
          usedBoxes += 1;
        }
      } else {
        pieces.push({
          uid: row.building_uid,
          geom: this.buildBoxGeometry(row, height, originLon, originLat, lonM),
        });
        usedBoxes += 1;
      }
      included += 1;
    }

    const ranges: Record<BuildingUid, BuildingRange[]> = {};
    let totalTriangles = 0;
    let merged = false;

    if (pieces.length === 0) {
      threeScene.add(new THREE.Group());
      return {
        scene: threeScene,
        origin: [originLon, originLat],
        included,
        totalTriangles: 0,
        usedFootprints,
        usedBoxes,
        ranges,
        merged: false,
      };
    }

    const normalized = pieces.map((p) => ({
      uid: p.uid,
      geom: this.normalizeForMerge(p.geom),
    }));

    let cursor = 0;
    for (const piece of normalized) {
      const triCount = piece.geom.attributes.position!.count / 3;
      let arr = ranges[piece.uid];
      if (!arr) {
        arr = [];
        ranges[piece.uid] = arr;
      }
      arr.push({ triangle_start: cursor, triangle_count: triCount });
      cursor += triCount;
    }
    totalTriangles = cursor;

    try {
      const mergedGeom = mergeGeometries(
        normalized.map((p) => p.geom),
        false,
      );
      if (!mergedGeom) throw new Error("mergeGeometries returned null");
      mergedGeom.computeBoundingBox();
      mergedGeom.computeBoundingSphere();
      const mesh = new THREE.Mesh(mergedGeom, material);
      mesh.name = "buildings_merged";
      mesh.userData.scene_id = scene.scene_id;
      mesh.userData.merged = true;
      threeScene.add(mesh);
      merged = true;
    } catch {
      const group = new THREE.Group();
      group.name = "buildings";
      for (const piece of normalized) {
        const mesh = new THREE.Mesh(piece.geom, material);
        mesh.name = piece.uid;
        mesh.userData.building_uid = piece.uid;
        group.add(mesh);
      }
      threeScene.add(group);
    }

    return {
      scene: threeScene,
      origin: [originLon, originLat],
      included,
      totalTriangles,
      usedFootprints,
      usedBoxes,
      ranges,
      merged,
    };
  }

  private normalizeForMerge(geom: THREE.BufferGeometry): THREE.BufferGeometry {
    const flat = geom.index ? geom.toNonIndexed() : geom;
    for (const name of Object.keys(flat.attributes)) {
      if (name !== "position" && name !== "normal") flat.deleteAttribute(name);
    }
    if (!flat.getAttribute("normal")) flat.computeVertexNormals();
    return flat;
  }

  private buildBoxGeometry(
    row: BuildingRow,
    height: number,
    originLon: number,
    originLat: number,
    lonM: number,
  ): THREE.BufferGeometry {
    const cx = (row.centroid_lon - originLon) * lonM;
    const cz = -(row.centroid_lat - originLat) * LAT_M;
    const half = DEFAULT_FOOTPRINT_HALF_M;
    const geom = new THREE.BoxGeometry(half * 2, height, half * 2);
    geom.translate(cx, height / 2, cz);
    return geom;
  }

  private buildFootprintGeometry(
    poly: FootprintPolygon,
    height: number,
    originLon: number,
    originLat: number,
    lonM: number,
  ): THREE.BufferGeometry | null {
    if (poly.outer.length < 3) return null;
    const toLocal = ([lon, lat]: [number, number]): THREE.Vector2 =>
      new THREE.Vector2((lon - originLon) * lonM, (lat - originLat) * LAT_M);

    const outerPoints = this.dedupeRing(poly.outer.map(toLocal));
    if (outerPoints.length < 3) return null;
    const shape = new THREE.Shape(outerPoints);

    for (const hole of poly.holes) {
      if (hole.length < 3) continue;
      const holePoints = this.dedupeRing(hole.map(toLocal));
      if (holePoints.length < 3) continue;
      shape.holes.push(new THREE.Path(holePoints));
    }

    let geom: THREE.BufferGeometry;
    try {
      geom = new THREE.ExtrudeGeometry(shape, {
        depth: height,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 1,
      });
    } catch {
      return null;
    }
    geom.rotateX(-Math.PI / 2);
    geom.computeVertexNormals();
    return geom;
  }

  private dedupeRing(points: THREE.Vector2[]): THREE.Vector2[] {
    if (points.length === 0) return points;
    const out: THREE.Vector2[] = [points[0]!];
    for (let i = 1; i < points.length; i++) {
      const p = points[i]!;
      const prev = out[out.length - 1]!;
      if (Math.abs(p.x - prev.x) > 1e-6 || Math.abs(p.y - prev.y) > 1e-6) out.push(p);
    }
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (out.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
      out.pop();
    }
    return out;
  }
}
