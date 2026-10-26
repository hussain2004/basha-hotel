
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import './Admin.css';

type OrderItem = {
  menuItemId: string;
  quantity: number;
};

type Order = {
  id: number;
  customerName: string;
  phone: string;
  pickupNote: string;
  items: OrderItem[];
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  updatedAt?: string | null;
};

type OrderFilter = 'pending' | 'accepted' | 'rejected' | 'all';
type LoginMode = 'owner' | 'staff';
type Role = 'owner' | 'staff';

type ApiMessage = {
  message?: string;
  authenticated?: boolean;
  mustChangePassword?: boolean;
  temporaryPassword?: string;
};

type StaffUser = {
  id: number;
  username: string;
  isActive: number | boolean;
  mustChangePassword: number | boolean;
  createdAt: string;
  updatedAt?: string | null;
};

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as ApiMessage).message || `Request failed (${response.status})`,
    );
  }

  return data as T;
}

export default function Admin() {
  const [role, setRole] = useState<Role | null>(null);
  const [loginMode, setLoginMode] = useState<LoginMode>('owner');
  const [checkingSession, setCheckingSession] = useState(true);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('pending');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);

  const [pageError, setPageError] = useState('');
  const [notice, setNotice] = useState('');

  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [staffActionId, setStaffActionId] = useState<number | null>(null);
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [temporaryUsername, setTemporaryUsername] = useState('');

  const pendingCount = orders.filter(
    (order) => order.status === 'pending',
  ).length;

  const acceptedCount = orders.filter(
    (order) => order.status === 'accepted',
  ).length;

  const rejectedCount = orders.filter(
    (order) => order.status === 'rejected',
  ).length;

  const filteredOrders =
    orderFilter === 'all'
      ? orders
      : orders.filter((order) => order.status === orderFilter);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    setPageError('');

    try {
      const response = await fetch('/api/orders', {
        credentials: 'include',
        cache: 'no-store',
      });

      const data = await readResponse<Order[]>(response);
      setOrders(data);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load orders.';

      if (
        message.includes('login required') ||
        message.includes('sign in again')
      ) {
        setRole(null);
        setOrders([]);
      } else {
        setPageError(message);
      }
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const loadStaff = useCallback(async () => {
    setLoadingStaff(true);
    setPageError('');

    try {
      const response = await fetch('/api/staff', {
        credentials: 'same-origin',
        cache: 'no-store',
      });

      const data = await readResponse<{ staff: StaffUser[] }>(response);
      setStaffUsers(data.staff);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to load staff accounts.',
      );
    } finally {
      setLoadingStaff(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const ownerResponse = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
        });

        const ownerData = await readResponse<ApiMessage>(ownerResponse);

        if (!active) return;

        if (ownerData.authenticated) {
          setRole('owner');
          setCheckingSession(false);
          return;
        }

        const staffResponse = await fetch('/api/staff/me', {
          credentials: 'same-origin',
          cache: 'no-store',
        });

        const staffData = await readResponse<ApiMessage>(staffResponse);

        if (!active) return;

        if (staffData.authenticated) {
          setRole('staff');
          setMustChangePassword(staffData.mustChangePassword === true);
        }
      } catch {
        if (active) {
          setPageError(
            'Unable to connect to the server. Is the backend running?',
          );
        }
      } finally {
        if (active) {
          setCheckingSession(false);
        }
      }
    }

    void checkSession();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
  if (!role || mustChangePassword) {
    return;
  }

  let active = true;

  async function fetchOrders() {
    try {
      setLoadingOrders(true);
setPageError('');
      const response = await fetch('/api/orders', {
        credentials: 'same-origin',
        cache: 'no-store',
      });

      const data = await readResponse<Order[]>(response);

      if (active) {
        setOrders(data);
      }
    } catch (error) {
      if (!active) return;

      const message =
        error instanceof Error ? error.message : 'Unable to load orders.';

      if (
        message.includes('login required') ||
        message.includes('sign in again')
      ) {
        setRole(null);
        setOrders([]);
            } else {
        setPageError(message);
      }
    } finally {
      if (active) {
        setLoadingOrders(false);
      }
    }
  }

  void fetchOrders();

  return () => {
    active = false;
  };
}, [role, mustChangePassword]);

useEffect(() => {
  if (role !== 'owner') {
    return;
  }

  let active = true;

  async function fetchStaff() {
    try {
      setLoadingStaff(true);
setPageError('');
      const response = await fetch('/api/staff', {
        credentials: 'same-origin',
        cache: 'no-store',
      });

      const data = await readResponse<{ staff: StaffUser[] }>(response);

      if (active) {
        setStaffUsers(data.staff);
      }
    } catch (error) {
      if (active) {
        setPageError(
          error instanceof Error
            ? error.message
            : 'Unable to load staff accounts.',
        );
      }
    }
    finally {
  if (active) {
    setLoadingStaff(false);
  }
}
  }

  void fetchStaff();

  return () => {
    active = false;
  };
}, [role]);

  function switchLoginMode(mode: LoginMode) {
    setLoginMode(mode);
    setUsername('');
    setPassword('');
    setLoginError('');
    setPageError('');
    setNotice('');
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    setPageError('');

    try {
      const endpoint =
        loginMode === 'owner' ? '/api/auth/login' : '/api/staff/login';

      const body =
        loginMode === 'owner'
          ? { password }
          : { username: username.trim(), password };

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await readResponse<ApiMessage>(response);

      setPassword('');
      setRole(loginMode);

      if (loginMode === 'staff') {
        setMustChangePassword(data.mustChangePassword === true);
      } else {
        setMustChangePassword(false);
      }
    } catch (error) {
      setLoginError(
        error instanceof Error ? error.message : 'Unable to log in.',
      );
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError('');
    setNotice('');

    if (newPassword.length < 12) {
      setPageError('Your new password must contain at least 12 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPageError('The new passwords do not match.');
      return;
    }

    setChangingPassword(true);

    try {
      const response = await fetch('/api/staff/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await readResponse<ApiMessage>(response);

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMustChangePassword(false);
      setNotice(data.message || 'Password changed successfully.');
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to change password.',
      );
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleLogout() {
    setPageError('');
    setNotice('');

    try {
      const endpoint =
        role === 'staff' ? '/api/staff/logout' : '/api/auth/logout';

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
      });

      await readResponse<ApiMessage>(response);

      setRole(null);
      setMustChangePassword(false);
      setOrders([]);
      setStaffUsers([]);
      setUsername('');
      setPassword('');
      setLoginError('');
      setLoginMode('owner');
      setTemporaryPassword('');
      setTemporaryUsername('');
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to log out.',
      );
    }
  }

  async function updateOrderStatus(
    orderId: number,
    status: 'accepted' | 'rejected',
  ) {
    setBusyOrderId(orderId);
    setPageError('');
    setNotice('');

    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      await readResponse<ApiMessage>(response);
      await loadOrders();
      setNotice(`Order #${orderId} ${status}.`);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to update the order.',
      );
    } finally {
      setBusyOrderId(null);
    }
  }

  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError('');
    setNotice('');
    setTemporaryPassword('');
    setTemporaryUsername('');

    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(newUsername.trim())) {
      setPageError(
        'Username must be 3–30 characters using letters, numbers, underscores or hyphens.',
      );
      return;
    }

    setCreatingStaff(true);

    try {
      const response = await fetch('/api/staff', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim() }),
      });

      const data = await readResponse<ApiMessage & { staff: StaffUser }>(
        response,
      );

      setNewUsername('');
      setTemporaryPassword(data.temporaryPassword || '');
      setTemporaryUsername(data.staff.username);
      setNotice(data.message || 'Staff account created.');
      await loadStaff();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to create staff account.',
      );
    } finally {
      setCreatingStaff(false);
    }
  }

  async function toggleStaff(staff: StaffUser) {
    const currentlyActive =
      staff.isActive === true || staff.isActive === 1;

    const nextActive = !currentlyActive;

    const confirmed = window.confirm(
      `${nextActive ? 'Enable' : 'Disable'} the account "${staff.username}"?`,
    );

    if (!confirmed) return;

    setStaffActionId(staff.id);
    setPageError('');
    setNotice('');
    setTemporaryPassword('');

    try {
      const response = await fetch(`/api/staff/${staff.id}/active`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });

      const data = await readResponse<ApiMessage>(response);

      setNotice(data.message || 'Staff account updated.');
      await loadStaff();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to update staff account.',
      );
    } finally {
      setStaffActionId(null);
    }
  }

  async function resetStaffPassword(staff: StaffUser) {
    const confirmed = window.confirm(
      `Reset the password for "${staff.username}"? They must change it at their next login.`,
    );

    if (!confirmed) return;

    setStaffActionId(staff.id);
    setPageError('');
    setNotice('');
    setTemporaryPassword('');
    setTemporaryUsername('');

    try {
      const response = await fetch(
        `/api/staff/${staff.id}/reset-password`,
        {
          method: 'POST',
          credentials: 'same-origin',
        },
      );

      const data = await readResponse<
        ApiMessage & { staff: StaffUser }
      >(response);

      setTemporaryPassword(data.temporaryPassword || '');
      setTemporaryUsername(data.staff.username);
      setNotice(data.message || 'Temporary password created.');
      await loadStaff();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : 'Unable to reset password.',
      );
    } finally {
      setStaffActionId(null);
    }
  }

  if (checkingSession) {
    return (
      <main className="admin-page">
        <header className="admin-header">
          <p className="admin-eyebrow">BASHA HOTEL</p>
          <h1>Checking your session…</h1>
        </header>
      </main>
    );
  }

  if (!role) {
    return (
      <main className="admin-page">
        <section className="admin-login-card">
          <p className="admin-eyebrow">BASHA HOTEL · SECURE AREA</p>
          <h1>{loginMode === 'owner' ? 'Owner login' : 'Staff login'}</h1>
          <p className="admin-login-description">
            {loginMode === 'owner'
              ? 'Sign in to manage orders and staff accounts.'
              : 'Sign in with the username and password provided by the owner.'}
          </p>

          <div className="admin-order-tabs" role="group" aria-label="Login type">
            <button
              type="button"
              className={loginMode === 'owner' ? 'active' : ''}
              aria-pressed={loginMode === 'owner'}
              onClick={() => switchLoginMode('owner')}
            >
              Owner
            </button>
            <button
              type="button"
              className={loginMode === 'staff' ? 'active' : ''}
              aria-pressed={loginMode === 'staff'}
              onClick={() => switchLoginMode('staff')}
            >
              Staff
            </button>
          </div>

          <form onSubmit={handleLogin} className="admin-login-form">
            {loginMode === 'staff' && (
              <>
                <label htmlFor="staff-username">Username</label>
                <input
                  id="staff-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  minLength={3}
                  maxLength={30}
                  pattern="[a-zA-Z0-9_-]{3,30}"
                  placeholder="Enter your staff username"
                />
              </>
            )}

            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              maxLength={200}
              placeholder={
                loginMode === 'owner'
                  ? 'Enter your owner password'
                  : 'Enter your staff password'
              }
            />

            {loginError && (
              <p className="admin-error" role="alert">
                {loginError}
              </p>
            )}

            <button type="submit" disabled={loggingIn}>
              {loggingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {pageError && (
            <p className="admin-error" role="alert">
              {pageError}
            </p>
          )}
        </section>
      </main>
    );
  }

  if (role === 'staff' && mustChangePassword) {
    return (
      <main className="admin-page">
        <section className="admin-login-card">
          <p className="admin-eyebrow">BASHA HOTEL · STAFF ACCOUNT</p>
          <h1>Change your password</h1>
          <p className="admin-login-description">
            For your security, change the temporary password before managing orders.
            Use at least 12 characters.
          </p>

          <form onSubmit={handleChangePassword} className="admin-login-form">
            <label htmlFor="current-password">Current temporary password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
              maxLength={200}
            />

            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={12}
              maxLength={200}
            />

            <label htmlFor="confirm-password">Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              minLength={12}
              maxLength={200}
            />

            {pageError && (
              <p className="admin-error" role="alert">
                {pageError}
              </p>
            )}

            {notice && (
              <p className="admin-success" role="status">
                {notice}
              </p>
            )}

            <button type="submit" disabled={changingPassword}>
              {changingPassword ? 'Changing password…' : 'Change password'}
            </button>

            <button type="button" onClick={() => void handleLogout()}>
              Log out
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <p className="admin-eyebrow">
          BASHA HOTEL · {role === 'owner' ? 'OWNER AREA' : 'STAFF AREA'}
        </p>
        <h1>Pickup Orders</h1>
        <p>Review customer requests before confirming them.</p>

        <div className="admin-header-actions">
          <button
            type="button"
            onClick={() => void loadOrders()}
            disabled={loadingOrders}
          >
            {loadingOrders ? 'Refreshing…' : 'Refresh orders'}
          </button>

          <button type="button" onClick={() => void handleLogout()}>
            Log out
          </button>
        </div>
      </header>

      {pageError && (
        <p className="admin-error" role="alert">
          {pageError}
        </p>
      )}

      {notice && (
        <p className="admin-success" role="status">
          {notice}
        </p>
      )}

      <section className="admin-orders">
        <h2>Manage Orders</h2>

        <div
          className="admin-order-tabs"
          role="group"
          aria-label="Filter orders"
        >
          <button
            type="button"
            className={orderFilter === 'pending' ? 'active' : ''}
            aria-pressed={orderFilter === 'pending'}
            onClick={() => setOrderFilter('pending')}
          >
            Pending ({pendingCount})
          </button>

          <button
            type="button"
            className={orderFilter === 'accepted' ? 'active' : ''}
            aria-pressed={orderFilter === 'accepted'}
            onClick={() => setOrderFilter('accepted')}
          >
            Accepted ({acceptedCount})
          </button>

          <button
            type="button"
            className={orderFilter === 'rejected' ? 'active' : ''}
            aria-pressed={orderFilter === 'rejected'}
            onClick={() => setOrderFilter('rejected')}
          >
            Rejected ({rejectedCount})
          </button>

          <button
            type="button"
            className={orderFilter === 'all' ? 'active' : ''}
            aria-pressed={orderFilter === 'all'}
            onClick={() => setOrderFilter('all')}
          >
            All Orders ({orders.length})
          </button>
        </div>

        {loadingOrders && orders.length === 0 && <p>Loading orders…</p>}

        {!loadingOrders && filteredOrders.length === 0 && (
          <p>
            {orderFilter === 'pending'
              ? 'No pending orders.'
              : orderFilter === 'accepted'
                ? 'No accepted orders.'
                : orderFilter === 'rejected'
                  ? 'No rejected orders.'
                  : 'No pickup requests yet.'}
          </p>
        )}

        {filteredOrders.map((order) => (
          <article className="admin-order-card" key={order.id}>
            <div className="admin-order-heading">
              <h3>Order #{order.id}</h3>
              <span className={`order-status status-${order.status}`}>
                {order.status.toUpperCase()}
              </span>
            </div>

            <p>
              <strong>Customer:</strong> {order.customerName}
            </p>
            <p>
              <strong>Phone:</strong> {order.phone}
            </p>

            {order.pickupNote && (
              <p>
                <strong>Pickup note:</strong> {order.pickupNote}
              </p>
            )}

            <p>
              <strong>Requested items:</strong>
            </p>

            <ul>
              {order.items.map((item, index) => (
                <li key={`${item.menuItemId}-${index}`}>
                  {item.menuItemId} × {item.quantity}
                </li>
              ))}
            </ul>

            <p className="admin-order-date">
              Submitted: {new Date(order.createdAt).toLocaleString()}
            </p>

            {order.status === 'pending' && (
              <div className="admin-order-actions">
                <button
                  type="button"
                  className="admin-accept-button"
                  disabled={busyOrderId !== null}
                  onClick={() => void updateOrderStatus(order.id, 'accepted')}
                >
                  {busyOrderId === order.id ? 'Updating…' : 'Accept order'}
                </button>

                <button
                  type="button"
                  className="admin-reject-button"
                  disabled={busyOrderId !== null}
                  onClick={() => void updateOrderStatus(order.id, 'rejected')}
                >
                  {busyOrderId === order.id ? 'Updating…' : 'Reject order'}
                </button>
              </div>
            )}
          </article>
        ))}
      </section>

      {role === 'owner' && (
        <section className="admin-orders admin-staff-section">
          <h2>Staff Accounts</h2>
          <p>
            Create and manage up to six staff accounts. A staff member must
            change their temporary password before managing orders.
          </p>

          <form onSubmit={createStaff} className="admin-login-form">
            <label htmlFor="new-staff-username">New staff username</label>
            <input
              id="new-staff-username"
              type="text"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              required
              minLength={3}
              maxLength={30}
              pattern="[a-zA-Z0-9_-]{3,30}"
              placeholder="Example: morning_staff"
            />

            <button type="submit" disabled={creatingStaff}>
              {creatingStaff ? 'Creating account…' : 'Create staff account'}
            </button>
          </form>

          {temporaryPassword && (
            <div className="admin-success" role="status">
              <p>
                <strong>Temporary password for {temporaryUsername}</strong>
              </p>
              <p>
                Share this password securely. It will not be shown again after
                you leave or refresh this page.
              </p>
              <p>
                <code>{temporaryPassword}</code>
              </p>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(temporaryPassword)
                    .then(() => setNotice('Temporary password copied.'))
                    .catch(() =>
                      setPageError('Unable to copy. Please copy the password manually.'),
                    );
                }}
              >
                Copy temporary password
              </button>
            </div>
          )}

          {loadingStaff && <p>Loading staff accounts…</p>}

          {!loadingStaff && staffUsers.length === 0 && (
            <p>No staff accounts created yet.</p>
          )}

          {staffUsers.map((staff) => {
            const active = staff.isActive === true || staff.isActive === 1;
            const needsPasswordChange =
              staff.mustChangePassword === true ||
              staff.mustChangePassword === 1;

            return (
              <article className="admin-order-card" key={staff.id}>
                <div className="admin-order-heading">
                  <h3>{staff.username}</h3>
                  <span className={`order-status ${active ? 'status-accepted' : 'status-rejected'}`}>
                    {active ? 'ACTIVE' : 'DISABLED'}
                  </span>
                </div>

                <p>
                  <strong>Account ID:</strong> {staff.id}
                </p>
                <p>
                  <strong>Password status:</strong>{' '}
                  {needsPasswordChange
                    ? 'Temporary password must be changed'
                    : 'Password changed'}
                </p>
                <p className="admin-order-date">
                  Created: {new Date(staff.createdAt).toLocaleString()}
                </p>

                <div className="admin-order-actions">
                  <button
                    type="button"
                    disabled={staffActionId !== null}
                    onClick={() => void toggleStaff(staff)}
                  >
                    {staffActionId === staff.id
                      ? 'Updating…'
                      : active
                        ? 'Disable account'
                        : 'Enable account'}
                  </button>

                  <button
                    type="button"
                    disabled={staffActionId !== null}
                    onClick={() => void resetStaffPassword(staff)}
                  >
                    {staffActionId === staff.id
                      ? 'Working…'
                      : 'Reset password'}
                  </button>
                </div>
              </article>
            );
          })}

          <button
            type="button"
            onClick={() => void loadStaff()}
            disabled={loadingStaff}
          >
            {loadingStaff ? 'Refreshing…' : 'Refresh staff accounts'}
          </button>
        </section>
      )}
    </main>
  );
}
