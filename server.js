
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const INFINITY_API_URL =
  "https://dev.infinityconnect.ai/config-service/api/v1/public/templates/appoinment-fixed-message/send";

const SHOPIFY_API_VERSION = "2026-07";
const METAOBJECT_TYPE = "consultation_booking";

let cachedShopifyToken = null;
let tokenExpiresAt = 0;

function getShopDomain() {
  const shop = (process.env.SHOPIFY_SHOP || "").trim();
  return shop
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

async function getShopifyToken() {
  if (cachedShopifyToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedShopifyToken;
  }

  const shop = getShopDomain();
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!shop || !clientId || !clientSecret) {
    throw new Error("Shopify environment variables are missing.");
  }

  const response = await fetch(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
      })
    }
  );

  const result = await response.json();

  if (!response.ok || !result.access_token) {
    console.error("Shopify token request failed:", response.status);
    throw new Error("Shopify authentication failed.");
  }

  cachedShopifyToken = result.access_token;
  tokenExpiresAt =
    Date.now() + Number(result.expires_in || 86400) * 1000;

  return cachedShopifyToken;
}

async function shopifyGraphQL(query, variables = {}) {
  const shop = getShopDomain();
  const token = await getShopifyToken();

  const response = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const result = await response.json();

  if (!response.ok || result.errors?.length) {
    console.error(
      "Shopify GraphQL request failed:",
      response.status,
      JSON.stringify(result.errors || [])
    );
    throw new Error("Shopify API request failed.");
  }

  return result.data;
}

async function getMetaobjectDefinition() {
  const data = await shopifyGraphQL(
    `query BookingDefinition($type: String!) {
      metaobjectDefinitionByType(type: $type) {
        id
        type
        fieldDefinitions {
          key
          type {
            name
          }
          required
        }
      }
    }`,
    { type: METAOBJECT_TYPE }
  );

  const definition = data.metaobjectDefinitionByType;

  if (!definition) {
    throw new Error("consultation_booking definition not found.");
  }

  return definition;
}

async function createBookingMetaobject(booking) {
  const definition = await getMetaobjectDefinition();
  const fieldKeys = new Set(
    definition.fieldDefinitions.map(field => field.key)
  );

  const now = new Date().toISOString();

  const values = {
    booking_id: booking.booking_id,
    customer_name: booking.customer_name,
    customer_email: booking.customer_email || "Not provided",
    whatsapp_number: booking.whatsapp_number,
    booking_date: booking.booking_date,
    booking_time: booking.booking_time,
    timezone: booking.timezone,
    nutritionist_name: booking.nutritionist_name || "Not assigned",
    status: "pending",
    infinity_status: "pending",
    infinity_message_id: "pending",
    created_at: now,
    infinity_error: "None",
    updated_at: now
  };

  const fields = Object.entries(values)
    .filter(([key]) => fieldKeys.has(key))
    .map(([key, value]) => ({
      key,
      value: String(value)
    }));

  const missing = definition.fieldDefinitions
    .filter(field => field.required)
    .filter(field => {
      const item = fields.find(entry => entry.key === field.key);
      return !item || !item.value.trim();
    });

  if (missing.length) {
    throw new Error(
      `Required metaobject fields missing: ${missing.map(f => f.key).join(", ")}`
    );
  }

  const data = await shopifyGraphQL(
    `mutation CreateBooking($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      metaobject: {
        type: METAOBJECT_TYPE,
        fields
      }
    }
  );

  const result = data.metaobjectCreate;

  if (result.userErrors?.length || !result.metaobject) {
    console.error(
      "Metaobject creation errors:",
      JSON.stringify(result.userErrors || [])
    );
    throw new Error("Shopify could not create the booking.");
  }

  return result.metaobject;
}

async function updateBookingMetaobject(id, values) {
  const definition = await getMetaobjectDefinition();
  const fieldKeys = new Set(
    definition.fieldDefinitions.map(field => field.key)
  );

  const fields = Object.entries(values)
    .filter(([key]) => fieldKeys.has(key))
    .map(([key, value]) => ({
      key,
      value: String(value)
    }));

  const data = await shopifyGraphQL(
    `mutation UpdateBooking($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      id,
      metaobject: { fields }
    }
  );

  const result = data.metaobjectUpdate;

  if (result.userErrors?.length || !result.metaobject) {
    console.error(
      "Metaobject update errors:",
      JSON.stringify(result.userErrors || [])
    );
    throw new Error("Shopify could not update the booking.");
  }
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Nutrify Booking Backend is running",
    endpoints: {
      booking: "POST /api/bookings",
      status: "GET /api/shopify-status",
      shopifyTest: "GET /test-shopify",
      metaobjectTest: "GET /test-metaobject"
    }
  });
});

app.get("/api/config-check", (req, res) => {
  res.json({
    infinityApiKeyPresent: Boolean(
      process.env.INFINITY_API_KEY_NEW?.trim()
    ),
    infinitySenderIdPresent: Boolean(
      process.env.INFINITY_SENDER_ID?.trim()
    ),
    shopifyConfigured: Boolean(
      process.env.SHOPIFY_SHOP &&
      process.env.SHOPIFY_CLIENT_ID &&
      process.env.SHOPIFY_CLIENT_SECRET
    ),
    nodeEnvironment: process.env.NODE_ENV || "not set"
  });
});

app.get("/api/shopify-status", async (req, res) => {
  try {
    const definition = await getMetaobjectDefinition();

    res.json({
      authenticated: true,
      metaobjectDefinitionFound: true,
      type: definition.type,
      fieldCount: definition.fieldDefinitions.length
    });
  } catch (error) {
    console.error("Shopify status check failed:", error.message);

    res.status(500).json({
      authenticated: false,
      message: "Shopify connection or metaobject check failed."
    });
  }
});

app.get("/test-shopify", async (req, res) => {
  try {
    await getShopifyToken();
    res.json({ success: true, message: "Shopify authentication succeeded." });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Shopify authentication failed."
    });
  }
});

app.get("/test-metaobject", async (req, res) => {
  try {
    const definition = await getMetaobjectDefinition();

    res.json({
      success: true,
      type: definition.type,
      fields: definition.fieldDefinitions.map(field => ({
        key: field.key,
        required: field.required
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Unable to read the metaobject definition."
    });
  }
});

app.post("/api/bookings", async (req, res) => {
  let savedBooking = null;

  try {
    const {
      customer_name,
      customer_email,
      whatsapp_number,
      booking_date,
      booking_time,
      nutritionist_name,
      timezone
    } = req.body || {};

    if (
      !customer_name?.trim() ||
      !whatsapp_number?.trim() ||
      !booking_date ||
      !booking_time
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, WhatsApp number, booking date and booking time are required."
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(booking_date))) {
      return res.status(400).json({
        success: false,
        message: "booking_date must use YYYY-MM-DD format."
      });
    }

    if (!process.env.INFINITY_API_KEY_NEW ||
        !process.env.INFINITY_SENDER_ID) {
      return res.status(500).json({
        success: false,
        message: "WhatsApp service is not configured."
      });
    }

    const booking = {
      booking_id: `NUT-${randomUUID()}`,
      customer_name: String(customer_name).trim(),
      customer_email: String(customer_email || "").trim(),
      whatsapp_number: String(whatsapp_number).trim(),
      booking_date: String(booking_date),
      booking_time: String(booking_time).trim(),
      timezone: String(timezone || "Asia/Lagos").trim(),
      nutritionist_name: String(nutritionist_name || "").trim()
    };

    // Save the booking first so a WhatsApp failure doesn't lose it.
    savedBooking = await createBookingMetaobject(booking);

    let infinityStatus = "sent";
    let infinityMessageId = "accepted";
    let infinityError = "None";

    try {
      const infinityResponse = await fetch(INFINITY_API_URL, {
        method: "POST",
        headers: {
          "X-API-Key": process.env.INFINITY_API_KEY_NEW,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          channel: "whatsapp",
          senderId: process.env.INFINITY_SENDER_ID,
          to: booking.whatsapp_number,
          variables: [
            booking.customer_name,
            booking.booking_date,
            booking.booking_time
          ]
        })
      });

      const responseText = await infinityResponse.text();
      let providerResponse = responseText;

      try {
        providerResponse = responseText ? JSON.parse(responseText) : null;
      } catch {}

      if (!infinityResponse.ok) {
        infinityStatus = "failed";
        infinityMessageId = "None";
        infinityError = `Infinity Connect HTTP ${infinityResponse.status}`;
      } else {
        const providerId =
          providerResponse?.messageId ||
          providerResponse?.message_id ||
          providerResponse?.id;

        if (providerId) infinityMessageId = String(providerId);
      }
    } catch (error) {
      infinityStatus = "failed";
      infinityMessageId = "None";
      infinityError = "Infinity Connect request failed";
    }

    let updateFailed = false;

    try {
      await updateBookingMetaobject(savedBooking.id, {
        status: "confirmed",
        infinity_status: infinityStatus,
        infinity_message_id: infinityMessageId,
        infinity_error: infinityError,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      updateFailed = true;
      console.error("Booking status update failed:", error.message);
    }

    return res.status(200).json({
      success: true,
      message: infinityStatus === "sent"
        ? "Booking saved to Shopify and WhatsApp message accepted."
        : "Booking saved to Shopify, but the WhatsApp message failed.",
      booking_id: booking.booking_id,
      metaobject_id: savedBooking.id,
      whatsapp_status: infinityStatus,
      status_update_failed: updateFailed
    });
  } catch (error) {
    console.error("Booking processing failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to save the booking. Please try again."
    });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log("Nutrify Booking Backend running on port", PORT);
  });
}

module.exports = app;
