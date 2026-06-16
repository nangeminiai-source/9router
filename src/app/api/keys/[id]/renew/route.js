import { NextResponse } from "next/server";
import { getApiKeyById, updateApiKey } from "@/lib/localDb";
import { resolveApiKeyRenewedExpiresAt } from "@/shared/utils/apiKeyExpiration";

// POST /api/keys/[id]/renew - Extend an existing API key without changing the key value
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      renewalPreset = "7d",
      customDurationValue = null,
      customDurationUnit = "days",
      customExpiresAt = null,
    } = body || {};

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    let expiresAt;
    try {
      expiresAt = resolveApiKeyRenewedExpiresAt(
        { renewalPreset, customDurationValue, customDurationUnit, customExpiresAt },
        existing.expiresAt
      );
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const updateData = {
      expiresAt,
      expiredAt: null,
    };
    if (existing.status === "expired") updateData.isActive = true;

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error renewing key:", error);
    return NextResponse.json({ error: "Failed to renew key" }, { status: 500 });
  }
}
