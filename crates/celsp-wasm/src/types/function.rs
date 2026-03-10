//! Function definition types for CEL.
//!
//! Adapted from celsp's types/function.rs.
//! No changes needed — this module is self-contained.

/// Definition of a CEL function with documentation.
#[derive(Debug, Clone)]
pub struct FunctionDef {
    /// Function name (e.g., "size")
    pub name: &'static str,
    /// Function signature (e.g., "(list<T>) -> int")
    pub signature: &'static str,
    /// Description of what the function does
    pub description: &'static str,
    /// Optional example usage
    pub example: Option<&'static str>,
}
