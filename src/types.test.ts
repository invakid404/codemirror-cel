import { expect, test } from "bun:test";
import { optionalType } from "wasm-cel";
import { normalizeAnalyzerOptions, toCelspTypeString } from "./types.ts";

test("serializes optional types to celsp syntax", () => {
  expect(toCelspTypeString(optionalType("string"))).toBe("optional(string)");
  expect(
    toCelspTypeString({
      kind: "list",
      elementType: optionalType("int"),
    }),
  ).toBe("list(optional(int))");
  expect(
    toCelspTypeString({
      kind: "map",
      keyType: "string",
      valueType: optionalType("bool"),
    }),
  ).toBe("map(string, optional(bool))");
});

test("normalizes analyzer declarations recursively", () => {
  expect(
    normalizeAnalyzerOptions({
      variables: [{ name: "maybeName", type: optionalType("string") }],
      functions: [
        {
          name: "wrap",
          params: [{ name: "value", type: optionalType("string") }],
          returnType: optionalType("string"),
          overloads: [
            {
              name: "wrap",
              params: [
                {
                  name: "value",
                  type: {
                    kind: "list",
                    elementType: optionalType("string"),
                  },
                },
              ],
              returnType: {
                kind: "list",
                elementType: optionalType("string"),
              },
            },
          ],
        },
      ],
      hoverShowErrors: true,
    }),
  ).toEqual({
    variables: [{ name: "maybeName", type: "optional(string)" }],
    functions: [
      {
        name: "wrap",
        params: [{ name: "value", type: "optional(string)", optional: undefined }],
        returnType: "optional(string)",
        overloads: [
          {
            name: "wrap",
            params: [{ name: "value", type: "list(optional(string))", optional: undefined }],
            returnType: "list(optional(string))",
            overloads: undefined,
          },
        ],
      },
    ],
    hoverShowErrors: true,
  });
});
