type StreakCard = {
  snapshot: { combined: { streak_current: number } } | null;
};

/** Highest current streak first; stable sort preserves roster order for ties. */
export function rankByStreak(a: StreakCard, b: StreakCard): number {
  return (b.snapshot?.combined.streak_current ?? -1) - (a.snapshot?.combined.streak_current ?? -1);
}
