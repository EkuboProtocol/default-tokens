import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import tokenListSchema from "../token-list.schema.json";
import type { TokenListDocument } from "./types";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile<TokenListDocument>(tokenListSchema);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    )
    .join("; ");
}

export function validateTokenListSchema(
  value: unknown,
  label = "token list",
): asserts value is TokenListDocument {
  if (!validate(value)) {
    throw new Error(
      `${label} does not match token-list.schema.json: ${formatErrors(validate.errors)}`,
    );
  }
}
