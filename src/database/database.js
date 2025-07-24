const Database = require('better-sqlite3');
const path = require('path');

class DatabaseManager {
    constructor() {
        // Create database in project root
        const dbPath = path.join(__dirname, '../../bitnob_bot.db');
        console.log('📀 Initializing database at:', dbPath);
        
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL'); // Better performance
        this.db.pragma('foreign_keys = ON');   // Enable foreign key constraints
        
        this.initializeTables();
        console.log('✅ Database initialized successfully');
    }

    initializeTables() {
        console.log('🏗️  Creating database tables...');
        
        // Users table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone VARCHAR(20) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                first_name VARCHAR(100) NOT NULL,
                last_name VARCHAR(100) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Balances table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS balances (
                user_id INTEGER PRIMARY KEY,
                btc_sats INTEGER DEFAULT 0,
                usdt_cents INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Transactions table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_user_id INTEGER,
                to_user_id INTEGER,
                amount INTEGER NOT NULL,
                currency VARCHAR(10) NOT NULL,
                type VARCHAR(20) NOT NULL, -- 'transfer', 'deposit', 'withdrawal'
                reference VARCHAR(100),
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_user_id) REFERENCES users(id),
                FOREIGN KEY (to_user_id) REFERENCES users(id)
            )
        `);

        // Deposits table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS deposits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                bitnob_address VARCHAR(100) NOT NULL,
                expected_amount INTEGER,
                actual_amount INTEGER,
                currency VARCHAR(10) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'confirmed', 'failed'
                bitnob_reference VARCHAR(100),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                confirmed_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        console.log('✅ Database tables created successfully');
    }

    // User management methods
    createUser(phone, email, firstName, lastName) {
        const stmt = this.db.prepare(`
            INSERT INTO users (phone, email, first_name, last_name)
            VALUES (?, ?, ?, ?)
        `);
        
        const transaction = this.db.transaction(() => {
            const result = stmt.run(phone, email, firstName, lastName);
            const userId = result.lastInsertRowid;
            
            // Initialize balance for new user
            const balanceStmt = this.db.prepare(`
                INSERT INTO balances (user_id, btc_sats, usdt_cents)
                VALUES (?, 0, 0)
            `);
            balanceStmt.run(userId);
            
            return userId;
        });
        
        return transaction();
    }

    getUserByPhone(phone) {
        const stmt = this.db.prepare('SELECT * FROM users WHERE phone = ?');
        return stmt.get(phone);
    }

    getUserByEmail(email) {
        const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
        return stmt.get(email);
    }

    // Balance management methods
    getBalance(userId) {
        const stmt = this.db.prepare(`
            SELECT btc_sats, usdt_cents, updated_at 
            FROM balances 
            WHERE user_id = ?
        `);
        return stmt.get(userId);
    }

    updateBalance(userId, btcSats = null, usdtCents = null) {
        let query = 'UPDATE balances SET updated_at = CURRENT_TIMESTAMP';
        const params = [];
        
        if (btcSats !== null) {
            query += ', btc_sats = ?';
            params.push(btcSats);
        }
        
        if (usdtCents !== null) {
            query += ', usdt_cents = ?';
            params.push(usdtCents);
        }
        
        query += ' WHERE user_id = ?';
        params.push(userId);
        
        const stmt = this.db.prepare(query);
        return stmt.run(...params);
    }

    // Transfer methods
    createTransfer(fromUserId, toUserId, amount, currency, description = '') {
        const transaction = this.db.transaction(() => {
            // Check sender balance
            const senderBalance = this.getBalance(fromUserId);
            const balanceField = currency === 'btc' ? 'btc_sats' : 'usdt_cents';
            
            if (senderBalance[balanceField] < amount) {
                throw new Error('Insufficient balance');
            }
            
            // Update balances
            const newSenderBalance = senderBalance[balanceField] - amount;
            const receiverBalance = this.getBalance(toUserId);
            const newReceiverBalance = receiverBalance[balanceField] + amount;
            
            if (currency === 'btc') {
                this.updateBalance(fromUserId, newSenderBalance, null);
                this.updateBalance(toUserId, newReceiverBalance, null);
            } else {
                this.updateBalance(fromUserId, null, newSenderBalance);
                this.updateBalance(toUserId, null, newReceiverBalance);
            }
            
            // Log transaction
            const reference = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
            const stmt = this.db.prepare(`
                INSERT INTO transactions (from_user_id, to_user_id, amount, currency, type, reference, description)
                VALUES (?, ?, ?, ?, 'transfer', ?, ?)
            `);
            
            const result = stmt.run(fromUserId, toUserId, amount, currency, reference, description);
            return { transactionId: result.lastInsertRowid, reference };
        });
        
        return transaction();
    }

    // Deposit methods
    createDeposit(userId, address, currency, expectedAmount = null) {
        const stmt = this.db.prepare(`
            INSERT INTO deposits (user_id, bitnob_address, currency, expected_amount)
            VALUES (?, ?, ?, ?)
        `);
        
        const result = stmt.run(userId, address, currency, expectedAmount);
        return result.lastInsertRowid;
    }

    confirmDeposit(depositId, actualAmount, bitnobReference) {
        const transaction = this.db.transaction(() => {
            // Get deposit info
            const deposit = this.db.prepare('SELECT * FROM deposits WHERE id = ?').get(depositId);
            if (!deposit) {
                throw new Error('Deposit not found');
            }
            
            // Update deposit status
            const updateStmt = this.db.prepare(`
                UPDATE deposits 
                SET status = 'confirmed', actual_amount = ?, bitnob_reference = ?, confirmed_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);
            updateStmt.run(actualAmount, bitnobReference, depositId);
            
            // Credit user balance
            const balance = this.getBalance(deposit.user_id);
            if (deposit.currency === 'btc') {
                const newBalance = balance.btc_sats + actualAmount;
                this.updateBalance(deposit.user_id, newBalance, null);
            } else {
                const newBalance = balance.usdt_cents + actualAmount;
                this.updateBalance(deposit.user_id, null, newBalance);
            }
            
            // Log as transaction
            const stmt = this.db.prepare(`
                INSERT INTO transactions (to_user_id, amount, currency, type, reference, description)
                VALUES (?, ?, ?, 'deposit', ?, ?)
            `);
            stmt.run(deposit.user_id, actualAmount, deposit.currency, bitnobReference, 'Deposit confirmation');
            
            return deposit;
        });
        
        return transaction();
    }

    // Transaction history
    getTransactionHistory(userId, limit = 10) {
        const stmt = this.db.prepare(`
            SELECT 
                t.*,
                sender.email as sender_email,
                sender.first_name as sender_name,
                receiver.email as receiver_email,
                receiver.first_name as receiver_name
            FROM transactions t
            LEFT JOIN users sender ON t.from_user_id = sender.id
            LEFT JOIN users receiver ON t.to_user_id = receiver.id
            WHERE t.from_user_id = ? OR t.to_user_id = ?
            ORDER BY t.created_at DESC
            LIMIT ?
        `);
        
        return stmt.all(userId, userId, limit);
    }

    // Utility methods
    getAllUsers() {
        const stmt = this.db.prepare('SELECT id, phone, email, first_name, last_name FROM users');
        return stmt.all();
    }

    getUserStats() {
        const totalUsers = this.db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const totalTransactions = this.db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
        const totalBtc = this.db.prepare('SELECT SUM(btc_sats) as total FROM balances').get().total || 0;
        const totalUsdt = this.db.prepare('SELECT SUM(usdt_cents) as total FROM balances').get().total || 0;
        
        return {
            totalUsers,
            totalTransactions,
            totalBtcSats: totalBtc,
            totalUsdtCents: totalUsdt
        };
    }

    close() {
        this.db.close();
    }
}

// Create singleton instance
const database = new DatabaseManager();

module.exports = database; 