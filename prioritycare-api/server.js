const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Test if API is running
app.get("/api/health", (req, res) => {
  res.json({
    message: "PriorityCare API is running",
  });
});

// Test database connection
app.get("/api/test-db", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT DATABASE() AS database_name");

    res.json({
      message: "Database connected successfully",
      database: rows[0].database_name,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Database connection failed",
      error: error.message,
    });
  }
});

// Get all residents with user and sitio info
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

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to fetch residents",
      error: error.message,
    });
  }
});

// Get verified residents for map plotting
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

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to fetch map residents",
      error: error.message,
    });
  }
});

// Get pending verification documents
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
      INNER JOIN users ON verification_documents.uid = users.uid
      INNER JOIN document_types ON verification_documents.type_id = document_types.type_id
      WHERE verification_documents.review_status = 'Pending'
      ORDER BY verification_documents.uploaded_at DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to fetch pending documents",
      error: error.message,
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`PriorityCare API running on http://localhost:${port}`);
});