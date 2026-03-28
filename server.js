require("dotenv").config({ path: __dirname + "/.env" });

const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getConnection } = require("./db");

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || "starkswap_secret";

console.log("DB_SERVER:", process.env.DB_SERVER);

app.use(cors({
  origin: [
    "http://23.254.133.138",
    "http://23.254.133.138:4000",
    "http://23.254.133.138:80",
    // Allow GitHub Pages / raw GitHub serving if used
    "https://jsamman0712.github.io"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());

/* ===========================
   HEALTH CHECK
=========================== */
app.get("/", (req, res) => {
  res.send("Backend is running");
});

/* ===========================
   TEST DATABASE
=========================== */
app.get("/test-db", async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query("SELECT GETDATE() AS CurrentDate");
    res.json(result.recordset);
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ===========================
   LOGIN
=========================== */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("email", sql.VarChar(255), email)
      .query("SELECT * FROM USERS WHERE Email = @email");

    const user = result.recordset[0];

    if (!user)
      return res.status(401).json({ error: "Invalid email or password" });

    if (user.Status !== "active")
      return res.status(403).json({ error: "Account not active" });

    let match = false;

    // Supports placeholder passwords (HASHED_PLACEHOLDER_xx) for demo data
    if (user.PasswordHash.startsWith("HASHED_")) {
      match = user.PasswordHash === password;
    } else {
      match = await bcrypt.compare(password, user.PasswordHash);
    }

    if (!match)
      return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign(
      {
        id: user.UserID,
        email: user.Email,
        role: user.UserRole,
        firstName: user.FirstName
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.UserID,
        firstName: user.FirstName,
        lastName: user.LastName,
        username: user.Username,
        email: user.Email,
        role: user.UserRole
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ===========================
   REGISTER
=========================== */
app.post("/api/register", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  if (!firstName || !lastName || !email || !password)
    return res.status(400).json({ error: "All fields required" });

  try {
    const pool = await getConnection();

    // Check if email already exists
    const existing = await pool.request()
      .input("email", sql.VarChar(255), email)
      .query("SELECT UserID FROM USERS WHERE Email = @email");

    if (existing.recordset.length > 0)
      return res.status(409).json({ error: "Email already exists" });

    const passwordHash = await bcrypt.hash(password, 10);
    // Auto-generate username from email (part before @)
    const username = email.split("@")[0];

    await pool.request()
      .input("firstName", sql.VarChar(100), firstName)
      .input("lastName", sql.VarChar(100), lastName)
      .input("username", sql.VarChar(100), username)
      .input("email", sql.VarChar(255), email)
      .input("passwordHash", sql.VarChar(255), passwordHash)
      .input("role", sql.VarChar(50), "student")
      .input("status", sql.VarChar(50), "active")
      .query(`
        INSERT INTO USERS (FirstName, LastName, Username, Email, PasswordHash, UserRole, JoinDate, Status)
        VALUES (@firstName, @lastName, @username, @email, @passwordHash, @role, GETDATE(), @status)
      `);

    res.json({ message: "Account created successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ===========================
   GET LISTINGS
=========================== */
app.get("/api/listings", async (req, res) => {
  try {
    const pool = await getConnection();

    const result = await pool.request().query(`
      SELECT 
        l.ListingID, l.UserID, l.CategoryID, l.Title, l.Price,
        l.Condition, l.Description, l.Status, l.DatePosted,
        u.FirstName + ' ' + u.LastName AS SellerName,
        c.CategoryName
      FROM LISTINGS l
      JOIN USERS u ON l.UserID = u.UserID
      JOIN CATEGORY c ON l.CategoryID = c.CategoryID
      WHERE l.Status = 'Active'
      ORDER BY l.DatePosted DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===========================
   GET SINGLE LISTING
=========================== */
app.get("/api/listings/:id", async (req, res) => {
  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("id", sql.Int, req.params.id)
      .query(`
        SELECT 
          l.ListingID, l.UserID, l.CategoryID, l.Title, l.Price,
          l.Condition, l.Description, l.Status, l.DatePosted,
          u.FirstName + ' ' + u.LastName AS SellerName,
          u.Email AS SellerEmail,
          c.CategoryName
        FROM LISTINGS l
        JOIN USERS u ON l.UserID = u.UserID
        JOIN CATEGORY c ON l.CategoryID = c.CategoryID
        WHERE l.ListingID = @id
      `);

    if (result.recordset.length === 0)
      return res.status(404).json({ error: "Listing not found" });

    res.json(result.recordset[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===========================
   CREATE LISTING
=========================== */
app.post("/api/listings", async (req, res) => {
  const { userId, categoryId, title, price, condition, description } = req.body;

  if (!userId || !categoryId || !title || !price)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    const pool = await getConnection();

    await pool.request()
      .input("userId", sql.Int, userId)
      .input("categoryId", sql.Int, categoryId)
      .input("title", sql.VarChar(255), title)
      .input("price", sql.Decimal(10, 2), price)
      .input("condition", sql.VarChar(50), condition || "Good")
      .input("description", sql.Text, description || "")
      .input("status", sql.VarChar(50), "Active")
      .query(`
        INSERT INTO LISTINGS (UserID, CategoryID, Title, Price, Condition, Description, Status, DatePosted)
        VALUES (@userId, @categoryId, @title, @price, @condition, @description, @status, GETDATE())
      `);

    res.json({ message: "Listing created successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create listing" });
  }
});

/* ===========================
   GET CATEGORIES
=========================== */
app.get("/api/categories", async (req, res) => {
  try {
    const pool = await getConnection();
    const result = await pool.request().query("SELECT * FROM CATEGORY ORDER BY CategoryName");
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===========================
   GET MESSAGES FOR USER
=========================== */
app.get("/api/messages/:userId", async (req, res) => {
  try {
    const pool = await getConnection();

    const result = await pool.request()
      .input("userId", sql.Int, req.params.userId)
      .query(`
        SELECT 
          m.MessageID, m.SenderID, m.ReceiverID, m.ListingID,
          m.MessageDescription, m.TimeStamp,
          s.FirstName + ' ' + s.LastName AS SenderName,
          r.FirstName + ' ' + r.LastName AS ReceiverName,
          l.Title AS ListingTitle
        FROM MESSAGES m
        JOIN USERS s ON m.SenderID = s.UserID
        JOIN USERS r ON m.ReceiverID = r.UserID
        JOIN LISTINGS l ON m.ListingID = l.ListingID
        WHERE m.SenderID = @userId OR m.ReceiverID = @userId
        ORDER BY m.TimeStamp DESC
      `);

    res.json(result.recordset);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ===========================
   SEND MESSAGE
=========================== */
app.post("/api/messages", async (req, res) => {
  const { senderId, receiverId, listingId, message } = req.body;

  if (!senderId || !receiverId || !listingId || !message)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    const pool = await getConnection();

    await pool.request()
      .input("senderId", sql.Int, senderId)
      .input("receiverId", sql.Int, receiverId)
      .input("listingId", sql.Int, listingId)
      .input("message", sql.Text, message)
      .query(`
        INSERT INTO MESSAGES (SenderID, ReceiverID, ListingID, MessageDescription, TimeStamp)
        VALUES (@senderId, @receiverId, @listingId, @message, GETDATE())
      `);

    res.json({ message: "Message sent" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});