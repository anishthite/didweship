import assert from "node:assert/strict";
import { rankByStreak } from "../apps/web/src/lib/ranking";

const card = (slug: string, streak: number | null) => ({
  slug,
  snapshot: streak === null ? null : { combined: { streak_current: streak } },
});
const cards = [card("offline", null), card("zero", 0), card("first-tie", 7), card("leader", 30), card("second-tie", 7)];
assert.deepEqual(cards.sort(rankByStreak).map((c) => c.slug), ["leader", "first-tie", "second-tie", "zero", "offline"]);
assert.equal(rankByStreak(card("a", null), card("b", null)), 0);
console.log("Streak ranking checks passed.");
