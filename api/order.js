/**
 * Vercel Serverless Function untuk mengirim detail order ke Discord.
 *
 * Konfigurasikan DISCORD_WEBHOOK_URL pada Environment Variables di Vercel.
 */

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json");
  return res.json(payload);
}

function getRequestBody(req) {
  // Vercel biasanya sudah mem-parse request JSON menjadi object. Dukungan
  // terhadap string juga disediakan untuk konfigurasi/request yang belum diparse.
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  return null;
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
      message: "DISCORD_WEBHOOK_URL belum dikonfigurasi di environment Vercel.",
    });
  }

  let order;
  try {
    order = getRequestBody(req);
  } catch (_error) {
    return sendJson(res, 400, {
      ok: false,
      message: "Request body harus berupa JSON yang valid.",
    });
  }

  if (!order || typeof order !== "object" || Array.isArray(order)) {
    return sendJson(res, 400, {
      ok: false,
      message: "Request body order harus berupa object JSON.",
    });
  }

  const { orderId, username, product, amount, paymentMethod } = order;
  const requiredFields = { orderId, username, product, paymentMethod };
  const missingField = Object.entries(requiredFields).find(
    ([, value]) => typeof value !== "string" || value.trim() === ""
  );

  if (missingField) {
    return sendJson(res, 400, {
      ok: false,
      message: `Data wajib belum tersedia: ${missingField[0]}.`,
    });
  }

  const numericAmount =
    typeof amount === "number" ? amount : Number(String(amount).trim());

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return sendJson(res, 400, {
      ok: false,
      message: "amount harus berupa nominal angka yang valid dan lebih dari 0.",
    });
  }

  if (paymentMethod.trim() !== "SeaBank") {
    return sendJson(res, 400, {
      ok: false,
      message: "paymentMethod yang didukung hanya SeaBank.",
    });
  }

  const status = "MENUNGGU VERIFIKASI";
  const discordPayload = {
    embeds: [
      {
        title: "Order Baru",
        color: 3447003,
        fields: [
          { name: "Order ID", value: String(orderId).trim(), inline: true },
          { name: "Username", value: String(username).trim(), inline: true },
          { name: "Product", value: String(product).trim(), inline: false },
          {
            name: "Amount",
            value: numericAmount.toLocaleString("id-ID"),
            inline: true,
          },
          { name: "Payment Method", value: "SeaBank", inline: true },
          { name: "Status", value: status, inline: false },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const webhookResponse = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload),
    });

    if (!webhookResponse.ok) {
      return sendJson(res, 502, {
        ok: false,
        message: "Order gagal dikirim ke Discord.",
      });
    }

    return sendJson(res, 200, {
      ok: true,
      message: "Order berhasil dikirim",
      status,
    });
  } catch (_error) {
    return sendJson(res, 502, {
      ok: false,
      message: "Tidak dapat terhubung ke Discord webhook.",
    });
  }
}
