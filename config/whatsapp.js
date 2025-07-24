const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

async function connectToWhatsApp(onMessageCallback) {
    // ensure we use the WhatsApp Web version that matches the server
    const { version } = await fetchLatestBaileysVersion();

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        version,
        auth: state,
        // we’ll display QR manually below, printQRInTerminal is deprecated
        syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log('📱  Scan the QR code above to link your bot number');
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp connected!');
        }

        if (connection === 'close') {
            const code = (lastDisconnect?.error)?.output?.statusCode;
            console.warn('⚠️  Connection closed. Code:', code, 'Reason:', DisconnectReason[code] || 'unknown');

            // If not logged out, try to reconnect automatically
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWhatsApp(onMessageCallback), 5_000);
            } else {
                console.log('Session logged out. Delete auth_info directory & restart to relink.');
            }
        }
    });
    sock.ev.on('messages.upsert', (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        onMessageCallback(sock, msg);
    });

    return sock;
}

module.exports = { connectToWhatsApp }; 