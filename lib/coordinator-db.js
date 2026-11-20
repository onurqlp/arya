import { neon } from "@neondatabase/serverless";

let client;
let clientUrl;

function productionDatabaseIsIsolated(url) {
  try {
    const coordinator = new URL(url);
    const coordinatorDatabase = decodeURIComponent(coordinator.pathname.replace(/^\/+/, ""));
    if (coordinatorDatabase !== "arya_ders_koordinatoru") return false;

    const aryaDatabaseUrl = process.env.DATABASE_URL;
    if (aryaDatabaseUrl) {
      const arya = new URL(aryaDatabaseUrl);
      const aryaDatabase = decodeURIComponent(arya.pathname.replace(/^\/+/, ""));
      if (coordinator.host === arya.host && coordinatorDatabase === aryaDatabase) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getCoordinatorDb() {
  const isProduction = process.env.VERCEL_ENV === "production";
  if (isProduction && process.env.DERS_COORDINATOR_ENABLED !== "true") {
    const error = new Error("coordinator_storage_disabled");
    error.code = "coordinator_storage_disabled";
    throw error;
  }
  const url = process.env.DERS_COORD_DATABASE_URL;
  if (!url) {
    const error = new Error("coordinator_store_not_configured");
    error.code = "coordinator_store_not_configured";
    throw error;
  }
  if (isProduction && !productionDatabaseIsIsolated(url)) {
    const error = new Error("coordinator_database_scope_invalid");
    error.code = "coordinator_database_scope_invalid";
    throw error;
  }
  if (!client || clientUrl !== url) {
    client = neon(url);
    clientUrl = url;
  }
  return client;
}
