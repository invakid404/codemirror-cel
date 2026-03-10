//! Document state management and text utilities.
//!
//! Adapted from celsp's document/mod.rs.
//! Changes:
//!   - Removed CelRegion/OffsetMapper (proto support skipped for v1)
//!   - Removed DocumentStore/DocumentKind/ProtoDocumentState

mod state;
mod text;

pub use state::DocumentState;
pub use text::LineIndex;
