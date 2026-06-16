import { NextResponse } from "next/server";
import { getApiKeys, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { resolveApiKeyExpiresAt } from "@/shared/utils/apiKeyExpiration";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET() {
  try {
    const keys = await getApiKeys();
    return NextResponse.json({ keys });
  } catch (error) {
    console.log("Error fetching keys:", error);
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      name,
      expirationPreset = "never",
      customExpiresAt = null,
      customDurationValue = null,
      customDurationUnit = "days",
      requestLimit = null,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let expiresAt = null;
    let normalizedRequestLimit = null;
    try {
      expiresAt = resolveApiKeyExpiresAt({
        expirationPreset,
        customExpiresAt,
        customDurationValue,
        customDurationUnit,
      });
      if (requestLimit !== null && requestLimit !== undefined && requestLimit !== "") {
        normalizedRequestLimit = Number(requestLimit);
        if (!Number.isInteger(normalizedRequestLimit) || normalizedRequestLimit <= 0) {
          throw new Error("Request limit must be a positive integer");
        }
      }
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, { expiresAt, requestLimit: normalizedRequestLimit });

    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      machineId: apiKey.machineId,
      expiresAt: apiKey.expiresAt,
      expiredAt: apiKey.expiredAt,
      requestLimit: apiKey.requestLimit,
      requestUsed: apiKey.requestUsed,
      requestRemaining: apiKey.requestRemaining,
      status: apiKey.status,
    }, { status: 201 });
  } catch (error) {
    console.log("Error creating key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
