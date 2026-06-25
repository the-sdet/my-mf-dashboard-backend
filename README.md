# My MF Dashboard - Backend

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-blue.svg)](https://expressjs.com/)

A powerful Express backend for parsing Mutual Fund Consolidated Account Statements (CAS) and aggregating real-time mutual fund data from multiple sources.

## 🌟 Features

- **CAS Parsing**: Parse password-protected PDF CAS statements from CAMS
- **Detailed Extraction**: Extract investor info, folios, schemes, and transaction history
- **Real-time Data**: Fetch live NAV, fund statistics, and performance metrics
- **Multiple AMC Support**: Handles 50+ Asset Management Companies
- **Rate Limiting**: Built-in protection against API abuse
- **CORS Enabled**: Ready for frontend integration

## 📋 Table of Contents

- [Installation](#installation)
- [API Endpoints](#api-endpoints)
- [Usage Examples](#usage-examples)
- [Data Sources](#data-sources)
- [Supported AMCs](#supported-amcs)
- [Configuration](#configuration)
- [Error Handling](#error-handling)
- [Contributing](#contributing)
- [License](#license)

## 🚀 Installation

### Prerequisites

- Node.js 18.x or higher
- npm or yarn

### Setup

1. Clone the repository:

```bash
git clone https://github.com/the-sdet/my-mf-dashboard-backend.git
cd my-mf-dashboard-backend
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file (optional):

```env
PORT=3000
```

4. Start the server:

```bash
npm start
```

The server will run on `http://localhost:3000`

## 📡 API Endpoints

### Health Check

```http
GET /
GET /health
```

Returns server status and available endpoints.

**Response:**

```json
{
  "status": "ok",
  "message": "MF Dashboard Backend API is running",
  "endpoints": [
    "POST /api/parse-cas",
    "POST /api/mf-stats",
    "POST /api/mf-peers",
    "POST /api/update-nav-only"
  ]
}
```

---

### Parse CAS Statement

```http
POST /api/parse-cas
```

Upload and parse a password-protected CAS PDF from CAMS or KFintech.

**Request:** `multipart/form-data`

| Field      | Type   | Required | Description               |
| ---------- | ------ | -------- | ------------------------- |
| `file`     | File   | Yes      | CAS PDF file              |
| `password` | String | No       | PDF password if protected |

**Response:**

```json
{
  "success": true,
  "message": "CAS parsed successfully",
  "data": {
    "statement_period": { "from": "01-Apr-2024", "to": "25-Jun-2025" },
    "file_type": "CAMS",
    "cas_type": "DETAILED",
    "investor_info": {
      "name": "John Doe",
      "email": "investor@example.com",
      "mobile": "+919876543210",
      "address": "123 Street, City"
    },
    "folios": [
      {
        "folio": "1234567/89",
        "amc": "HDFC Mutual Fund",
        "pan": "ABCDE1234F",
        "schemes": [
          {
            "scheme": "HDFC Mid-Cap Opportunities Fund - Direct Plan - Growth",
            "isin": "INF179KB1HD7",
            "open": 100.234,
            "close": 150.891,
            "transactions": [
              {
                "date": "2024-06-15",
                "type": "PURCHASE",
                "amount": 5000.0,
                "units": 12.345,
                "nav": 405.12,
                "balance": 150.891,
                "description": "SIP"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

### Fetch MF Statistics

```http
POST /api/mf-stats
```

Fetch full fund metadata, NAV history, and portfolio stats for a list of funds. Supports a two-tier fetch: `searchKeys` for active holdings (full data including NAV history) and `lightSearchKeys` for past/redeemed holdings (metadata only, NAV history optional). Both lists are fetched concurrently with up to 10 parallel workers each.

**Request:**

| Field             | Type     | Required | Description                                                                |
| ----------------- | -------- | -------- | -------------------------------------------------------------------------- |
| `searchKeys`      | String[] | Yes      | Groww search IDs for active holdings — full fetch (metadata + stats + NAV) |
| `lightSearchKeys` | String[] | No       | Groww search IDs for past holdings — light fetch (metadata only)           |
| `lightIncludeNav` | Boolean  | No       | Whether to include NAV history for light keys. Default: `false`            |

```json
{
  "searchKeys": ["motilal-oswal-midcap-fund-direct-plan-growth"],
  "lightSearchKeys": ["hdfc-equity-fund-direct-plan-growth"],
  "lightIncludeNav": true
}
```

**Response:**

The `data` object is keyed by ISIN. Active fund objects include full portfolio stats and NAV history; past fund objects (`_is_past: true`) include only metadata.

```json
{
  "success": true,
  "message": "Fetched stats for 1 active + 1 past funds",
  "data": {
    "INF247L01052": {
      "isin": "INF247L01052",
      "scheme_name": "Motilal Oswal Midcap Fund Direct Growth",
      "scheme_code": "151278",
      "amc": "Motilal Oswal Mutual Fund",
      "logo_url": "https://...",
      "plan_type": "DIRECT",
      "scheme_type": "EQUITY",
      "category": "Equity",
      "sub_category": "Mid Cap",
      "expense_ratio": 0.58,
      "expense_ratio_history": [
        { "date": "2024-04-01", "expense_ratio": 0.58 }
      ],
      "aum": 36458,
      "groww_rating": 3,
      "return_stats": {
        "return1y": -7.6,
        "return3y": 18.9,
        "return5y": 31.2,
        "risk_rating": 6,
        "cat_return3y": 22.1
      },
      "sip_return": { "return1y": -4.2, "return3y": 16.5 },
      "simple_return": { "return1y": -7.6 },
      "holdings": [{ "company_name": "Kalyan Jewellers", "percentage": 6.5 }],
      "portfolio_stats": { "risk": "Very High", "pe": 43.75 },
      "portfolio_turnover": 0.35,
      "benchmark": "Nifty Midcap 150 TRI",
      "latest_nav": 101.23,
      "latest_nav_date": "24-Jun-2025",
      "nav_history": [
        { "date": "24-Jun-2025", "nav": "101.2300" },
        { "date": "23-Jun-2025", "nav": "100.8900" }
      ],
      "meta": {
        "fund_house": "Motilal Oswal Mutual Fund",
        "scheme_type": "Open Ended"
      },
      "similar_schemes": []
    },
    "INF179KB1HD7": {
      "isin": "INF179KB1HD7",
      "scheme_name": "HDFC Mid-Cap Opportunities Fund Direct Plan Growth",
      "scheme_code": "119062",
      "amc": "HDFC Mutual Fund",
      "_is_past": true,
      "return_stats": {},
      "portfolio_stats": {},
      "nav_history": [],
      "similar_schemes": []
    }
  }
}
```

---

### Fetch Peer Funds

```http
POST /api/mf-peers
```

Fetch similar/peer funds for a list of funds, grouped by ISIN. Used as a background Phase 2 load after the initial dashboard render. Each fund's peers are sourced from Groww's similar schemes endpoint, then enriched with individual fund metadata (ISIN, AMC, return stats, expense ratio history).

**Request:**

| Field   | Type  | Required | Description                                 |
| ------- | ----- | -------- | ------------------------------------------- |
| `funds` | Array | Yes      | List of fund descriptors to fetch peers for |

Each item in `funds`:

| Field          | Type   | Description                      |
| -------------- | ------ | -------------------------------- |
| `isin`         | String | Fund ISIN (used as response key) |
| `category`     | String | e.g. `"Equity"`                  |
| `sub_category` | String | e.g. `"Mid Cap"`                 |
| `plan_type`    | String | `"DIRECT"` or `"REGULAR"`        |
| `scheme_type`  | String | e.g. `"EQUITY"`                  |

```json
{
  "funds": [
    {
      "isin": "INF247L01052",
      "category": "Equity",
      "sub_category": "Mid Cap",
      "plan_type": "DIRECT",
      "scheme_type": "EQUITY"
    }
  ]
}
```

**Response:**

The `data` object is keyed by the input ISIN. Each value is an array of peer fund objects.

```json
{
  "success": true,
  "message": "Fetched peers for 1 funds",
  "data": {
    "INF247L01052": [
      {
        "search_id": "invesco-india-mid-cap-fund-direct-plan-growth",
        "scheme_name": "Invesco India Mid Cap Fund Direct Growth",
        "fund_house": "Invesco Mutual Fund",
        "isin": "INF205K01EV2",
        "amc": "Invesco Asset Management",
        "logo_url": "https://...",
        "return1y": 10.7,
        "return3y": 27.0,
        "expense_ratio": 0.58,
        "aum": 12397,
        "groww_rating": 4,
        "risk": "Very High",
        "return_stats": {
          "return1y": 10.7,
          "return3y": 27.0,
          "risk_rating": 6
        },
        "expense_ratio_history": [
          { "date": "2024-04-01", "expense_ratio": 0.58 }
        ]
      }
    ]
  }
}
```

---

### Update NAV Only

```http
POST /api/update-nav-only
```

Fetch only the latest NAV entries for a set of active holdings. Used for daily NAV refresh without re-fetching full fund metadata. Only returns entries newer than `last_nav_date` per fund; if `last_nav_date` is absent, the full NAV history is returned.

**Request:**

| Field           | Type   | Required | Description                                    |
| --------------- | ------ | -------- | ---------------------------------------------- |
| `navUpdateData` | Object | Yes      | Map of ISIN → `{ scheme_code, last_nav_date }` |

```json
{
  "navUpdateData": {
    "INF247L01052": {
      "scheme_code": "151278",
      "last_nav_date": "20-Jun-2025"
    },
    "INF179KB1HD7": {
      "scheme_code": "119062",
      "last_nav_date": null
    }
  }
}
```

**Response:**

Only ISINs that have new NAV entries (newer than `last_nav_date`) are included in `data`.

```json
{
  "success": true,
  "message": "Found NAV data for 2 out of 2 funds",
  "data": {
    "INF247L01052": {
      "latest_nav": "101.2300",
      "latest_nav_date": "24-Jun-2025",
      "nav_entries": [
        { "date": "24-Jun-2025", "nav": "101.2300" },
        { "date": "23-Jun-2025", "nav": "100.8900" }
      ],
      "is_full_history": false,
      "meta": {
        "fund_house": "Motilal Oswal Mutual Fund",
        "scheme_type": "Open Ended"
      }
    },
    "INF179KB1HD7": {
      "latest_nav": "178.5600",
      "latest_nav_date": "24-Jun-2025",
      "nav_entries": [{ "date": "24-Jun-2025", "nav": "178.5600" }],
      "is_full_history": true,
      "meta": { "fund_house": "HDFC Mutual Fund", "scheme_type": "Open Ended" }
    }
  }
}
```

## 💡 Usage Examples

### Using cURL

**Parse CAS:**

```bash
curl -X POST http://localhost:3000/api/parse-cas \
  -F "file=@statement.pdf" \
  -F "password=yourpassword"
```

**Fetch Fund Stats (active + past holdings):**

```bash
curl -X POST http://localhost:3000/api/mf-stats \
  -H "Content-Type: application/json" \
  -d '{
    "searchKeys": ["motilal-oswal-midcap-fund-direct-plan-growth"],
    "lightSearchKeys": ["hdfc-equity-fund-direct-plan-growth"],
    "lightIncludeNav": true
  }'
```

**Fetch Peer Funds:**

```bash
curl -X POST http://localhost:3000/api/mf-peers \
  -H "Content-Type: application/json" \
  -d '{
    "funds": [{
      "isin": "INF247L01052",
      "category": "Equity",
      "sub_category": "Mid Cap",
      "plan_type": "DIRECT",
      "scheme_type": "EQUITY"
    }]
  }'
```

**Update NAV only:**

```bash
curl -X POST http://localhost:3000/api/update-nav-only \
  -H "Content-Type: application/json" \
  -d '{
    "navUpdateData": {
      "INF247L01052": { "scheme_code": "151278", "last_nav_date": "20-Jun-2025" }
    }
  }'
```

### Using JavaScript (Fetch API)

```javascript
// Parse CAS
const formData = new FormData();
formData.append("file", pdfFile);
formData.append("password", "yourpassword");

const response = await fetch("http://localhost:3000/api/parse-cas", {
  method: "POST",
  body: formData,
});

const data = await response.json();
console.log(data);
```

## 🔗 Data Sources

The backend aggregates data from multiple reliable sources:

1. **Groww API**: Fund details, statistics, and portfolio information
2. **MFAPI**: Historical NAV data and scheme information
3. **CAS Statements**: Investor-specific holdings and transactions

## 🏦 Supported AMCs

The parser supports 50+ Asset Management Companies including:

- HDFC Mutual Fund
- ICICI Prudential Mutual Fund
- SBI Mutual Fund
- Axis Mutual Fund
- Kotak Mahindra Mutual Fund
- Aditya Birla Sun Life Mutual Fund
- UTI Mutual Fund
- Nippon India Mutual Fund
- And 40+ more...

## ⚙️ Configuration

### Rate Limiting

Default configuration:

- **Window**: 15 minutes
- **Max Requests**: 20 per window

Modify in `server.js`:

```javascript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many requests. Please slow down." },
});
```

### CORS Origins

Update allowed origins in `server.js`:

```javascript
app.use(
  cors({
    origin: ["https://your-frontend-domain.com", "http://localhost:5500"],
  }),
);
```

### File Upload

Default upload directory: `uploads/`

Temporary files are automatically cleaned up after processing.

## 🛡️ Error Handling

The API returns consistent error responses:

```json
{
  "success": false,
  "error": "Error message description"
}
```

Common HTTP status codes:

- `400`: Bad Request (invalid input)
- `500`: Internal Server Error

## 📊 Transaction Types

The parser identifies the following transaction types:

- `PURCHASE`: New investments
- `REDEMPTION`: Withdrawals
- `SWITCH_IN`: Units received from another scheme
- `SWITCH_OUT`: Units transferred to another scheme
- `DIVIDEND`: Dividend payouts
- `STAMP_DUTY_TAX`: Stamp duty charges
- `STT_TAX`: Securities Transaction Tax
- `DEMAT`: Demat-related transactions
- `OTHER`: Miscellaneous transactions

## 🚀 Deployment

### Deploy on Render

This backend is configured for easy deployment on [Render](https://render.com).

#### Quick Deploy

1. Fork this repository to your GitHub account

2. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** → **Web Service**

3. Connect your GitHub repository

4. Configure the service:
   - **Name**: `my-mf-dashboard-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free (or as per your needs)

5. Add Environment Variables (optional):
   - `PORT`: 3000 (Render sets this automatically)

6. Click **Create Web Service**

#### Post-Deployment

1. Note your deployment URL: `https://your-service.onrender.com`

2. Update your frontend to use this URL:

```javascript
const API_BASE_URL = "https://your-service.onrender.com";
```

3. Add your frontend domain to CORS origins in `server.js`:

```javascript
origin: ["https://your-frontend-domain.github.io", "http://localhost:5500"];
```

#### Important Notes

- **Free Tier**: Service may spin down after 15 minutes of inactivity
- **Cold Starts**: First request after inactivity may take 30-60 seconds
- **File Uploads**: Temporary files are stored in `/tmp` and cleaned automatically
- **Rate Limiting**: 20 requests per 15 minutes per IP address

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👤 Author

[Pabitra Swain @the-sdet](https://github.com/the-sdet)

## 🙏 Acknowledgments

- CAMS for CAS statement format
- Groww for fund data API
- MFAPI for NAV history

## ⚠️ Disclaimer:

This tool is for personal portfolio tracking only. Always verify data with official sources. Not affiliated with CAMS, SEBI, or any AMC and is for **informational and educational purposes only**.

- Always consult with a qualified financial advisor before making investment decisions
- Capital gains calculations are indicative and should be verified with your official tax statements or CA
- Past performance is not indicative of future results
- The developer assumes no responsibility for any financial decisions made based on this tool
- NAV and fund data accuracy depends on external API providers
- Tax laws and regulations are subject to change - consult a tax professional for accurate tax planning

---

**Privacy Notice**: Your financial data is processed and stored locally on your device. No data is transmitted to external servers except for fetching public NAV and fund information from publicly available APIs.

---

## Made with ❤️ for the Indian MF investor community

**Note**: This backend is designed to work with the [My MF Dashboard](https://mf-dashboard.github.io) frontend application.
