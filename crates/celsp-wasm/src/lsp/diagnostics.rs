//! Diagnostics conversion from parser and check errors to LSP diagnostics.
//!
//! Adapted from celsp's lsp/diagnostics.rs.
//! Changes:
//!   - `tower_lsp::lsp_types::*` -> `lsp_types::*`
//!   - Removed `proto_to_diagnostics` (proto support skipped for v1)
//!   - Removed ProtoDocumentState import

use cel_core::{CheckError, CheckErrorKind, ParseError};
use lsp_types::{Diagnostic, DiagnosticSeverity, NumberOrString};

use crate::document::LineIndex;

/// Convert parser errors to LSP diagnostics.
fn parse_errors_to_diagnostics(errors: &[ParseError], line_index: &LineIndex) -> Vec<Diagnostic> {
    errors
        .iter()
        .map(|error| {
            let range = line_index.span_to_range(&error.span);
            Diagnostic {
                range,
                severity: Some(DiagnosticSeverity::ERROR),
                code: None,
                code_description: None,
                source: Some("cel".to_string()),
                message: error.message.clone(),
                related_information: None,
                tags: None,
                data: None,
            }
        })
        .collect()
}

/// Convert check errors to LSP diagnostics.
fn check_errors_to_diagnostics(errors: &[CheckError], line_index: &LineIndex) -> Vec<Diagnostic> {
    errors
        .iter()
        .map(|error| {
            let code = match &error.kind {
                CheckErrorKind::UndeclaredReference { .. } => "undeclared-reference",
                CheckErrorKind::NoMatchingOverload { .. } => "no-matching-overload",
                CheckErrorKind::TypeMismatch { .. } => "type-mismatch",
                CheckErrorKind::UndefinedField { .. } => "undefined-field",
                CheckErrorKind::NotAssignable { .. } => "type-mismatch",
                CheckErrorKind::HeterogeneousAggregate { .. } => "heterogeneous-aggregate",
                CheckErrorKind::NotAType { .. } => "not-a-type",
                CheckErrorKind::Other(_) => "check-error",
            };

            Diagnostic {
                range: line_index.span_to_range(&error.span),
                severity: Some(DiagnosticSeverity::ERROR),
                code: Some(NumberOrString::String(code.to_string())),
                code_description: None,
                source: Some("cel".to_string()),
                message: error.message(),
                related_information: None,
                tags: None,
                data: None,
            }
        })
        .collect()
}

/// Convert all errors (parse + check) to LSP diagnostics.
pub fn to_diagnostics(
    parse_errors: &[ParseError],
    check_errors: &[CheckError],
    line_index: &LineIndex,
) -> Vec<Diagnostic> {
    let mut diagnostics = parse_errors_to_diagnostics(parse_errors, line_index);
    diagnostics.extend(check_errors_to_diagnostics(check_errors, line_index));
    diagnostics
}
