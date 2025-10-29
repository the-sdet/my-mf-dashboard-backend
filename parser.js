/**
 * @file parser.js
 * @description A line by line Express CAS Parser to parse Mutual Fund CAS statements (both Detailed and Summary).
 * @author Pabitra Swain - https://github.com/the-sdet
 * @license MIT
 */
export function parseCAS(text) {
  // Input validation
  if (!text || typeof text !== "string") {
    throw new Error("Invalid input: text must be a non-empty string");
  }

  // Detect CAS type
  const casType = detectCASType(text);

  if (casType === "SUMMARY") {
    return parseSummaryCAS(text);
  } else {
    return parseDetailedCAS(text);
  }
}

function detectCASType(text) {
  // Check for "Consolidated Account Summary" vs "Consolidated Account Statement"
  if (text.includes("Consolidated Account Summary")) {
    return "SUMMARY";
  } else if (text.includes("Consolidated Account Statement")) {
    return "DETAILED";
  }
  // Default to detailed if can't determine
  return "DETAILED";
}

function parseSummaryCAS(text) {
  const result = {
    statement_period: { from: null, to: null },
    file_type: "CAMS",
    cas_type: "SUMMARY",
    investor_info: {
      email: null,
      name: null,
      mobile: null,
      address: null,
    },
    current_value: 0,
    cost: 0,
    folios: [],
  };

  // Extract statement date (only single date for summary)
  const dateMatch = text.match(/As on (\d{2}-[A-Z][a-z]{2}-\d{4})/);
  if (dateMatch) {
    const date = convertDate(dateMatch[1]);
    result.statement_period.to = date;
  }

  // Extract investor info
  const emailMatch = text.match(/Email Id:\s*([^\n]+)/);
  if (emailMatch) result.investor_info.email = emailMatch[1].trim();

  const mobileMatch = text.match(/Mobile:\s*(\+?\d+)/);
  if (mobileMatch) result.investor_info.mobile = mobileMatch[1];

  // Name and address
  const nameAddrMatch = text.match(/Email Id:[^\n]*\n([\s\S]+?)Mobile:/);
  if (nameAddrMatch) {
    const lines = nameAddrMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);
    result.investor_info.name = lines[0] || "";
    result.investor_info.address = lines.slice(1).join(", ");
  }

  const lines = text.split(/\r?\n/);

  // --- Identify start & end ---
  const startIndex = lines.findIndex((l) =>
    l.includes("Market Value Folio No.")
  );
  const endIndex = lines.findIndex((l) => l.startsWith("Total "));

  if (startIndex === -1 || endIndex === -1) {
    throw new Error("Could not find summary section boundaries");
  }

  const section = lines
    .slice(startIndex + 1, endIndex)
    .map((l) => l.trim())
    .filter(Boolean);
  const totalLine = lines[endIndex];
  const totalMatch = totalLine.match(/^Total\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/);

  result.current_value = parseFloat((totalMatch?.[1] ?? 0).replace(/,/g, ""));
  result.cost = parseFloat((totalMatch?.[2] ?? 0).replace(/,/g, ""));
  // Parse summary holdings
  result.folios = parseSummaryHoldings(section);

  return result;
}

function parseSummaryHoldings(section) {
  const folios = [];
  for (let i = 0; i < section.length - 1; i++) {
    const line1 = section[i];
    const line2 = section[i + 1];

    //Folio line must start with a number (folio no.)
    if (!/^\d/.test(line1)) continue;

    //First line pattern (flexible spacing and optional "-" blocks)
    const line1Match = line1.match(
      /^(\S+)\s+([\d,]+\.\d+)\s+([A-Z0-9\s]+?)\s+-\s+(.+)$/
    );
    if (!line1Match) continue;

    const [, folio, current_value, rta_code, scheme] = line1Match;

    //Next line: units, nav-date, nav, rta, isin, cost
    const line2Match = line2.match(
      /^([\d,]+\.\d+)\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+([\d,.]+)\s+(\S+)\s+(\S+)\s+([\d,]+\.\d+)$/
    );
    if (!line2Match) continue;

    const [, units, nav_date, nav, rta, isin, cost] = line2Match;

    folios.push({
      folio,
      current_value: parseFloat(current_value.replace(/,/g, "")),
      cost: parseFloat(cost.replace(/,/g, "")),
      rta_code: rta_code.trim().replace(/\s+/g, ""),
      scheme: scheme.trim(),
      units: parseFloat(units.replace(/,/g, "")),
      nav_date,
      nav: parseFloat(nav.replace(/,/g, "")),
      rta,
      isin,

      amc: determineAMCFromSchemeName(scheme),
    });

    i++; // Skip the 2nd line since we’ve already consumed it
  }

  return folios;
}

function determineAMCFromSchemeName(schemeName) {
  const AMCs = [
    "360 ONE Mutual Fund",
    "Aditya Birla Sun Life Mutual Fund",
    "Axis Mutual Fund",
    "Bajaj Finserv Mutual Fund",
    "Bandhan Mutual Fund",
    "Bank of India Mutual Fund",
    "Baroda BNP Paribas Mutual Fund",
    "Canara Robeco Mutual Fund",
    "Capitalmind Mutual Fund",
    "Choice Mutual Fund",
    "CRB Mutual Fund",
    "DSP Mutual Fund",
    "Edelweiss Mutual Fund",
    "Franklin Templeton Mutual Fund",
    "Groww Mutual Fund",
    "Helios Mutual Fund",
    "HDFC Mutual Fund",
    "HSBC Mutual Fund",
    "ICICI Prudential Mutual Fund",
    "IDBI Mutual Fund",
    "Invesco Mutual Fund",
    "ITI Mutual Fund",
    "JM Financial Mutual Fund",
    "JioBlackRock Mutual Fund",
    "JPMorgan Mutual Fund",
    "Kotak Mahindra Mutual Fund",
    "L&T Mutual Fund",
    "LIC Mutual Fund",
    "Mahindra Manulife Mutual Fund",
    "Mirae Asset Mutual Fund",
    "Motilal Oswal Mutual Fund",
    "Navi Mutual Fund",
    "Nippon India Mutual Fund",
    "Old Bridge Mutual Fund",
    "PGIM India Mutual Fund",
    "PineBridge Mutual Fund",
    "PPFAS Mutual Fund",
    "Principal Mutual Fund",
    "Quant MF",
    "Quantum Mutual Fund",
    "Samco Mutual Fund",
    "SBI Mutual Fund",
    "Shriram Mutual Fund",
    "Sundaram Mutual Fund",
    "Tata Mutual Fund",
    "Taurus Mutual Fund",
    "TRUST Mutual Fund",
    "Union Mutual Fund",
    "UTI Mutual Fund",
    "WhiteOak Capital Mutual Fund",
    "Zerodha Mutual Fund",
    "Angel One Mutual Fund",
  ];

  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const firstWord = normalize(schemeName).split(" ")[0];

  const similarity = (a, b) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) =>
      Array(b.length + 1).fill(0)
    );
    for (let i = 0; i <= a.length; i++) m[i][0] = i;
    for (let j = 0; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        m[i][j] = Math.min(
          m[i - 1][j] + 1,
          m[i][j - 1] + 1,
          m[i - 1][j - 1] + cost
        );
      }
    }
    const dist = m[a.length][b.length];
    return 1 - dist / Math.max(a.length, b.length);
  };

  let bestAMC = "Unknown AMC";
  let bestScore = 0;

  for (const amc of AMCs) {
    const amcFirst = normalize(amc).split(" ")[0];
    const score = similarity(firstWord, amcFirst);
    if (score > bestScore) {
      bestScore = score;
      bestAMC = amc;
    }
  }

  return bestScore > 0.6 ? bestAMC : "Unknown AMC";
}

function parseDetailedCAS(text) {
  const result = {
    statement_period: { from: null, to: null },
    file_type: "CAMS",
    cas_type: "DETAILED",
    investor_info: {
      email: null,
      name: null,
      mobile: null,
      address: null,
    },
    folios: [],
  };

  // Extract statement period
  const periodMatch = text.match(
    /(\d{2}-[A-Z][a-z]{2}-\d{4})\s+To\s+(\d{2}-[A-Z][a-z]{2}-\d{4})/
  );
  if (periodMatch) {
    result.statement_period.from = convertDate(periodMatch[1]);
    result.statement_period.to = convertDate(periodMatch[2]);
  }

  // Extract investor info
  const emailMatch = text.match(/Email Id:\s*([^\n]+)/);
  if (emailMatch) result.investor_info.email = emailMatch[1].trim();

  const mobileMatch = text.match(/Mobile:\s*(\+?\d+)/);
  if (mobileMatch) result.investor_info.mobile = mobileMatch[1];

  // Name and address
  const nameAddrMatch = text.match(/Email Id:[^\n]*\n([\s\S]+?)Mobile:/);
  if (nameAddrMatch) {
    const lines = nameAddrMatch[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l);
    result.investor_info.name = lines[0] || "";
    result.investor_info.address = lines.slice(1).join(", ");
  }

  // Parse folios line by line
  result.folios = parseLineByLine(text);

  return result;
}

function parseLineByLine(text) {
  const lines = text.split("\n");
  const folios = [];

  let currentAMC = null;
  let currentScheme = null;
  let currentFolio = null;
  let collectingTransactions = false;
  let expectingFolio = false;
  let expectingName = false;
  let expectingNominee = false;

  // Optimize AMC lookup with lowercase mapping
  const AMCs = [
    "360 ONE Mutual Fund",
    "Aditya Birla Sun Life Mutual Fund",
    "Axis Mutual Fund",
    "Bajaj Finserv Mutual Fund",
    "Bandhan Mutual Fund",
    "Bank of India Mutual Fund",
    "Baroda BNP Paribas Mutual Fund",
    "Canara Robeco Mutual Fund",
    "Capitalmind Mutual Fund",
    "Choice Mutual Fund",
    "CRB Mutual Fund",
    "DSP Mutual Fund",
    "Edelweiss Mutual Fund",
    "Franklin Templeton Mutual Fund",
    "Groww Mutual Fund",
    "Helios Mutual Fund",
    "HDFC Mutual Fund",
    "HSBC Mutual Fund",
    "ICICI Prudential Mutual Fund",
    "IDBI Mutual Fund",
    "Invesco Mutual Fund",
    "ITI Mutual Fund",
    "JM Financial Mutual Fund",
    "JioBlackRock Mutual Fund",
    "JPMorgan Mutual Fund",
    "Kotak Mahindra Mutual Fund",
    "L&T Mutual Fund",
    "LIC Mutual Fund",
    "Mahindra Manulife Mutual Fund",
    "Mirae Asset Mutual Fund",
    "Motilal Oswal Mutual Fund",
    "Navi Mutual Fund",
    "Nippon India Mutual Fund",
    "Old Bridge Mutual Fund",
    "PGIM India Mutual Fund",
    "PineBridge Mutual Fund",
    "PPFAS Mutual Fund",
    "Principal Mutual Fund",
    "Quant MF",
    "Quantum Mutual Fund",
    "Samco Mutual Fund",
    "SBI Mutual Fund",
    "Shriram Mutual Fund",
    "Sundaram Mutual Fund",
    "Tata Mutual Fund",
    "Taurus Mutual Fund",
    "TRUST Mutual Fund",
    "Union Mutual Fund",
    "UTI Mutual Fund",
    "WhiteOak Capital Mutual Fund",
    "Zerodha Mutual Fund",
    "Angel One Mutual Fund",
  ];

  // Create lowercase map for faster AMC lookup
  const amcLowerMap = new Map();
  AMCs.forEach((amc) => amcLowerMap.set(amc.toLowerCase(), amc));

  // Cache compiled regex patterns
  const PATTERNS = {
    date: /^\d{2}-[A-Z][a-z]{2}-\d{4}$/,
    pan: /PAN:\s*([A-Z]{5}\d{4}[A-Z])/,
    kyc: /KYC:\s*(OK|NOT\s*OK)(?!\d)/,
    pankyc: /PAN:\s*(OK|NOT\s*OK)(?!\s*[A-Z]{5})/,
    panLine: /PAN:\s*[A-Z0-9]+/,
    openingBalance: /Opening Unit Balance:\s*([\d.]+)/,
    closingBalance: /Closing Unit Balance:\s*([\d,]+(?:\.\d+)?)/,
    costValue: /Total Cost Value:\s*([\d,]+(?:\.\d+)?)/,
    nav: /NAV on (\d{2}-[A-Z][a-z]{2}-\d{4}):\s*INR\s*([\d.]+)/,
    marketValue: /Market Value on \d{2}-[A-Z][a-z]{2}-\d{4}:\s*INR\s*([\d,.]+)/,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const lineLower = line.toLowerCase();

    // Optimize AMC matching with lowercase map
    let foundAMC = null;
    for (const [amcLower, amcOriginal] of amcLowerMap) {
      if (lineLower.startsWith(amcLower)) {
        foundAMC = amcOriginal;
        break;
      }
    }

    if (foundAMC) {
      currentAMC = foundAMC;
      continue;
    }

    // Check for PAN/KYC line - indicates new scheme
    // Only check if line contains "PAN:" for efficiency
    if (line.includes("PAN:") && PATTERNS.panLine.test(line)) {
      // This is a new scheme starting

      // Extract PAN/KYC info
      const panMatch = line.match(PATTERNS.pan);
      const pan = panMatch ? panMatch[1] : null;

      const kycMatch = line.match(PATTERNS.kyc);
      const kyc = kycMatch ? kycMatch[1].replace(/\s+/g, " ") : null;

      const pankycMatch = line.match(PATTERNS.pankyc);
      const pankyc = pankycMatch ? pankycMatch[1].replace(/\s+/g, " ") : null;

      // Next line(s) should be scheme info - may span multiple lines
      // This handles cases where ISIN code wraps to the next line
      i++;
      let schemeLine = lines[i].trim();

      // Try to parse, if it fails (incomplete ISIN), keep appending next lines
      let schemeInfo = parseSchemeInfo(schemeLine);
      let nextLineIndex = i + 1;

      while (!schemeInfo && nextLineIndex < lines.length) {
        const nextLine = lines[nextLineIndex].trim();
        // Stop if we hit a "Folio No:" line or another PAN line or empty line
        if (
          !nextLine ||
          nextLine.startsWith("Folio No:") ||
          PATTERNS.panLine.test(nextLine)
        ) {
          break;
        }
        schemeLine += " " + nextLine;
        schemeInfo = parseSchemeInfo(schemeLine);
        i = nextLineIndex;
        nextLineIndex++;
      }

      if (schemeInfo) {
        currentScheme = {
          scheme: schemeInfo.name,
          isin: schemeInfo.isin,
          amfi: null,
          advisor: schemeInfo.advisor,
          rta_code: schemeInfo.rtaCode,
          rta: schemeInfo.rta,
          nominees: [],
          open: 0,
          close: 0,
          close_calculated: 0,
          valuation: { date: null, nav: 0, value: 0, cost: 0 },
          transactions: [],
        };

        // Store PAN/KYC for when we create folio
        currentScheme._tempPAN = pan;
        currentScheme._tempKYC = kyc;
        currentScheme._tempPANKYC = pankyc;

        expectingFolio = true;
        collectingTransactions = false;
      }
      continue;
    }

    // Check for Folio No
    if (expectingFolio && line.startsWith("Folio No:")) {
      const folioNumber = line.substring(9).trim();

      // Check if this folio already exists for this AMC
      currentFolio = folios.find(
        (f) => f.folio === folioNumber && f.amc === currentAMC
      );

      if (!currentFolio) {
        // Create new folio
        currentFolio = {
          folio: folioNumber,
          amc: currentAMC,
          PAN: currentScheme._tempPAN,
          KYC: currentScheme._tempKYC,
          PANKYC: currentScheme._tempPANKYC,
          schemes: [],
        };
        folios.push(currentFolio);
      }

      expectingFolio = false;
      expectingName = true;
      continue;
    }

    // Check for holder name
    if (
      expectingName &&
      line &&
      /^[A-Z]/.test(line) &&
      line.length > 2 &&
      line.length < 100
    ) {
      // This is the holder name, we can skip it
      expectingName = false;
      expectingNominee = true;
      continue;
    }

    // Check for Nominee line
    if (expectingNominee && line.includes("Nominee")) {
      const pattern =
        /Nominee\s+(\d+):\s*([A-Za-z][A-Za-z\s.]*?)(?=\s+Nominee\s+\d+:|\s*$)/g;

      let match;
      const nominees = [];

      while ((match = pattern.exec(line)) !== null) {
        const name = match[2].trim();
        if (name) nominees.push(name);
      }

      currentScheme.nominees = nominees;

      expectingNominee = false;
      continue;
    }

    // Check for Opening Unit Balance
    if (currentScheme && line.includes("Opening Unit Balance:")) {
      const match = line.match(PATTERNS.openingBalance);
      if (match) {
        currentScheme.open = parseFloat(match[1]);
        collectingTransactions = true;
      }
      continue;
    }

    // Check for Closing Unit Balance
    if (currentScheme && line.includes("Closing Unit Balance:")) {
      const match = line.match(PATTERNS.closingBalance);
      if (match) {
        currentScheme.close = parseFloat(match[1].replace(/,/g, ""));
        currentScheme.close_calculated = parseFloat(match[1].replace(/,/g, ""));
      }

      const costMatch = line.match(PATTERNS.costValue);
      if (costMatch) {
        currentScheme.valuation.cost = parseFloat(
          costMatch[1].replace(/,/g, "")
        );
      }

      // Save scheme to current folio
      if (currentFolio) {
        // Clean up temp fields
        delete currentScheme._tempPAN;
        delete currentScheme._tempKYC;
        delete currentScheme._tempPANKYC;

        currentFolio.schemes.push(currentScheme);
      }

      collectingTransactions = false;
      currentScheme = null;
      currentFolio = null;
      continue;
    }

    // Check for NAV line
    if (currentScheme && line.includes("NAV on")) {
      const navMatch = line.match(PATTERNS.nav);
      if (navMatch) {
        currentScheme.valuation.date = convertDate(navMatch[1]);
        currentScheme.valuation.nav = parseFloat(navMatch[2]);
      }

      const valueMatch = line.match(PATTERNS.marketValue);
      if (valueMatch) {
        currentScheme.valuation.value = parseFloat(
          valueMatch[1].replace(/,/g, "")
        );
      }
      continue;
    }

    // Collect transactions
    // Optimize with early character checks before regex
    if (
      collectingTransactions &&
      currentScheme &&
      line.length >= 11 &&
      line[2] === "-" &&
      line[6] === "-"
    ) {
      if (PATTERNS.date.test(line.substring(0, 11))) {
        const tx = parseTransactionLine(line);
        if (tx) {
          currentScheme.transactions.push(tx);
        }
      }
    }
  }

  return folios;
}

function parseSchemeInfo(line) {
  // Format: RTA_CODE - Scheme Name - ISIN : CODE (Advisor : CODE) Registrar : CODE

  const isinMatch = line.match(
    /ISIN\s*:\s*([A-Z0-9\s]+?)(?=\s*\(|\s+Advisor|Registrar|$)/
  );
  if (!isinMatch) return null;

  const isin = isinMatch[1].trim().replace(/\s+/g, "");

  // ISIN must be exactly 12 characters, if not, it's incomplete (split across lines)
  if (isin.length !== 12) return null;

  const advisorMatch = line.match(
    /Advisor\s*:?\s*((?:INZ|INA|CAT)[A-Za-z0-9\s]*|DIRECT)/i
  );
  const advisor = advisorMatch ? advisorMatch[1].replace(/\s+/g, "") : null;

  const rtaMatch = line.match(/Registrar\s*:\s*([A-Z]+)/);
  const rta = rtaMatch ? rtaMatch[1] : null;

  // Extract RTA code and scheme name
  const beforeISIN = line.substring(0, isinMatch.index);
  const parts = beforeISIN.split("-");

  if (parts.length < 2) return null;

  const rtaCode = parts[0].trim().replace(/\s+/g, "");
  let schemeName = parts.slice(1).join("-").trim();

  // Clean scheme name
  schemeName = schemeName
    .replace(/\s*\(\s*(?:Non\s*-\s*)?Demat\s*\)\s*/gi, "")
    .trim();
  schemeName = schemeName
    .replace(/\s*-\s*$/, "")
    .replace(/\s*\(.*?formerly.*?\)/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    rtaCode: rtaCode,
    name: schemeName,
    isin: isin,
    advisor: advisor,
    rta: rta,
  };
}

function parseTransactionLine(line) {
  // Handle stamp duty
  if (line.includes("*** Stamp Duty ***")) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && /^\d{2}-[A-Z][a-z]{2}-\d{4}$/.test(parts[0])) {
      return {
        date: convertDate(parts[0]),
        description: "Stamp Duty",
        amount: parseFloat(parts[1]),
        units: 0,
        nav: 0,
        balance: 0,
        type: "STAMP_DUTY_TAX",
      };
    }
  }

  // Handle STT
  if (line.includes("*** STT Paid ***")) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2 && /^\d{2}-[A-Z][a-z]{2}-\d{4}$/.test(parts[0])) {
      return {
        date: convertDate(parts[0]),
        description: "STT Paid",
        amount: parseFloat(parts[1]),
        units: 0,
        nav: 0,
        balance: 0,
        type: "STT_TAX",
      };
    }
  }

  // Early exit for non-transaction lines
  const skipPatterns = [
    "***",
    "Unpledge",
    "Lien Removal",
    "Pledged",
    "Lien Marked",
  ];
  if (skipPatterns.some((word) => line.includes(word))) return null;

  // Parse regular transaction: DATE AMOUNT NAV UNITS DESCRIPTION BALANCE
  const parts = line.split(/\s+/);
  if (parts.length < 5) return null;

  const date = parts[0];
  if (!/^\d{2}-[A-Z][a-z]{2}-\d{4}$/.test(date)) return null;

  // Amount (handle parentheses for negative values)
  const amountStr = parts[1].replace(/,/g, "");
  const amount = parseFloat(amountStr.replace(/[()]/g, ""));

  // NAV
  const nav = parseFloat(parts[2]) || 0;

  // Units
  const unitsStr = parts[3].replace(/,/g, "");
  const units = parseFloat(unitsStr.replace(/[()]/g, ""));

  // Balance
  const balanceStr = parts[parts.length - 1].replace(/,/g, "");
  const balance = parseFloat(balanceStr.replace(/[()]/g, ""));

  // Description (all parts between units and balance)
  const description = parts.slice(4, parts.length - 1).join(" ");
  if (!description) return null;

  // ADD THIS: Skip transactions where all values are null/0 or NaN
  const hasAmount = !isNaN(amount) && amount !== 0;
  const hasUnits = !isNaN(units) && units !== 0;
  const hasNav = !isNaN(nav) && nav !== 0;
  const hasBalance = !isNaN(balance) && balance !== 0;

  // Return null if all values are invalid/zero (consolidation/system messages)
  if (!hasAmount && !hasUnits && !hasNav && !hasBalance) {
    return null;
  }

  return {
    date: convertDate(date),
    description: description,
    amount: amount,
    units: units,
    nav: nav,
    balance: balance,
    type: determineTransactionType(description, units),
  };
}

function determineTransactionType(desc, units) {
  const d = desc.toLowerCase();

  // Check for redemption first (including reversed purchases)
  if (
    /purchase[-\s]*reversed|systematic investment purchase[-\s]*reversed|redemption/i.test(
      d
    )
  ) {
    return "REDEMPTION";
  }

  // Check for purchase
  if (/purchase|systematic investment/i.test(d)) {
    return "PURCHASE";
  }

  // Check for switch (use units to determine direction)
  if (/switch/i.test(d)) {
    return units >= 0 ? "SWITCH_IN" : "SWITCH_OUT";
  }

  // Check for other transaction types
  if (/dividend/i.test(d)) return "DIVIDEND";
  if (/consolidation/i.test(d)) return "CONSOLIDATION";
  if (/cancelled/i.test(d)) return "CANCELLED";
  if (/demat/i.test(d)) return "DEMAT";

  return "OTHER";
}

function convertDate(dateStr) {
  const months = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };

  const [day, month, year] = dateStr.split("-");
  return `${year}-${months[month]}-${day.padStart(2, "0")}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseCAS };
}
