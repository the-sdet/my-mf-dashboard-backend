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
    "POST /api/update-nav-only"
  ]
}
```

### Parse CAS Statement

```http
POST /api/parse-cas
```

Upload and parse a CAS PDF file.

**Request:**

- Content-Type: `multipart/form-data`
- Body:
  - `file`: PDF file (required)
  - `password`: PDF password (optional)

**Response:**

```json
{
  "success": true,
  "message": "CAS parsed successfully",
  "data": {
    "statement_period": {
      "from": "2024-01-01",
      "to": "2024-12-31"
    },
    "file_type": "CAMS",
    "cas_type": "DETAILED",
    "investor_info": {
      "email": "investor@example.com",
      "name": "John Doe",
      "mobile": "+919876543210",
      "address": "123 Street, City"
    },
    "folios": [...]
  }
}
```

### Fetch MF Statistics

```http
POST /api/mf-stats
```

Get comprehensive statistics for multiple mutual funds.

**Request:**

```json
{
  "searchKeys": ["fund-name-1", "fund-name-2"]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Fetched stats for 2 ISINs",
  "data": {
    "INF123456789": {
      "amc": "HDFC Mutual Fund",
      "scheme_name": "HDFC Equity Fund",
      "scheme_code": "119551",
      "latest_nav": 845.32,
      "latest_nav_date": "27-Oct-2024",
      "expense_ratio": 1.85,
      "aum": 15000,
      "return_stats": {...},
      "holdings": [...],
      "nav_history": [...]
    }
  }
}
```

### Update NAV Data

```http
POST /api/update-nav-only
```

Fetch only the latest NAV updates for existing funds.

**Request:**

```json
{
  "navUpdateData": {
    "INF123456789": {
      "scheme_code": "119551",
      "last_nav_date": "2024-10-20"
    }
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Found NAV data for 1 out of 1 funds",
  "data": {
    "INF123456789": {
      "latest_nav": 845.32,
      "latest_nav_date": "27-Oct-2024",
      "nav_entries": [...],
      "is_full_history": false,
      "meta": {...}
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

**Fetch Fund Stats:**

```bash
curl -X POST http://localhost:3000/api/mf-stats \
  -H "Content-Type: application/json" \
  -d '{"searchKeys": ["hdfc-equity-fund", "icici-bluechip"]}'
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
  })
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

**Note**: This backend is designed to work with the [My MF Dashboard](https://my-mf-dashboard.github.io) frontend application.
