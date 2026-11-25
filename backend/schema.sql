-- UCU Lost & Found database. Run once:  mysql -u root -p < schema.sql
CREATE DATABASE IF NOT EXISTS ucu_lost_found CHARACTER SET utf8mb4;
USE ucu_lost_found;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,            -- bcrypt hash, never plain text
  role ENUM('student','admin') NOT NULL DEFAULT 'student',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT NOT NULL,
  type ENUM('lost','found') NOT NULL,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  date DATE NOT NULL,
  location VARCHAR(100) NOT NULL,
  private_details TEXT,                      -- only owner/admin may see
  photo_url VARCHAR(255) DEFAULT '',
  status ENUM('open','returned') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS claims (
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
);

-- Tokens that were logged out (so they stop working)
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti VARCHAR(64) PRIMARY KEY,
  revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
