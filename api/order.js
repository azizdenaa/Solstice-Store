// api/order.js
// Serverless handler for Vercel (or any Node environment that uses same signature)
// Receives POST /api/order, posts summary to Discord webhook, and returns a waLink

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

    const { orderId, product, price, username, contact, contactMethod, paymentMethod } = body;
    if (!username || !product) return res.status(400).json({ success: false, message: 'username and product required' });

    const savedOrderId = orderId || `SOL-${Date.now().toString(36).toUpperCase()}`;

    // Build message for Discord
    const lines = [
      `📦 Pesanan baru — ${savedOrderId}`,
      `Produk: ${product}`,
      `Total: Rp ${Number(price || 0).toLocaleString('id-ID')}`,
      `Username Roblox: ${username}`,
      `Kontak (${contactMethod || '-' }): ${contact || '-'}`,
      `Pembayaran: ${paymentMethod || '-'}`
    ];

    const discordPayload = { content: lines.join('\n') };
    const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

    if (!DISCORD_WEBHOOK) {
      console.warn('DISCORD_WEBHOOK not set — skipping Discord notification');
    } else {
      try {
        // Use global fetch (Node 18+ / Vercel). Fallback to require('node-fetch') if not available.
        const doFetch = typeof fetch === 'function' ? fetch : (await import('node-fetch')).default;
        const r = await doFetch(DISCORD_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discordPayload),
          // no timeout parameter here; hosting platform controls function timeout
        });
        if (r.status !== 204 && r.status !== 200) {
          const text = await r.text().catch(() => null);
          console.warn('Discord webhook returned', r.status, text);
        }
      } catch (err) {
        console.error('Failed to call Discord webhook', err?.message || err);
        // continue — do not fail order creation because webhook failed
      }
    }

    // Build waLink: prefer customer's WhatsApp when they selected it, otherwise admin number
    const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || '6285780024940';
    let phone = ADMIN_WHATSAPP;
    if (contactMethod === 'WhatsApp' && contact) phone = contact.replace(/\D/g, '');
    const text = encodeURIComponent(`Halo admin, saya ingin konfirmasi pesanan ${savedOrderId}.\nProduk: ${product}\nUsername: ${username}`);
    const waLink = `https://wa.me/${phone}?text=${text}`;

    return res.status(201).json({ success: true, orderId: savedOrderId, waLink });
  } catch (err) {
    console.error('api/order error', err);
    return res.status(500).json({ success: false, message: 'gagal membuat pesanan' });
  }
};
