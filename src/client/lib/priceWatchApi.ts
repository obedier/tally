import { z } from "zod";
import {
  PriceWatchSchema,
  type CreatePriceWatchRequest,
  type PriceWatch,
} from "../../shared/priceWatch";
import { ApiError } from "./api";
import { apiUrl } from "./origin";

/**
 * Price-watch client helper (M4 growth). Records a saved re-check honestly —
 * never a promised alert. Responses are zod-parsed against the shared contract
 * before reaching a component; the client trusts nothing.
 */

const SetPriceWatchResponseSchema = z.object({
  ok: z.literal(true),
  watch: PriceWatchSchema,
});

/** POST /api/price-watch — records a watch (idempotent server-side). */
export async function setPriceWatch(req: CreatePriceWatchRequest): Promise<PriceWatch> {
  let response: Response;
  try {
    response = await fetch(apiUrl("/api/price-watch"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw new ApiError("Tally couldn't reach the server. Check your connection and try again.", 0);
  }

  if (!response.ok) {
    throw new ApiError("This price watch couldn't be saved.", response.status);
  }

  let json: unknown;
  try {
    json = (await response.json()) as unknown;
  } catch {
    throw new ApiError("The server returned an unreadable response.", response.status);
  }

  const parsed = SetPriceWatchResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError("The price watch arrived in an unexpected shape.", response.status);
  }
  return parsed.data.watch;
}
