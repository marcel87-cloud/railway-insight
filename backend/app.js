require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');

const app = express();
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production.');
}
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(cors());
app.use(express.json());

// Photos are saved on disk. On Railway, attach a Volume and set UPLOAD_DIR to its mount path
// (e.g. /data/uploads) so photos survive redeploys.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// Make sure the database tables exist before the first API request is handled.
let dbReady;
app.use('/api', (req, res, next) => {
  dbReady = dbReady || initDb();
  dbReady.then(() => next()).catch((e) => {
    console.error('Database initialization failed:', e);
    dbReady = null;
    fail(res, 500, 'Cannot reach the database. Please try again later.');
  });
});

// ---------- photo upload ----------
const MAX_PHOTO_MB = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

async function savePhoto(file) {
  if (!file) return null;
  const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname).toLowerCase();
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), file.buffer);
  return `/uploads/${name}`;
}

// ---------- helpers ----------
const fail = (res, status, message, errors) => res.status(status).json({ message, errors });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e);
  fail(res, 500, 'Server error. Please try again.');
});

async function readUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try {
    const p = jwt.verify(h.slice(7), SECRET);
    const [[revoked]] = await db.query('SELECT jti FROM revoked_tokens WHERE jti=?', [p.jti]);
    if (revoked) return null;
    const [[u]] = await db.query('SELECT id,name,role FROM users WHERE id=?', [p.id]);
    return u ? { ...u, jti: p.jti, exp: p.exp } : null;
  } catch { return null; }
}
const optionalUser = (req, res, next) => readUser(req).then((u) => { req.user = u; next(); });
const requireUser = async (req, res, next) => {
  req.user = await readUser(req);
  if (!req.user) return fail(res, 401, 'Please log in to continue.');
  next();
};
const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : fail(res, 403, 'Only the administrator can do this.');

const signToken = (u) =>
  jwt.sign({ id: u.id, role: u.role, jti: crypto.randomUUID() }, SECRET, { expiresIn: '8h' });

// ---------- auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name = '', email = '', password = '' } = req.body;
  const e = {};
  if (name.trim().length < 2) e.name = 'Enter your full name.';
  if (!/^\S+@\S+\.\S+$/.test(email)) e.email = 'Enter a valid email address.';
  if (password.length < 8) e.password = 'Use at least 8 characters for your password.';
  if (Object.keys(e).length) return fail(res, 400, 'Please correct the highlighted fields.', e);

  const [[exists]] = await db.query('SELECT id FROM users WHERE email=?', [email.trim()]);
  if (exists) return fail(res, 409, 'That email is already registered.', { email: 'This email is already registered. Log in instead.' });

  const hash = await bcrypt.hash(password, 10);
  const [r] = await db.query('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)',
    [name.trim(), email.trim(), hash, 'student']);   // new users are always students
  const user = { id: r.insertId, name: name.trim(), email: email.trim(), role: 'student' };
  res.status(201).json({ token: signToken(user), user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email = '', password = '' } = req.body;
  const [[u]] = await db.query('SELECT * FROM users WHERE email=?', [email.trim()]);
  if (!u || !(await bcrypt.compare(password, u.password)))
    return fail(res, 401, 'Email or password is incorrect. Check them and try again.');
  res.json({ token: signToken(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

app.post('/api/auth/logout', requireUser, wrap(async (req, res) => {
  await db.query('INSERT IGNORE INTO revoked_tokens (jti) VALUES (?)', [req.user.jti]);
  res.json({ ok: true });
}));

// ---------- items ----------
const PUBLIC = 'id,type,title,category,description,date,location,photo_url,status';

app.get('/api/items', wrap(async (req, res) => {
  const { q, type, category, location, date, status } = req.query;
  const where = []; const args = [];
  if (q) {
    where.push('(title LIKE ? OR description LIKE ? OR category LIKE ? OR location LIKE ?)');
    args.push(...Array(4).fill(`%${q}%`));
  }
  for (const [col, val] of Object.entries({ type, category, location, date, status }))
    if (val) { where.push(`${col}=?`); args.push(val); }
  const [rows] = await db.query(
    `SELECT ${PUBLIC} FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`, args);
  res.json(rows);   // never includes private_details
}));

app.get('/api/items/:id', optionalUser, wrap(async (req, res) => {
  const [[item]] = await db.query(`SELECT ${PUBLIC}, reporter_id, private_details FROM items WHERE id=?`, [req.params.id]);
  if (!item) return fail(res, 404, 'This report does not exist.');
  const u = req.user;
  const isOwner = !!u && u.id === item.reporter_id;
  const out = { ...item, is_owner: isOwner };
  if (!(isOwner || (u && u.role === 'admin'))) delete out.private_details;
  delete out.reporter_id;
  if (u) {
    const [[c]] = await db.query(
      'SELECT id,status,evidence,admin_reason FROM claims WHERE item_id=? AND claimant_id=?', [item.id, u.id]);
    if (c) out.my_claim = c;
  }
  res.json(out);
}));

function validateItem(f) {
  const e = {};
  if (!f.title || f.title.trim().length < 3) e.title = 'Title must be at least 3 characters.';
  if (!f.category) e.category = 'Choose a category.';
  if (!f.description || f.description.trim().length < 10) e.description = 'Description must be at least 10 characters.';
  if (!f.date) e.date = 'Choose a date.';
  if (!f.location) e.location = 'Choose a location.';
  if (f.type === 'found' && !(f.private_details || '').trim()) e.private_details = 'Found items need private identifying details.';
  return Object.keys(e).length ? e : null;
}

app.post('/api/items', requireUser, upload.single('photo'), wrap(async (req, res) => {
  const f = req.body;
  if (!['lost', 'found'].includes(f.type)) return fail(res, 400, 'Choose lost or found.', { type: 'Choose lost or found.' });
  const e = validateItem(f);
  if (e) return fail(res, 400, 'Please correct the highlighted fields.', e);
  const photoUrl = await savePhoto(req.file);
  const [r] = await db.query(
    `INSERT INTO items (reporter_id,type,title,category,description,date,location,private_details,photo_url)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.user.id, f.type, f.title.trim(), f.category, f.description.trim(), f.date, f.location,
     f.type === 'found' ? f.private_details.trim() : '', photoUrl || '']);
  res.status(201).json({ id: r.insertId });
}));

app.put('/api/items/:id', requireUser, upload.single('photo'), wrap(async (req, res) => {
  const [[item]] = await db.query('SELECT * FROM items WHERE id=?', [req.params.id]);
  if (!item) return fail(res, 404, 'This report does not exist.');
  if (item.reporter_id !== req.user.id && req.user.role !== 'admin')
    return fail(res, 403, 'You can only edit your own reports.');
  if (item.status === 'returned') return fail(res, 409, 'A returned item can no longer be edited.');
  const f = { ...req.body, type: item.type };
  const e = validateItem(f);
  if (e) return fail(res, 400, 'Please correct the highlighted fields.', e);
  const photoUrl = await savePhoto(req.file);
  await db.query(
    `UPDATE items SET title=?,category=?,description=?,date=?,location=?,private_details=?,photo_url=? WHERE id=?`,
    [f.title.trim(), f.category, f.description.trim(), f.date, f.location,
     item.type === 'found' ? f.private_details.trim() : '',
     photoUrl || item.photo_url, item.id]);
  res.json({ id: item.id });
}));

app.get('/api/my/items', requireUser, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT ${PUBLIC}, private_details FROM items WHERE reporter_id=? ORDER BY id DESC`, [req.user.id]);
  res.json(rows.map((r) => ({ ...r, is_owner: true })));
}));

// ---------- claims ----------
app.post('/api/items/:id/claims', requireUser, wrap(async (req, res) => {
  const evidence = (req.body.evidence || '').trim();
  if (evidence.length < 15) return fail(res, 400, 'Please give at least 15 characters of evidence.', { evidence: 'Please give at least 15 characters of evidence.' });
  const [[item]] = await db.query('SELECT id,type,status,reporter_id FROM items WHERE id=?', [req.params.id]);
  if (!item) return fail(res, 404, 'This report does not exist.');
  if (item.type !== 'found') return fail(res, 400, 'Only found items can be claimed.');
  if (item.reporter_id === req.user.id) return fail(res, 403, 'You cannot claim an item you reported as found.');
  if (item.status === 'returned') return fail(res, 409, 'This item was already returned, so it cannot be claimed.');
  const [[dup]] = await db.query('SELECT id FROM claims WHERE item_id=? AND claimant_id=?', [item.id, req.user.id]);
  if (dup) return fail(res, 409, 'You already claimed this item.');
  const [r] = await db.query('INSERT INTO claims (item_id,claimant_id,evidence) VALUES (?,?,?)', [item.id, req.user.id, evidence]);
  res.status(201).json({ id: r.insertId, item_id: item.id, status: 'pending', evidence });
}));

app.get('/api/my/claims', requireUser, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT c.id, c.item_id, i.title AS item_title, c.status, c.admin_reason, c.created_at
     FROM claims c JOIN items i ON i.id=c.item_id WHERE c.claimant_id=? ORDER BY c.id DESC`, [req.user.id]);
  res.json(rows);
}));

// ---------- admin ----------
app.get('/api/admin/profile', requireUser, requireAdmin, wrap(async (req, res) => {
  const [[user]] = await db.query('SELECT id,name,email,role FROM users WHERE id=?', [req.user.id]);
  if (!user) return fail(res, 404, 'Administrator account not found.');
  res.json(user);
}));

app.patch('/api/admin/profile', requireUser, requireAdmin, wrap(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const errors = {};
  if (name.length < 2) errors.name = 'Enter your full name.';
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!currentPassword) errors.currentPassword = 'Enter your current password to confirm these changes.';
  if (newPassword && newPassword.length < 12)
    errors.newPassword = 'Use at least 12 characters for your new password.';
  if (Object.keys(errors).length) return fail(res, 400, 'Please correct the highlighted fields.', errors);

  const [[account]] = await db.query('SELECT password FROM users WHERE id=? AND role=?', [req.user.id, 'admin']);
  if (!account) return fail(res, 404, 'Administrator account not found.');
  if (!(await bcrypt.compare(currentPassword, account.password)))
    return fail(res, 403, 'Current password is incorrect.', { currentPassword: 'Enter your current password.' });

  const [[duplicate]] = await db.query('SELECT id FROM users WHERE email=? AND id<>?', [email, req.user.id]);
  if (duplicate) return fail(res, 409, 'That email is already registered.', { email: 'This email is already registered.' });

  const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : account.password;
  await db.query('UPDATE users SET name=?,email=?,password=? WHERE id=?',
    [name, email, passwordHash, req.user.id]);
  res.json({ user: { id: req.user.id, name, email, role: 'admin' } });
}));

app.get('/api/admin/users', requireUser, requireAdmin, wrap(async (req, res) => {
  const [users] = await db.query(
    "SELECT id,name,email FROM users WHERE role='admin' ORDER BY name,id");
  res.json(users);
}));

app.post('/api/admin/users', requireUser, requireAdmin, wrap(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const errors = {};
  if (name.length < 2) errors.name = "Enter the new administrator's full name.";
  if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 12) errors.password = 'Use at least 12 characters for the initial password.';
  if (Object.keys(errors).length) return fail(res, 400, 'Please correct the highlighted fields.', errors);

  const [[exists]] = await db.query('SELECT id FROM users WHERE email=?', [email]);
  if (exists) return fail(res, 409, 'That email is already registered.', { email: 'This email is already registered.' });

  const hash = await bcrypt.hash(password, 12);
  const [result] = await db.query('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)',
    [name, email, hash, 'admin']);
  res.status(201).json({ id: result.insertId, name, email, role: 'admin' });
}));

app.get('/api/admin/items', requireUser, requireAdmin, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT items.id, items.type, items.title, items.category, items.description,
            items.date, items.location, items.photo_url, items.status,
            users.name AS reporter_name
     FROM items JOIN users ON users.id=items.reporter_id
     ORDER BY items.id DESC`);
  res.json(rows);
}));

app.delete('/api/admin/items/:id', requireUser, requireAdmin, wrap(async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[item]] = await conn.query('SELECT id FROM items WHERE id=? FOR UPDATE', [req.params.id]);
    if (!item) {
      await conn.rollback();
      return fail(res, 404, 'This report does not exist.');
    }
    await conn.query('DELETE FROM claims WHERE item_id=?', [item.id]);
    await conn.query('DELETE FROM items WHERE id=?', [item.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

app.get('/api/admin/claims', requireUser, requireAdmin, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT c.id, c.item_id, i.title AS item_title, i.status AS item_status,
            i.private_details AS item_private_details, u.name AS claimant_name,
            c.evidence, c.status, c.admin_reason, c.created_at
     FROM claims c JOIN items i ON i.id=c.item_id JOIN users u ON u.id=c.claimant_id
     ORDER BY c.id DESC`);
  res.json(rows);
}));

app.patch('/api/admin/claims/:id', requireUser, requireAdmin, wrap(async (req, res) => {
  const { decision, reason = '' } = req.body;
  if (!['approved', 'rejected'].includes(decision)) return fail(res, 400, 'Decision must be approved or rejected.');
  if (reason.trim().length < 5) return fail(res, 400, 'A reason is required.', { reason: 'A reason is required.' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[claim]] = await conn.query('SELECT * FROM claims WHERE id=? FOR UPDATE', [req.params.id]);
    if (!claim) { await conn.rollback(); return fail(res, 404, 'This claim does not exist.'); }
    if (claim.status !== 'pending') { await conn.rollback(); return fail(res, 409, 'This claim was already decided.'); }
    const [[item]] = await conn.query('SELECT id,status FROM items WHERE id=? FOR UPDATE', [claim.item_id]);
    if (decision === 'approved') {
      if (item.status === 'returned') { await conn.rollback(); return fail(res, 409, 'This item was already returned.'); }
      const [[other]] = await conn.query("SELECT id FROM claims WHERE item_id=? AND status='approved'", [item.id]);
      if (other) { await conn.rollback(); return fail(res, 409, 'Another claim for this item is already approved. Reject this one or confirm the return first.'); }
    }
    await conn.query('UPDATE claims SET status=?, admin_reason=? WHERE id=?', [decision, reason.trim(), claim.id]);
    await conn.commit();
    res.json({ ...claim, status: decision, admin_reason: reason.trim() });
  } catch (e) {
    await conn.rollback(); console.error(e); fail(res, 500, 'Server error. Please try again.');
  } finally { conn.release(); }
}));

app.post('/api/admin/items/:id/return', requireUser, requireAdmin, wrap(async (req, res) => {
  const [[item]] = await db.query('SELECT id FROM items WHERE id=?', [req.params.id]);
  if (!item) return fail(res, 404, 'This report does not exist.');
  const [[ok]] = await db.query("SELECT id FROM claims WHERE item_id=? AND status='approved'", [item.id]);
  if (!ok) return fail(res, 409, 'Approve a claim before confirming a return.');
  await db.query("UPDATE items SET status='returned' WHERE id=?", [item.id]);
  res.json({ ok: true });
}));

// ---------- serve the built React frontend (production) ----------
const DIST = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  // any non-API path returns index.html so React Router routes survive a refresh
  app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// multer errors (file too big etc.)
app.use((err, req, res, next) => fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? `Photo must be under ${MAX_PHOTO_MB} MB.` : 'Upload failed.'));

async function ensureTables() {
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('student','admin') NOT NULL DEFAULT 'student',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reporter_id INT NOT NULL,
    type ENUM('lost','found') NOT NULL,
    title VARCHAR(200) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    date DATE NOT NULL,
    location VARCHAR(100) NOT NULL,
    private_details TEXT,
    photo_url VARCHAR(255) DEFAULT '',
    status ENUM('open','returned') NOT NULL DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reporter_id) REFERENCES users(id)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS claims (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_id INT NOT NULL,
    claimant_id INT NOT NULL,
    evidence TEXT NOT NULL,
    status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    admin_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY one_claim_per_user (item_id, claimant_id),
    FOREIGN KEY (item_id) REFERENCES items(id),
    FOREIGN KEY (claimant_id) REFERENCES users(id)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti VARCHAR(64) PRIMARY KEY,
    revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function ensureItemDateColumn() {
  const [columns] = await db.query("SHOW COLUMNS FROM items LIKE 'date'");
  if (columns.length) return;

  await db.query('ALTER TABLE items ADD COLUMN date DATE NULL');
  await db.query('UPDATE items SET date = DATE(created_at) WHERE date IS NULL');
  await db.query('ALTER TABLE items MODIFY COLUMN date DATE NOT NULL');
  console.log('Added the missing items.date column.');
}

async function ensureClaimColumns() {
  const [columns] = await db.query('SHOW COLUMNS FROM claims');
  const names = new Set(columns.map(({ Field }) => Field));

  if (!names.has('item_id')) {
    await db.query('ALTER TABLE claims ADD COLUMN item_id INT NULL');
    if (names.has('report_id')) {
      await db.query('UPDATE claims SET item_id = report_id WHERE item_id IS NULL');
    }
  }
  if (!names.has('claimant_id')) {
    await db.query('ALTER TABLE claims ADD COLUMN claimant_id INT NULL');
    if (names.has('user_id')) {
      await db.query('UPDATE claims SET claimant_id = user_id WHERE claimant_id IS NULL');
    }
  }
  if (!names.has('evidence')) {
    await db.query('ALTER TABLE claims ADD COLUMN evidence TEXT NULL');
    await db.query(names.has('message')
      ? "UPDATE claims SET evidence = COALESCE(message, '')"
      : "UPDATE claims SET evidence = ''");
    await db.query('ALTER TABLE claims MODIFY COLUMN evidence TEXT NOT NULL');
  }
  if (!names.has('admin_reason')) {
    await db.query('ALTER TABLE claims ADD COLUMN admin_reason TEXT NULL');
  }
  if (!names.has('status')) {
    await db.query("ALTER TABLE claims ADD COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'");
  }
  if (!names.has('created_at')) {
    await db.query('ALTER TABLE claims ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
  }
}

async function initDb() {
  await ensureTables();
  await ensureClaimColumns();
  await ensureItemDateColumn();
}

app.initDb = () => (dbReady = dbReady || initDb());
module.exports = app;
