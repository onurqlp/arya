import { neon } from "@neondatabase/serverless";

let client;
let clientUrl;

export function getCoordinatorDb() {
  if (process.env.VERCEL_ENV === "production") {
    const error = new Error("coordinator_storage_blocked_in_production");
    error.code = "coordinator_storage_blocked_in_production";
    throw error;
  }
  const url = process.env.DERS_COORD_DATABASE_URL;
  if (!url) {
    const error = new Error("coordinator_store_not_configured");
    error.code = "coordinator_store_not_configured";
    throw error;
  }
  if (!client || clientUrl !== url) {
    client = neon(url);
    clientUrl = url;
  }
  return client;
}
