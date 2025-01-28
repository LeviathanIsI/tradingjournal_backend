// backend/services/secService.js
const axios = require("axios");
const InsiderTransaction = require("../models/InsiderTransaction");

class SECService {
  constructor() {
    // SEC RSS Feed URL for latest Form 4 filings
    this.SEC_FEED_URL = "https://www.sec.gov/cgi-bin/browse-edgar";
    this.headers = {
      "User-Agent": "TradingApp InsiderTracker contact@yourapp.com", // Required by SEC
    };
  }

  async fetchLatestFilings() {
    try {
      // Get latest Form 4 filings
      const response = await axios.get(this.SEC_FEED_URL, {
        params: {
          action: "getcurrent",
          type: "4",
          output: "atom",
          count: 100,
        },
        headers: this.headers,
      });

      // Process and store the filings
      const filings = this.parseFilings(response.data);
      await this.storeFilings(filings);

      return filings;
    } catch (error) {
      console.error("Error fetching SEC filings:", error);
      throw error;
    }
  }

  parseFilings(xmlData) {
    // TODO: Implement XML parsing logic for SEC filings
    // This will need a XML parser library like 'xml2js'
    // and complex parsing logic for Form 4 data
    return [];
  }

  async storeFilings(filings) {
    try {
      // Store each filing in MongoDB
      const operations = filings.map((filing) => ({
        updateOne: {
          filter: {
            ticker: filing.ticker,
            filingDate: filing.filingDate,
            insiderName: filing.insiderName,
          },
          update: { $set: filing },
          upsert: true,
        },
      }));

      await InsiderTransaction.bulkWrite(operations);
    } catch (error) {
      console.error("Error storing filings:", error);
      throw error;
    }
  }

  // Helper method to parse Form 4 XML documents
  // TODO: Implement actual Form 4 XML parsing
  async parseForm4(url) {
    try {
      const response = await axios.get(url, { headers: this.headers });
      // Parse the Form 4 XML document
      // This will need detailed implementation based on SEC's Form 4 structure
      return null;
    } catch (error) {
      console.error("Error parsing Form 4:", error);
      throw error;
    }
  }
}

module.exports = new SECService();
