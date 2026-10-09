const express = require("express");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
      shopifyTest: "GET /test-shopify"
    }
  });
});

/*
========================================
BOOKING
========================================
*/

app.post("/api/bookings", (req, res) => {
  console.log("");
  console.log("=================================");
  console.log("       BOOKING RECEIVED");
  console.log("=================================");
  console.log(req.body);
  console.log("=================================");
  console.log("");

  res.json({
    success: true,
    message: "Booking received successfully",
    booking: req.body
  });
});

/*
========================================
SHOPIFY STATUS
========================================
*/

app.get("/api/shopify-status", (req, res) => {
  res.json({
    authenticated: false,
    message: "Shopify authentication not connected yet."
  });
});

/*
========================================
SHOPIFY TEST
========================================
*/

app.get("/test-shopify", async (req, res) => {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    console.log("");
    console.log("=================================");
    console.log("TESTING SHOPIFY");
    console.log("=================================");
    console.log("Shop:", shop);
    console.log("Client ID loaded:", !!clientId);
    console.log("Client Secret loaded:", !!clientSecret);

    const response = await fetch(
      `https://${shop}.myshopify.com/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret
        })
      }
    );

    const data = await response.json();

    console.log("Shopify status:", response.status);
    console.log("Shopify response:", data);

    res.json({
      success: response.ok,
      status: response.status,
      hasAccessToken: !!data.access_token,
      scope: data.scope || null,
      expires_in: data.expires_in || null,
      error: data.error || null,
      error_description: data.error_description || null
    });

  } catch (error) {
    console.error("Shopify test error:", error);

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
  console.log("");
  console.log("=================================");
  console.log("Nutrify Booking Backend");
  console.log("=================================");
  console.log(`Server running on http://localhost:${PORT}`);
  console.log("=================================");
  console.log("");
});


app.get("/test-metaobject", async (req, res) => {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    // Get a Shopify access token
    const tokenResponse = await fetch(
      `https://${shop}.myshopify.com/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret
        })
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(500).json({
        success: false,
        step: "Shopify authentication",
        error: tokenData
      });
    }

    // Retrieve the existing Metaobject definition
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

    const response = await fetch(
      `https://${shop}.myshopify.com/admin/api/2026-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": tokenData.access_token
        },
        body: JSON.stringify({ query })
      }
    );

    const data = await response.json();

    console.log(JSON.stringify(data, null, 2));

    res.status(response.ok ? 200 : 500).json({
      success: response.ok && !data.errors,
      data
    });

  } catch (error) {
    console.error("Metaobject test error:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
