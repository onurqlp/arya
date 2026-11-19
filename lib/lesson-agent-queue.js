const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rowsOf(result) {
  return Array.isArray(result) ? result : Array.isArray(result?.rows) ? result.rows : [];
}

function fail(code, status) {
  return Object.assign(new Error(code), { code, status });
}

export async function claimJob(db, agentId) {
  const rows = rowsOf(await db.query(
    "WITH expired AS (" +
      "UPDATE coord_jobs SET status = 'dead_letter', lease_owner = NULL, lease_until = NULL, last_error = 'lease_expired_max_attempts', updated_at = NOW() " +
      "WHERE status = 'leased' AND lease_until < NOW() AND attempts >= max_attempts AND send_enabled = false RETURNING id, occurrence_id" +
    "), expired_outbox AS (" +
      "UPDATE coord_outbox SET status = 'dead_letter', updated_at = NOW() WHERE job_id IN (SELECT id FROM expired) RETURNING job_id" +
    "), expired_events AS (" +
      "INSERT INTO coord_events (event_type, level, occurrence_id, job_id, details) " +
      "SELECT 'agent_lease_expired_dead_letter', 'error', occurrence_id, id, '{\"error_code\":\"lease_expired_max_attempts\"}'::jsonb FROM expired RETURNING id" +
    "), candidate AS (" +
      "SELECT id FROM coord_jobs WHERE send_enabled = false AND (" +
        "(status IN ('queued','retry_wait') AND run_at <= NOW()) OR " +
        "(status = 'leased' AND lease_until < NOW() AND attempts < max_attempts)" +
      ") AND id NOT IN (SELECT id FROM expired) ORDER BY run_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1" +
    "), claimed AS (" +
      "UPDATE coord_jobs j SET status = 'leased', attempts = j.attempts + 1, lease_owner = $1, " +
      "lease_until = NOW() + INTERVAL '2 minutes', updated_at = NOW() FROM candidate c " +
      "WHERE j.id = c.id AND j.send_enabled = false " +
      "RETURNING j.id::text AS id, j.occurrence_id::text AS occurrence_id, j.job_type, j.status, j.run_at, " +
      "j.attempts, j.max_attempts, j.payload, j.send_enabled" +
    ") " +
    "UPDATE coord_agent_heartbeats SET last_job_id = (SELECT id::uuid FROM claimed LIMIT 1), last_seen = NOW() " +
    "WHERE agent_id = $1 RETURNING (SELECT row_to_json(claimed) FROM claimed LIMIT 1) AS job",
    [agentId]
  ));
  return rows[0]?.job || null;
}

export async function acknowledge(db, agentId, body) {
  if (!JOB_ID_RE.test(body.job_id || "") || !["simulated","retry","failed"].includes(body.outcome)) {
    throw fail("invalid_agent_ack", 400);
  }
  const safeErrorCodes = new Set(["timeout","simulated_failure","lease_lost"]);
  if (body.error_code && !safeErrorCodes.has(body.error_code)) throw fail("invalid_agent_ack", 400);
  if (body.outcome === "simulated") {
    const rows = rowsOf(await db.query(
      "WITH moved AS (" +
        "UPDATE coord_jobs SET status = 'simulated', lease_owner = NULL, lease_until = NULL, updated_at = NOW() " +
        "WHERE id = $1::uuid AND status = 'leased' AND lease_owner = $2 AND send_enabled = false " +
        "RETURNING id, occurrence_id" +
      ") " +
      "UPDATE coord_outbox o SET status = 'simulated', simulated_at = NOW(), updated_at = NOW() " +
      "FROM moved WHERE o.job_id = moved.id AND o.send_enabled = false RETURNING moved.id::text AS job_id, moved.occurrence_id::text AS occurrence_id",
      [body.job_id, agentId]
    ));
    if (!rows.length) throw fail("agent_job_lease_not_found", 409);
    await db.query(
      "INSERT INTO coord_events (event_type, level, occurrence_id, job_id, details) VALUES ('agent_job_simulated', 'info', $1::uuid, $2::uuid, $3::jsonb)",
      [rows[0].occurrence_id, rows[0].job_id, JSON.stringify({ agent_id: agentId, sent: false, sending_enabled: false })]
    );
    return { acknowledged: true, simulated: true, sent: false, sending_enabled: false };
  }

  const errorCode = body.error_code || "simulated_failure";
  const status = body.outcome === "failed" ? "dead_letter" : null;
  const moved = rowsOf(await db.query(
    "WITH changed AS (" +
      "UPDATE coord_jobs SET status = COALESCE($4, CASE WHEN attempts >= max_attempts THEN 'dead_letter' ELSE 'retry_wait' END), " +
      "run_at = CASE WHEN $4 = 'dead_letter' OR attempts >= max_attempts THEN run_at " +
        "ELSE NOW() + LEAST(INTERVAL '30 minutes', INTERVAL '30 seconds' * POWER(2, GREATEST(attempts - 1, 0))) END, " +
      "last_error = $3, lease_owner = NULL, lease_until = NULL, updated_at = NOW() " +
      "WHERE id = $1::uuid AND status = 'leased' AND lease_owner = $2 AND send_enabled = false " +
      "RETURNING id, occurrence_id, status, payload, run_at" +
    ") " +
    "UPDATE coord_outbox o SET status = CASE WHEN changed.status = 'dead_letter' THEN 'dead_letter' ELSE 'queued' END, " +
      "payload = changed.payload, updated_at = NOW() FROM changed WHERE o.job_id = changed.id AND o.send_enabled = false " +
      "RETURNING changed.id::text AS job_id, changed.occurrence_id::text AS occurrence_id, changed.status, " +
      "CASE WHEN changed.status = 'retry_wait' THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (changed.run_at - NOW())) * 1000))::bigint ELSE 0 END AS retry_after_ms",
    [body.job_id, agentId, errorCode, status]
  ));
  if (!moved.length) throw fail("agent_job_lease_not_found", 409);
  const retryAfterMs = Number(moved[0].retry_after_ms || 0);
  await db.query(
    "INSERT INTO coord_events (event_type, level, occurrence_id, job_id, details) VALUES ('agent_job_retry', 'warn', $1::uuid, $2::uuid, $3::jsonb)",
    [moved[0].occurrence_id, moved[0].job_id, JSON.stringify({ outcome: body.outcome, status: moved[0].status, error_code: errorCode, retry_after_ms: retryAfterMs })]
  );
  return { acknowledged: true, status: moved[0].status, retry_after_ms: retryAfterMs, sent: false, sending_enabled: false };
}
