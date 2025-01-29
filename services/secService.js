const axios = require("axios");
const xml2js = require('xml2js');  // Add this at the top
const InsiderTransaction = require("../models/InsiderTransaction");

class SECService {
  constructor() {
    this.SEC_FEED_URL = "https://www.sec.gov/cgi-bin/browse-edgar";
    this.headers = {
      "User-Agent": "TradingApp InsiderTracker contact@yourapp.com",
    };
  }

  async fetchLatestFilings() {
    try {
      const response = await axios.get(this.SEC_FEED_URL, {
        params: {
          action: "getcurrent",
          type: "4",
          output: "atom",
          count: 100,
        },
        headers: this.headers,
      });

      const filings = await this.parseFilings(response.data);
      await this.storeFilings(filings);

      return filings;
    } catch (error) {
      console.error("Error fetching SEC filings:", error);
      throw error;
    }
  }

  async parseFilings(xmlData) {
    try {
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);
      
      const filings = result.feed.entry.map(entry => {
        const filing = {
          ticker: entry.title[0].match(/\((.*?)\)/)[1],
          filingDate: new Date(entry.updated[0]),
          insiderName: entry.title[0].split(' - ')[0],
          formType: '4',
          link: entry.link[0].$.href
        };

        // Fetch detailed Form 4 data
        const form4Data = await this.parseForm4(filing.link);
        return {
          ...filing,
          ...form4Data
        };
      });

      return filings;
    } catch (error) {
      console.error('Error parsing XML:', error);
      throw error;
    }
  }

  async parseForm4(url) {
    try {
      const response = await axios.get(url, { headers: this.headers });
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(response.data);

      // Extract transaction details from Form 4 XML
      const transactionData = {
        transactionType: result.form4.nonDerivativeTable[0].nonDerivativeTransaction[0].transactionCode[0],
        shares: parseInt(result.form4.nonDerivativeTable[0].nonDerivativeTransaction[0].sharesAmount[0]),
        pricePerShare: parseFloat(result.form4.nonDerivativeTable[0].nonDerivativeTransaction[0].transactionPricePerShare[0]),
        sharesOwned: parseInt(result.form4.ownershipTable[0].postTransactionAmounts[0].sharesOwnedFollowingTransaction[0])
      };

      transactionData.totalValue = transactionData.shares * transactionData.pricePerShare;
      return transactionData;
    } catch (error) {
      console.error('Error parsing Form 4:', error);
      throw error;
    }
  }

  async storeFilings(filings) {
    try {
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
}

module.exports = new SECService();