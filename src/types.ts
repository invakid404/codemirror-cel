/**
 * CEL environment types for configuring the language server.
 *
 * These types are structurally compatible with wasm-cel's types, so you can
 * pass wasm-cel `VariableDeclaration` and `CELFunctionDefinition` objects
 * directly — no adapter needed.
 */

import type {
  CELType,
  CELTypeDef,
  CELListType,
  CELMapType,
  CELFunctionDefinition,
  CELFunctionParam,
  VariableDeclaration,
} from "wasm-cel";

// Re-export the type-level imports so consumers get them from us.
export type {
  CELType,
  CELTypeDef,
  CELListType,
  CELMapType,
  CELFunctionParam,
  VariableDeclaration,
};

/**
 * Function declaration for the CEL type-checker.
 *
 * Pick only the fields the LSP needs (name, params, returnType, overloads).
 * The `impl` and brand from wasm-cel's `CELFunctionDefinition` are ignored,
 * but wasm-cel objects are assignable to this type thanks to structural typing.
 */
export type FunctionDeclaration = Pick<
  CELFunctionDefinition,
  "name" | "params" | "returnType" | "overloads"
>;

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
