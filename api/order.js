// api/order.js
// Serverless handler for Vercel — improved validation and price security.
// - Server is the source of truth for product prices (PRODUCTS mapping)
// - Validates required fields and contact method-specific fields
// - Generates server-side orderId SOL-XXXXXX
// - Posts summary to Discord webhook (if set) but does NOT fail order on webhook error
// - Returns waLink that opens WhatsApp to the ADMIN number with a prefilled message

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

    // Accept either modern payload with productId OR legacy product name/price fallback
    // Expected modern payload:
    // { productId, username, contactMethod, whatsapp, discordUsername, paymentMethod }

    const { productId: incomingProductId, product: incomingProductName, price: incomingPrice, username } = body || {};
    let { contactMethod, whatsapp, discordUsername, paymentMethod } = body || {};

    // Server-side product price table (source of truth)
    const PRODUCTS = {
      // productId: { name, amount }
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

    // Determine productId: prefer explicit incomingProductId; otherwise try to infer from incomingProductName
    let productId = incomingProductId;
    if (!productId && incomingProductName) {
      // try to extract numeric part from product name like '400 Robux' or '1.000 Robux'
      const digits = (String(incomingProductName).match(/[0-9\.]+/) || [null])[0];
      if (digits) {
        const normalized = String(digits).replace(/\./g, '');
        if (normalized) productId = normalized;
      }
    }

    if (!productId || !(productId in PRODUCTS)) {
      return res.status(400).json({ success: false, message: 'productId tidak valid' });
    }

    // Validate username
    if (!username || String(username).trim().length === 0) {
      return res.status(400).json({ success: false, message: 'username tidak boleh kosong' });
    }

    // Validate contactMethod
    if (!contactMethod || !['WhatsApp', 'Discord'].includes(contactMethod)) {
      return res.status(400).json({ success: false, message: 'contactMethod harus WhatsApp atau Discord' });
    }

    // Normalize contact fields
    if (contactMethod === 'WhatsApp') {
      if (!whatsapp || String(whatsapp).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Nomor WhatsApp wajib diisi saat contactMethod = WhatsApp' });
      }
      const digits = String(whatsapp).replace(/\D/g, '');
      if (!/^[0-9]{9,15}$/.test(digits)) {
        return res.status(400).json({ success: false, message: 'Nomor WhatsApp tidak valid (harus berisi 9–15 digit angka)' });
      }
      // canonicalize to digits only for storage
      whatsapp = digits;
      // ensure discordUsername isn't used
      discordUsername = undefined;
    } else {
      // Discord
      if (!discordUsername || String(discordUsername).trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Username Discord wajib diisi saat contactMethod = Discord' });
      }
      // ensure whatsapp not used
      whatsapp = undefined;
    }

    // Validate payment method
    if (!paymentMethod || !['SeaBank', 'QRIS'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'paymentMethod harus SeaBank atau QRIS' });
    }

    // Server is the source of truth for price
    const product = PRODUCTS[productId];
    const amount = product.amount;

    // Generate server-side orderId for uniqueness (ignore any orderId sent by client)
    const orderId = `SOL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Build payload for Discord (do not include raw price from client)
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

    if (DISCORD_WEBHOOK) {
      try {
        const doFetch = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;
        const r = await doFetch(DISCORD_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discordPayload)
        });
        if (r.status !== 204 && r.status !== 200) {
          const text = await r.text().catch(() => null);
          console.warn('Discord webhook returned', r.status, text);
        }
      } catch (err) {
        console.warn('Failed to call Discord webhook:', err?.message || err);
      }
    }

    // Build waLink: ALWAYS open admin WhatsApp (ADMIN_WHATSAPP) with order details as required
    const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || '6285780024940';

    let contactLine = '';
    if (contactMethod === 'WhatsApp') contactLine = `WhatsApp: ${whatsapp}`;
    if (contactMethod === 'Discord') contactLine = `Discord: ${discordUsername}`;

    const messageLines = [
      'Halo Admin Solstice Store,',
      '',
      'Saya ingin mengonfirmasi pesanan.',
      '',
      `Order ID: ${orderId}`,
      `Username Roblox: ${username}`,
      `Produk: ${product.name}`,
      `Total: ${formatRupiah(amount)}`,
      `Metode Pembayaran: ${paymentMethod}`,
      '',
      'Metode Kontak:',
      contactLine
    ];

    const encoded = encodeURIComponent(messageLines.join('\n'));
    const waLink = `https://wa.me/${ADMIN_WHATSAPP}?text=${encoded}`;

    // Return created order data
    return res.status(201).json({ success: true, orderId, amount, amountFormatted: formatRupiah(amount), waLink });

  } catch (err) {
    console.error('api/order error', err);
    return res.status(500).json({ success: false, message: 'gagal membuat pesanan' });
  }
};

function formatRupiah(amount){
  return 'Rp ' + String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
