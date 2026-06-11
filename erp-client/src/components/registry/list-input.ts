// Helpers for editing string[] registry fields (niches, capabilities) as a single
// comma-separated text input. Kept tiny and shared by the supplier/customer forms.

// "a, b ,  c" -> ['a','b','c']. Empty/whitespace-only -> []. Trims and drops blanks.
export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ['a','b'] -> "a, b" for display in the text input.
export function joinList(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}
