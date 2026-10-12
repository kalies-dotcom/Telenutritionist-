
require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const INFINITY_API_URL =
  "https://dev.infinityconnect.ai/config-service/api/v1/public/templates/appoinment-fixed-message/send";

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

app.get("/api/shopify-status", (req, res) => {
  res.json({
    authenticated: false,
    message:
      "Shopify authentication is not configured in this version. Bookings are sent directly to Infinity Connect."
  });
});

/*
========================================
SEND BOOKING TO INFINITY CONNECT
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

    // Validate the required booking details.
    if (
      !customer_name ||
      !whatsapp_number ||
      !booking_date ||
      !booking_time
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: customer_name, whatsapp_number, booking_date and booking_time."
      });
    }

    // Validate the booking date format.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(booking_date))) {
      return res.status(400).json({
        success: false,
        message: "booking_date must use YYYY-MM-DD format."
      });
    }

    // Validate Infinity Connect credentials.
    const apiKey = process.env.INFINITY_API_KEY;
    const senderId = process.env.INFINITY_SENDER_ID;

    if (!apiKey || !senderId) {
      console.error("Infinity Connect credentials are missing.");

      return res.status(500).json({
        success: false,
        message: "WhatsApp service is not configured."
      });
    }

    // Send the appointment message.
    const infinityResponse = await fetch(INFINITY_API_URL, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        channel: "whatsapp",
        senderId,
        to: String(whatsapp_number).trim(),
        variables: [
          String(customer_name).trim(),
          String(booking_date).trim(),
          String(booking_time).trim()
        ]
      })
    });

    const responseText = await infinityResponse.text();

    let providerResponse = responseText;

    try {
      providerResponse = responseText
        ? JSON.parse(responseText)
        : null;
    } catch {
      // The provider returned plain text rather than JSON.
    }

    if (!infinityResponse.ok) {
      console.error(
        "Infinity Connect API error:",
        infinityResponse.status,
        responseText
      );

      return res.status(502).json({
        success: false,
        message:
          "Infinity Connect rejected the appointment message.",
        provider_status: infinityResponse.status
      });
    }

    console.log(
      "Infinity Connect accepted the booking message:",
      booking_date,
      booking_time
    );

    return res.status(200).json({
      success: true,
      message:
        "Appointment message accepted by Infinity Connect.",
      booking: {
        customer_name: String(customer_name).trim(),
        customer_email: customer_email || null,
        whatsapp_number: String(whatsapp_number).trim(),
        booking_date,
        booking_time,
        nutritionist_name: nutritionist_name || null
      },
      infinity_response: providerResponse
    });
  } catch (error) {
    console.error(
      "Failed to send appointment message:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to process the appointment message."
    });
  }
});

/*
========================================
SHOPIFY TEST ENDPOINT
========================================
*/

app.get("/test-shopify", (req, res) => {
  res.json({
    success: false,
    message:
      "Shopify authentication testing is disabled in this version."
  });
});

/*
========================================
METAOBJECT TEST ENDPOINT
========================================
*/

app.get("/test-metaobject", (req, res) => {
  res.json({
    success: false,
    message:
      "Metaobject testing is disabled because bookings are no longer saved to Shopify."
  });
});

/*
========================================
START SERVER
========================================
*/

if (require.main === module) {
  app.listen(PORT, () => {
    console.log("Nutrify Booking Backend");
    console.log(`Server running on port ${PORT}`);
    console.log("Infinity Connect integration enabled");
  });
}

module.exports = app;