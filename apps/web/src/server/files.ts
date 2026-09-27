import "server-only";
import { storage } from "@revenueos/core";
import "./boot";

/** Short-lived signed URL for a storage key (local HMAC link or Supabase signed URL). */
export async function signedUrl(key: string | null | undefined, ttlSec = 3600): Promise<string | null> {
  if (!key) return null;
  try {
    return await storage().getSignedUrl(key, ttlSec);
  } catch {
    return null;
  }
}

export async function signedUrls(keys: (string | null | undefined)[], ttlSec = 3600): Promise<(string | null)[]> {
  return Promise.all(keys.map((k) => signedUrl(k, ttlSec)));
}
