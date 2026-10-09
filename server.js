
const express = require("express");
require("dotenv").config();
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = "2026-10";

function validateConfig() {
  if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Missing SHOPIFY_SHOP, SHOPIFY_CLIENT_ID, or SHOPIFY_CLIENT_SECRET in .env"
    );
  }
}

async function getShopifyAccessToken() {
  validateConfig();

  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      `Shopify authentication failed: ${JSON.stringify(data)}`
    );
  }

  return data.access_token;
}

async function shopifyGraphQL(query, variables = {}) {
  const accessToken = await getShopifyAccessToken();

  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const data = await response.json();

  if (!response.ok || data.errors?.length) {
    throw new Error(
      `Shopify GraphQL error: ${JSON.stringify(data.errors || data)}`
    );
  }

  return data.data;
}

/*
========================================
HOME
========================================
*/

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

/*
========================================
SHOPIFY STATUS
========================================
*/

app.get("/api/shopify-status", async (req, res) => {
  try {
    await getShopifyAccessToken();

    res.json({
      authenticated: true,
      message: "Shopify authentication successful"
    });
  } catch (error) {
    res.status(500).json({
      authenticated: false,
      error: error.message
    });
  }
});

/*
========================================
CREATE BOOKING IN SHOPIFY METAOBJECT
========================================
*/

app.post("/api/bookings", async (req, res) => {
  try {
    const {
      customer_name,
      customer_email,
      whatsapp_number,
      booking_date,
      booking_time,
      nutritionist_name
    } = req.body || {};

    if (
      !customer_name ||
      !customer_email ||
      !whatsapp_number ||
      !booking_date ||
      !booking_time ||
      !nutritionist_name
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required booking fields.",
        required: [
          "customer_name",
          "customer_email",
          "whatsapp_number",
          "booking_date",
          "booking_time",
          "nutritionist_name"
        ]
      });
    }

    // Validate the date format expected by Shopify's date field.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
      return res.status(400).json({
        success: false,
        message: "booking_date must use YYYY-MM-DD format."
      });
    }

    const now = new Date().toISOString();
    const bookingId =
      `NB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const fields = [
      { key: "booking_id", value: bookingId },
      { key: "customer_name", value: String(customer_name).trim() },
      { key: "customer_email", value: String(customer_email).trim() },
      { key: "whatsapp_number", value: String(whatsapp_number).trim() },
      { key: "booking_date", value: booking_date },
      { key: "booking_time", value: String(booking_time).trim() },
      { key: "timezone", value: "Asia/Kolkata" },
      { key: "nutritionist_name", value: String(nutritionist_name).trim() },
      { key: "status", value: "confirmed" },
      { key: "infinity_status", value: "pending" },
      { key: "infinity_message_id", value: "" },
      { key: "created_at", value: now },
      { key: "infinity_error", value: "" },
      { key: "updated_at", value: now }
    ];

    const mutation = `
      mutation CreateConsultationBooking(
        $metaobject: MetaobjectCreateInput!
      ) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject {
            id
            handle
            type
            fields {
              key
              value
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const result = await shopifyGraphQL(mutation, {
      metaobject: {
        type: "consultation_booking",
        handle: bookingId.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        fields
      }
    });

    const creation = result.metaobjectCreate;

    if (creation.userErrors?.length || !creation.metaobject) {
      console.error("Metaobject creation errors:", creation.userErrors);

      return res.status(400).json({
        success: false,
        message: "Shopify did not create the booking.",
        errors: creation.userErrors
      });
    }

    console.log("Booking saved to Shopify:", bookingId);
    console.log("Metaobject ID:", creation.metaobject.id);

    return res.status(201).json({
      success: true,
      message: "Booking saved to Shopify successfully.",
      booking_id: bookingId,
      metaobject_id: creation.metaobject.id,
      handle: creation.metaobject.handle,
      booking: {
        customer_name,
        customer_email,
        whatsapp_number,
        booking_date,
        booking_time,
        nutritionist_name,
        status: "confirmed",
        infinity_status: "pending"
      }
    });
  } catch (error) {
    console.error("Booking creation failed:", error);

    return res.status(500).json({
      success: false,
      message: "Could not save booking to Shopify.",
      error: error.message
    });
  }
});

/*
========================================
SHOPIFY AUTHENTICATION TEST
========================================
*/

app.get("/test-shopify", async (req, res) => {
  try {
    const accessToken = await getShopifyAccessToken();

    res.json({
      success: true,
      status: 200,
      hasAccessToken: Boolean(accessToken),
      message: "Shopify authentication successful"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/*
========================================
METAOBJECT DEFINITION TEST
========================================
*/

app.get("/test-metaobject", async (req, res) => {
  try {
    const query = `
      query GetConsultationBookingDefinition {
        metaobjectDefinitionByType(type: "consultation_booking") {
          id
          name
          type
          fieldDefinitions {
            key
            name
            type {
              name
            }
            required
          }
        }
      }
    `;

    const data = await shopifyGraphQL(query);
    const definition = data.metaobjectDefinitionByType;

    if (!definition) {
      return res.status(404).json({
        success: false,
        message: "Metaobject definition consultation_booking was not found."
      });
    }

    res.json({
      success: true,
      definition
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/*
========================================
START SERVER
========================================
*/

app.listen(PORT, () => {
  console.log("=================================");
  console.log("Nutrify Booking Backend");
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("=================================");
});
