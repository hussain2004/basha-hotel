
import 'dotenv/config';
import express from 'express';
import Database from 'better-sqlite3';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';
const MAX_STAFF_ACCOUNTS = 6;

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 40) {
  throw new Error('SESSION_SECRET is missing or too short in .env');
}

if (
  !process.env.OWNER_PASSWORD_HASH ||
  !/^\$2[aby]\$12\$/.test(process.env.OWNER_PASSWORD_HASH)
) {
  throw new Error('A valid bcrypt OWNER_PASSWORD_HASH is required in .env');
}

if (isProduction) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// -------------------- SESSION --------------------

app.use(
  session({
    name: 'basha_owner_session',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 2 * 60 * 60 * 1000,
      path: '/',
    },
  }),
);

// -------------------- DATABASE --------------------

const db = new Database('basha-hotel.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customerName TEXT NOT NULL,
    phone TEXT NOT NULL,
    pickupNote TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`);
// Add tracking tokens without deleting existing orders.
const orderColumns = db
  .prepare('PRAGMA table_info(orders)')
  .all();

if (!orderColumns.some((column) => column.name === 'trackingToken')) {
  db.exec('ALTER TABLE orders ADD COLUMN trackingToken TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    passwordHash TEXT NOT NULL,
    isActive INTEGER NOT NULL DEFAULT 1,
    mustChangePassword INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS order_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    actorType TEXT NOT NULL,
    actorUsername TEXT NOT NULL,
    action TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )
`);

function formatOrder(row) {
  const { trackingToken, ...safeOrder } = row;

  return {
    ...safeOrder,
    items: JSON.parse(row.items),
  };
}
// -------------------- LOGIN RATE LIMIT --------------------

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function getClientKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isLoginBlocked(key) {
  const entry = loginAttempts.get(key);

  if (!entry) return false;

  if (Date.now() - entry.windowStartedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }

  return entry.failedAttempts >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(key) {
  const now = Date.now();
  let entry = loginAttempts.get(key);

  if (!entry || now - entry.windowStartedAt >= LOGIN_WINDOW_MS) {
    entry = {
      failedAttempts: 0,
      windowStartedAt: now,
    };
  }

  entry.failedAttempts += 1;
  loginAttempts.set(key, entry);
}

// -------------------- AUTHORIZATION --------------------

function requireOwner(req, res, next) {
  if (req.session.ownerAuthenticated !== true) {
    return res.status(401).json({
      message: 'Owner login required.',
    });
  }

  return next();
}

function requireStaff(req, res, next) {
  if (
    req.session.staffAuthenticated !== true ||
    !Number.isInteger(req.session.staffUserId)
  ) {
    return res.status(401).json({
      message: 'Staff login required.',
    });
  }

  const staff = db
    .prepare(
      'SELECT isActive, mustChangePassword FROM staff_users WHERE id = ?',
    )
    .get(req.session.staffUserId);

  if (!staff || staff.isActive !== 1) {
    req.session.destroy(() => {});

    return res.status(401).json({
      message: 'Staff account is inactive. Please contact the owner.',
    });
  }

  return next();
}

function requireOrderManager(req, res, next) {
  if (req.session.ownerAuthenticated === true) {
    return next();
  }

  if (
    req.session.staffAuthenticated !== true ||
    !Number.isInteger(req.session.staffUserId)
  ) {
    return res.status(401).json({
      message: 'Owner or staff login required.',
    });
  }

  const staff = db
    .prepare(
      'SELECT isActive, mustChangePassword, username FROM staff_users WHERE id = ?',
    )
    .get(req.session.staffUserId);

  if (!staff || staff.isActive !== 1) {
    req.session.destroy(() => {});

    return res.status(401).json({
      message: 'Staff account is inactive. Please sign in again.',
    });
  }

  if (
    staff.mustChangePassword === 1 ||
    req.session.staffMustChangePassword === true
  ) {
    return res.status(403).json({
      message: 'Change your initial password before managing orders.',
      mustChangePassword: true,
    });
  }

  req.staffUsername = staff.username;
  return next();
}

function createTemporaryPassword() {
  return `Bh!${crypto.randomBytes(18).toString('base64url')}9a`;
}

// -------------------- HEALTH CHECK --------------------

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Basha Hotel backend is running!',
  });
});

// -------------------- OWNER LOGIN --------------------

app.post('/api/auth/login', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const key = getClientKey(req);
  const { password } = req.body ?? {};

  if (isLoginBlocked(key)) {
    return res.status(429).json({
      message: 'Too many failed attempts. Please try again in 15 minutes.',
    });
  }

  if (
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > 200
  ) {
    return res.status(400).json({
      message: 'Please enter your password.',
    });
  }

  try {
    const matches = await bcrypt.compare(
      password,
      process.env.OWNER_PASSWORD_HASH,
    );

    if (!matches) {
      recordFailedLogin(key);

      return res.status(401).json({
        message: 'Invalid password.',
      });
    }

    loginAttempts.delete(key);

    req.session.regenerate((error) => {
      if (error) {
        console.error('Owner session regeneration failed:', error);

        return res.status(500).json({
          message: 'Unable to create login session.',
        });
      }

      req.session.ownerAuthenticated = true;

      req.session.save((saveError) => {
        if (saveError) {
          console.error('Owner session save failed:', saveError);

          return res.status(500).json({
            message: 'Unable to save login session.',
          });
        }

        return res.json({
          message: 'Owner login successful.',
        });
      });
    });
  } catch (error) {
    console.error('Owner login verification failed:', error);

    return res.status(500).json({
      message: 'Unable to verify login.',
    });
  }
});

app.get('/api/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');

  res.json({
    authenticated: req.session.ownerAuthenticated === true,
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error('Owner logout failed:', error);

      return res.status(500).json({
        message: 'Unable to log out.',
      });
    }

    res.clearCookie('basha_owner_session', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    });

    return res.json({
      message: 'Logged out successfully.',
    });
  });
});

// -------------------- STAFF LOGIN --------------------

app.post('/api/staff/login', async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const key = getClientKey(req);
  const { username, password } = req.body ?? {};

  if (isLoginBlocked(key)) {
    return res.status(429).json({
      message: 'Too many failed attempts. Please try again in 15 minutes.',
    });
  }

  if (
    typeof username !== 'string' ||
    !/^[a-zA-Z0-9_-]{3,30}$/.test(username) ||
    typeof password !== 'string' ||
    password.length === 0 ||
    password.length > 200
  ) {
    recordFailedLogin(key);

    return res.status(400).json({
      message: 'Please provide a valid username and password.',
    });
  }

  try {
    const staff = db
      .prepare(
        `SELECT id, username, passwordHash, isActive, mustChangePassword
         FROM staff_users
         WHERE username = ? COLLATE NOCASE`,
      )
      .get(username);

    const matches = staff
      ? await bcrypt.compare(password, staff.passwordHash)
      : false;

    if (!staff || !matches || staff.isActive !== 1) {
      recordFailedLogin(key);

      return res.status(401).json({
        message: 'Invalid username or password.',
      });
    }

    loginAttempts.delete(key);

    req.session.regenerate((error) => {
      if (error) {
        console.error('Staff session regeneration failed:', error);

        return res.status(500).json({
          message: 'Unable to create staff login session.',
        });
      }

      req.session.staffAuthenticated = true;
      req.session.staffUserId = staff.id;
      req.session.staffMustChangePassword =
        staff.mustChangePassword === 1;

      req.session.save((saveError) => {
        if (saveError) {
          console.error('Staff session save failed:', saveError);

          return res.status(500).json({
            message: 'Unable to save staff login session.',
          });
        }

        return res.json({
          message: 'Staff login successful.',
          mustChangePassword: staff.mustChangePassword === 1,
        });
      });
    });
  } catch (error) {
    console.error('Staff login verification failed:', error);

    return res.status(500).json({
      message: 'Unable to verify staff login.',
    });
  }
});

app.get('/api/staff/me', (req, res) => {
  res.set('Cache-Control', 'no-store');

  if (
    req.session.staffAuthenticated !== true ||
    !Number.isInteger(req.session.staffUserId)
  ) {
    return res.json({
      authenticated: false,
      mustChangePassword: false,
    });
  }

  const staff = db
    .prepare(
      'SELECT isActive, mustChangePassword FROM staff_users WHERE id = ?',
    )
    .get(req.session.staffUserId);

  if (!staff || staff.isActive !== 1) {
    req.session.destroy(() => {});

    return res.json({
      authenticated: false,
      mustChangePassword: false,
    });
  }

  return res.json({
    authenticated: true,
    mustChangePassword: staff.mustChangePassword === 1,
  });
});

// -------------------- STAFF PASSWORD CHANGE --------------------

app.post('/api/staff/change-password', requireStaff, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const { currentPassword, newPassword } = req.body ?? {};

  if (
    typeof currentPassword !== 'string' ||
    typeof newPassword !== 'string' ||
    newPassword.length < 12 ||
    newPassword.length > 200
  ) {
    return res.status(400).json({
      message:
        'Enter your current password and a new password of at least 12 characters.',
    });
  }

  try {
    const staff = db
      .prepare(
        'SELECT id, passwordHash, isActive FROM staff_users WHERE id = ?',
      )
      .get(req.session.staffUserId);

    if (!staff || staff.isActive !== 1) {
      req.session.destroy(() => {});

      return res.status(401).json({
        message: 'Staff account is inactive. Please contact the owner.',
      });
    }

    const matches = await bcrypt.compare(
      currentPassword,
      staff.passwordHash,
    );

    if (!matches) {
      return res.status(401).json({
        message: 'Current password is incorrect.',
      });
    }

    const hash = await bcrypt.hash(newPassword, 12);

    db.prepare(
      `UPDATE staff_users
       SET passwordHash = ?, mustChangePassword = 0, updatedAt = ?
       WHERE id = ?`,
    ).run(hash, new Date().toISOString(), staff.id);

    req.session.staffMustChangePassword = false;

    req.session.save((error) => {
      if (error) {
        console.error('Staff password-change session save failed:', error);

        return res.status(500).json({
          message:
            'Password changed, but the session could not be saved. Please sign in again.',
        });
      }

      return res.json({
        message: 'Password changed successfully.',
      });
    });
  } catch (error) {
    console.error('Staff password change failed:', error);

    return res.status(500).json({
      message: 'Unable to change password.',
    });
  }
});

app.post('/api/staff/logout', requireStaff, (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        message: 'Unable to log out.',
      });
    }

    res.clearCookie('basha_owner_session', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    });

    return res.json({
      message: 'Logged out successfully.',
    });
  });
});

// -------------------- OWNER-ONLY STAFF MANAGEMENT --------------------

app.get('/api/staff', requireOwner, (_req, res) => {
  res.set('Cache-Control', 'no-store');

  const staff = db
    .prepare(
      `SELECT id, username, isActive, mustChangePassword, createdAt, updatedAt
       FROM staff_users
       ORDER BY id ASC`,
    )
    .all();

  return res.json({
    staff,
    maxStaffAccounts: MAX_STAFF_ACCOUNTS,
  });
});

app.post('/api/staff', requireOwner, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const { username } = req.body ?? {};

  if (
    typeof username !== 'string' ||
    !/^[a-zA-Z0-9_-]{3,30}$/.test(username)
  ) {
    return res.status(400).json({
      message:
        'Username must be 3–30 characters using letters, numbers, underscores or hyphens.',
    });
  }

  const total = db
    .prepare('SELECT COUNT(*) AS count FROM staff_users')
    .get().count;

  if (total >= MAX_STAFF_ACCOUNTS) {
    return res.status(409).json({
      message:
        'The maximum of six staff accounts has been reached. Disable an unused account and reset it if needed.',
    });
  }

  const temporaryPassword = createTemporaryPassword();

  try {
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const now = new Date().toISOString();

    const result = db
      .prepare(
        `INSERT INTO staff_users
         (username, passwordHash, isActive, mustChangePassword, createdAt)
         VALUES (?, ?, 1, 1, ?)`,
      )
      .run(username, passwordHash, now);

    return res.status(201).json({
      message:
        'Staff account created. Share this temporary password securely; it will not be shown again.',
      staff: {
        id: Number(result.lastInsertRowid),
        username,
        isActive: true,
        mustChangePassword: true,
      },
      temporaryPassword,
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({
        message: 'That username is already in use.',
      });
    }

    console.error('Staff account creation failed:', error);

    return res.status(500).json({
      message: 'Unable to create staff account.',
    });
  }
});

app.patch('/api/staff/:id/active', requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const { isActive } = req.body ?? {};

  if (
    !Number.isInteger(id) ||
    id < 1 ||
    typeof isActive !== 'boolean'
  ) {
    return res.status(400).json({
      message: 'Provide a valid staff ID and active status.',
    });
  }

  const staff = db
    .prepare('SELECT id, username FROM staff_users WHERE id = ?')
    .get(id);

  if (!staff) {
    return res.status(404).json({
      message: 'Staff account not found.',
    });
  }

  db.prepare(
    'UPDATE staff_users SET isActive = ?, updatedAt = ? WHERE id = ?',
  ).run(isActive ? 1 : 0, new Date().toISOString(), id);

  return res.json({
    message: isActive
      ? 'Staff account enabled.'
      : 'Staff account disabled.',
  });
});

app.post('/api/staff/:id/reset-password', requireOwner, async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      message: 'Invalid staff ID.',
    });
  }

  const staff = db
    .prepare('SELECT id, username FROM staff_users WHERE id = ?')
    .get(id);

  if (!staff) {
    return res.status(404).json({
      message: 'Staff account not found.',
    });
  }

  const temporaryPassword = createTemporaryPassword();

  try {
    const hash = await bcrypt.hash(temporaryPassword, 12);

    db.prepare(
      `UPDATE staff_users
       SET passwordHash = ?, mustChangePassword = 1, updatedAt = ?
       WHERE id = ?`,
    ).run(hash, new Date().toISOString(), id);

    return res.json({
      message:
        'Temporary password reset. Share it securely; it will not be shown again.',
      staff: {
        id: staff.id,
        username: staff.username,
      },
      temporaryPassword,
    });
  } catch (error) {
    console.error('Staff password reset failed:', error);

    return res.status(500).json({
      message: 'Unable to reset staff password.',
    });
  }
});

app.get('/api/staff/:id/activity', requireOwner, (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      message: 'Invalid staff ID.',
    });
  }

  const staff = db
    .prepare('SELECT id, username FROM staff_users WHERE id = ?')
    .get(id);

  if (!staff) {
    return res.status(404).json({
      message: 'Staff account not found.',
    });
  }

  const activity = db
    .prepare(
      `SELECT id, orderId, actorType, actorUsername, action, createdAt
       FROM order_activity
       WHERE actorType = ? AND actorUsername = ?
       ORDER BY id DESC
       LIMIT 100`,
    )
    .all('staff', staff.username);

  return res.json({
    staff,
    activity,
  });
});

// -------------------- CUSTOMER PICKUP REQUESTS --------------------

app.post('/api/orders', (req, res) => {
  const { customerName, phone, pickupNote, items } = req.body ?? {};

  if (
    typeof customerName !== 'string' ||
    !customerName.trim() ||
    typeof phone !== 'string' ||
    !/^[0-9]{10}$/.test(phone) ||
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > 50
  ) {
    return res.status(400).json({
      message:
        'Please provide a name, valid mobile number, and order items.',
    });
  }

  const validItems = items.every(
    (item) =>
      item &&
      typeof item.menuItemId === 'string' &&
      item.menuItemId.length > 0 &&
      item.menuItemId.length <= 100 &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      item.quantity <= 100,
  );

  if (!validItems) {
    return res.status(400).json({
      message: 'One or more order items are invalid.',
    });
  }
  const trackingToken = crypto.randomBytes(32).toString('hex');

  const order = {
  trackingToken,
  customerName: customerName.trim().slice(0, 100),
    phone,
    pickupNote:
      typeof pickupNote === 'string'
        ? pickupNote.trim().slice(0, 500)
        : '',
    items: JSON.stringify(
      items.map((item) => ({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
      })),
    ),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const result = db
    .prepare(
      `INSERT INTO orders
 (customerName, phone, pickupNote, items, status, createdAt, trackingToken)
 VALUES (@customerName, @phone, @pickupNote, @items, @status, @createdAt, @trackingToken)`
    )
    .run(order);

  const savedOrder = db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .get(result.lastInsertRowid);

  return res.status(201).json({
  message: 'Pickup request received. Waiting for hotel approval.',
  order: {
    id: savedOrder.id,
    status: savedOrder.status,
    createdAt: savedOrder.createdAt,
    trackingToken: savedOrder.trackingToken,
  },
});
});

// -------------------- CUSTOMER ORDER HISTORY --------------------

// Retrieve one order only when its private tracking token matches.
app.get('/api/customer/orders/:id', (req, res) => {
  res.set('Cache-Control', 'no-store');

  const orderId = Number(req.params.id);
  const token = req.get('X-Order-Token');

  if (
    !Number.isSafeInteger(orderId) ||
    orderId < 1 ||
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    return res.status(404).json({
      message: 'Order not found.',
    });
  }

  const order = db
    .prepare(
      `SELECT id, trackingToken, status, items, createdAt, updatedAt
       FROM orders
       WHERE id = ? AND trackingToken = ?`,
    )
    .get(orderId, token);

  if (!order) {
    return res.status(404).json({
      message: 'Order not found.',
    });
  }

  return res.json({
    order: {
      id: order.id,
      status: order.status,
      items: order.items,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
  });
});

// Check the status of one order using its private tracking token.
app.get('/api/orders/:id/status', (req, res) => {
  res.set('Cache-Control', 'no-store');

  const orderId = Number(req.params.id);
  const token = req.get('X-Order-Token');

  if (
    !Number.isSafeInteger(orderId) ||
    orderId < 1 ||
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    return res.status(404).json({
      message: 'Order not found.',
    });
  }

  const order = db
    .prepare(
      `SELECT id, trackingToken, status, createdAt, updatedAt
       FROM orders
       WHERE id = ? AND trackingToken = ?`,
    )
    .get(orderId, token);

  if (!order) {
    return res.status(404).json({
      message: 'Order not found.',
    });
  }

  return res.json({
    order: {
      id: order.id,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    },
  });
});
// -------------------- ORDER MANAGEMENT --------------------

app.get('/api/orders', requireOrderManager, (_req, res) => {
  res.set('Cache-Control', 'no-store');

  const rows = db
    .prepare('SELECT * FROM orders ORDER BY id DESC')
    .all();

  return res.json(rows.map(formatOrder));
});

app.patch('/api/orders/:id/status', requireOrderManager, (req, res) => {
  const orderId = Number(req.params.id);
  const { status } = req.body ?? {};

  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({
      message: 'Invalid order ID.',
    });
  }

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({
      message: 'Status must be accepted or rejected.',
    });
  }

  const order = db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .get(orderId);

  if (!order) {
    return res.status(404).json({
      message: 'Order not found.',
    });
  }

  if (order.status !== 'pending') {
    return res.status(409).json({
      message: 'Only pending orders can be updated.',
      order: formatOrder(order),
    });
  }

  const now = new Date().toISOString();

  db.prepare(
    'UPDATE orders SET status = ?, updatedAt = ? WHERE id = ?',
  ).run(status, now, orderId);

  const actorType =
    req.session.ownerAuthenticated === true ? 'owner' : 'staff';

  const actorUsername =
    actorType === 'owner' ? 'owner' : req.staffUsername || 'staff';

  db.prepare(
    `INSERT INTO order_activity
     (orderId, actorType, actorUsername, action, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(orderId, actorType, actorUsername, status, now);

  const updatedOrder = db
    .prepare('SELECT * FROM orders WHERE id = ?')
    .get(orderId);

  return res.json({
    message: `Order ${status}.`,
    order: formatOrder(updatedOrder),
  });
});

// -------------------- START SERVER --------------------

app.listen(PORT, () => {
  console.log(`Basha Hotel backend running at http://localhost:${PORT}`);
});
