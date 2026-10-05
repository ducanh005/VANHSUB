/** Immutable interval index; queries preserve the input order, including equal-score tie breaks. */
export function createTimeWindowIndex<T extends { startMs: number; endMs: number }>(items: T[]) {
  type Node = { item: T; index: number; maxEnd: number; left?: Node; right?: Node };
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => a.item.startMs - b.item.startMs);
  const build = (lo: number, hi: number): Node | undefined => {
    if (lo >= hi) return undefined;
    const mid = (lo + hi) >>> 1;
    const left = build(lo, mid),
      right = build(mid + 1, hi);
    return {
      ...ordered[mid],
      left,
      right,
      maxEnd: Math.max(ordered[mid].item.endMs, left?.maxEnd ?? -Infinity, right?.maxEnd ?? -Infinity),
    };
  };
  const root = build(0, ordered.length);
  return (start: number, end: number): T[] => {
    const found: { item: T; index: number }[] = [];
    const visit = (node?: Node) => {
      if (!node || node.maxEnd < start) return;
      visit(node.left);
      if (node.item.startMs <= end && node.item.endMs >= start) found.push(node);
      if (node.item.startMs <= end) visit(node.right);
    };
    visit(root);
    return found.sort((a, b) => a.index - b.index).map((entry) => entry.item);
  };
}
