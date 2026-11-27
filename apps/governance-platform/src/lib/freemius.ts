/**
 * Freemius SDK singleton — used for webhook verification and API calls.
 *
 * Requires env vars:
 *   FREEMIUS_PRODUCT_ID (default 27205)
 *   FREEMIUS_API_KEY
 *   FREEMIUS_SECRET_KEY
 *   FREEMIUS_PUBLIC_KEY
 */
import { Freemius } from "@freemius/sdk";

let _instance: Freemius | null = null;

export function getFreemius(): Freemius {
  if (!_instance) {
    const productId = Number(process.env.FREEMIUS_PRODUCT_ID || "27205");
    const apiKey = process.env.FREEMIUS_API_KEY;
    const secretKey = process.env.FREEMIUS_SECRET_KEY;
    const publicKey = process.env.FREEMIUS_PUBLIC_KEY;

    if (!apiKey || !secretKey || !publicKey) {
      throw new Error(
        "Missing Freemius env vars: FREEMIUS_API_KEY, FREEMIUS_SECRET_KEY, FREEMIUS_PUBLIC_KEY",
      );
    }

    _instance = new Freemius({ productId, apiKey, secretKey, publicKey });
  }
  return _instance;
}
