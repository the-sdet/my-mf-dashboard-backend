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

app.use("/api", limiter);

app.use(
  cors({
    origin: "https://mf-dashboard.github.io",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

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

// -------------------- MF DATA FETCH HELPERS --------------------
async function getMFDetails(endpoint) {
  const url =
    "https://groww.in/v1/api/data/mf/web/v4/scheme/search/" + endpoint;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! ${response.status}`);
    return await response.json();
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

    const stats = await getFundStats(mfData.scheme_code);
    const navHistory = await getFundNAVHistory(mfData.scheme_code);

    return {
      amc: mfData.amc_info.name,
      scheme_name: mfData.scheme_name,
      scheme_code: mfData.scheme_code,
      plan_type: mfData.plan_type,
      scheme_type: mfData.scheme_type,
      isin: mfData.isin,
      category: mfData.category,
      sub_category: mfData.sub_category,
      second_category: mfData.category_info?.category,
      holdings: mfData.holdings || [],
      expense_ratio: mfData.expense_ratio,
      aum: mfData.aum,
      groww_rating: mfData.groww_rating,
      return_stats: mfData.return_stats?.[0] || {},
      sip_return: mfData?.sip_return || {},
      portfolio_stats: stats || {},
      latest_nav: navHistory?.data?.[0]?.nav || 0,
      latest_nav_date: navHistory?.data?.[0]?.date || 0,
      nav_history: navHistory?.data || [],
      meta: navHistory?.meta || {},
      benchmark: mfData?.benchmark || "",
    };
  } catch (err) {
    console.error("Error fetching fund details:", err);
    return null;
  }
}

async function fetchMFStats(searchKeys) {
  try {
    const allFunds = {};

    for (const searchKey of searchKeys) {
      const fundDetails = await getFundDetails(searchKey);
      if (fundDetails && fundDetails.isin) {
        allFunds[fundDetails.isin] = fundDetails;
      }
    }

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

    for (const isin of isins) {
      const { scheme_code, last_nav_date } = navUpdateData[isin];

      if (!scheme_code) {
        console.warn(`No scheme_code for ISIN ${isin}, skipping`);
        continue;
      }

      try {
        const navHistory = await getFundNAVHistory(scheme_code);

        if (navHistory && navHistory.data && navHistory.data.length > 0) {
          let navEntries = navHistory.data;
          let isFullHistory = false;

          if (!last_nav_date) {
            isFullHistory = true;
          } else {
            const lastDate = new Date(last_nav_date);
            navEntries = navHistory.data.filter((entry) => {
              const entryDate = new Date(entry.date);
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
      } catch (err) {
        console.error(`Error updating NAV for ${isin}:`, err);
      }
    }

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
  })
);

// -------------------- START SERVER --------------------
app.listen(PORT, () =>
  console.log(`🚀 Backend server running on port ${PORT}`)
);
