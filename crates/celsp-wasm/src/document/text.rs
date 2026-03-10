//! Text utilities for position conversion.
//!
//! Adapted from celsp's document/text.rs.
//! Changed: `tower_lsp::lsp_types::Position` -> `lsp_types::Position`
//! Changed: `tower_lsp::lsp_types::Range` -> `lsp_types::Range`

use lsp_types::Position;

/// Pre-computed line index for efficient position lookups.
///
/// LSP positions use line/column where column is in UTF-16 code units.
/// This struct pre-computes line start offsets for O(log n) lookup.
#[derive(Debug, Clone)]
pub struct LineIndex {
    /// Byte offset where each line starts.
    line_starts: Vec<usize>,
    /// Source text (needed for UTF-16 column calculation).
    source: String,
}

impl LineIndex {
    /// Build a line index from source text.
    pub fn new(source: String) -> Self {
        let mut line_starts = vec![0];

        for (i, c) in source.char_indices() {
            if c == '\n' {
                line_starts.push(i + 1);
            }
        }

        Self {
            line_starts,
            source,
        }
    }

    /// Get the source text.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// Convert a byte offset to an LSP position.
    ///
    /// Uses binary search for O(log n) line lookup, then scans the line for UTF-16 column.
    pub fn offset_to_position(&self, offset: usize) -> Position {
        // Binary search to find the line
        let line = match self.line_starts.binary_search(&offset) {
            Ok(line) => line,                    // Exact match (start of line)
            Err(line) => line.saturating_sub(1), // In the middle of a line
        };

        let line_start = self.line_starts[line];
        let line_end = self
            .line_starts
            .get(line + 1)
            .copied()
            .unwrap_or(self.source.len());

        // Calculate UTF-16 column
        let mut col = 0u32;
        let line_slice = &self.source[line_start..line_end];

        for (i, c) in line_slice.char_indices() {
            if line_start + i >= offset {
                break;
            }
            col += c.len_utf16() as u32;
        }

        Position::new(line as u32, col)
    }

    /// Convert an LSP position to a byte offset.
    ///
    /// Returns None if the position is out of bounds.
    pub fn position_to_offset(&self, position: Position) -> Option<usize> {
        let line = position.line as usize;

        if line >= self.line_starts.len() {
            return None;
        }

        let line_start = self.line_starts[line];
        let line_end = self
            .line_starts
            .get(line + 1)
            .map(|&end| end.saturating_sub(1)) // Exclude newline
            .unwrap_or(self.source.len());

        let line_slice = &self.source[line_start..line_end];

        // Walk UTF-16 code units to find byte offset
        let mut utf16_col = 0u32;
        for (i, c) in line_slice.char_indices() {
            if utf16_col >= position.character {
                return Some(line_start + i);
            }
            utf16_col += c.len_utf16() as u32;
        }

        // Position is at or past end of line
        Some(line_end.min(self.source.len()))
    }

    /// Convert a byte span to an LSP range.
    pub fn span_to_range(&self, span: &std::ops::Range<usize>) -> lsp_types::Range {
        let start = self.offset_to_position(span.start);
        let end = self.offset_to_position(span.end);
        lsp_types::Range::new(start, end)
    }
}
