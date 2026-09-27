import { receiveMetaWebhook, verifyMetaSubscription } from "@/server/webhooks";

export const maxDuration = 60;

export function GET(req: Request) {
  return verifyMetaSubscription(req);
}

export function POST(req: Request) {
  return receiveMetaWebhook(req, "INSTAGRAM");
}
