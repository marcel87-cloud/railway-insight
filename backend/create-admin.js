require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

async function createAdmin() {
  const name = (process.env.ADMIN_NAME || '').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if (name.length < 2) throw new Error("Set ADMIN_NAME to the administrator's full name.");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Set ADMIN_EMAIL to a valid email address.');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');

  const hash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')
     ON DUPLICATE KEY UPDATE name=?, password=?, role='admin'`,
    [name, email, hash, name, hash]);
  console.log(`Administrator account provisioned for ${email}.`);
}

createAdmin()
  .catch((error) => {
    console.error('Administrator provisioning failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
