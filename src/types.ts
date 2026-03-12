/**
 * CEL environment types for configuring the language server.
 *
 * These types stay structurally compatible with wasm-cel declarations while
 * also covering optional type syntax used by newer wasm-cel releases.
 */

export type CELPrimitiveType =
  | "bool"
  | "int"
  | "uint"
  | "double"
  | "string"
  | "bytes"
  | "list"
  | "map"
  | "dyn"
  | "null"
  | "timestamp"
  | "duration";

export type CELType = CELPrimitiveType | (string & {});

export interface CELListType {
  kind: "list";
  elementType: CELTypeDef;
}

export interface CELMapType {
  kind: "map";
  keyType: CELTypeDef;
  valueType: CELTypeDef;
}

export interface CELOptionalType {
  kind: "optional";
  innerType: CELTypeDef;
}

export type CELTypeDef = CELType | CELListType | CELMapType | CELOptionalType;

export interface CELFunctionParam {
  name: string;
  type: CELTypeDef;
  optional?: boolean;
}

export interface VariableDeclaration {
  name: string;
  type: CELTypeDef;
}

/**
 * Function declaration for the CEL type-checker.
 *
 * Pick only the fields the LSP needs (name, params, returnType, overloads).
 * The `impl` and brand from wasm-cel's `CELFunctionDefinition` are ignored,
 * but wasm-cel objects are assignable to this type thanks to structural typing.
 */
export interface FunctionDeclaration {
  name: string;
  params: CELFunctionParam[];
  returnType: CELTypeDef;
  overloads?: FunctionDeclaration[];
}

/**
 * Options passed to the WASM CelAnalyzer at construction time.
 *
 * Serialized as JSON and sent to the worker's init message.
 */
export interface AnalyzerOptions {
  /** Variable declarations (name + type) available in the CEL environment. */
  variables?: VariableDeclaration[];

  /** Function declarations (name + signature) available in the CEL environment. */
  functions?: FunctionDeclaration[];

  /**
   * Whether hover tooltips should include check-error details.
   *
   * When `false` (the default), hover skips error info since CM6 already
   * displays diagnostics in the tooltip — showing both looks broken.
   */
  hoverShowErrors?: boolean;
}

type SerializedTypeDef = string;

interface SerializedVariableDeclaration {
  name: string;
  type: SerializedTypeDef;
}

interface SerializedFunctionParam {
  name: string;
  type: SerializedTypeDef;
  optional?: boolean;
}

interface SerializedFunctionDeclaration {
  name: string;
  params: SerializedFunctionParam[];
  returnType: SerializedTypeDef;
  overloads?: SerializedFunctionDeclaration[];
}

export interface SerializedAnalyzerOptions {
  variables?: SerializedVariableDeclaration[];
  functions?: SerializedFunctionDeclaration[];
  hoverShowErrors?: boolean;
}

export function toCelspTypeString(type: CELTypeDef | CELType): string {
  if (typeof type === "string") return type;
  if (!type || typeof type !== "object" || !("kind" in type)) return "dyn";

  switch (type.kind) {
    case "list":
      return `list(${toCelspTypeString(type.elementType)})`;
    case "map":
      return `map(${toCelspTypeString(type.keyType)}, ${toCelspTypeString(type.valueType)})`;
    case "optional":
      return `optional(${toCelspTypeString(type.innerType)})`;
    default:
      return "dyn";
  }
}

function serializeFunctionDeclaration(
  fn: FunctionDeclaration,
): SerializedFunctionDeclaration {
  return {
    name: fn.name,
    params: fn.params.map((param) => ({
      name: param.name,
      type: toCelspTypeString(param.type),
      optional: param.optional,
    })),
    returnType: toCelspTypeString(fn.returnType),
    overloads: fn.overloads?.map(serializeFunctionDeclaration),
  };
}

export function normalizeAnalyzerOptions(
  options: AnalyzerOptions,
): SerializedAnalyzerOptions {
  return {
    variables: options.variables?.map((variable) => ({
      name: variable.name,
      type: toCelspTypeString(variable.type),
    })),
    functions: options.functions?.map(serializeFunctionDeclaration),
    hoverShowErrors: options.hoverShowErrors,
  };
}
