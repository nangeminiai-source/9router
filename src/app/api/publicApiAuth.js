import { getSettings } from "@/lib/localDb";
import { validateRequestApiKey } from "@/sse/services/auth.js";

export async function publicApiAuthError(request) {
  const settings = await getSettings();
  const validation = await validateRequestApiKey(request, { requireApiKey: !!settings.requireApiKey });
  if (validation.valid) return null;

  return Response.json(
    {
      error: {
        message: validation.message || "Invalid API key",
        type: "authentication_error",
      },
    },
    { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
