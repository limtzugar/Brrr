import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const rateResult = checkRateLimit(ip, 30, 60 * 1000);
  if (!rateResult.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  return NextResponse.json({ message: "Hello, world!" });
}