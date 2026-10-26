import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === 'production';
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendBuildDirectory = path.resolve(currentDirectory, '..', 'dist');
const MAX_STAFF_ACCOUNTS = 6;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

if (
  !process.env.DATABASE_URL ||
  !/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL)
) {
  throw new Error('A valid DATABASE_URL is required in .env');
}

if (
  !process.env.SESSION_SECRET ||
  process.env.SESSION_SECRET.length < 40
) {
  throw new Error('SESSION_SECRET is missing or too short in .env');
}

if (
  !process.env.OWNER_PASSWORD_HASH ||
  !/^\$2[aby]\$12\$/.test(process.env.OWNER_PASSWORD_HASH)
) {
  throw new Error('A valid bcrypt OWNER_PASSWORD_HASH is required in .env');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

if (isProduction) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// -------------------- SESSION --------------------

const PgSessionStore = connectPgSimple(session);

app.use(
  session({
    name: 'basha_owner_session',
    store: new PgSessionStore({
      pool,
      tableName: 'session',
      createTableIfMissing: false,
      pruneSessionInterval: 15 * 60,
    }),
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

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function formatOrder(row) {
  const { trackingToken, ...safeOrder } = row;

  return {
    ...safeOrder,
    items: JSON.parse(row.items),
  };
}

// Login throttling is per running process.
// For multi-instance production deployments, use a shared rate-limit store.
const loginAttempts = new Map();

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

function regenerateSession(req) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((error) =>
      error ? reject(error) : resolve(),
    ),
  );
}

function saveSession(req) {
  return new Promise((resolve, reject) =>
    req.session.save((error) =>
      error ? reject(error) : resolve(),
    ),
  );
}

function destroySession(req) {
  return new Promise((resolve, reject) =>
    req.session.destroy((error) =>
      error ? reject(error) : resolve(),
    ),
  );
}

function clearSessionCookie(res) {
  res.clearCookie('basha_owner_session', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
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

const requireStaff = asyncHandler(async (req, res, next) => {
  if (
    req.session.staffAuthenticated !== true ||
    !Number.isInteger(req.session.staffUserId)
  ) {
    return res.status(401).json({
      message: 'Staff login required.',
    });
  }

  const result = await pool.query(
    'SELECT "isActive", "mustChangePassword" FROM staff_users WHERE id = $1',
    [req.session.staffUserId],
  );

  const staff = result.rows[0];

  if (!staff || staff.isActive !== 1) {
    await destroySession(req).catch(() => {});

    return res.status(401).json({
      message: 'Staff account is inactive. Please contact the owner.',
    });
  }

  return next();
});

const requireOrderManager = asyncHandler(async (req, res, next) => {
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

  const result = await pool.query(
    'SELECT "isActive", "mustChangePassword", username FROM staff_users WHERE id = $1',
    [req.session.staffUserId],
  );

  const staff = result.rows[0];

  if (!staff || staff.isActive !== 1) {
    await destroySession(req).catch(() => {});

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
});

function createTemporaryPassword() {
  return `Bh!${crypto.randomBytes(18).toString('base64url')}9a`;
}

// -------------------- HEALTH CHECK --------------------

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    await pool.query('SELECT 1');

    return res.json({
      status: 'ok',
      database: 'connected',
      message: 'Basha Hotel backend and database are healthy.',
    });
  }),
);

// -------------------- OWNER LOGIN --------------------

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
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

    try {
      await regenerateSession(req);
      req.session.ownerAuthenticated = true;
      await saveSession(req);

      return res.json({
        message: 'Owner login successful.',
      });
    } catch (error) {
      console.error('Owner session setup failed:', error.message);

      return res.status(500).json({
        message: 'Unable to create login session.',
      });
    }
  }),
);

app.get('/api/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');

  return res.json({
    authenticated: req.session.ownerAuthenticated === true,
  });
});

app.post(
  '/api/auth/logout',
  asyncHandler(async (req, res) => {
    try {
      await destroySession(req);
      clearSessionCookie(res);

      return res.json({
        message: 'Logged out successfully.',
      });
    } catch (error) {
      console.error('Owner logout failed:', error.message);

      return res.status(500).json({
        message: 'Unable to log out.',
      });
    }
  }),
);

// -------------------- STAFF LOGIN --------------------

app.post(
  '/api/staff/login',
  asyncHandler(async (req, res) => {
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

    const result = await pool.query(
      `SELECT id, username, "passwordHash", "isActive", "mustChangePassword"
       FROM staff_users
       WHERE LOWER(username) = LOWER($1)`,
      [username],
    );

    const staff = result.rows[0];

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

    try {
      await regenerateSession(req);

      req.session.staffAuthenticated = true;
      req.session.staffUserId = staff.id;
      req.session.staffMustChangePassword =
        staff.mustChangePassword === 1;

      await saveSession(req);

      return res.json({
        message: 'Staff login successful.',
        mustChangePassword: staff.mustChangePassword === 1,
      });
    } catch (error) {
      console.error('Staff session setup failed:', error.message);

      return res.status(500).json({
        message: 'Unable to create staff login session.',
      });
    }
  }),
);
app.get(
  '/api/staff/me',
  asyncHandler(async (req, res) => {
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

    const result = await pool.query(
      'SELECT "isActive", "mustChangePassword" FROM staff_users WHERE id = $1',
      [req.session.staffUserId],
    );

    const staff = result.rows[0];

    if (!staff || staff.isActive !== 1) {
      await destroySession(req).catch(() => {});

      return res.json({
        authenticated: false,
        mustChangePassword: false,
      });
    }

    return res.json({
      authenticated: true,
      mustChangePassword: staff.mustChangePassword === 1,
    });
  }),
);

// -------------------- STAFF PASSWORD CHANGE --------------------

app.post(
  '/api/staff/change-password',
  requireStaff,
  asyncHandler(async (req, res) => {
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

    const result = await pool.query(
      'SELECT id, "passwordHash", "isActive" FROM staff_users WHERE id = $1',
      [req.session.staffUserId],
    );

    const staff = result.rows[0];

    if (!staff || staff.isActive !== 1) {
      await destroySession(req).catch(() => {});

      return res.status(401).json({
        message: 'Staff account is inactive. Please contact the owner.',
      });
    }

    if (!(await bcrypt.compare(currentPassword, staff.passwordHash))) {
      return res.status(401).json({
        message: 'Current password is incorrect.',
      });
    }

    const hash = await bcrypt.hash(newPassword, 12);

    await pool.query(
      `UPDATE staff_users
       SET "passwordHash" = $1, "mustChangePassword" = 0, "updatedAt" = $2
       WHERE id = $3`,
      [hash, new Date().toISOString(), staff.id],
    );

    req.session.staffMustChangePassword = false;

    try {
      await saveSession(req);

      return res.json({
        message: 'Password changed successfully.',
      });
    } catch (error) {
      console.error(
        'Staff password-change session save failed:',
        error.message,
      );

      return res.status(500).json({
        message:
          'Password changed, but the session could not be saved. Please sign in again.',
      });
    }
  }),
);

app.post(
  '/api/staff/logout',
  requireStaff,
  asyncHandler(async (req, res) => {
    try {
      await destroySession(req);
      clearSessionCookie(res);

      return res.json({
        message: 'Logged out successfully.',
      });
    } catch {
      return res.status(500).json({
        message: 'Unable to log out.',
      });
    }
  }),
);

// -------------------- OWNER-ONLY STAFF MANAGEMENT --------------------

app.get(
  '/api/staff',
  requireOwner,
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store');

    const result = await pool.query(
      `SELECT id, username, "isActive", "mustChangePassword", "createdAt", "updatedAt"
       FROM staff_users
       ORDER BY id ASC`,
    );

    return res.json({
      staff: result.rows,
      maxStaffAccounts: MAX_STAFF_ACCOUNTS,
    });
  }),
);

app.post(
  '/api/staff',
  requireOwner,
  asyncHandler(async (req, res) => {
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

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM staff_users',
    );

    if (countResult.rows[0].count >= MAX_STAFF_ACCOUNTS) {
      return res.status(409).json({
        message:
          'The maximum of six staff accounts has been reached. Disable an unused account and reset it if needed.',
      });
    }

    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const now = new Date().toISOString();

    try {
      const result = await pool.query(
        `INSERT INTO staff_users
         (username, "passwordHash", "isActive", "mustChangePassword", "createdAt")
         VALUES ($1, $2, 1, 1, $3)
         RETURNING id, username, "isActive", "mustChangePassword"`,
        [username, passwordHash, now],
      );

      const staff = result.rows[0];

      return res.status(201).json({
        message:
          'Staff account created. Share this temporary password securely; it will not be shown again.',
        staff: {
          id: staff.id,
          username: staff.username,
          isActive: staff.isActive === 1,
          mustChangePassword: staff.mustChangePassword === 1,
        },
        temporaryPassword,
      });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          message: 'That username is already in use.',
        });
      }

      throw error;
    }
  }),
);

app.patch(
  '/api/staff/:id/active',
  requireOwner,
  asyncHandler(async (req, res) => {
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

    const found = await pool.query(
      'SELECT id, username FROM staff_users WHERE id = $1',
      [id],
    );

    if (!found.rows[0]) {
      return res.status(404).json({
        message: 'Staff account not found.',
      });
    }

    await pool.query(
      'UPDATE staff_users SET "isActive" = $1, "updatedAt" = $2 WHERE id = $3',
      [isActive ? 1 : 0, new Date().toISOString(), id],
    );

    return res.json({
      message: isActive
        ? 'Staff account enabled.'
        : 'Staff account disabled.',
    });
  }),
);

app.post(
  '/api/staff/:id/reset-password',
  requireOwner,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        message: 'Invalid staff ID.',
      });
    }

    const found = await pool.query(
      'SELECT id, username FROM staff_users WHERE id = $1',
      [id],
    );

    const staff = found.rows[0];

    if (!staff) {
      return res.status(404).json({
        message: 'Staff account not found.',
      });
    }

    const temporaryPassword = createTemporaryPassword();
    const hash = await bcrypt.hash(temporaryPassword, 12);

    await pool.query(
      `UPDATE staff_users
       SET "passwordHash" = $1, "mustChangePassword" = 1, "updatedAt" = $2
       WHERE id = $3`,
      [hash, new Date().toISOString(), id],
    );

    return res.json({
      message:
        'Temporary password reset. Share it securely; it will not be shown again.',
      staff: {
        id: staff.id,
        username: staff.username,
      },
      temporaryPassword,
    });
  }),
);

app.get(
  '/api/staff/:id/activity',
  requireOwner,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        message: 'Invalid staff ID.',
      });
    }

    const staffResult = await pool.query(
      'SELECT id, username FROM staff_users WHERE id = $1',
      [id],
    );

    const staff = staffResult.rows[0];

    if (!staff) {
      return res.status(404).json({
        message: 'Staff account not found.',
      });
    }

    const activity = await pool.query(
      `SELECT id, "orderId", "actorType", "actorUsername", action, "createdAt"
       FROM order_activity
       WHERE "actorType" = $1 AND "actorUsername" = $2
       ORDER BY id DESC
       LIMIT 100`,
      ['staff', staff.username],
    );

    return res.json({
      staff,
      activity: activity.rows,
    });
  }),
);
// -------------------- CUSTOMER PICKUP REQUESTS --------------------

app.post(
  '/api/orders',
  asyncHandler(async (req, res) => {
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
      trackingToken,
    };

    const result = await pool.query(
      `INSERT INTO orders
       ("customerName", phone, "pickupNote", items, status, "createdAt", "trackingToken")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, "createdAt", "trackingToken"`,
      [
        order.customerName,
        order.phone,
        order.pickupNote,
        order.items,
        order.status,
        order.createdAt,
        order.trackingToken,
      ],
    );

    const savedOrder = result.rows[0];

    return res.status(201).json({
      message: 'Pickup request received. Waiting for hotel approval.',
      order: {
        id: savedOrder.id,
        status: savedOrder.status,
        createdAt: savedOrder.createdAt,
        trackingToken: savedOrder.trackingToken,
      },
    });
  }),
);

// -------------------- CUSTOMER ORDER HISTORY --------------------

// Retrieve one order only when its private tracking token matches.
app.get(
  '/api/customer/orders/:id',
  asyncHandler(async (req, res) => {
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

    const result = await pool.query(
      `SELECT id, "trackingToken", status, items, "createdAt", "updatedAt"
       FROM orders
       WHERE id = $1 AND "trackingToken" = $2`,
      [orderId, token],
    );

    const order = result.rows[0];

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
  }),
);

// Check the status of one order using its private tracking token.
app.get(
  '/api/orders/:id/status',
  asyncHandler(async (req, res) => {
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

    const result = await pool.query(
      `SELECT id, "trackingToken", status, "createdAt", "updatedAt"
       FROM orders
       WHERE id = $1 AND "trackingToken" = $2`,
      [orderId, token],
    );

    const order = result.rows[0];

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
  }),
);

// -------------------- ORDER MANAGEMENT --------------------

app.get(
  '/api/orders',
  requireOrderManager,
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store');

    const result = await pool.query(
      'SELECT * FROM orders ORDER BY id DESC',
    );

    return res.json(result.rows.map(formatOrder));
  }),
);

app.patch(
  '/api/orders/:id/status',
  requireOrderManager,
  asyncHandler(async (req, res) => {
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

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const found = await client.query(
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        [orderId],
      );

      const order = found.rows[0];

      if (!order) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          message: 'Order not found.',
        });
      }

      if (order.status !== 'pending') {
        await client.query('ROLLBACK');

        return res.status(409).json({
          message: 'Only pending orders can be updated.',
          order: formatOrder(order),
        });
      }

      const now = new Date().toISOString();

      const updated = await client.query(
        `UPDATE orders
         SET status = $1, "updatedAt" = $2
         WHERE id = $3
         RETURNING *`,
        [status, now, orderId],
      );

      const actorType =
        req.session.ownerAuthenticated === true ? 'owner' : 'staff';

      const actorUsername =
        actorType === 'owner' ? 'owner' : req.staffUsername || 'staff';

      await client.query(
        `INSERT INTO order_activity
         ("orderId", "actorType", "actorUsername", action, "createdAt")
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, actorType, actorUsername, status, now],
      );

      await client.query('COMMIT');

      return res.json({
        message: `Order ${status}.`,
        order: formatOrder(updated.rows[0]),
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

if (isProduction) {
  app.use(express.static(frontendBuildDirectory));

  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }

    return res.sendFile(
      path.join(frontendBuildDirectory, 'index.html'),
      (error) => {
        if (error) next(error);
      },
    );
  });
}


// -------------------- ERROR HANDLER --------------------

app.use((error, _req, res, _next) => {
  console.error('API request failed:', error.message);

  if (res.headersSent) return;

  return res.status(500).json({
    message: 'An unexpected server error occurred.',
  });
});

// -------------------- START SERVER --------------------

const server = app.listen(PORT, () => {
  console.log(
    `Basha Hotel PostgreSQL backend listening on port ${PORT}`,
  );
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down gracefully.`);

  server.close(async () => {
    await pool.end();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));