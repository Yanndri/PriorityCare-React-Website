const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: require("node:path").join(__dirname, ".env") });

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

// Fail fast on the most common misconfiguration: the frontend's publishable
// (anon) key pasted into SUPABASE_SERVICE_ROLE_KEY, or a key from another
// project. With the wrong key every token check fails ("Invalid or expired
// session") or every table read fails ("permission denied"). The key value is
// never logged.
function checkServiceKey(url, key) {
  if (key.startsWith("sb_publishable_")) {
    return "SUPABASE_SERVICE_ROLE_KEY holds the publishable (frontend) key. Use the secret key (sb_secret_...) or the legacy service_role key from Supabase > Project Settings > API Keys.";
  }

  const parts = key.split(".");

  if (parts.length !== 3) return null; // sb_secret_... or another non-JWT key

  let claims;

  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return "SUPABASE_SERVICE_ROLE_KEY is not a valid Supabase key.";
  }

  if (claims.role !== "service_role") {
    return `SUPABASE_SERVICE_ROLE_KEY is a '${claims.role}' key, not the service_role key.`;
  }

  let projectRef = "";

  try {
    projectRef = new URL(url).hostname.split(".")[0];
  } catch {
    return "SUPABASE_URL is not a valid URL.";
  }

  if (claims.ref && projectRef && claims.ref !== projectRef) {
    return "SUPABASE_SERVICE_ROLE_KEY belongs to a different Supabase project than SUPABASE_URL.";
  }

  return null;
}

const serviceKeyProblem = checkServiceKey(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

if (serviceKeyProblem) {
  throw new Error(serviceKeyProblem);
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
  console.error(
    "Supabase token verification failed:",
    authError?.message || "No authenticated user returned"
  );

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
        profileError.code,
        profileError.message
      );

      if (profileError.code === "42501") {
        console.error(
          "The backend key cannot read public.users. Check that SUPABASE_SERVICE_ROLE_KEY is the service_role/secret key and that service_role has SELECT on public.users."
        );
      }

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

app.get("/api/test-db", requireSuperAdmin, async (req, res) => {
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
// LEGACY MYSQL ROUTES
// These return residents from EVERY barangay (with contact details), so they
// must never be public. The website does not call them (it reads Supabase
// directly), so they are limited to an active Super Admin. Admins use the
// barangay-scoped Supabase queries instead.
// ============================================

// ============================================
// EXISTING RESIDENTS API
// ============================================

app.get("/api/residents", requireSuperAdmin, async (req, res) => {
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
        barangays.barangay_name
      FROM residents
      INNER JOIN users ON residents.uid = users.uid
      INNER JOIN barangays ON residents.barangay_id = barangays.barangay_id
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

app.get("/api/map/residents", requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        residents.uid,
        CONCAT(users.f_name, ' ', users.l_name) AS full_name,
        residents.mobility_status,
        residents.GPS_Lat,
        residents.GPS_Long,
        barangays.barangay_name
      FROM residents
      INNER JOIN users ON residents.uid = users.uid
      INNER JOIN barangays ON residents.barangay_id = barangays.barangay_id
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

app.get("/api/verification/pending", requireSuperAdmin, async (req, res) => {
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
      const [adminResult, barangayResult] = await Promise.all([
        supabaseAdmin
          .from("users")
          .select(
            "uid, email, f_name, l_name, account_status, assigned_barangay_id"
          )
          .eq("role", "admin")
          .order("email"),

        supabaseAdmin
          .from("barangays")
          .select("barangay_id, barangay_name")
          .order("barangay_name"),
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

      if (barangayResult.error) {
        console.error(
          "Failed to load barangays:",
          barangayResult.error.message
        );

        return res.status(500).json({
          message: "Unable to load barangays.",
        });
      }

      return res.json({
        admins: adminResult.data || [],
        barangays: barangayResult.data || [],
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
        assigned_barangay_id,
        uid,
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
        assigned_barangay_id === undefined ||
        assigned_barangay_id === null ||
        assigned_barangay_id === ""
      ) {
        return res.status(400).json({
          message:
            "Email, password, first name, last name, contact number, and barangay are required.",
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          message: "Password must be at least 8 characters long.",
        });
      }

      // Supabase Auth (bcrypt) only uses the first 72 bytes of a password.
      if (Buffer.byteLength(password, "utf8") > 72) {
        return res.status(400).json({
          message: "Password must be at most 72 characters long.",
        });
      }

      if (
        m_name !== undefined &&
        m_name !== null &&
        typeof m_name !== "string"
      ) {
        return res.status(400).json({
          message: "Middle name must be text.",
        });
      }

      // Match the varchar limits of public.users.
      const tooLong =
        email.trim().length > 100 ||
        f_name.trim().length > 100 ||
        l_name.trim().length > 100 ||
        (typeof m_name === "string" && m_name.trim().length > 100) ||
        contact_no.trim().length > 50;

      if (tooLong) {
        return res.status(400).json({
          message:
            "Email and names must be at most 100 characters; contact number at most 50.",
        });
      }

      const contactDigits = contact_no.replace(/\D/g, "");

      if (
        !/^\+?[0-9][0-9\s-]*$/.test(contact_no.trim()) ||
        contactDigits.length < 7 ||
        contactDigits.length > 15
      ) {
        return res.status(400).json({
          message:
            "Contact number must contain 7 to 15 digits (an optional leading +, spaces, and hyphens are allowed).",
        });
      }

      if (
        typeof assigned_barangay_id !== "number" &&
        typeof assigned_barangay_id !== "string"
      ) {
        return res.status(400).json({
          message: "Invalid barangay selection.",
        });
      }

      const barangayId = Number(assigned_barangay_id);
      const normalizedEmail = email.trim().toLowerCase();

      if (
        !Number.isSafeInteger(barangayId) ||
        barangayId <= 0
      ) {
        return res.status(400).json({
          message: "Please select a valid barangay.",
        });
      }

      // Basic email format validation.
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailPattern.test(normalizedEmail)) {
        return res.status(400).json({
          message: "Please enter a valid email address.",
        });
      }

      // Optional custom User ID (UUID). Blank = auto-generated.
      let requestedUid = null;

      if (uid !== undefined && uid !== null && uid !== "") {
        const uuidPattern =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (typeof uid !== "string" || !uuidPattern.test(uid.trim())) {
          return res.status(400).json({
            message:
              "User ID must be a valid UUID (e.g. 123e4567-e89b-12d3-a456-426614174000), or left blank to auto-generate.",
          });
        }

        requestedUid = uid.trim().toLowerCase();

        const { data: existingUid, error: uidError } =
          await supabaseAdmin
            .from("users")
            .select("uid")
            .eq("uid", requestedUid)
            .maybeSingle();

        if (uidError) {
          console.error("User ID lookup failed:", uidError.message);

          return res.status(500).json({
            message: "Unable to verify the User ID.",
          });
        }

        if (existingUid) {
          return res.status(409).json({
            message: "An account with this User ID already exists.",
          });
        }
      }

      // Confirm the selected barangay exists.
      const { data: barangay, error: barangayError } =
        await supabaseAdmin
          .from("barangays")
          .select("barangay_id")
          .eq("barangay_id", barangayId)
          .maybeSingle();

      if (barangayError) {
        console.error(
          "Barangay lookup failed:",
          barangayError.message
        );

        return res.status(500).json({
          message: "Unable to verify the selected barangay.",
        });
      }

      if (!barangay) {
        return res.status(400).json({
          message: "The selected barangay does not exist.",
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

      // contact_no is UNIQUE in public.users.
      const { data: existingContact, error: contactError } =
        await supabaseAdmin
          .from("users")
          .select("uid")
          .eq("contact_no", contact_no.trim())
          .maybeSingle();

      if (contactError) {
        console.error(
          "Contact number lookup failed:",
          contactError.message
        );

        return res.status(500).json({
          message: "Unable to verify the contact number.",
        });
      }

      if (existingContact) {
        return res.status(409).json({
          message: "An account with this contact number already exists.",
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
          ...(requestedUid ? { id: requestedUid } : {}),
        });

      if (authError || !authResult.user) {
        console.error(
          "Admin Auth creation failed:",
          authError?.message
        );

        // The profile email check above is case-sensitive, so Auth is
        // the final authority on duplicate emails.
        if (authError?.code === "email_exists") {
          return res.status(409).json({
            message: "An account with this email already exists.",
          });
        }

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
            assigned_barangay_id: barangayId,
            account_status: "active",
            is_verified: false,
          })
          .select(
            "uid, email, f_name, l_name, account_status, assigned_barangay_id"
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

        // Unique violation: a concurrent request took the email,
        // contact number, or User ID after the pre-checks above.
        if (profileError.code === "23505") {
          return res.status(409).json({
            message:
              "An account with this email, contact number, or User ID already exists.",
          });
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
// MANAGE ADMIN ACCOUNT — SUPER ADMIN ONLY
// Suspend, reactivate, or reassign the barangay of an existing Admin.
// Super Admin accounts cannot be changed through this endpoint.
// ============================================

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Effectively permanent until reactivated (Supabase Auth ban duration).
const SUSPENDED_BAN_DURATION = "876000h";

app.patch(
  "/api/super-admin/admins/:uid",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const uid = String(req.params.uid || "").trim().toLowerCase();
      const body = req.body;

      if (!UUID_PATTERN.test(uid)) {
        return res.status(400).json({
          message: "Invalid Admin account ID.",
        });
      }

      if (uid === String(req.superAdmin.id).toLowerCase()) {
        return res.status(400).json({
          message: "You cannot change your own account here.",
        });
      }

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({
          message: "Invalid request body.",
        });
      }

      const allowed = ["account_status", "assigned_barangay_id"];
      const keys = Object.keys(body);

      if (!keys.length || keys.some((key) => !allowed.includes(key))) {
        return res.status(400).json({
          message:
            "Send account_status and/or assigned_barangay_id only.",
        });
      }

      const changes = {};

      if (body.account_status !== undefined) {
        if (!["active", "suspended"].includes(body.account_status)) {
          return res.status(400).json({
            message: "Status must be 'active' or 'suspended'.",
          });
        }

        changes.account_status = body.account_status;
      }

      if (body.assigned_barangay_id !== undefined) {
        const barangayId = Number(body.assigned_barangay_id);

        if (
          (typeof body.assigned_barangay_id !== "number" &&
            typeof body.assigned_barangay_id !== "string") ||
          !Number.isSafeInteger(barangayId) ||
          barangayId <= 0
        ) {
          return res.status(400).json({
            message: "Please select a valid barangay.",
          });
        }

        const { data: barangay, error: barangayError } =
          await supabaseAdmin
            .from("barangays")
            .select("barangay_id")
            .eq("barangay_id", barangayId)
            .maybeSingle();

        if (barangayError) {
          console.error("Barangay lookup failed:", barangayError.message);

          return res.status(500).json({
            message: "Unable to verify the selected barangay.",
          });
        }

        if (!barangay) {
          return res.status(400).json({
            message: "The selected barangay does not exist.",
          });
        }

        changes.assigned_barangay_id = barangayId;
      }

      const { data: target, error: targetError } =
        await supabaseAdmin
          .from("users")
          .select("uid, role, account_status, assigned_barangay_id")
          .eq("uid", uid)
          .maybeSingle();

      if (targetError) {
        console.error("Admin lookup failed:", targetError.message);

        return res.status(500).json({
          message: "Unable to load the Admin account.",
        });
      }

      if (!target || target.role !== "admin") {
        return res.status(404).json({
          message: "Admin account not found.",
        });
      }

      const { data: updated, error: updateError } =
        await supabaseAdmin
          .from("users")
          .update(changes)
          .eq("uid", uid)
          .eq("role", "admin")
          .select(
            "uid, email, f_name, l_name, account_status, assigned_barangay_id"
          )
          .single();

      if (updateError || !updated) {
        console.error(
          "Admin update failed:",
          updateError?.message || "No row updated"
        );

        return res.status(500).json({
          message: "Unable to update the Admin account.",
        });
      }

      // Block or restore sign-in in Supabase Auth to match the status.
      // Data access is also cut immediately, because the database checks
      // account_status = 'active' on every request.
      if (
        changes.account_status &&
        changes.account_status !== target.account_status
      ) {
        const { error: banError } =
          await supabaseAdmin.auth.admin.updateUserById(uid, {
            ban_duration:
              changes.account_status === "suspended"
                ? SUSPENDED_BAN_DURATION
                : "none",
          });

        if (banError) {
          console.error("Auth status update failed:", banError.message);

          // Keep the profile and Auth consistent: undo this request.
          const { error: revertError } = await supabaseAdmin
            .from("users")
            .update({
              account_status: target.account_status,
              assigned_barangay_id: target.assigned_barangay_id,
            })
            .eq("uid", uid);

          if (revertError) {
            console.error("Status revert failed:", revertError.message);
          }

          return res.status(500).json({
            message:
              "Unable to update sign-in access for this Admin. No change was saved.",
          });
        }
      }

      const verb =
        changes.account_status === "suspended"
          ? "suspended"
          : changes.account_status === "active" &&
              target.account_status !== "active"
            ? "reactivated"
            : "updated";

      return res.json({
        message: `Admin account ${verb}.`,
        admin: updated,
      });
    } catch (error) {
      console.error("Manage Admin endpoint failed:", error.message);

      return res.status(500).json({
        message: "Unable to update the Admin account.",
      });
    }
  }
);

// ============================================
// RESPONDER (RESCUER) ACCOUNTS — SUPER ADMIN ONLY
// ============================================
// RA 10121 Sec. 13 and NDRRMC MC No. 64 s. 2021 (amended by MC No. 02
// s. 2024): community disaster volunteers are accredited and issued IDs at
// the municipal/city level through the LDRRMO. There is no rescuer
// self-signup; the municipal admin creates the account together with the
// volunteer's accreditation record.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

// Optional roster details (NDRRMP 2020-2030 Outcome 13: trained, protected volunteers).
function normalizeRosterDetails({ trainings, insurance_ref }) {
  const list = trainings === undefined || trainings === null ? [] : trainings;

  if (
    !Array.isArray(list) ||
    list.length > 20 ||
    list.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 100)
  ) {
    return { error: "List up to 20 trainings, each at most 100 characters." };
  }

  if (
    insurance_ref !== undefined &&
    insurance_ref !== null &&
    (typeof insurance_ref !== "string" || insurance_ref.trim().length > 100)
  ) {
    return { error: "Insurance reference must be at most 100 characters." };
  }

  return {
    trainings: [...new Set(list.map((item) => item.trim()))],
    insurance_ref:
      typeof insurance_ref === "string" && insurance_ref.trim() ? insurance_ref.trim() : null,
  };
}

function validateAccreditation({ accreditation_no, organization, accredited_on, valid_until }) {
  if (
    typeof accreditation_no !== "string" ||
    accreditation_no.trim().length < 3 ||
    accreditation_no.trim().length > 50
  ) {
    return "Accreditation number must be 3 to 50 characters.";
  }

  if (
    typeof organization !== "string" ||
    organization.trim().length < 2 ||
    organization.trim().length > 150
  ) {
    return "Enter the organization that fields this responder (2 to 150 characters).";
  }

  const from = parseIsoDate(accredited_on);
  const until = parseIsoDate(valid_until);

  if (!from || !until) {
    return "Accreditation dates must be valid dates (YYYY-MM-DD).";
  }

  if (until <= from) {
    return "The accreditation must expire after the date it was issued.";
  }

  return null;
}

app.post(
  "/api/super-admin/rescuers",
  requireSuperAdmin,
  async (req, res) => {
    let createdUserId = null;

    try {
      const {
        email,
        password,
        f_name,
        m_name,
        l_name,
        contact_no,
        assigned_barangay_id,
        accreditation_no,
        organization,
        accredited_on,
        valid_until,
        trainings,
        insurance_ref,
      } = req.body || {};

      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        typeof f_name !== "string" ||
        typeof l_name !== "string" ||
        typeof contact_no !== "string" ||
        !email.trim() ||
        !f_name.trim() ||
        !l_name.trim() ||
        !contact_no.trim()
      ) {
        return res.status(400).json({
          message:
            "Email, password, first name, last name, contact number, and barangay are required.",
        });
      }

      if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
        return res.status(400).json({
          message: "Password must be 8 to 72 characters long.",
        });
      }

      if (m_name !== undefined && m_name !== null && typeof m_name !== "string") {
        return res.status(400).json({ message: "Middle name must be text." });
      }

      if (
        email.trim().length > 100 ||
        f_name.trim().length > 100 ||
        l_name.trim().length > 100 ||
        (typeof m_name === "string" && m_name.trim().length > 100) ||
        contact_no.trim().length > 50
      ) {
        return res.status(400).json({
          message:
            "Email and names must be at most 100 characters; contact number at most 50.",
        });
      }

      const contactDigits = contact_no.replace(/\D/g, "");

      if (
        !/^\+?[0-9][0-9\s-]*$/.test(contact_no.trim()) ||
        contactDigits.length < 7 ||
        contactDigits.length > 15
      ) {
        return res.status(400).json({
          message:
            "Contact number must contain 7 to 15 digits (an optional leading +, spaces, and hyphens are allowed).",
        });
      }

      const normalizedEmail = email.trim().toLowerCase();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({
          message: "Please enter a valid email address.",
        });
      }

      const barangayId = Number(assigned_barangay_id);

      if (!Number.isSafeInteger(barangayId) || barangayId <= 0) {
        return res.status(400).json({
          message: "Please select the responder's barangay.",
        });
      }

      const accreditationError = validateAccreditation({
        accreditation_no,
        organization,
        accredited_on,
        valid_until,
      });

      if (accreditationError) {
        return res.status(400).json({ message: accreditationError });
      }

      const roster = normalizeRosterDetails({ trainings, insurance_ref });

      if (roster.error) {
        return res.status(400).json({ message: roster.error });
      }

      const { data: barangay, error: barangayError } = await supabaseAdmin
        .from("barangays")
        .select("barangay_id")
        .eq("barangay_id", barangayId)
        .maybeSingle();

      if (barangayError) {
        console.error("Barangay lookup failed:", barangayError.message);
        return res.status(500).json({
          message: "Unable to verify the selected barangay.",
        });
      }

      if (!barangay) {
        return res.status(400).json({
          message: "The selected barangay does not exist.",
        });
      }

      const { data: authResult, error: authError } =
        await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true,
        });

      if (authError || !authResult.user) {
        console.error("Rescuer Auth creation failed:", authError?.message);

        if (authError?.code === "email_exists") {
          return res.status(409).json({
            message: "An account with this email already exists.",
          });
        }

        return res.status(400).json({
          message: authError?.message || "Unable to create the Auth account.",
        });
      }

      createdUserId = authResult.user.id;

      const { error: profileError } = await supabaseAdmin.from("users").insert({
        uid: createdUserId,
        role: "rescuer",
        email: normalizedEmail,
        f_name: f_name.trim(),
        m_name: typeof m_name === "string" && m_name.trim() ? m_name.trim() : null,
        l_name: l_name.trim(),
        contact_no: contact_no.trim(),
        assigned_barangay_id: barangayId,
        account_status: "active",
        is_verified: true,
      });

      if (profileError) {
        console.error("Rescuer profile creation failed:", profileError.message);
        await supabaseAdmin.auth.admin.deleteUser(createdUserId);
        createdUserId = null;

        return res.status(profileError.code === "23505" ? 409 : 500).json({
          message:
            profileError.code === "23505"
              ? "An account with this email or contact number already exists."
              : "The responder profile could not be created.",
        });
      }

      const { error: accreditationInsertError } = await supabaseAdmin
        .from("responder_accreditations")
        .insert({
          uid: createdUserId,
          accreditation_no: accreditation_no.trim(),
          organization: organization.trim(),
          accredited_on,
          valid_until,
          trainings: roster.trainings,
          insurance_ref: roster.insurance_ref,
          updated_by: req.superAdmin.id,
        });

      if (accreditationInsertError) {
        console.error(
          "Accreditation record failed:",
          accreditationInsertError.message
        );
        // Deleting the Auth user cascades to public.users.
        await supabaseAdmin.auth.admin.deleteUser(createdUserId);
        createdUserId = null;

        return res.status(accreditationInsertError.code === "23505" ? 409 : 500).json({
          message:
            accreditationInsertError.code === "23505"
              ? "This accreditation number is already registered to another responder."
              : accreditationInsertError.code === "42P01"
                ? "Responder accreditation needs the 20261019_11_responder_accreditation.sql database migration."
                : "The accreditation record could not be saved.",
        });
      }

      return res.status(201).json({
        message: "Responder account created.",
        rescuer: { uid: createdUserId, email: normalizedEmail },
      });
    } catch (error) {
      console.error("Create Rescuer endpoint failed:", error.message);

      if (createdUserId) {
        await supabaseAdmin.auth.admin.deleteUser(createdUserId);
      }

      return res.status(500).json({
        message: "Unable to create the responder account.",
      });
    }
  }
);

// Suspend / reactivate a responder, or renew their accreditation.
app.patch(
  "/api/super-admin/rescuers/:uid",
  requireSuperAdmin,
  async (req, res) => {
    try {
      const uid = String(req.params.uid || "").trim().toLowerCase();
      const {
        account_status,
        organization,
        accredited_on,
        valid_until,
        accreditation_no,
        trainings,
        insurance_ref,
      } = req.body || {};

      if (!UUID_PATTERN.test(uid)) {
        return res.status(400).json({ message: "Invalid responder account ID." });
      }

      const { data: target, error: targetError } = await supabaseAdmin
        .from("users")
        .select("uid, role")
        .eq("uid", uid)
        .maybeSingle();

      if (targetError) {
        console.error("Rescuer lookup failed:", targetError.message);
        return res.status(500).json({ message: "Unable to find the responder." });
      }

      if (!target || target.role !== "rescuer") {
        return res.status(404).json({ message: "Responder account not found." });
      }

      if (account_status !== undefined) {
        if (account_status !== "active" && account_status !== "suspended") {
          return res.status(400).json({ message: "Invalid account status." });
        }

        const { error } = await supabaseAdmin
          .from("users")
          .update({ account_status })
          .eq("uid", uid);

        if (error) {
          console.error("Rescuer status update failed:", error.message);
          return res.status(500).json({ message: "Unable to update the account status." });
        }

        // A suspended responder cannot sign in to the field app.
        const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(uid, {
          ban_duration: account_status === "suspended" ? SUSPENDED_BAN_DURATION : "none",
        });

        if (banError) {
          console.error("Rescuer Auth status update failed:", banError.message);
          return res.status(500).json({
            message: "The status was saved, but signing in could not be updated. Try again.",
          });
        }
      }

      if (valid_until !== undefined) {
        const accreditationError = validateAccreditation({
          accreditation_no,
          organization,
          accredited_on,
          valid_until,
        });

        if (accreditationError) {
          return res.status(400).json({ message: accreditationError });
        }

        const roster = normalizeRosterDetails({ trainings, insurance_ref });

        if (roster.error) {
          return res.status(400).json({ message: roster.error });
        }

        const { error } = await supabaseAdmin
          .from("responder_accreditations")
          .upsert({
            uid,
            accreditation_no: accreditation_no.trim(),
            organization: organization.trim(),
            accredited_on,
            valid_until,
            trainings: roster.trainings,
            insurance_ref: roster.insurance_ref,
            updated_at: new Date().toISOString(),
            updated_by: req.superAdmin.id,
          });

        if (error) {
          console.error("Accreditation update failed:", error.message);
          return res.status(error.code === "23505" ? 409 : 500).json({
            message:
              error.code === "23505"
                ? "This accreditation number is already registered to another responder."
                : "Unable to save the accreditation.",
          });
        }
      }

      return res.json({ message: "Responder updated." });
    } catch (error) {
      console.error("Manage Rescuer endpoint failed:", error.message);
      return res.status(500).json({ message: "Unable to update the responder." });
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
// JSON ERROR HANDLER
// ============================================

// Keep error responses JSON (e.g. malformed request bodies) instead of
// Express's default HTML page.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error("Unhandled API error:", err.message);
  }

  return res.status(status).json({
    message:
      status === 400
        ? "Invalid request body."
        : status === 413
          ? "Request body is too large."
          : "Internal server error.",
  });
});

// ============================================
// START SERVER
// ============================================

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log(
    `PriorityCare API running on port ${port}`
  );
});
