const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ============================================
// SUPABASE ADMIN CLIENT — BACKEND ONLY
// ============================================

if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend .env"
  );
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ============================================
// SUPER ADMIN AUTHORIZATION MIDDLEWARE
// ============================================

async function requireSuperAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        message: "Authentication required.",
      });
    }

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.getUser(token);

    if (authError || !authData.user) {
      return res.status(401).json({
        message: "Invalid or expired session. Please sign in again.",
      });
    }

    const { data: profile, error: profileError } =
      await supabaseAdmin
        .from("users")
        .select("uid, role, account_status")
        .eq("uid", authData.user.id)
        .maybeSingle();

    if (profileError) {
      console.error(
        "Super Admin verification failed:",
        profileError.message
      );

      return res.status(500).json({
        message: "Unable to verify account permissions.",
      });
    }

    if (
      !profile ||
      profile.role !== "super_admin" ||
      profile.account_status !== "active"
    ) {
      return res.status(403).json({
        message: "Active Super Admin access required.",
      });
    }

    req.superAdmin = authData.user;
    return next();
  } catch (error) {
    console.error(
      "Authorization error:",
      error.message
    );

    return res.status(500).json({
      message: "Authorization failed.",
    });
  }
}

// ============================================
// MYSQL CONNECTION — EXISTING API
// ============================================

const db = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST,
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME,
});

// ============================================
// BASIC API ROUTES
// ============================================

app.get("/api/health", (req, res) => {
  res.json({
    message: "PriorityCare API is running",
  });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT DATABASE() AS database_name"
    );

    return res.json({
      message: "Database connected successfully",
      database: rows[0].database_name,
    });
  } catch (error) {
    console.error(
      "MySQL connection failed:",
      error.message
    );

    return res.status(500).json({
      message: "Database connection failed",
    });
  }
});

// ============================================
// EXISTING RESIDENTS API
// ============================================

app.get("/api/residents", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        residents.uid,
        users.f_name,
        users.m_name,
        users.l_name,
        users.email,
        users.contact_no,
        users.is_verified,
        residents.sex,
        residents.birthdate,
        residents.mobility_status,
        residents.emerg_contact_name,
        residents.emerg_contact_no,
        residents.GPS_Lat,
        residents.GPS_Long,
        residents.last_heartbeat,
        sitios.sitio_name
      FROM residents
      INNER JOIN users ON residents.uid = users.uid
      INNER JOIN sitios ON residents.sitio_id = sitios.sitio_id
      ORDER BY residents.uid DESC
    `);

    return res.json(rows);
  } catch (error) {
    console.error(
      "Failed to fetch residents:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to fetch residents",
    });
  }
});

// ============================================
// EXISTING MAP API
// ============================================

app.get("/api/map/residents", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        residents.uid,
        CONCAT(users.f_name, ' ', users.l_name) AS full_name,
        residents.mobility_status,
        residents.GPS_Lat,
        residents.GPS_Long,
        sitios.sitio_name
      FROM residents
      INNER JOIN users ON residents.uid = users.uid
      INNER JOIN sitios ON residents.sitio_id = sitios.sitio_id
      WHERE users.is_verified = 1
        AND residents.GPS_Lat IS NOT NULL
        AND residents.GPS_Long IS NOT NULL
    `);

    return res.json(rows);
  } catch (error) {
    console.error(
      "Failed to fetch map residents:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to fetch map residents",
    });
  }
});

// ============================================
// EXISTING VERIFICATION API
// ============================================

app.get("/api/verification/pending", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        verification_documents.doc_id,
        verification_documents.uid,
        verification_documents.file_url,
        verification_documents.review_status,
        verification_documents.uploaded_at,
        document_types.type_name,
        users.f_name,
        users.l_name,
        users.email
      FROM verification_documents
      INNER JOIN users
        ON verification_documents.uid = users.uid
      INNER JOIN document_types
        ON verification_documents.type_id = document_types.type_id
      WHERE verification_documents.review_status = 'Pending'
      ORDER BY verification_documents.uploaded_at DESC
    `);

    return res.json(rows);
  } catch (error) {
    console.error(
      "Failed to fetch pending documents:",
      error.message
    );

    return res.status(500).json({
      message: "Failed to fetch pending documents",
    });
  }
});

// ============================================
// SUPER ADMIN DASHBOARD API
// ============================================

app.get(
  "/api/super-admin/dashboard",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const [adminResult, sitioResult] = await Promise.all([
        supabaseAdmin
          .from("users")
          .select(
            "uid, email, f_name, l_name, account_status, assigned_sitio_id"
          )
          .eq("role", "admin")
          .order("email"),

        supabaseAdmin
          .from("sitios")
          .select("sitio_id, sitio_name")
          .order("sitio_name"),
      ]);

      if (adminResult.error) {
        console.error(
          "Failed to load admins:",
          adminResult.error.message
        );

        return res.status(500).json({
          message: "Unable to load administrator accounts.",
        });
      }

      if (sitioResult.error) {
        console.error(
          "Failed to load sitios:",
          sitioResult.error.message
        );

        return res.status(500).json({
          message: "Unable to load sitios.",
        });
      }

      return res.json({
        admins: adminResult.data || [],
        sitios: sitioResult.data || [],
      });
    } catch (error) {
      console.error(
        "Dashboard API error:",
        error.message
      );

      return res.status(500).json({
        message: "Failed to load dashboard data.",
      });
    }
  }
);

// ============================================
// CREATE ADMIN ACCOUNT — SUPER ADMIN ONLY
// ============================================

app.post(
  "/api/super-admin/admins",
  requireSuperAdmin,
  async (req, res) => {
    let createdUserId = null;
    let profileCreated = false;

    try {
      const {
        email,
        password,
        f_name,
        m_name,
        l_name,
        contact_no,
        assigned_sitio_id,
      } = req.body || {};

      // Validate required fields.
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        typeof f_name !== "string" ||
        typeof l_name !== "string" ||
        typeof contact_no !== "string" ||
        !email.trim() ||
        !password ||
        !f_name.trim() ||
        !l_name.trim() ||
        !contact_no.trim() ||
        assigned_sitio_id === undefined ||
        assigned_sitio_id === null ||
        assigned_sitio_id === ""
      ) {
        return res.status(400).json({
          message:
            "Email, password, first name, last name, contact number, and sitio are required.",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters long.",
        });
      }

      if (
        typeof assigned_sitio_id !== "number" &&
        typeof assigned_sitio_id !== "string"
      ) {
        return res.status(400).json({
          message: "Invalid sitio selection.",
        });
      }

      const sitioId = Number(assigned_sitio_id);
      const normalizedEmail = email.trim().toLowerCase();

      if (
        !Number.isSafeInteger(sitioId) ||
        sitioId <= 0
      ) {
        return res.status(400).json({
          message: "Please select a valid sitio.",
        });
      }

      // Basic email format validation.
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailPattern.test(normalizedEmail)) {
        return res.status(400).json({
          message: "Please enter a valid email address.",
        });
      }

      // Confirm the selected sitio exists.
      const { data: sitio, error: sitioError } =
        await supabaseAdmin
          .from("sitios")
          .select("sitio_id")
          .eq("sitio_id", sitioId)
          .maybeSingle();

      if (sitioError) {
        console.error(
          "Sitio lookup failed:",
          sitioError.message
        );

        return res.status(500).json({
          message: "Unable to verify the selected sitio.",
        });
      }

      if (!sitio) {
        return res.status(400).json({
          message: "The selected sitio does not exist.",
        });
      }

      // Check for an existing public profile.
      const { data: existingProfile, error: existingError } =
        await supabaseAdmin
          .from("users")
          .select("uid")
          .eq("email", normalizedEmail)
          .maybeSingle();

      if (existingError) {
        console.error(
          "Email lookup failed:",
          existingError.message
        );

        return res.status(500).json({
          message: "Unable to verify the email address.",
        });
      }

      if (existingProfile) {
        return res.status(409).json({
          message: "An account with this email already exists.",
        });
      }

      // Create the Supabase Auth user.
      // This is a trusted, Super Admin-created account.
      // Email is marked confirmed so the account can sign in
      // with the credentials provided by the Super Admin.
      const { data: authResult, error: authError } =
        await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true,
        });

      if (authError || !authResult.user) {
        console.error(
          "Admin Auth creation failed:",
          authError?.message
        );

        return res.status(400).json({
          message:
            authError?.message ||
            "Unable to create the Auth account.",
        });
      }

      createdUserId = authResult.user.id;

      // Create the matching public.users profile.
      const { data: profile, error: profileError } =
        await supabaseAdmin
          .from("users")
          .insert({
            uid: createdUserId,
            role: "admin",
            email: normalizedEmail,
            f_name: f_name.trim(),
            m_name:
              typeof m_name === "string" && m_name.trim()
                ? m_name.trim()
                : null,
            l_name: l_name.trim(),
            contact_no: contact_no.trim(),
            assigned_sitio_id: sitioId,
            account_status: "active",
            is_verified: false,
          })
          .select(
            "uid, email, f_name, l_name, account_status, assigned_sitio_id"
          )
          .single();

      if (profileError) {
        console.error(
          "Admin profile creation failed:",
          profileError.message
        );

        // Remove the Auth account if its profile could not be
        // created, so there is no orphaned account.
        const { error: cleanupError } =
          await supabaseAdmin.auth.admin.deleteUser(
            createdUserId
          );

        if (cleanupError) {
          console.error(
            "Auth cleanup failed:",
            cleanupError.message
          );
        } else {
          createdUserId = null;
        }

        return res.status(500).json({
          message:
            "The Admin profile could not be created. Check the database constraints and try again.",
        });
      }

      profileCreated = true;

      return res.status(201).json({
        message: "Admin account created successfully.",
        admin: profile,
      });
    } catch (error) {
      console.error(
        "Create Admin endpoint failed:",
        error.message
      );

      // Only clean up when Auth was created but the profile
      // was not successfully saved.
      if (createdUserId && !profileCreated) {
        const { error: cleanupError } =
          await supabaseAdmin.auth.admin.deleteUser(
            createdUserId
          );

        if (cleanupError) {
          console.error(
            "Auth cleanup failed:",
            cleanupError.message
          );
        }
      }

      return res.status(500).json({
        message: "Unable to create the Admin account.",
      });
    }
  }
);

// ============================================
// SUPER ADMIN AUTHORIZATION TEST
// ============================================

app.get(
  "/api/super-admin/check",
  requireSuperAdmin,
  (req, res) => {
    return res.json({
      message: "Super Admin authorization successful.",
      userId: req.superAdmin.id,
      email: req.superAdmin.email,
    });
  }
);

// ============================================
// START SERVER
// ============================================

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(
    `PriorityCare API running on port ${port}`
  );
});
