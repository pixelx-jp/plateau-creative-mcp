import type { ZodType } from "zod";
import { zodToJsonSchema as convert } from "zod-to-json-schema";

export function zodToJsonSchema(schema: ZodType): object {
  const result = convert(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete result.$schema;
  delete result.$ref;
  delete result.definitions;
  return result;
}
