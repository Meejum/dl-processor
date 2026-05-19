// src/trending.js — v2.3 trending tile backend (Phase 7.1).
//
// getTrendingProjects(db, { minBaseline=5, ratioThreshold=2.0 }) returns the
// list of projects whose pending_change rate this month spikes above the
// trailing 6-month average. Bucketing uses dld_snapshot.imported_at where
// pending_change.source_snapshot_id is set; SF_DRIFT rows (snapshot id NULL)
// fall back to pending_change.proposed_at.
//
// Returned shape: [{ project_id, project_name, this_month, trailing_avg, ratio }]
// sorted by ratio DESC. ratio === Infinity when trailing_avg is 0; for display
// we cap at 999, but rows with Infinity still pass the ratio filter.

const DEFAULT_MIN_BASELINE = 5;
const DEFAULT_RATIO_THRESHOLD = 2.0;
const RATIO_DISPLAY_CAP = 999;

// Query plan:
//   1. Build a derived table that, for every pending_change row, computes the
//      bucket_month (YYYY-MM-01) via COALESCE(snapshot.imported_at, pc.proposed_at).
//   2. Aggregate per (project_id, bucket_month).
//   3. In JS, for each project: pick the current-month count, compute trailing
//      6-month average across the 6 months *before* the current month, apply
//      filters, sort.
//
// We compute "current month" SQL-side (date('now','start of month')) so tests
// follow system time without injecting clocks.
const BUCKETS_SQL = `
  WITH bucketed AS (
    SELECT
      pc.project_id,
      strftime('%Y-%m-01',
        COALESCE(s.imported_at, pc.proposed_at)
      ) AS bucket_month
    FROM pending_change pc
    LEFT JOIN dld_snapshot s ON s.snapshot_id = pc.source_snapshot_id
  )
  SELECT
    b.project_id,
    p.project_name,
    b.bucket_month,
    COUNT(*) AS n
  FROM bucketed b
  JOIN dld_project p ON p.project_id = b.project_id
  WHERE b.bucket_month IS NOT NULL
  GROUP BY b.project_id, b.bucket_month
`;

const CURRENT_MONTH_SQL = `SELECT date('now', 'start of month') AS m`;

function monthsBefore(monthStr, n) {
  // monthStr is 'YYYY-MM-01'. Return the YYYY-MM-01 for n months earlier.
  const [y, m] = monthStr.split('-').map(Number);
  // m is 1-12. Compute zero-based month index.
  const zero = (y * 12 + (m - 1)) - n;
  const yy = Math.floor(zero / 12);
  const mm = (zero % 12) + 1;
  return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-01`;
}

function getTrendingProjects(db, opts = {}) {
  const minBaseline = opts.minBaseline ?? DEFAULT_MIN_BASELINE;
  const ratioThreshold = opts.ratioThreshold ?? DEFAULT_RATIO_THRESHOLD;

  const { m: currentMonth } = db.prepare(CURRENT_MONTH_SQL).get();
  if (!currentMonth) return [];

  // Trailing 6 months EXCLUDING current.
  const trailingMonths = new Set();
  for (let i = 1; i <= 6; i++) trailingMonths.add(monthsBefore(currentMonth, i));

  const rows = db.prepare(BUCKETS_SQL).all();

  // Group rows by project.
  const byProject = new Map();
  for (const r of rows) {
    let agg = byProject.get(r.project_id);
    if (!agg) {
      agg = { project_id: r.project_id, project_name: r.project_name, this_month: 0, trailing_sum: 0 };
      byProject.set(r.project_id, agg);
    }
    if (r.bucket_month === currentMonth) {
      agg.this_month += r.n;
    } else if (trailingMonths.has(r.bucket_month)) {
      agg.trailing_sum += r.n;
    }
    // Anything older than 6 months ago, or in the future, is ignored.
  }

  const result = [];
  for (const agg of byProject.values()) {
    const trailing_avg = agg.trailing_sum / 6;
    let ratio;
    if (trailing_avg === 0) {
      ratio = agg.this_month > 0 ? Infinity : 0;
    } else {
      ratio = agg.this_month / trailing_avg;
    }

    // Filter — Infinity passes ratioThreshold; minBaseline gates noise.
    if (agg.this_month < minBaseline) continue;
    if (!(ratio >= ratioThreshold)) continue;

    result.push({
      project_id: agg.project_id,
      project_name: agg.project_name,
      this_month: agg.this_month,
      trailing_avg,
      ratio: ratio === Infinity ? RATIO_DISPLAY_CAP : ratio
    });
  }

  // Sort by ratio DESC.
  result.sort((a, b) => b.ratio - a.ratio);
  return result;
}

module.exports = { getTrendingProjects };
