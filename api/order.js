/**
 * Solstice Store order notification API.
 *
 * Flow yang dipakai:
 * - customer memilih produk
 * - mengisi username Roblox
 * - memilih kontak WhatsApp / Discord
 * - transfer sesuai total
 * - klik Saya Sudah Transfer
 * - server validasi data dan mengirim notifikasi ke Discord
 *
 * Tidak ada status tracking, database, atau admin endpoint.
 * Semua response API wajib berbentuk JSON.
 */

const PRODUCTS = Object.freeze({
  "50 Robux": 8000,
  "100 Robux": 16000,
  "200 Robux": 32000,
  "300 Robux": 48000,
  "500 Robux": 65000,
  "1.000 Robux": 130000,
  "1.500 Robux": 240000,
  "2.000 Robux": 320000,
  "3.000 Robux": 480000,
  "4.000 Robux": 640000,
  "5.000 Robux": 800000,
  "6.000 Robux": 960000,
  "7.000 Robux": 1120000,
  "8.000 Robux": 1280000,
  "9.000 Robux": 1440000,
  "10.000 Robux": 1600000,
});

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.json(payload);
}

function getRequestBody(req) {
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return null;
}

function validOrderId(value) {
  return typeof value === "string" && /^SOL-[A-Z0-9]{6,32}$/.test(value);
}

function validContact(method, value) {
  if (typeof value !== "string") return false;

  const cleaned = value.trim();
  if (cleaned.length < 3 || cleaned.length > 80) return false;

  if (method === "WhatsApp") {
    return /^[0-9+ ()-]{7,25}$/.test(cleaned);
  }

  if (method === "Discord") {
    return /^[A-Za-z0-9_.-]{2,40}(#[0-9]{4})?$/.test(cleaned);
  }

  return false;
}

async function notifyDiscord(order) {
  if (!process.env.DISCORD_WEBHOOK_URL) {
    throw new Error("DISCORD_WEBHOOK_URL belum dikonfigurasi di Vercel.");
  }

  const payload = {
    embeds: [
      {
        title: "🧾 Order Baru — Menunggu Konfirmasi Pembayaran",
        color: 3447003,
        fields: [
          { name: "No. Pesanan", value: order.orderId, inline: true },
          { name: "Username Roblox", value: order.username, inline: true },
          { name: "Produk", value: order.product, inline: false },
          { name: "Nominal", value: order.amount.toLocaleString("id-ID"), inline: true },
          { name: "Metode Pembayaran", value: order.paymentMethod, inline: true },
          { name: `Kontak ${order.contactMethod}`, value: order.contact, inline: false },
          {
            name: "Keterangan",
            value: "Customer menyatakan sudah transfer. Mohon cocokkan pembayaran dan No. Pesanan sebelum diproses.",
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Discord webhook menolak request.");
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, {
      ok: false,
      message: "Method tidak diizinkan. Gunakan POST.",
    });
  }

  if (!process.env.DISCORD_WEBHOOK_URL) {
    return sendJson(res, 500, {
      ok: false,
      message: "DISCORD_WEBHOOK_URL belum dikonfigurasi di Vercel.",
    });
  }

  let input;
  try {
    input = getRequestBody(req);
  } catch (_error) {
    return sendJson(res, 400, {
      ok: false,
      message: "Request body harus berupa JSON yang valid.",
    });
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return sendJson(res, 400, {
      ok: false,
      message: "Request body harus berupa object JSON.",
    });
  }

  const { orderId, username, product, amount, paymentMethod, contactMethod, contact } = input;
  const numericAmount = typeof amount === "number" ? amount : Number(amount);

  if (!validOrderId(orderId)) {
    return sendJson(res, 400, {
      ok: false,
      message: "No. Pesanan tidak valid.",
    });
  }

  if (typeof username !== "string" || !/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return sendJson(res, 400, {
      ok: false,
      message: "Username Roblox tidak valid.",
    });
  }

  if (typeof product !== "string" || PRODUCTS[product] === undefined) {
    return sendJson(res, 400, {
      ok: false,
      message: "Produk tidak valid.",
    });
  }

  if (!Number.isSafeInteger(numericAmount) || PRODUCTS[product] !== numericAmount) {
    return sendJson(res, 400, {
      ok: false,
      message: "Nominal produk tidak valid.",
    });
  }

  if (paymentMethod !== "SeaBank") {
    return sendJson(res, 400, {
      ok: false,
      message: "Metode pembayaran tidak valid.",
    });
  }

  if (!["WhatsApp", "Discord"].includes(contactMethod) || !validContact(contactMethod, contact)) {
    return sendJson(res, 400, {
      ok: false,
      message: "Kontak WhatsApp atau Discord tidak valid.",
    });
  }

  const order = {
    orderId,
    username,
    product,
    amount: numericAmount,
    paymentMethod,
    contactMethod,
    contact: contact.trim(),
  };

  try {
    await notifyDiscord(order);
    return sendJson(res, 201, {
      ok: true,
      orderId,
      message: "No. Pesanan berhasil dikirim ke admin.",
    });
  } catch (_error) {
    return sendJson(res, 502, {
      ok: false,
      message: "No. Pesanan belum terkirim ke Discord. Silakan coba lagi.",
    });
  }
}
