export type InboxRiskRow = { id: string; revenueRisk?: { status: string; score: number | null } | null };

/** Applicable scores first, highest first. Ties and unknowns retain the server's existing order. */
export function sortInboxByRevenueRisk<T extends InboxRiskRow>(rows: readonly T[]): T[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const aScore = a.row.revenueRisk?.status === 'APPLICABLE' ? a.row.revenueRisk.score : null;
    const bScore = b.row.revenueRisk?.status === 'APPLICABLE' ? b.row.revenueRisk.score : null;
    if (aScore == null && bScore == null) return a.index - b.index;
    if (aScore == null) return 1;
    if (bScore == null) return -1;
    return bScore - aScore || a.index - b.index;
  }).map(entry => entry.row);
}
