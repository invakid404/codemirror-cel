//! CEL type system and builtin function definitions.
//!
//! Adapted from celsp's types/mod.rs.
//! No changes needed — this module is self-contained.

mod builtins;
mod function;

pub use builtins::{get_builtin, is_builtin};
pub use function::FunctionDef;
