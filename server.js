
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const INFINITY_API_URL =
  "https://dev.infinityconnect.ai/config-service/api/v1/public/templates/appoinment-fixed-message/send";

// Supabase connection
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

const supabase =
  supabaseUrl && supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

// Health check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Nutrify Booking Backend is running",
    database: "Supabase",
    endpoints: {
      booking: "POST /api/bookings",
      databaseStatus: "GET /api/database-status",
      configCheck: "GET /api/config-check",
      dashboard: "GET /dashboard",
      dashboardBookings: "GET /api/dashboard/bookings"
    }
  });
});

// Serve dashboard HTML
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Check environment configuration without exposing secrets
app.get("/api/config-check", (req, res) => {
  res.json({
    supabaseConfigured: Boolean(supabase),
    infinityApiKeyPresent: Boolean(
      process.env.INFINITY_API_KEY_NEW?.trim()
    ),
    infinitySenderIdPresent: Boolean(
      process.env.INFINITY_SENDER_ID?.trim()
    ),
    nodeEnvironment: process.env.NODE_ENV || "not set"
  });
});

// Check Supabase connection
app.get("/api/database-status", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({
      success: false,
      message: "Supabase environment variables are missing."
    });
  }

  try {
    const { error } = await supabase
      .from("consultation_bookings")
      .select("id")
      .limit(1);

    if (error) {
      console.error("Supabase status check failed:", error.code);

      return res.status(500).json({
        success: false,
        message: "Unable to access the bookings table."
      });
    }

    return res.json({
      success: true,
      message: "Supabase connection successful.",
      table: "consultation_bookings"
    });
  } catch (error) {
    console.error("Database status check failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Database connection failed."
    });
  }
});

// Create a consultation booking
app.post("/api/bookings", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        success: false,
        message: "Supabase is not configured."
      });
    }

    if (
      !process.env.INFINITY_API_KEY_NEW ||
      !process.env.INFINITY_SENDER_ID
    ) {
      return res.status(500).json({
        success: false,
        message: "WhatsApp service is not configured."
      });
    }

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
      typeof customer_name !== "string" ||
      !customer_name.trim() ||
      typeof whatsapp_number !== "string" ||
      !whatsapp_number.trim() ||
      !booking_date ||
      !booking_time
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Name, WhatsApp number, booking date and booking time are required."
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(booking_date))) {
      return res.status(400).json({
        success: false,
        message: "booking_date must use YYYY-MM-DD format."
      });
    }

    const normalizedNutritionist =
      typeof nutritionist_name === "string" &&
      nutritionist_name.trim()
        ? nutritionist_name.trim()
        : "Not assigned";

    const booking = {
      booking_id: `NUT-${randomUUID()}`,
      customer_name: customer_name.trim(),
      customer_email:
        typeof customer_email === "string"
          ? customer_email.trim() || null
          : null,
      whatsapp_number: whatsapp_number.trim(),
      booking_date: String(booking_date),
      booking_time: String(booking_time).trim(),
      timezone:
        typeof timezone === "string" && timezone.trim()
          ? timezone.trim()
          : "Africa/Lagos",
      nutritionist_name: normalizedNutritionist
    };

    // Save booking to Supabase
    const { data: savedBooking, error: saveError } = await supabase
      .from("consultation_bookings")
      .insert({
        booking_id: booking.booking_id,
        customer_name: booking.customer_name,
        customer_email: booking.customer_email,
        whatsapp_number: booking.whatsapp_number,
        booking_date: booking.booking_date,
        booking_time: booking.booking_time,
        timezone: booking.timezone,
        nutritionist_name: booking.nutritionist_name,
        status: "pending",
        infinity_status: "pending",
        infinity_message_id: "pending",
        infinity_error: "None"
      })
      .select("id, booking_id")
      .single();

    if (saveError) {
      if (saveError.code === "23505") {
        return res.status(409).json({
          success: false,
          message: "This time slot is already booked."
        });
      }

      console.error("Supabase booking save failed:", {
        code: saveError.code,
        message: saveError.message
      });

      return res.status(500).json({
        success: false,
        message: "Unable to save the booking. Please try again."
      });
    }

    // Send WhatsApp via Infinity Connect
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
      let providerResponse = null;

      try {
        providerResponse = responseText ? JSON.parse(responseText) : null;
      } catch {
        providerResponse = null;
      }

      if (!infinityResponse.ok) {
        infinityStatus = "failed";
        infinityMessageId = "None";
        infinityError = `Infinity Connect HTTP ${infinityResponse.status}`;
      } else {
        const providerId =
          providerResponse?.messageId ||
          providerResponse?.message_id ||
          providerResponse?.id;

        if (providerId) {
          infinityMessageId = String(providerId);
        }
      }
    } catch (error) {
      infinityStatus = "failed";
      infinityMessageId = "None";
      infinityError = "Infinity Connect request failed";

      console.error("Infinity Connect request failed:", error.message);
    }

    // Update saved booking with WhatsApp result
    const { error: updateError } = await supabase
      .from("consultation_bookings")
      .update({
        status: "confirmed",
        infinity_status: infinityStatus,
        infinity_message_id: infinityMessageId,
        infinity_error: infinityError,
        updated_at: new Date().toISOString()
      })
      .eq("id", savedBooking.id);

    if (updateError) {
      console.error("Booking status update failed:", updateError.code);

      return res.status(200).json({
        success: true,
        message:
          "Booking saved, but its final status could not be updated.",
        booking_id: booking.booking_id,
        database_id: savedBooking.id,
        whatsapp_status: infinityStatus,
        status_update_failed: true
      });
    }

    return res.status(200).json({
      success: true,
      message:
        infinityStatus === "sent"
          ? "Booking saved to Supabase and WhatsApp message accepted."
          : "Booking saved to Supabase, but the WhatsApp message failed.",
      booking_id: booking.booking_id,
      database_id: savedBooking.id,
      whatsapp_status: infinityStatus,
      status_update_failed: false
    });
  } catch (error) {
    console.error("Booking processing failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to process the booking. Please try again."
    });
  }
});

// Dashboard API: fetch consultation bookings
app.get("/api/dashboard/bookings", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        success: false,
        message: "Supabase is not configured."
      });
    }

    const { data, error } = await supabase
      .from("consultation_bookings")
      .select("*")
      .order("booking_date", { ascending: false })
      .order("booking_time", { ascending: false });

    if (error) {
      console.error("Dashboard bookings query failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to fetch consultation bookings."
      });
    }

    return res.json({
      success: true,
      count: data.length,
      bookings: data
    });
  } catch (error) {
    console.error("Dashboard API failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to load dashboard bookings."
    });
  }
});

// Start the server once
if (require.main === module) {
  app.listen(PORT, () => {
    console.log("Nutrify Booking Backend running on port", PORT);
  });
}

module.exports = app;
