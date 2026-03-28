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
    "http://23.254.133.138:4000"
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());

/* HEALTH CHECK */
app.get("/", (req, res) => {
  res.send("Backend is running");
});

/* TEST DATABASE */
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

    // TEMP: supports your placeholder passwords
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

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.request()
      .input("firstName", sql.VarChar(100), firstName)
      .input("lastName", sql.VarChar(100), lastName)
      .input("email", sql.VarChar(255), email)
      .input("passwordHash", sql.VarChar(255), passwordHash)
      .input("role", sql.VarChar(50), "student")
      .input("status", sql.VarChar(50), "active")
      .query(`
        INSERT INTO USERS (FirstName, LastName, Email, PasswordHash, UserRole, JoinDate, Status)
        VALUES (@firstName, @lastName, @email, @passwordHash, @role, GETDATE(), @status)
      `);

    res.json({ message: "Account created" });

  } catch (err) {
    console.error(err);

    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Email already exists" });
    }

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
      SELECT ListingID, UserID, CategoryID, Title, Price, Condition, Description, Status, DatePosted
      FROM LISTINGS
      ORDER BY DatePosted DESC
    `);

    res.json(result.recordset);

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
    return res.status(400).json({ error: "Missing fields" });

  try {
    const pool = await getConnection();

    await pool.request()
      .input("userId", sql.Int, userId)
      .input("categoryId", sql.Int, categoryId)
      .input("title", sql.VarChar(255), title)
      .input("price", sql.Decimal(10, 2), price)
      .input("condition", sql.VarChar(50), condition)
      .input("description", sql.Text, description)
      .input("status", sql.VarChar(50), "Active")
      .query(`
        INSERT INTO LISTINGS (UserID, CategoryID, Title, Price, Condition, Description, Status, DatePosted)
        VALUES (@userId, @categoryId, @title, @price, @condition, @description, @status, GETDATE())
      `);

    res.json({ message: "Listing created" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Insert failed" });
  }
});



app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});