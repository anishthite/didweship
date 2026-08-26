import { NextResponse } from "next/server";
import { getMonthlyEvidence } from "@/lib/monthly-evidence";
import { getUserBySlug } from "@/config/users";

export const runtime = "nodejs";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  const slug = url.searchParams.get("user") ?? "anish";
  const user = getUserBySlug(slug);

  if (!MONTH.test(month)) {
    return NextResponse.json({ error: "invalid_month" }, { status: 400 });
  }
  if (!user) {
    return NextResponse.json({ error: "unknown_user" }, { status: 404 });
  }

  const evidence = await getMonthlyEvidence(user, month);
  return NextResponse.json(evidence, {
    headers: {
      // Account-derived evidence must never be served from a shared CDN cache.
      "cache-control": "private, no-store",
    },
  });
}
