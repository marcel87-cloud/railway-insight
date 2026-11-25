// Starts the app (used by Railway and for local development).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const app = require('./app');
const db = require('./db');

const PORT = process.env.PORT || 5000;

// If ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD are set, make sure that administrator exists.
// An existing account keeps its current password.
async function ensureAdmin() {
  const name = (process.env.ADMIN_NAME || '').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) return;
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12) {
    console.warn('Admin not created: need ADMIN_NAME, a valid ADMIN_EMAIL and an ADMIN_PASSWORD of 12+ characters.');
    return;
  }
  const hash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')
     ON DUPLICATE KEY UPDATE role='admin'`, [name, email, hash]);
  console.log(`Administrator ready: ${email}`);
}

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
app.initDb().then(ensureAdmin).catch((e) => console.error('Database startup failed:', e.message));
