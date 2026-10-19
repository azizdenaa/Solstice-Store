// api/order.js
// Improved Discord webhook delivery: server-side product mapping, validation, retry, and diagnostics.

const crypto = require('crypto');

async function getFetch() {
  if (typeof fetch === 'function') return fetch;
  try {
    const mod = await import('node-fetch');
    return mod.default || mod;
  } catch (e) {
    throw new Error('fetch not available and node-fetch import failed: ' + e.message);
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

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

    const embed = {
      title: `📦 Pesanan baru — ${orderId}`,
      description: `${product.name} (id: ${productId})`,
      color: 0x6b2cff,
      fields: [
        { name: 'Total', value: formatRupiah(amount), inline: true },
        { name: 'Pembayaran', value: paymentMethod, inline: true },
        { name: 'Username Roblox', value: username, inline: false },
        { name: 'Metode Kontak', value: contactMethod, inline: true }
      ],
      timestamp: new Date().toISOString()
    };
    if (contactMethod === 'WhatsApp') embed.fields.push({ name: 'WhatsApp', value: whatsapp, inline: true });
    if (contactMethod === 'Discord') embed.fields.push({ name: 'Discord', value: discordUsername, inline: true });

    const discordPayload = { embeds: [embed] };
    const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

    let webhookDiagnostic = { called: false, attempts: [] };

    if (DISCORD_WEBHOOK) {
      const fetchImpl = await getFetch();
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          webhookDiagnostic.called = true;
          const r = await fetchImpl(DISCORD_WEBHOOK, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'SolsticeStore/1.0 (+https://your-site.example)'
            },
            body: JSON.stringify(discordPayload),
          });
          const text = await r.text().catch(() => null);
          webhookDiagnostic.attempts.push({ attempt, status: r.status, body: text });
          if (r.status === 204 || r.status === 200) break;
        } catch (err) {
          webhookDiagnostic.attempts.push({ attempt, error: String(err?.message || err) });
        }
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
      'Halo Admin Solstice Store,', '',
      'Saya ingin mengonfirmasi pesanan.', '',
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

    return res.status(201).json({ success: true, orderId, amount, amountFormatted: formatRupiah(amount), waLink, webhook: webhookDiagnostic });

  } catch (err) {
    console.error('api/order error', err);
    return res.status(500).json({ success: false, message: 'gagal membuat pesanan' });
  }
};

function formatRupiah(amount) {
  return 'Rp ' + String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
