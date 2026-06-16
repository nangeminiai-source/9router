import { NextResponse } from "next/server";
import { updateApiKeyQuota } from "@/lib/localDb";

// POST /api/keys/[id]/quota - Manage request quota without changing the key value
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const updated = await updateApiKeyQuota(id, {
      mode: body?.mode,
      requestLimit: body?.requestLimit,
      additionalRequests: body?.additionalRequests,
      resetUsed: body?.resetUsed === true,
    });
    if (!updated) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key quota:", error);
    return NextResponse.json({ error: error.message || "Failed to update key quota" }, { status: 400 });
  }
}
