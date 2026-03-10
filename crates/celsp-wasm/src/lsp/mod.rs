//! LSP protocol feature implementations.
//!
//! Adapted from celsp's lsp/mod.rs.
//! Changes:
//!   - Removed proto-related exports (proto support skipped for v1)

mod completion;
mod diagnostics;
mod hover;
mod semantic_tokens;

pub use completion::completion_at_position;
pub use diagnostics::to_diagnostics;
pub use hover::hover_at_position;
pub use semantic_tokens::{legend, tokens_for_ast};
