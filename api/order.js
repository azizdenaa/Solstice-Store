// api/order.js
// Serverless handler for Vercel — improved validation and price security.
// Added webhook diagnostics in the response to help debug Discord webhook issues.

const crypto = require('crypto');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    // parse body (Vercel provides req.body for JSON)
    const body = req.body || (await new Promise((r) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => {
        try { r(JSON.parse(data)); } catch (e) { r({}); }
      });
    }));

    const { productId: incomingProductId, product: incomingProductName, username } = body || {};
    let { contactMethod, whatsapp, discordUsername, paymentMethod } = body || {};

    const PRODUCTS = {
      "50": { name: "50 Robux", amount: 9898 },
      "100": { name: "100 Robux", amount: 16585 },
      "200": { name: "200 Robux", amount: 33170 },
      "300": { name: "300 Robux", amount: 49755 },
      "400": { name: "400 Robux", amount: 66340 },
      "500": { name: "500 Robux", amount: 82500 },
      "600": { name: "600 Robux", amount: 99510 },
      "700": { name: "700 Robux", amount: 116095 },
      "800": { name: "800 Robux", amount: 132680 },
      "900": { name: "900 Robux", amount: 149265 },
      "1000": { name: "1000 Robux", amount: 165850 }
    };

    // Determine productId
    let productId = incomingProductId;
    if (!productId && incomingProductName) {
      const digits = (String(incomingProductName).match(/[0-9\.]+/) || [null])[0];
      if (digits) {
        const normalized = String(digits).replace(/\./g, '');
        if (normalized) productId = normalized;
      }
    }

    if (!productId || !(productId in PRODUCTS)) {
      return res.status(400).json({ success: false, message: 'productId tidak valid' });
    }

    if (!username || String(username).trim().length === 0) {
      return res.status(400).json({ success: false, message: 'username tidak boleh kosong' });
    }

    if (!contactMethod || !['WhatsApp', 'Discord'].includes(contactMethod)) {
      return res.status(400).json({ success: false, message: 'contactMethod harus WhatsApp atau Discord' });
    }

    if (contactMethod === 'WhatsApp') {
      if (!whatsapp || String(whatsapp).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Nomor WhatsApp wajib diisi saat contactMethod = WhatsApp' });
      }
      const digits = String(whatsapp).replace(/\D/g, '');
      if (!/^[0-9]{9,15}$/.test(digits)) {
        return res.status(400).json({ success: false, message: 'Nomor WhatsApp tidak valid (harus berisi 9–15 digit angka)' });
      }
      whatsapp = digits;
      discordUsername = undefined;
    } else {
      if (!discordUsername || String(discordUsername).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Username Discord wajib diisi saat contactMethod = Discord' });
      }
      whatsapp = undefined;
    }

    if (!paymentMethod || !['SeaBank', 'QRIS'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'paymentMethod harus SeaBank atau QRIS' });
    }

    const product = PRODUCTS[productId];
    const amount = product.amount;
    const orderId = `SOL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const lines = [
      `📦 Pesanan baru — ${orderId}`,
      `Produk: ${product.name} (id: ${productId})`,
      `Total: ${formatRupiah(amount)}`,
      `Username Roblox: ${username}`,
      `Metode Kontak: ${contactMethod}`
    ];
    if (contactMethod === 'WhatsApp') lines.push(`WhatsApp: ${whatsapp}`);
    if (contactMethod === 'Discord') lines.push(`Discord: ${discordUsername}`);
    lines.push(`Pembayaran: ${paymentMethod}`);

    const discordPayload = { content: lines.join('\n') };
    const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

    // collect webhook diagnostics to return for debugging
    let webhookDiagnostic = { called: false };

    if (DISCORD_WEBHOOK) {
      try {
        const doFetch = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;
        webhookDiagnostic.called = true;
        const r = await doFetch(DISCORD_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discordPayload)
        });
        webhookDiagnostic.status = r.status;
        try { webhookDiagnostic.body = await r.text(); } catch (e) { webhookDiagnostic.body = null; }
        if (r.status !== 204 && r.status !== 200) {
          console.warn('Discord webhook returned', r.status, webhookDiagnostic.body);
        }
      } catch (err) {
        webhookDiagnostic.error = String(err?.message || err);
        console.warn('Failed to call Discord webhook:', webhookDiagnostic.error);
      }
    } else {
      webhookDiagnostic.called = false;
      webhookDiagnostic.error = 'DISCORD_WEBHOOK not configured';
      console.warn('DISCORD_WEBHOOK not set — skipping Discord notification');
    }

    const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || '6285780024940';

    let contactLine = '';
    if (contactMethod === 'WhatsApp') contactLine = `WhatsApp: ${whatsapp}`;
    if (contactMethod === 'Discord') contactLine = `Discord: ${discordUsername}`;

    const messageLines = [
      'Halo Admin Solstice Store,', '', 'Saya ingin mengonfirmasi pesanan.', '',
      `Order ID: ${orderId}`, `Username Roblox: ${username}`, `Produk: ${product.name}`, `Total: ${formatRupiah(amount)}`, `Metode Pembayaran: ${paymentMethod}`, '', 'Metode Kontak:', contactLine
    ];

    const encoded = encodeURIComponent(messageLines.join('\n'));
    const waLink = `https://wa.me/${ADMIN_WHATSAPP}?text=${encoded}`;

    // Return created order data including webhook diagnostics for debugging
    return res.status(201).json({ success: true, orderId, amount, amountFormatted: formatRupiah(amount), waLink, webhook: webhookDiagnostic });

  } catch (err) {
    console.error('api/order error', err);
    return res.status(500).json({ success: false, message: 'gagal membuat pesanan' });
  }
};

function formatRupiah(amount){
  return 'Rp ' + String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
