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
async function getMFDetails(endpoint) {
  const url =
    "https://groww.in/v1/api/data/mf/web/v4/scheme/search/" + endpoint;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
    const data = await response.json();

    // If the returned search_id differs, the fund's search_id has changed —
    // re-fetch using the updated search_id to get the canonical response.
    if (data?.search_id && data.search_id !== endpoint) {
      console.log(
        `🔄 search_id changed: ${endpoint} → ${data.search_id}. Re-fetching...`,
      );
      const updatedUrl =
        "https://groww.in/v1/api/data/mf/web/v4/scheme/search/" +
        data.search_id;
      const updatedResponse = await fetch(updatedUrl);
      if (!updatedResponse.ok)
        throw new Error(`HTTP error! ${updatedResponse.status}`);
      return await updatedResponse.json();
    }

    return data;
  } catch (err) {
    console.error("Error fetching MF details:", err);
    return null;
  }
}

async function getFundStats(schemeCode) {
  const url = `https://groww.in/v1/api/data/mf/web/v1/scheme/portfolio/${schemeCode}/stats`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error("Error fetching MF stats:", err);
    return null;
  }
}

async function getFundNAVHistory(schemeCode) {
  const url = `https://api.mfapi.in/mf/${schemeCode}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
    const data = await response.json();
    return data;
  } catch (err) {
    console.error("Error fetching NAV history:", err);
    return null;
  }
}

async function getFundDetails(searchKey) {
  try {
    const mfData = await getMFDetails(searchKey);
    if (!mfData || !mfData.scheme_code) return null;

    // Run stats + NAV history concurrently — both only need scheme_code
    const [stats, navHistory] = await Promise.all([
      getFundStats(mfData.scheme_code),
      getFundNAVHistory(mfData.scheme_code),
    ]);

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
      mini_sip: mfData.min_sip_investment,
      mini_first_investment: mfData.min_investment_amount,
      mini_second_investment: mfData.mini_additional_investment,
      available_for_investment: mfData.available_for_investment,
      mini_swp: mfData.swp_details?.swp_minimum_installment_amount,
      tax_impact: mfData.category_info?.tax_impact,
      holdings: mfData.holdings || [],
      expense_ratio: mfData.expense_ratio,
      portfolio_turnover: mfData.portfolio_turnover,
      aum: mfData.aum,
      groww_rating: mfData.groww_rating,
      return_stats: mfData.return_stats?.[0] || {},
      sip_return: mfData?.sip_return || {},
      simple_return: mfData?.simple_return || {},
      portfolio_stats: stats || {},
      latest_nav: navHistory?.data?.[0]?.nav || 0,
      latest_nav_date: navHistory?.data?.[0]?.date || 0,
      nav_history: navHistory?.data || [],
      meta: navHistory?.meta || {},
      benchmark: mfData?.benchmark || "",
      rta: mfData.rta_details?.rta_name,
      manager: mfData.fund_manager,
    };
  } catch (err) {
    console.error("Error fetching fund details:", err);
    return null;
  }
}

async function fetchMFStats(searchKeys) {
  try {
    const allFunds = {};
    const CONCURRENCY = 10;

    const tasks = searchKeys.map(
      (searchKey) => () => getFundDetails(searchKey),
    );
    const results = await pLimit(tasks, CONCURRENCY);

    results.forEach((fundDetails) => {
      if (fundDetails && fundDetails.isin) {
        allFunds[fundDetails.isin] = fundDetails;
      }
    });

    return allFunds;
  } catch (err) {
    console.error("Error in fetchMFStats:", err);
    return {};
  }
}

// Core-only fetch: just Groww search + mfapi NAV history (no portfolio stats)
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
    const { searchKeys } = req.body;

    if (!searchKeys || typeof searchKeys !== "object") {
      return res
        .status(400)
        .json({ success: false, error: "searchKeys required" });
    }

    const data = await fetchMFStats(searchKeys);

    res.json({
      success: true,
      message: `Fetched stats for ${searchKeys.length} ISINs`,
      data,
    });
  } catch (err) {
    console.error("Error fetching MF stats:", err);
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

      const navHistory = await getFundNAVHistory(scheme_code);

      if (navHistory && navHistory.data && navHistory.data.length > 0) {
        let navEntries = navHistory.data;
        let isFullHistory = false;

        if (!last_nav_date) {
          isFullHistory = true;
        } else {
          const [day, month, year] = last_nav_date.split("-");
          const lastDate = new Date(`${year}-${month}-${day}`);

          navEntries = navHistory.data.filter((entry) => {
            const [entryDay, entryMonth, entryYear] = entry.date.split("-");
            const entryDate = new Date(
              `${entryYear}-${entryMonth}-${entryDay}`,
            );
            return entryDate > lastDate;
          });
        }

        const latestNav = navHistory.data[0]?.nav;
        const latestNavDate = navHistory.data[0]?.date;

        if (navEntries.length > 0 || isFullHistory) {
          navUpdates[isin] = {
            latest_nav: latestNav,
            latest_nav_date: latestNavDate,
            nav_entries: navEntries,
            is_full_history: isFullHistory,
            meta: navHistory.meta,
          };
          updatedCount++;
        }
      }
    });

    await pLimit(tasks, CONCURRENCY);

    res.json({
      success: true,
      message: `Found NAV data for ${updatedCount} out of ${isins.length} funds`,
      data: navUpdates,
    });
  } catch (err) {
    console.error("Error updating NAV history:", err);
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
