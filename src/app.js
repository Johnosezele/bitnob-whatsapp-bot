require('dotenv').config();
const { connectToWhatsApp } = require('../config/whatsapp');
const bitnobService = require('./services/bitnob');
const database = require('./database/database');

// Email and phone validation
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10,11}$/;

// In-memory pending registrations (temporary until user completes registration)
const pendingRegistration = new Set();

// Admin phone number (your phone number for admin commands)
const ADMIN_PHONE = '2347039551679'; // Your phone number

async function handleMessage(sock, msg) {
    const from = msg.key.remoteJid;
    const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').toLowerCase();
    console.log('👉 handleMessage triggered for', from, text);

    // Only handle direct 1-to-1 chats
    if (!from.endsWith('@s.whatsapp.net')) {
        return;
    }
    const phoneNumber = from.split('@')[0]; // digits only

    try {
        // -------- Admin Commands (only for admin phone) --------
        if (phoneNumber === ADMIN_PHONE) {
            if (text === 'cleardb') {
                try {
                    // Clear all tables
                    database.db.exec('DELETE FROM transactions');
                    database.db.exec('DELETE FROM deposits');
                    database.db.exec('DELETE FROM balances');
                    database.db.exec('DELETE FROM users');
                    
                    // Clear pending registrations
                    pendingRegistration.clear();
                    
                    await sock.sendMessage(from, { 
                        text: '🗑️ **Database Cleared!**\n\nAll users, balances, transactions, and deposits have been deleted.\n\n✅ Ready for fresh testing!' 
                    });
                    return;
                } catch (err) {
                    await sock.sendMessage(from, { 
                        text: `❌ Error clearing database: ${err.message}` 
                    });
                    return;
                }
            }

            if (text.startsWith('testcredit ')) {
                // Parse: "testcredit 50000 sats" or "testcredit 100 usdt"
                const parts = text.split(' ');
                if (parts.length !== 3) {
                    await sock.sendMessage(from, { 
                        text: '❌ Format: "testcredit 50000 sats" or "testcredit 100 usdt"' 
                    });
                    return;
                }

                const amount = parseFloat(parts[1]);
                const currency = parts[2].toLowerCase();
                
                if (!amount || amount <= 0) {
                    await sock.sendMessage(from, { text: '❌ Invalid amount' });
                    return;
                }

                try {
                    const user = database.getUserByPhone(phoneNumber);
                    if (!user) {
                        await sock.sendMessage(from, { text: '❌ You need to register first' });
                        return;
                    }

                    const balance = database.getBalance(user.id);
                    
                    if (currency === 'sats' || currency === 'btc') {
                        const satsToAdd = currency === 'btc' ? Math.floor(amount * 100000000) : Math.floor(amount);
                        const newBtcSats = balance.btc_sats + satsToAdd;
                        database.updateBalance(user.id, newBtcSats, null);
                        
                        await sock.sendMessage(from, { 
                            text: `✅ **Test Credit Added!**\n\nAdded: ${satsToAdd} sats\nNew BTC balance: ${newBtcSats} sats\n\n💡 Type "balance" to see updated balance.` 
                        });
                    } else if (currency === 'usdt') {
                        const centsToAdd = Math.floor(amount * 100);
                        const newUsdtCents = balance.usdt_cents + centsToAdd;
                        database.updateBalance(user.id, null, newUsdtCents);
                        
                        await sock.sendMessage(from, { 
                            text: `✅ **Test Credit Added!**\n\nAdded: $${amount} USDT\nNew USDT balance: $${(newUsdtCents/100).toFixed(2)}\n\n💡 Type "balance" to see updated balance.` 
                        });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Currency must be "sats", "btc", or "usdt"' });
                    }
                    return;
                } catch (err) {
                    await sock.sendMessage(from, { 
                        text: `❌ Error adding test credit: ${err.message}` 
                    });
                    return;
                }
            }

            if (text === 'stats') {
                try {
                    const stats = database.getUserStats();
                    const users = database.getAllUsers();
                    
                    let statsMsg = '📊 **Database Statistics**\n\n';
                    statsMsg += `👥 Total Users: ${stats.totalUsers}\n`;
                    statsMsg += `📋 Total Transactions: ${stats.totalTransactions}\n`;
                    statsMsg += `₿ Total BTC: ${stats.totalBtcSats} sats\n`;
                    statsMsg += `💵 Total USDT: $${(stats.totalUsdtCents/100).toFixed(2)}\n\n`;
                    
                    if (users.length > 0) {
                        statsMsg += '👥 **Registered Users:**\n';
                        users.forEach((user, index) => {
                            const balance = database.getBalance(user.id);
                            statsMsg += `${index + 1}. ${user.first_name} (${user.email})\n`;
                            statsMsg += `   ${balance.btc_sats} sats, $${(balance.usdt_cents/100).toFixed(2)}\n`;
                        });
                    }
                    
                    await sock.sendMessage(from, { text: statsMsg });
                    return;
                } catch (err) {
                    await sock.sendMessage(from, { 
                        text: `❌ Error getting stats: ${err.message}` 
                    });
                    return;
                }
            }

            if (text === 'adminhelp') {
                await sock.sendMessage(from, { 
                    text: '🔧 **Admin Commands**\n\n• "cleardb" - Clear all database data\n• "testcredit 50000 sats" - Add test BTC\n• "testcredit 100 usdt" - Add test USDT\n• "stats" - Show database statistics\n• "adminhelp" - Show this menu\n\n⚠️ Admin commands only work for the admin phone number.\n\n💡 Use "testcredit" to simulate deposits for demo purposes.' 
                });
                return;
            }
        }

        // -------- Registration flow --------
        // Check if user exists in database
        const existingUser = database.getUserByPhone(phoneNumber);
        
        if (!existingUser) {
            // If they have not started registration, prompt
            if (!pendingRegistration.has(phoneNumber)) {
                pendingRegistration.add(phoneNumber);
                await sock.sendMessage(from, { 
                    text: `👋 Hi! Welcome to Bitnob WhatsApp Bot!\n\n💰 Send and receive Bitcoin & USDT instantly\n\n📝 To get started, please send your details:\nfirstName,lastName,email,phone\n\n📋 Example:\nJohn,Doe,john@example.com,08123456789` 
                });
                return;
            } else {
                // Expecting their CSV details now
                const parts = text.split(',').map(p => p.trim());
                if (parts.length !== 4 || !EMAIL_RE.test(parts[2]) || !PHONE_RE.test(parts[3].replace(/^\+?/, ''))) {
                    await sock.sendMessage(from, { 
                        text: '❌ Invalid format. Please send exactly:\nfirstName,lastName,email,phone\n\n📋 Example:\nJohn,Doe,john@example.com,08123456789' 
                    });
                    return;
                }
                
                const [firstName, lastName, email, phoneRaw] = parts;
                const phoneClean = phoneRaw.replace(/^\+?/, '');

                try {
                    // Check if email already exists
                    const existingEmail = database.getUserByEmail(email);
                    if (existingEmail) {
                        await sock.sendMessage(from, { 
                            text: '❌ Email already registered. Please use a different email address.' 
                        });
                        return;
                    }

                    // Create user in Bitnob
                    await bitnobService.createCustomer(phoneClean, email, firstName, lastName);
                    
                    // Create user in database (this also initializes balance to 0)
                    const userId = database.createUser(phoneNumber, email, firstName, lastName);
                    
                    pendingRegistration.delete(phoneNumber);
                    
                    await sock.sendMessage(from, { 
                        text: `🎉 Welcome ${firstName}! Your account is ready.\n\n💼 Your balance: 0 BTC, $0 USDT\n\n📋 Available commands:\n• "balance" - Check your balances\n• "deposit btc" - Get Bitcoin deposit address\n• "deposit usdt" - Get USDT deposit address\n• "send 1000 sats to user@email.com" - Send Bitcoin\n• "send 50 usdt to user@email.com" - Send USDT\n• "history" - View transactions\n• "help" - Show commands\n\n🚀 Ready to start transacting!` 
                    });
                    
                } catch (err) {
                    console.error('Registration error:', err.message);
                    await sock.sendMessage(from, { 
                        text: `🚫 Registration failed: ${err.message}\n\nPlease try again with correct details.` 
                    });
                }
                return;
            }
        }

        // User exists, handle commands
        const user = existingUser;

        // -------- Commands --------
        if (text === 'balance') {
            console.log(`Checking balance for user ${user.id}...`);
            
            try {
                const balance = database.getBalance(user.id);
                const btcAmount = (balance.btc_sats / 100000000).toFixed(8);
                const usdtAmount = (balance.usdt_cents / 100).toFixed(2);
                
                let balanceMsg = `💰 **${user.first_name}'s Wallet Balance:**\n\n`;
                balanceMsg += `₿ Bitcoin: ${balance.btc_sats.toLocaleString()} sats (${btcAmount} BTC)\n`;
                balanceMsg += `💵 USDT: $${usdtAmount}\n\n`;
                balanceMsg += `📋 Commands:\n`;
                balanceMsg += `• "deposit btc" - Get Bitcoin address\n`;
                balanceMsg += `• "deposit usdt" - Get USDT address\n`;
                balanceMsg += `• "send 1000 sats to user@email.com"\n`;
                balanceMsg += `• "send 50 usdt to user@email.com"\n`;
                balanceMsg += `• "history" - View transactions`;
                
                await sock.sendMessage(from, { text: balanceMsg });
                
            } catch (err) {
                console.error('Balance check error:', err.message);
                await sock.sendMessage(from, { 
                    text: '❌ Unable to check balance. Please try again.' 
                });
            }

        } else if (text === 'deposit btc') {
            try {
                console.log(`Generating BTC address for user ${user.email}...`);
                const res = await bitnobService.generateAddress('btc', user.email, 'BTC deposit');
                const address = res.data?.address;
                
                if (address) {
                    // Store deposit in database
                    database.createDeposit(user.id, address, 'btc');
                    
                    await sock.sendMessage(from, { 
                        text: `🏧 **Bitcoin Deposit Address:**\n\n\`${address}\`\n\n💡 Send Bitcoin to this address to fund your account.\n⚠️ Only send Bitcoin (BTC) to this address!\n\n🔔 You'll receive a notification when funds arrive.` 
                    });
                } else {
                    throw new Error('No address in response');
                }
            } catch (e) {
                console.error('BTC address error:', e.message);
                await sock.sendMessage(from, { 
                    text: `🚫 Unable to generate Bitcoin address: ${e.message}` 
                });
            }

        } else if (text === 'deposit usdt') {
            try {
                console.log(`Generating USDT address for user ${user.email}...`);
                const res = await bitnobService.generateAddress('usdt', user.email, 'USDT deposit');
                const address = res.data?.address;
                
                if (address) {
                    // Store deposit in database
                    database.createDeposit(user.id, address, 'usdt');
                    
                    await sock.sendMessage(from, { 
                        text: `🏧 **USDT Deposit Address (BSC):**\n\n\`${address}\`\n\n💡 Send USDT (BEP20) to this address to fund your account.\n⚠️ Only send USDT on BSC network!\n\n🔔 You'll receive a notification when funds arrive.` 
                    });
                } else {
                    throw new Error('No address in response');
                }
            } catch (e) {
                console.error('USDT address error:', e.message);
                await sock.sendMessage(from, { 
                    text: `🚫 Unable to generate USDT address: ${e.message}` 
                });
            }

        } else if (text.startsWith('send ')) {
            // Parse send command: "send 1000 sats to user@email.com" or "send 50 usdt to user@email.com"
            const parts = text.split(' ');
            if (parts.length < 5 || parts[3] !== 'to') {
                await sock.sendMessage(from, { 
                    text: '❌ Invalid format. Use:\n• "send 1000 sats to user@email.com"\n• "send 50 usdt to user@email.com"' 
                });
                return;
            }

            const amount = parseFloat(parts[1]);
            let currency = parts[2].toLowerCase();
            const recipientEmail = parts[4];

            if (!amount || amount <= 0) {
                await sock.sendMessage(from, { text: '❌ Invalid amount. Please enter a positive number.' });
                return;
            }

            if (!EMAIL_RE.test(recipientEmail)) {
                await sock.sendMessage(from, { text: '❌ Invalid email address format.' });
                return;
            }

            try {
                // Find recipient
                const recipient = database.getUserByEmail(recipientEmail);
                if (!recipient) {
                    await sock.sendMessage(from, { 
                        text: `❌ User ${recipientEmail} not found. They need to register first.` 
                    });
                    return;
                }

                if (recipient.id === user.id) {
                    await sock.sendMessage(from, { text: '❌ Cannot send to yourself.' });
                    return;
                }

                // Convert to smallest units and normalize currency
                let amountInUnits;
                let normalizedCurrency;
                if (currency === 'sats') {
                    amountInUnits = Math.floor(amount);
                    normalizedCurrency = 'btc'; // Normalize to btc
                } else if (currency === 'btc') {
                    amountInUnits = Math.floor(amount * 100000000); // Convert BTC to sats
                    normalizedCurrency = 'btc';
                } else if (currency === 'usdt') {
                    amountInUnits = Math.floor(amount * 100); // Convert USDT to cents
                    normalizedCurrency = 'usdt';
                } else {
                    await sock.sendMessage(from, { 
                        text: '❌ Invalid currency. Use "sats", "btc", or "usdt".' 
                    });
                    return;
                }

                // Perform transfer
                const transferResult = database.createTransfer(
                    user.id, 
                    recipient.id, 
                    amountInUnits, 
                    normalizedCurrency,
                    `Transfer from ${user.first_name} to ${recipient.first_name}`
                );

                // Format confirmation message
                let displayAmount;
                if (normalizedCurrency === 'btc') {
                    displayAmount = parts[2] === 'sats' ? `${amountInUnits} sats` : `${amount} BTC`;
                } else {
                    displayAmount = `$${amount} USDT`;
                }

                // Notify sender
                await sock.sendMessage(from, { 
                    text: `✅ **Transfer Successful!**\n\nSent: ${displayAmount}\nTo: ${recipient.first_name} (${recipientEmail})\nRef: ${transferResult.reference}\n\n💡 Type "balance" to see updated balance.` 
                });

                // Notify recipient (if they're a bot user)
                const recipientPhone = recipient.phone + '@s.whatsapp.net';
                try {
                    await sock.sendMessage(recipientPhone, { 
                        text: `🎉 **Payment Received!**\n\nReceived: ${displayAmount}\nFrom: ${user.first_name} (${user.email})\nRef: ${transferResult.reference}\n\n💡 Type "balance" to see updated balance.` 
                    });
                } catch (notifyError) {
                    console.log('Could not notify recipient:', notifyError.message);
                }

            } catch (err) {
                console.error('Transfer error:', err.message);
                if (err.message === 'Insufficient balance') {
                    await sock.sendMessage(from, { 
                        text: '❌ Insufficient balance. Please deposit funds first or check your balance.' 
                    });
                } else {
                    await sock.sendMessage(from, { 
                        text: `❌ Transfer failed: ${err.message}` 
                    });
                }
            }

        } else if (text === 'history') {
            try {
                const transactions = database.getTransactionHistory(user.id, 10);
                
                if (transactions.length === 0) {
                    await sock.sendMessage(from, { 
                        text: '📋 **Transaction History**\n\nNo transactions yet.\n\n💡 Start by depositing funds or receiving from other users!' 
                    });
                    return;
                }

                let historyMsg = `📋 **Transaction History** (Last ${transactions.length})\n\n`;
                
                transactions.forEach((tx, index) => {
                    const date = new Date(tx.created_at).toLocaleDateString();
                    const time = new Date(tx.created_at).toLocaleTimeString();
                    
                    let amount, direction, otherParty;
                    
                    if (tx.type === 'deposit') {
                        direction = '⬇️ Received';
                        otherParty = 'Deposit';
                        amount = tx.currency === 'btc' ? `${tx.amount} sats` : `$${(tx.amount/100).toFixed(2)}`;
                    } else if (tx.from_user_id === user.id) {
                        direction = '⬆️ Sent';
                        otherParty = tx.receiver_name || 'Unknown';
                        amount = tx.currency === 'btc' ? `${tx.amount} sats` : `$${(tx.amount/100).toFixed(2)}`;
                    } else {
                        direction = '⬇️ Received';
                        otherParty = tx.sender_name || 'Unknown';
                        amount = tx.currency === 'btc' ? `${tx.amount} sats` : `$${(tx.amount/100).toFixed(2)}`;
                    }
                    
                    historyMsg += `${index + 1}. ${direction} ${amount}\n`;
                    historyMsg += `   ${otherParty} • ${date} ${time}\n`;
                    if (tx.reference) historyMsg += `   Ref: ${tx.reference}\n`;
                    historyMsg += '\n';
                });

                await sock.sendMessage(from, { text: historyMsg });
                
            } catch (err) {
                console.error('History error:', err.message);
                await sock.sendMessage(from, { 
                    text: '❌ Unable to load transaction history. Please try again.' 
                });
            }

        } else if (text === 'help') {
            await sock.sendMessage(from, { 
                text: `📋 **Bitnob WhatsApp Bot Commands**\n\n💰 **Balance & Deposits:**\n• "balance" - Check BTC/USDT balances\n• "deposit btc" - Get Bitcoin address\n• "deposit usdt" - Get USDT address\n\n💸 **Send Money:**\n• "send 1000 sats to user@email.com"\n• "send 0.001 btc to user@email.com"\n• "send 50 usdt to user@email.com"\n\n📊 **History:**\n• "history" - View recent transactions\n\n❓ **Support:**\n• "help" - Show this menu\n\n🚀 Ready to send some sats?` 
            });

        } else {
            await sock.sendMessage(from, { 
                text: `❓ Unknown command: "${text}"\n\n💡 Type "help" to see available commands.` 
            });
        }

    } catch (error) {
        console.error('Error handling message:', error);
        await sock.sendMessage(from, { 
            text: '🚫 Something went wrong. Please try again or contact support.' 
        });
    }
}

async function main() {
    console.log('🚀 Starting Bitnob WhatsApp Bot...');
    await connectToWhatsApp(handleMessage);
}

main().catch(console.error);
