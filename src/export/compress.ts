import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, weld } from "@gltf-transform/functions";
import { AppError } from "../errors/AppError.js";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export interface CompressResult {
  buffer: ArrayBuffer;
  input_bytes: number;
  output_bytes: number;
}

export async function compressGlb(input: ArrayBuffer): Promise<CompressResult> {
  let doc: Document;
  try {
    doc = await io.readBinary(new Uint8Array(input));
  } catch (err) {
    throw new AppError("EXPORT_GLTF_FAILED", `compress: parse failed: ${(err as Error).message}`);
  }
  try {
    await doc.transform(
      dedup(),
      weld(),
      prune(),
      quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
    );
  } catch (err) {
    throw new AppError(
      "EXPORT_GLTF_FAILED",
      `compress: transform failed: ${(err as Error).message}`,
    );
  }
  let out: Uint8Array;
  try {
    out = await io.writeBinary(doc);
  } catch (err) {
    throw new AppError("EXPORT_GLTF_FAILED", `compress: write failed: ${(err as Error).message}`);
  }
  return {
    buffer: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer,
    input_bytes: input.byteLength,
    output_bytes: out.byteLength,
  };
}
