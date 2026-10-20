
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { randomUUID } = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const ExcelJS = require("exceljs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const INFINITY_API_URL =
  "https://dev.infinityconnect.ai/config-service/api/v1/public/templates/appoinment-fixed-message/send";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const allowedDashboardEmail = (
  process.env.CLIENT_DASHBOARD_EMAIL || ""
).trim().toLowerCase();

// Server-side database client. Never expose this key in browser code.
const supabase =
  supabaseUrl && supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

// Public-key client for authentication only.
const authClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

// Verify the token with Supabase and restrict access to the approved email.
async function authorizeDashboard(req, res, next) {
  try {
    if (!supabase || !authClient || !allowedDashboardEmail) {
      return res.status(500).json({
        success: false,
        message: "Dashboard authentication is not configured."
      });
    }

    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Please sign in to continue."
      });
    }

    const { data, error } = await authClient.auth.getUser(match[1]);

    if (
      error ||
      !data.user ||
      (data.user.email || "").trim().toLowerCase() !==
        allowedDashboardEmail
    ) {
      return res.status(401).json({
        success: false,
        message: "Your session is invalid or access is not permitted."
      });
    }

    req.dashboardUser = data.user;
    next();
  } catch (error) {
    console.error("Dashboard authorization failed:", error.message);

    return res.status(401).json({
      success: false,
      message: "Unable to verify your session."
    });
  }
}

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
      dashboardLogin: "POST /api/dashboard/login",
      dashboardBookings: "GET /api/dashboard/bookings",
      dashboardExport: "GET /api/dashboard/export"
    }
  });
});

// Configuration check without exposing secrets
app.get("/api/config-check", (req, res) => {
  res.json({
    supabaseConfigured: Boolean(supabase),
    infinityApiKeyPresent: Boolean(
      process.env.INFINITY_API_KEY_NEW?.trim()
    ),
    infinitySenderIdPresent: Boolean(
      process.env.INFINITY_SENDER_ID?.trim()
    ),
    dashboardConfigured: Boolean(
      supabase &&
      authClient &&
      allowedDashboardEmail
    ),
    nodeEnvironment: process.env.NODE_ENV || "not set"
  });
});

// Database status
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

// Client login
app.post("/api/dashboard/login", async (req, res) => {
  try {
    if (!authClient || !allowedDashboardEmail) {
      return res.status(500).json({
        success: false,
        message: "Dashboard authentication is not configured."
      });
    }

    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body?.password === "string"
        ? req.body.password
        : "";

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    if (email !== allowedDashboardEmail) {
      return res.status(403).json({
        success: false,
        message: "This account is not authorized for the dashboard."
      });
    }

    const { data, error } =
      await authClient.auth.signInWithPassword({
        email,
        password
      });

    if (
      error ||
      !data.user ||
      !data.session ||
      (data.user.email || "").trim().toLowerCase() !==
        allowedDashboardEmail
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      access_token: data.session.access_token,
      user: {
        email: data.user.email
      }
    });
  } catch (error) {
    console.error("Dashboard login failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to sign in. Please try again."
    });
  }
});

// Fetch bookings for the authenticated client
app.get(
  "/api/dashboard/bookings",
  authorizeDashboard,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("consultation_bookings")
        .select(
          "id, booking_id, customer_name, customer_email, whatsapp_number, booking_date, booking_time, nutritionist_name, status, timezone"
        )
        .order("booking_date", { ascending: false })
        .order("booking_time", { ascending: false })
        .limit(5000);

      if (error) {
        console.error("Dashboard booking query failed:", error.code);

        return res.status(500).json({
          success: false,
          message: "Unable to load bookings."
        });
      }

      res.setHeader("Cache-Control", "no-store");

      return res.json({
        success: true,
        bookings: data || []
      });
    } catch (error) {
      console.error("Dashboard bookings failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to load bookings."
      });
    }
  }
);

// Export bookings to an actual Excel workbook
app.get(
  "/api/dashboard/export",
  authorizeDashboard,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("consultation_bookings")
        .select(
          "booking_id, customer_name, customer_email, whatsapp_number, booking_date, booking_time, nutritionist_name, status, timezone"
        )
        .order("booking_date", { ascending: false })
        .order("booking_time", { ascending: false })
        .limit(5000);

      if (error) {
        console.error("Excel export query failed:", error.code);

        return res.status(500).json({
          success: false,
          message: "Unable to export bookings."
        });
      }

      const workbook = new ExcelJS.Workbook();

      workbook.creator = "Nutrify";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet("Consultation Bookings");

      sheet.columns = [
        { header: "Booking ID", key: "booking_id", width: 30 },
        { header: "Customer", key: "customer_name", width: 25 },
        { header: "Email", key: "customer_email", width: 32 },
        { header: "WhatsApp", key: "whatsapp_number", width: 20 },
        { header: "Date", key: "booking_date", width: 16 },
        { header: "Time", key: "booking_time", width: 16 },
        { header: "Nutritionist", key: "nutritionist_name", width: 25 },
        { header: "Status", key: "status", width: 16 },
        { header: "Timezone", key: "timezone", width: 22 }
      ];

      sheet.addRows(data || []);
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = {
        from: "A1",
        to: "I1"
      };

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        'attachment; filename="nutrify-bookings.xlsx"'
      );

      res.setHeader("Cache-Control", "no-store");

      await workbook.xlsx.write(res);
      return res.end();
    } catch (error) {
      console.error("Excel export failed:", error.message);

      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: "Unable to generate the Excel file."
        });
      }
    }
  }
);

// Create booking — existing WhatsApp workflow retained
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
        providerResponse = responseText
          ? JSON.parse(responseText)
          : null;
      } catch {
        providerResponse = null;
      }

      if (!infinityResponse.ok) {
        infinityStatus = "failed";
        infinityMessageId = "None";
        infinityError =
          `Infinity Connect HTTP ${infinityResponse.status}`;
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log("Nutrify Booking Backend running on port", PORT);
  });
}

module.exports = app;
