/**
 * Detects identifiers that decompilers (Ghidra in particular) generate, so that none reach the
 * public code (docs/CLEAN_ROOM.md). The patterns require the generated shape (an address, a number
 * or a register name after the prefix) so ordinary words do not match.
 */
const patterns: readonly RegExp[] = [
  // Ghidra labels: FUN_, DAT_ or LAB_ plus an address, their thunk_ and PTR_ forms, switch tables
  /\b(?:thunk_)?(?:FUN|DAT|LAB)_[0-9a-fA-F]{4,}/,
  /\bPTR_(?:[0-9a-fA-F]{4,}|FUN_|DAT_|LAB_|LOOP_|s_)/,
  /\b(?:switchD|caseD)_[0-9a-fA-F]/,
  // IDA labels: sub_, loc_, dword_, off_ and similar plus an upper-case hex address
  /\b(?:sub|loc|locret|dword|word|byte|qword|unk|off|stru|asc)_[0-9A-F]{4,}\b/,
  // Ghidra variables: a type prefix (u, i, b, s, c, l, pv, pu, ...) plus Var and a number,
  // stack buffers, parameters, locals, register inputs and outputs
  /\b(?:a|p|pp)?(?:u|i|b|s|c|l|f|d|pv|uc|us|ui|ul|z)Var\d+\b/,
  /\bpVar\d+\b/,
  /\b(?:a|p)?(?:u|i|b|s|c|l)Stack_[0-9a-fA-F]+\b/,
  /\bparam_\d+\b/,
  /\blocal_(?:res)?[0-9a-fA-F]*\d[0-9a-fA-F]*\b/,
  /\bin_stack_[0-9a-fA-F]/,
  /\bin_[A-Z]{2,3}\b/,
  /\b(?:extraout|unaff)_[A-Za-z]/,
  // Ghidra types and pseudo-operations: undefinedN, CONCAT, SUB, ZEXT, SEXT, CARRY plus sizes
  /\bundefined[1-8]\b/,
  /\b(?:CONCAT|SUB|ZEXT|SEXT)\d{2}\b/,
  /\b(?:CARRY|SCARRY|SBORROW)\d\b/,
];

export interface Finding {
  line: number;
  column: number;
  match: string;
}

/** Returns every decompiler-style identifier in text, with 1-based line and column. */
export function scanText(text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const global = new RegExp(pattern.source, 'g');
      for (const match of line.matchAll(global)) {
        findings.push({ line: index + 1, column: match.index + 1, match: match[0] });
      }
    }
  });
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}
