//! Completion support for CEL expressions.
//!
//! Adapted from celsp's lsp/completion.rs.
//! Changes:
//!   - `tower_lsp::lsp_types::*` -> `lsp_types::*`
//!   - Removed `completion_at_position_proto` (proto support skipped for v1)
//!   - Removed protovalidate builtin references
//!   - Removed ProtoDocumentState import

use cel_core::types::Expr;
use cel_core::{CelType, Env, SpannedExpr};
use lsp_types::*;

use crate::document::LineIndex;
use crate::types::{get_builtin, FunctionDef};

/// Placeholder identifier inserted at the cursor for re-checking.
const PLACEHOLDER: &str = "__cel_complete__";

/// CEL macro names that should appear in identifier completion.
const MACROS: &[&str] = &["has", "all", "exists", "exists_one", "filter", "map"];

/// What kind of completion context we detected.
#[derive(Debug)]
enum CompletionContext {
    /// Cursor is after a `.` — need receiver type for member suggestions.
    /// Contains the prefix text the user has typed after the dot (may be empty).
    MemberAccess { prefix: String },
    /// Cursor is at a bare or partial identifier — suggest variables + functions.
    /// Contains the partial identifier text (may be empty).
    Identifier { prefix: String },
}

/// Detect the completion context by scanning backwards from the cursor.
fn detect_context(source: &str, offset: usize) -> CompletionContext {
    let before = &source[..offset];

    // Scan backwards to find any partial identifier being typed
    let ident_start = before
        .bytes()
        .rev()
        .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_')
        .count();
    let prefix = &before[before.len() - ident_start..];

    // Check if there's a dot before the partial identifier
    let before_prefix = &before[..before.len() - ident_start];
    let trimmed = before_prefix.trim_end();

    if trimmed.ends_with('.') {
        CompletionContext::MemberAccess {
            prefix: prefix.to_string(),
        }
    } else {
        CompletionContext::Identifier {
            prefix: prefix.to_string(),
        }
    }
}

/// Find the Expr::Member node with our placeholder field in the AST.
fn find_placeholder_member(ast: &SpannedExpr) -> Option<&SpannedExpr> {
    match &ast.node {
        Expr::Member { expr, field, .. } if field == PLACEHOLDER => Some(ast),
        // Recurse into children
        Expr::Member { expr, .. } => find_placeholder_member(expr),
        Expr::Call { expr, args } => {
            find_placeholder_member(expr).or_else(|| args.iter().find_map(find_placeholder_member))
        }
        Expr::Binary { left, right, .. } => {
            find_placeholder_member(left).or_else(|| find_placeholder_member(right))
        }
        Expr::Unary { expr, .. } => find_placeholder_member(expr),
        Expr::Ternary {
            cond,
            then_expr,
            else_expr,
        } => find_placeholder_member(cond)
            .or_else(|| find_placeholder_member(then_expr))
            .or_else(|| find_placeholder_member(else_expr)),
        Expr::Index { expr, index, .. } => {
            find_placeholder_member(expr).or_else(|| find_placeholder_member(index))
        }
        Expr::List(items) => items
            .iter()
            .find_map(|item| find_placeholder_member(&item.expr)),
        Expr::Map(entries) => entries.iter().find_map(|entry| {
            find_placeholder_member(&entry.key).or_else(|| find_placeholder_member(&entry.value))
        }),
        Expr::Comprehension(comp) => find_placeholder_member(&comp.iter_range)
            .or_else(|| find_placeholder_member(&comp.accu_init))
            .or_else(|| find_placeholder_member(&comp.loop_condition))
            .or_else(|| find_placeholder_member(&comp.loop_step))
            .or_else(|| find_placeholder_member(&comp.result)),
        Expr::MemberTestOnly { expr, field } if field == PLACEHOLDER => Some(ast),
        Expr::MemberTestOnly { expr, .. } => find_placeholder_member(expr),
        Expr::Bind { init, body, .. } => {
            find_placeholder_member(init).or_else(|| find_placeholder_member(body))
        }
        Expr::Struct { fields, .. } => fields
            .iter()
            .find_map(|f| find_placeholder_member(&f.value)),
        _ => None,
    }
}

/// Get the receiver expression ID from a Member node containing our placeholder.
fn get_receiver_id(node: &SpannedExpr) -> Option<i64> {
    match &node.node {
        Expr::Member { expr, field, .. } if field == PLACEHOLDER => Some(expr.id),
        Expr::MemberTestOnly { expr, field } if field == PLACEHOLDER => Some(expr.id),
        _ => None,
    }
}

/// Resolve the receiver type by inserting a placeholder and re-checking.
///
/// `prefix_len` is the length of any partial identifier already typed after the dot.
/// We strip that prefix and everything after the cursor, then append the placeholder
/// so the parser sees a clean `receiver.__cel_complete__` expression.
fn resolve_receiver_type(
    source: &str,
    offset: usize,
    prefix_len: usize,
    env: &Env,
) -> Option<CelType> {
    // Insert the placeholder right after the dot, replacing any partial text
    // but keeping the rest of the source (closing parens, etc.) so macros like
    // has() can still be expanded correctly.
    let insert_offset = offset - prefix_len;
    let modified = format!(
        "{}{}{}",
        &source[..insert_offset],
        PLACEHOLDER,
        &source[offset..]
    );

    let parse_result = env.parse(&modified);
    let ast = parse_result.ast?;
    let check_result = env.check(&ast);

    // Find the placeholder Member node
    let member_node = find_placeholder_member(&ast)?;
    let receiver_id = get_receiver_id(member_node)?;

    // Look up the receiver's type in the type map
    check_result.type_map.get(&receiver_id).cloned()
}

/// Format a function overload as a detail string.
fn format_overload_detail(overload: &cel_core::types::OverloadDecl) -> String {
    let args: Vec<String> = overload
        .arg_types()
        .iter()
        .map(|t| t.display_name())
        .collect();
    let result = overload.result.display_name();
    format!("({}) -> {}", args.join(", "), result)
}

/// Build completion items for member access on a known type.
fn member_completions(receiver_type: &CelType, env: &Env, prefix: &str) -> Vec<CompletionItem> {
    let mut items = Vec::new();

    // Add proto message fields if the receiver is a message type
    if let CelType::Message(msg_name) = receiver_type {
        if let Some(registry) = env.proto_registry() {
            if let Some(fields) = registry.message_field_names(msg_name) {
                for field_name in fields {
                    if !prefix.is_empty()
                        && !field_name
                            .to_lowercase()
                            .starts_with(&prefix.to_lowercase())
                    {
                        continue;
                    }
                    let field_type = registry
                        .get_field_type(msg_name, &field_name)
                        .map(|t| t.display_name())
                        .unwrap_or_default();
                    items.push(CompletionItem {
                        label: field_name.clone(),
                        kind: Some(CompletionItemKind::FIELD),
                        detail: if field_type.is_empty() {
                            None
                        } else {
                            Some(field_type)
                        },
                        sort_text: Some(format!("0_{}", field_name)),
                        ..Default::default()
                    });
                }
            }
        }
    }

    // Add member methods compatible with the receiver type
    let methods = env.methods_for_type(receiver_type);
    for (name, overload) in &methods {
        // Skip operator functions
        if name.starts_with('_') || name.contains('@') {
            continue;
        }
        if !prefix.is_empty() && !name.to_lowercase().starts_with(&prefix.to_lowercase()) {
            continue;
        }
        let detail = format_overload_detail(overload);

        // Build snippet with arg placeholders
        let arg_types = overload.arg_types();
        let insert_text = if arg_types.is_empty() {
            format!("{}()", name)
        } else {
            let placeholders: Vec<String> = arg_types
                .iter()
                .enumerate()
                .map(|(i, _)| format!("${{{}}}", i + 1))
                .collect();
            format!("{}({})", name, placeholders.join(", "))
        };

        // Look up documentation from builtins
        let documentation = get_function_docs(name);

        items.push(CompletionItem {
            label: name.to_string(),
            kind: Some(CompletionItemKind::METHOD),
            detail: Some(detail),
            documentation,
            insert_text: Some(insert_text),
            insert_text_format: Some(InsertTextFormat::SNIPPET),
            sort_text: Some(format!("1_{}", name)),
            ..Default::default()
        });
    }

    items
}

/// Build completion items for bare identifiers.
fn identifier_completions(env: &Env, prefix: &str) -> Vec<CompletionItem> {
    let mut items = Vec::new();

    // Add variables
    for (name, cel_type) in env.variables() {
        if !prefix.is_empty() && !name.to_lowercase().starts_with(&prefix.to_lowercase()) {
            continue;
        }
        items.push(CompletionItem {
            label: name.clone(),
            kind: Some(CompletionItemKind::VARIABLE),
            detail: Some(cel_type.display_name()),
            sort_text: Some(format!("0_{}", name)),
            ..Default::default()
        });
    }

    // Add standalone functions
    let functions = env.standalone_functions();
    for name in functions {
        if !prefix.is_empty() && !name.to_lowercase().starts_with(&prefix.to_lowercase()) {
            continue;
        }

        // Look up documentation
        let documentation = get_function_docs(name);

        items.push(CompletionItem {
            label: name.to_string(),
            kind: Some(CompletionItemKind::FUNCTION),
            documentation,
            sort_text: Some(format!("1_{}", name)),
            ..Default::default()
        });
    }

    // Add macros
    for &name in MACROS {
        if !prefix.is_empty() && !name.to_lowercase().starts_with(&prefix.to_lowercase()) {
            continue;
        }
        let documentation = get_function_docs(name);
        items.push(CompletionItem {
            label: name.to_string(),
            kind: Some(CompletionItemKind::KEYWORD),
            documentation,
            sort_text: Some(format!("2_{}", name)),
            ..Default::default()
        });
    }

    items
}

/// Look up documentation for a function from builtins.
///
/// Changed from celsp: removed protovalidate builtin fallback (proto support skipped for v1).
fn get_function_docs(name: &str) -> Option<Documentation> {
    let builtin: Option<&FunctionDef> = get_builtin(name);
    builtin.map(|b| {
        let mut doc = format!("{}\n\n{}", b.signature, b.description);
        if let Some(example) = b.example {
            doc.push_str(&format!("\n\nExample: `{}`", example));
        }
        Documentation::MarkupContent(MarkupContent {
            kind: MarkupKind::Markdown,
            value: doc,
        })
    })
}

/// Generate completions at a position in a CEL expression.
pub fn completion_at_position(
    line_index: &LineIndex,
    source: &str,
    env: &Env,
    position: Position,
) -> Option<CompletionResponse> {
    let offset = line_index.position_to_offset(position)?;
    let context = detect_context(source, offset);

    let items = match context {
        CompletionContext::MemberAccess { prefix } => {
            let receiver_type = resolve_receiver_type(source, offset, prefix.len(), env);
            match receiver_type {
                Some(ty) => member_completions(&ty, env, &prefix),
                None => member_completions(&CelType::Dyn, env, &prefix),
            }
        }
        CompletionContext::Identifier { prefix } => identifier_completions(env, &prefix),
    };

    if items.is_empty() {
        None
    } else {
        Some(CompletionResponse::Array(items))
    }
}
