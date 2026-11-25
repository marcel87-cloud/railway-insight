// Creates the demo accounts with properly hashed passwords.  Run:  npm run seed
const bcrypt = require('bcryptjs');
const db = require('./db');

(async () => {
  const hash = await bcrypt.hash('password123', 10);
  const users = [
    ['Namusoke Ruth', 'namusoke@students.ucu.ac.ug', 'student'],
    ['Okello James', 'okello@students.ucu.ac.ug', 'student'],
  ];
  for (const [name, email, role] of users) {
    await db.query(
      'INSERT INTO users (name, email, password, role) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)',
      [name, email, hash, role]);
  }
  console.log('Seeded demo users (password: password123)');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
