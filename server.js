/**
 * @file server.js
 * @description Express backend for CAS Parsing and My MF Dashboard - fetches and aggregates mutual fund data.
 * @author Pabitra Swain - https://github.com/the-sdet
 * @license MIT
 */
import express from "express";
import fs from "fs/promises";
import fetch from "node-fetch";
import multer from "multer";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { PdfReader } from "pdfreader";
import { parseCAS } from "./parser.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Detect environment automatically ---
const isRender = !!process.env.RENDER;
const isLocal = !isRender;

if (!isLocal) app.use("/api", limiter);

const allowedOrigins = isLocal
  ? ["http://127.0.0.1:5500", "http://localhost:5500", "http://localhost:3000"]
  : ["https://mf-dashboard.github.io"];

// --- Apply CORS dynamically ---
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn("❌ CORS blocked origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

console.log("🌍 Environment detected:", isLocal ? "LOCAL" : "RENDER");
console.log("✅ Allowed Origins:", allowedOrigins.join(", "));

app.use(express.json());
const upload = multer({ dest: "uploads/" });

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "MF Dashboard Backend API is running",
    endpoints: [
      "POST /api/parse-cas",
      "POST /api/mf-stats",
      "POST /api/update-nav-only",
      "GET /api/benchmark-returns",
      "GET /api/benchmark-rolling-returns",
      "GET /api/benchmark-rolling-returns-all",
    ],
  });
});

// -------------------- DECRYPT & READ CAS FILE --------------------
async function readCAS(filePath, password) {
  return new Promise((resolve, reject) => {
    let currentY = 0;
    let line = "";
    let output = [];
    let currentPage = 0;

    new PdfReader({ password }).parseFileItems(filePath, (err, item) => {
      if (err) return reject(err);

      if (!item) {
        if (line.trim()) output.push(line.trim());
        return resolve(output.join("\n"));
      }

      if (item.page) {
        currentPage = item.page;
        output.push(`\n=== Page ${currentPage} ===\n`);
        currentY = 0;
        return;
      }

      if (item.text) {
        if (currentY && Math.abs(item.y - currentY) > 0.5) {
          output.push(line.trim());
          line = "";
        }
        currentY = item.y;
        line += item.text + " ";
      }
    });
  });
}

// -------------------- CONCURRENCY HELPER --------------------
async function pLimit(tasks, concurrency) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      try {
        results[i] = await tasks[i]();
      } catch (err) {
        results[i] = null;
        console.error(`Task ${i} failed:`, err.message);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    worker,
  );
  await Promise.all(workers);
  return results;
}

// -------------------- MF DATA FETCH HELPERS --------------------
const _inFlight = new Map();
function dedupFetch(key, fetchFn) {
  if (_inFlight.has(key)) return _inFlight.get(key);
  const promise = fetchFn().finally(() => _inFlight.delete(key));
  _inFlight.set(key, promise);
  return promise;
}

async function getMFDetails(endpoint) {
  return dedupFetch(`mfdetails:${endpoint}`, () => _getMFDetails(endpoint));
}
async function _getMFDetails(endpoint) {
  const url =
    "https://groww.in/v1/api/data/mf/web/v4/scheme/search/" + endpoint;
  try {
    const response = await fetch(url, { redirect: "manual" });

    if (response.status === 308) {
      const location = response.headers.get("location");
      const redirectUrl =
        location ||
        (await response.json().then(
          (body) => {
            const newKey = body?.search_id || body?.new_search_id;
            return newKey
              ? `https://groww.in/v1/api/data/mf/web/v4/scheme/search/${newKey}`
              : null;
          },
          () => null,
        ));

      if (!redirectUrl) {
        console.error(`308 for ${endpoint}: no redirect target found`);
        return null;
      }

      const newKey = redirectUrl.split("/").pop();
      console.log(`🔄 search_key redirected: ${endpoint} → ${newKey}`);
      const redirected = await fetch(redirectUrl);
      if (!redirected.ok) throw new Error(`HTTP error! ${redirected.status}`);
      const data = await redirected.json();
      if (!data.search_id) data.search_id = newKey;
      return data;
    }

    if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error("Error fetching MF details:", err);
    return null;
  }
}

async function getFundStats(schemeCode) {
  return dedupFetch(`fundstats:${schemeCode}`, async () => {
    const url = `https://groww.in/v1/api/data/mf/web/v1/scheme/portfolio/${schemeCode}/stats`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error("Error fetching MF stats:", err);
      return null;
    }
  });
}

async function getSimilarSchemes(category, subCategory, planType, schemeType) {
  const key = `similar:${category}:${subCategory}:${planType}:${schemeType}`;
  return dedupFetch(key, async () => {
    const params = new URLSearchParams({
      category,
      plan_type: planType,
      sub_category: subCategory,
      type: schemeType,
      count: 10,
    });
    const url = `https://groww.in/v1/api/data/mf/web/v1/similar/scheme/top?${params}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error("Error fetching similar schemes:", err);
      return [];
    }
  });
}

async function getFundNAVHistory(schemeCode) {
  return dedupFetch(`navhistory:${schemeCode}`, async () => {
    const url = `https://api.mfapi.in/mf/${schemeCode}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error("Error fetching NAV history:", err);
      return null;
    }
  });
}

async function getFundLatestNAV(schemeCode) {
  return dedupFetch(`navlatest:${schemeCode}`, async () => {
    const url = `https://api.mfapi.in/mf/${schemeCode}/latest`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error("Error fetching latest NAV:", err);
      return null;
    }
  });
}

function _buildFundBase(mfData) {
  return {
    amc: mfData.amc_info.name,
    logo_url: mfData.logo_url,
    launch_date: mfData.launch_date,
    scheme_name: mfData.scheme_name,
    scheme_code: mfData.scheme_code,
    meta_desc: mfData.meta_desc,
    plan_type: mfData.plan_type,
    scheme_type: mfData.scheme_type,
    isin: mfData.isin,
    search_id: mfData.search_id,
    category: mfData.category,
    sub_category: mfData.sub_category,
    second_category: mfData.category_info?.category,
    second_category_sub_type: mfData.category_info?.sub_type,
    category_helper_text: mfData.category_info?.category_helper_text,
    exit_load: mfData.exit_load,
    min_sip: mfData.min_sip_investment,
    min_first_investment: mfData.min_investment_amount,
    min_second_investment: mfData.mini_additional_investment,
    available_for_investment: mfData.available_for_investment,
    min_swp: mfData.swp_details?.swp_minimum_installment_amount,
    min_stp: mfData.stp_details?.stp_in_minimum_installment_amount,
    tax_impact: mfData.category_info?.tax_impact,
    holdings: mfData.holdings || [],
    expense_ratio: mfData.expense_ratio,
    expense_ratio_history: mfData.historic_fund_expense,
    portfolio_turnover: mfData.portfolio_turnover,
    aum: mfData.aum,
    groww_rating: mfData.groww_rating,
    return_stats: mfData.return_stats?.[0] || {},
    sip_return: mfData?.sip_return || {},
    simple_return: mfData?.simple_return || {},
    benchmark: mfData?.benchmark || "",
    rta: mfData.rta_details?.rta_name,
    manager: mfData.fund_manager,
  };
}

// Full fetch: stats + NAV history. Peers are loaded separately via /api/mf-peers.
async function getFundDetails(searchKey) {
  try {
    const mfData = await getMFDetails(searchKey);
    if (!mfData || !mfData.scheme_code) return null;

    const [stats, navHistory] = await Promise.all([
      getFundStats(mfData.scheme_code),
      getFundNAVHistory(mfData.scheme_code),
    ]);

    return {
      ..._buildFundBase(mfData),
      portfolio_stats: stats || {},
      latest_nav: navHistory?.data?.[0]?.nav || 0,
      latest_nav_date: navHistory?.data?.[0]?.date || 0,
      nav_history: navHistory?.data || [],
      meta: navHistory?.meta || {},
      similar_schemes: [],
    };
  } catch (err) {
    console.error("Error fetching fund details:", err);
    return null;
  }
}

// Light fetch for past/redeemed holdings: metadata + optional NAV history. No stats or peers.
async function getFundDetailsLight(searchKey, includeNav = false) {
  try {
    const mfData = await getMFDetails(searchKey);
    if (!mfData || !mfData.scheme_code) return null;

    const navHistory = includeNav
      ? await getFundNAVHistory(mfData.scheme_code)
      : null;

    return {
      ..._buildFundBase(mfData),
      portfolio_stats: {},
      latest_nav: navHistory?.data?.[0]?.nav || null,
      latest_nav_date: navHistory?.data?.[0]?.date || null,
      nav_history: navHistory?.data || [],
      meta: navHistory?.meta || {},
      similar_schemes: [],
      _is_past: true,
    };
  } catch (err) {
    console.error("Error fetching light fund details:", err);
    return null;
  }
}

async function fetchMFStats(
  searchKeys,
  lightSearchKeys = [],
  lightIncludeNav = false,
) {
  try {
    const allFunds = {};
    const CONCURRENCY = 10;

    const activeTasks = searchKeys.map((sk) => () => getFundDetails(sk));
    const lightTasks = lightSearchKeys.map(
      (sk) => () => getFundDetailsLight(sk, lightIncludeNav),
    );

    const [activeResults, lightResults] = await Promise.all([
      pLimit(activeTasks, CONCURRENCY),
      pLimit(lightTasks, CONCURRENCY),
    ]);

    [...activeResults, ...lightResults].forEach((fd) => {
      if (fd && fd.isin) allFunds[fd.isin] = fd;
    });

    return allFunds;
  } catch (err) {
    console.error("Error in fetchMFStats:", err);
    return {};
  }
}

// -------------------- API ENDPOINTS --------------------
app.post("/api/parse-cas", upload.single("file"), async (req, res) => {
  const filePath = req.file.path;
  const password = req.body.password || "";
  try {
    const casExtract = await readCAS(filePath, password);
    const result = parseCAS(casExtract);

    await fs.unlink(filePath).catch(() => {});

    if (
      !result ||
      !Array.isArray(result.folios) ||
      result.folios.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid CAS file or no folios found",
      });
    }

    res.json({
      success: true,
      message: "CAS parsed successfully",
      data: result,
    });
  } catch (err) {
    console.error("CAS parsing error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/mf-stats", async (req, res) => {
  try {
    const {
      searchKeys,
      lightSearchKeys = [],
      lightIncludeNav = false,
    } = req.body;

    if (!searchKeys || !Array.isArray(searchKeys)) {
      return res
        .status(400)
        .json({ success: false, error: "searchKeys array required" });
    }

    const data = await fetchMFStats(
      searchKeys,
      lightSearchKeys,
      lightIncludeNav,
    );

    res.json({
      success: true,
      message: `Fetched stats for ${searchKeys.length} active + ${lightSearchKeys.length} past funds`,
      data,
    });
  } catch (err) {
    console.error("Error fetching MF stats:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/mf-peers", async (req, res) => {
  try {
    const { funds } = req.body;
    // funds: [{ isin, category, sub_category, plan_type, scheme_type }]
    if (!funds || !Array.isArray(funds) || funds.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "funds array required" });
    }

    const includeDetails = req.body.include_details !== false;
    const CONCURRENCY = 5;
    const tasks = funds.map((fund) => async () => {
      const schemes = await getSimilarSchemes(
        fund.category,
        fund.sub_category,
        fund.plan_type,
        fund.scheme_type,
      );
      let peers;
      if (includeDetails) {
        const peerDetails = await Promise.all(
          (schemes || []).map((peer) => getMFDetails(peer.search_id)),
        );
        peers = (schemes || []).map((peer, i) => ({
          ...peer,
          amc: peerDetails[i]?.amc_info?.name || "",
          isin: peerDetails[i]?.isin || "",
          return_stats: peerDetails[i]?.return_stats?.[0] || {},
          expense_ratio_history: peerDetails[i]?.historic_fund_expense || [],
        }));
      } else {
        peers = (schemes || []).map((peer) => ({ ...peer }));
      }
      return { isin: fund.isin, peers };
    });

    const results = await pLimit(tasks, CONCURRENCY);
    const data = {};
    results.forEach((r) => {
      if (r) data[r.isin] = r.peers;
    });

    res.json({
      success: true,
      message: `Fetched peers for ${Object.keys(data).length} funds`,
      data,
    });
  } catch (err) {
    console.error("Error fetching MF peers:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/update-nav-only", async (req, res) => {
  try {
    const { navUpdateData } = req.body;

    if (!navUpdateData || typeof navUpdateData !== "object") {
      return res
        .status(400)
        .json({ success: false, error: "navUpdateData required" });
    }

    const isins = Object.keys(navUpdateData);

    if (isins.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No ISINs provided in navUpdateData" });
    }

    const navUpdates = {};
    let updatedCount = 0;

    const CONCURRENCY = 10;
    const tasks = isins.map((isin) => async () => {
      const { scheme_code, last_nav_date } = navUpdateData[isin];

      if (!scheme_code) {
        console.warn(`No scheme_code for ISIN ${isin}, skipping`);
        return;
      }

      const latest = await getFundLatestNAV(scheme_code);
      if (!latest?.data?.[0]) return;

      const { date, nav } = latest.data[0];

      // Skip if this NAV date is not newer than what the client already has
      if (last_nav_date && date === last_nav_date) return;

      navUpdates[isin] = {
        latest_nav: nav,
        latest_nav_date: date,
        nav_entry: { date, nav },
      };
      updatedCount++;
    });

    await pLimit(tasks, CONCURRENCY);

    res.json({
      success: true,
      message: `Found new NAV for ${updatedCount} out of ${isins.length} funds`,
      data: navUpdates,
    });
  } catch (err) {
    console.error("Error updating NAV:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const toSlug = (name) =>
  name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * GET /api/benchmark-returns
 *
 * Scrapes the AdvisorKhoj benchmark monitor page and returns trailing return
 * stats for all major market indices as a slug-keyed object.
 *
 * @query {string} [names] - Optional comma-separated list of benchmark slugs to filter
 *   (e.g. "nifty-50-tri,bse-sensex"). If omitted, all benchmarks are returned.
 *
 * @returns {object} data - Object keyed by slug. Each entry contains:
 *   name, ret_1w, ret_1m, ret_3m, ret_6m, ret_ytd, ret_1y, ret_3y, ret_5y, ret_10y, ret_since_launch
 *   Numeric fields are floats; "-" values become null.
 */
app.get("/api/benchmark-returns", async (req, res) => {
  try {
    // Accept comma-separated slugs: ?names=nifty-50-tri,bse-sensex
    const requestedNames = req.query.names
      ? req.query.names
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : [];

    const response = await fetch(
      "https://www.advisorkhoj.com/mutual-funds-research/mutual-fund-benchmark-monitor",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      },
    );

    if (!response.ok) {
      return res
        .status(502)
        .json({ success: false, error: `Upstream returned ${response.status}` });
    }

    const html = await response.text();

    const tbodyMatch = html.match(
      /<table[^>]+id="tbl_scheme_returns"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/,
    );
    if (!tbodyMatch) {
      return res
        .status(502)
        .json({ success: false, error: "Could not find benchmark table in response" });
    }

    const stripTags = (s) => s.replace(/<[^>]+>/g, "").trim();

    const COLUMNS = [
      "name",
      "ret_1w",
      "ret_1m",
      "ret_3m",
      "ret_6m",
      "ret_ytd",
      "ret_1y",
      "ret_3y",
      "ret_5y",
      "ret_10y",
      "ret_since_launch",
    ];

    const data = {};
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
      const cells = [];
      cellRe.lastIndex = 0;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
        cells.push(stripTags(cellMatch[1]));
      }
      if (cells.length !== COLUMNS.length) continue;

      const slug = toSlug(cells[0]);
      if (requestedNames.length > 0 && !requestedNames.includes(slug)) continue;

      const entry = {};
      COLUMNS.forEach((col, i) => {
        entry[col] =
          col === "name"
            ? cells[i]
            : cells[i] === "-"
            ? null
            : parseFloat(cells[i]);
      });
      data[slug] = entry;
    }

    const unknownSlugs = requestedNames.filter((s) => !data[s]);

    res.json({
      success: true,
      count: Object.keys(data).length,
      ...(unknownSlugs.length > 0 && { unknown: unknownSlugs }),
      data,
    });
  } catch (err) {
    console.error("Error fetching benchmark returns:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const SCHEME_SLUG_MAP = {
  "nifty-50-tri":                "NIFTY 50 TRI",
  "cnx-nifty":                   "CNX Nifty",
  "nifty-next-50-tri":           "Nifty Next 50 TRI",
  "nifty-100-tri":               "NIFTY 100 TRI",
  "nifty-200-tri":               "NIFTY 200 TRI",
  "nifty-500-tri":               "NIFTY 500 TRI",
  "s-and-p-bse-sensex":          "S&P BSE Sensex",
  "nifty-large-midcap-250-tri":  "NIFTY LARGE MIDCAP 250 TRI",
  "nifty-smallcap-250-tri":      "NIFTY SMALLCAP 250 TRI",
  "nifty-midcap-150-tri":        "NIFTY MIDCAP 150 TRI",
  "nifty-midcap-100-tri":        "NIFTY MIDCAP 100 TRI",
  "domestic-price-of-gold":      "Domestic Price of Gold",
  "domestic-price-of-silver":    "Domestic Price of Silver",
  "nifty-50-arbitrage-index":    "Nifty 50 Arbitrage Index",
};

const ROLLING_VALID_PERIODS = [
  "1 Month", "1 Year", "2 Year", "3 Year",
  "5 Year", "7 Year", "10 Year", "15 Year",
];

const PERIOD_SLUG = {
  "1 Month": "1m",
  "1 Year":  "1yr",
  "2 Year":  "2yr",
  "3 Year":  "3yr",
  "5 Year":  "5yr",
  "7 Year":  "7yr",
  "10 Year": "10yr",
  "15 Year": "15yr",
};

/**
 * Fetches and parses rolling return stats for a single benchmark period from AdvisorKhoj.
 *
 * @param {string} scheme    - Benchmark name as it appears on AdvisorKhoj (e.g. "NIFTY 50 TRI").
 * @param {string} [period]  - Rolling period label (e.g. "3 Year"). Omit to use upstream default.
 * @param {string} [start_date] - Start date string (e.g. "30-06-1999"). Omit to use upstream default.
 * @returns {object|null} Parsed result with scheme, period (slug), start_date, and data stats,
 *   or null if the upstream page returned no matching data.
 */
async function fetchRollingReturnsForPeriod(scheme, period, start_date) {
  const params = new URLSearchParams({ scheme });
  if (period) params.set("period", period);
  if (start_date) params.set("start_date", start_date);
  const url = `https://www.advisorkhoj.com/mutual-funds-research/benchmark-rolling-return?${params}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) return null;

  const html = await response.text();

  const tbodyMatch = html.match(
    /<table[^>]+id="tbl_scheme_returns"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/,
  );
  if (!tbodyMatch) return null;

  const stripTags = (s) => s.replace(/<[^>]+>/g, "").trim();
  const COLUMNS = [
    "name",
    "average", "median", "maximum", "minimum", "std_deviation",
    "pct_negative", "pct_0_8", "pct_8_12", "pct_12_15", "pct_15_20", "pct_gt_20",
  ];

  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let rowMatch;
  let parsed = null;

  while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
    const cells = [];
    cellRe.lastIndex = 0;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.length !== COLUMNS.length) continue;

    const entry = {};
    COLUMNS.forEach((col, i) => {
      entry[col] =
        col === "name" ? cells[i] : cells[i] === "-" ? null : parseFloat(cells[i]);
    });
    parsed = entry;
    break;
  }

  if (!parsed) return null;

  const periodMatch = html.match(/<option[^>]+value="([^"]+)"[^>]*selected[^>]*>/i);
  const startDateMatch = html.match(/id="txt_start_date"[^>]+value="([^"]+)"/);

  const resolvedPeriod = periodMatch ? periodMatch[1] : (period || null);
  return {
    scheme: parsed.name,
    period: resolvedPeriod ? (PERIOD_SLUG[resolvedPeriod] ?? resolvedPeriod) : null,
    start_date: startDateMatch ? startDateMatch[1] : (start_date || null),
    data: {
      average: parsed.average,
      median: parsed.median,
      maximum: parsed.maximum,
      minimum: parsed.minimum,
      std_deviation: parsed.std_deviation,
      distribution: {
        pct_negative: parsed.pct_negative,
        pct_0_8: parsed.pct_0_8,
        pct_8_12: parsed.pct_8_12,
        pct_12_15: parsed.pct_12_15,
        pct_15_20: parsed.pct_15_20,
        pct_gt_20: parsed.pct_gt_20,
      },
    },
  };
}

/**
 * GET /api/benchmark-rolling-returns
 *
 * Returns rolling return distribution stats for one or more benchmarks for a given period.
 * The resolved period and start_date in the response are always extracted from
 * the upstream HTML, not echoed from caller input.
 *
 * @query {string} [names]     - Comma-separated benchmark slugs (e.g. "nifty-50-tri,cnx-nifty").
 *   Takes precedence over `scheme`. Valid slugs are keys of SCHEME_SLUG_MAP.
 * @query {string} [scheme]    - Single benchmark name (e.g. "NIFTY 50 TRI"). Kept for backward compat.
 * @query {string} [period]    - Rolling period. Valid: "1 Month" | "1 Year" | "2 Year" |
 *   "3 Year" | "5 Year" | "7 Year" | "10 Year" | "15 Year". Omit for upstream default.
 * @query {string} [start_date] - Analysis start date (DD-MM-YYYY). Omit for upstream default.
 *
 * @returns When multiple names: object keyed by slug, each with scheme, period, start_date, data.
 *   When single scheme: flat response with scheme, period (slug), start_date, data.
 */
app.get("/api/benchmark-rolling-returns", async (req, res) => {
  const { scheme, period, start_date } = req.query;

  const slugs = req.query.names
    ? req.query.names.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];

  const invalidSlugs = slugs.filter((s) => !SCHEME_SLUG_MAP[s]);
  const validSlugs = slugs.filter((s) => SCHEME_SLUG_MAP[s]);

  if (validSlugs.length === 0 && !scheme) {
    return res
      .status(400)
      .json({ success: false, error: "names or scheme query param is required" });
  }

  if (period && !ROLLING_VALID_PERIODS.includes(period)) {
    return res.status(400).json({
      success: false,
      error: `Invalid period. Valid values: ${ROLLING_VALID_PERIODS.join(", ")}`,
    });
  }

  try {
    if (slugs.length > 0) {
      const results = await Promise.all(
        validSlugs.map((slug) =>
          fetchRollingReturnsForPeriod(SCHEME_SLUG_MAP[slug], period, start_date).catch(() => null),
        ),
      );
      const data = {};
      validSlugs.forEach((slug, i) => { data[slug] = results[i] || null; });
      return res.json({
        success: true,
        count: validSlugs.length,
        ...(invalidSlugs.length > 0 && { unknown: invalidSlugs }),
        data,
      });
    }

    const result = await fetchRollingReturnsForPeriod(scheme, period, start_date);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: "No data found — check scheme name, period, and start_date",
      });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("Error fetching benchmark rolling returns:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/benchmark-rolling-returns-all
 *
 * Concurrently fetches rolling return stats for all 8 periods for one or more benchmarks,
 * returning results aggregated in a single response.
 * Periods with insufficient history or no data are returned as null rather than
 * failing the entire request.
 *
 * @query {string} [names]      - Comma-separated benchmark slugs (e.g. "nifty-50-tri,cnx-nifty").
 *   Takes precedence over `scheme`. Valid slugs are keys of SCHEME_SLUG_MAP.
 * @query {string} [scheme]     - Single benchmark name (e.g. "NIFTY 50 TRI"). Kept for backward compat.
 * @query {string} [start_date] - Analysis start date (DD-MM-YYYY). Omit for upstream default.
 *
 * @returns When multiple names: object keyed by slug, each containing period-keyed data.
 *   When single scheme: flat response with scheme name and period-keyed data.
 *   Period keys: "1m" | "1yr" | "2yr" | "3yr" | "5yr" | "7yr" | "10yr" | "15yr"
 */
app.get("/api/benchmark-rolling-returns-all", async (req, res) => {
  const { scheme, start_date } = req.query;

  const slugs = req.query.names
    ? req.query.names.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];

  const invalidSlugs = slugs.filter((s) => !SCHEME_SLUG_MAP[s]);
  const validSlugs = slugs.filter((s) => SCHEME_SLUG_MAP[s]);

  if (validSlugs.length === 0 && !scheme) {
    return res
      .status(400)
      .json({ success: false, error: "names or scheme query param is required" });
  }

  const schemesToFetch = validSlugs.length > 0
    ? validSlugs.map((slug) => ({ slug, name: SCHEME_SLUG_MAP[slug] }))
    : [{ slug: null, name: scheme }];

  try {
    const schemeResults = await Promise.all(
      schemesToFetch.map(({ name }) =>
        Promise.all(
          ROLLING_VALID_PERIODS.map((p) =>
            fetchRollingReturnsForPeriod(name, p, start_date).catch(() => null),
          ),
        ),
      ),
    );

    const buildPeriodData = (results) => {
      const data = {};
      for (let i = 0; i < ROLLING_VALID_PERIODS.length; i++) {
        const key = PERIOD_SLUG[ROLLING_VALID_PERIODS[i]];
        const result = results[i];
        data[key] = result
          ? { start_date: result.start_date, ...result.data }
          : null;
      }
      return data;
    };

    if (slugs.length > 0) {
      const data = {};
      validSlugs.forEach((slug, i) => {
        data[slug] = {
          scheme: schemesToFetch[i].name,
          data: buildPeriodData(schemeResults[i]),
        };
      });
      return res.json({
        success: true,
        count: validSlugs.length,
        ...(invalidSlugs.length > 0 && { unknown: invalidSlugs }),
        data,
      });
    }

    const results = schemeResults[0];
    const schemeName = results.find(Boolean)?.scheme || scheme;
    res.json({ success: true, scheme: schemeName, data: buildPeriodData(results) });
  } catch (err) {
    console.error("Error fetching all rolling returns:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/health", (req, res) =>
  res.json({
    status: "ok",
    message: "MF Dashboard Backend API is up & running...",
  }),
);

// -------------------- START SERVER --------------------
app.listen(PORT, () =>
  console.log(`🚀 Backend server running on port ${PORT}`),
);
