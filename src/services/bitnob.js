const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class BitnobService {
    constructor() {
        this.baseURL = process.env.BITNOB_API_BASE_URL;
        // this.apiKey = process.env.BITNOB_API_KEY;
        // this.clientId = process.env.BITNOB_CLIENT_ID;
        this.secretKey = process.env.BITNOB_SECRET_KEY;
    }

    // Simple Bearer token authentication (as confirmed working in Postman)
    async _request(method, path, body = null, queryParams = '') {
        const url = `${this.baseURL}${path}${queryParams}`;
        
        // Use Bearer token authentication with secret key (as confirmed working)
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.secretKey}`,
        };

        console.log('Request URL:', url);
        console.log('Request headers:', headers);
        console.log('Request body:', body);

        try {
            const response = await axios({ 
                method, 
                url, 
                data: body, 
                headers
            });
            
            console.log('Response status:', response.status);
            console.log('Response data:', response.data);
            return response.data;
        } catch (error) {
            console.error(`Bitnob API Error: ${error.response?.data?.message || error.message}`);
            console.error(`Request details: ${method} ${path}`);
            console.error(`Response status:`, error.response?.status);
            console.error(`Response data:`, error.response?.data);
            throw new Error(error.response?.data?.message || 'Bitnob API request failed');
        }
    }

    // Customer Creation
    async createCustomer(phoneNumber, email, firstName, lastName) {
        const path = '/api/v1/customers';
        const body = {
            firstName,
            lastName,
            email,
            phone: phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber,
            countryCode: "+234"
        };
        return this._request('POST', path, body);
    }

    // Get Wallets (with customerIdentifier query param as confirmed working)
    async getWallets(customerEmail) {
        const queryParams = `?customerIdentifier=${customerEmail}`;
        return this._request('GET', '/api/v1/wallets', null, queryParams);
    }

    // Address Generation (correct endpoint from Postman)
    async generateAddress(currency, customerEmail, label = '') {
        const path = '/api/v1/addresses/generate';  // Correct endpoint from Postman
        
        // Map currency to correct chain names
        const chainMap = {
            'btc': 'bitcoin',
            'bitcoin': 'bitcoin', 
            'usdt': 'bsc',  // USDT on BSC as shown in Postman
            'eth': 'ethereum',
            'ethereum': 'ethereum'
        };
        
        const body = { 
            chain: chainMap[currency.toLowerCase()] || currency.toLowerCase(),
            customerIdentifier: customerEmail,  // As shown in Postman
            customerEmail: customerEmail,       // Also include customerEmail as shown
            label: label || `${currency.toUpperCase()} deposit address`
        };
        return this._request('POST', path, body);
    }

    // Get Customer Transactions/History  
    async getCustomerTransactions(customerEmail) {
        const queryParams = `?customerIdentifier=${customerEmail}`;
        return this._request('GET', '/api/v1/transactions', null, queryParams);
    }

    // Transfer between users (P2P)
    async createTransfer(amount, currency, recipientEmail, senderEmail, description) {
        const path = '/api/v1/transfers';
        const body = {
            amount,
            currency: currency.toLowerCase(),
            recipientEmail,
            senderEmail,
            description,
            reference: `whatsapp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };
        return this._request('POST', path, body);
    }

    // Lightning Invoice Creation (might need different endpoint)
    async createInvoice(sats, description, customerEmail) {
        const path = '/api/v1/lightning/invoices';
        const body = {
            amount: sats,
            description,
            customerEmail,
            reference: `whatsapp-invoice-${Date.now()}`
        };
        return this._request('POST', path, body);
    }

    // Payout Quote (convert crypto to fiat)
    async createPayoutQuote(amount, fromAsset, toCurrency, customerEmail) {
        const path = '/api/v1/payouts/quotes';
        const body = {
            amount,
            fromAsset: fromAsset.toLowerCase(),
            toCurrency: toCurrency.toUpperCase(),
            customerEmail,
            reference: `whatsapp-payout-${Date.now()}`
        };
        return this._request('POST', path, body);
    }
}

module.exports = new BitnobService();
