import { useEffect, useState, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Field from '../components/Field.jsx';
import { Alert, Loading, EmptyState } from '../components/Feedback.jsx';
import { formatDate } from '../utils.js';

function ClaimCard({ claim, onChanged }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(decision) {
    if (reason.trim().length < 5) {
      setError('Write a reason of at least 5 characters before you approve or reject.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api.decideClaim(claim.id, { decision, reason: reason.trim() });
      onChanged(`Claim ${decision}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmReturn() {
    if (!window.confirm('Confirm that the owner has collected this item? This closes the listing.')) return;
    setBusy(true);
    setError('');
    try {
      await api.confirmReturn(claim.item_id);
      onChanged('Item marked as returned.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="panel claim">
      <div className="claim-head">
        <h3><Link to={`/items/${claim.item_id}`}>{claim.item_title}</Link></h3>
        <StatusBadge kind={claim.status} />
        {claim.item_status === 'returned' && <StatusBadge kind="returned" />}
      </div>
      <p className="meta">Claimed by {claim.claimant_name} on {formatDate(claim.created_at)}</p>

      <div className="compare">
        <div>
          <h4>Claimant's evidence</h4>
          <p>{claim.evidence}</p>
        </div>
        <div>
          <h4>Finder's private details</h4>
          <p>{claim.item_private_details || 'None recorded.'}</p>
        </div>
      </div>

      {claim.admin_reason && <p><strong>Decision reason:</strong> {claim.admin_reason}</p>}
      {error && <Alert type="error">{error}</Alert>}

      {claim.status === 'pending' && (
        <>
          <Field id={`reason-${claim.id}`} label="Reason for your decision"
            hint="The claimant will see this.">
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => decide('approved')}>Approve claim</button>
            <button type="button" className="btn danger" disabled={busy} onClick={() => decide('rejected')}>Reject claim</button>
          </div>
        </>
      )}

      {claim.status === 'approved' && claim.item_status === 'open' && (
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy} onClick={confirmReturn}>
            Confirm item collected
          </button>
        </div>
      )}
    </li>
  );
}

function Metric({ label, value }) {
  return (
    <div className="admin-metric">
      <span className="admin-metric-value">{value}</span>
      <span className="admin-metric-label">{label}</span>
    </div>
  );
}

function AdminItemCard({ item, onDeleted }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`Permanently delete "${item.title}" and its claims? This cannot be undone.`)) return;
    setError('');
    setBusy(true);
    try {
      await api.deleteItem(item.id);
      onDeleted(`Listing "${item.title}" deleted.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="panel admin-item">
      <div>
        <div className="badges">
          <StatusBadge kind={item.type} />
          <StatusBadge kind={item.status} />
        </div>
        <h3><Link to={`/items/${item.id}`}>{item.title}</Link></h3>
        <p className="meta">{item.category} · {item.location} · Reported by {item.reporter_name}</p>
      </div>
      <div className="actions">
        <Link className="btn secondary" to={`/items/${item.id}`}>View</Link>
        {item.status === 'open' && (
          <Link className="btn primary" to={`/admin/items/${item.id}/edit`}>Edit listing</Link>
        )}
        <button type="button" className="btn danger" disabled={busy} onClick={remove}>
          {busy ? 'Deleting…' : 'Delete listing'}
        </button>
      </div>
      {error && <Alert type="error">{error}</Alert>}
    </li>
  );
}

function CreateAdminForm({ onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (form.name.trim().length < 2) nextErrors.name = 'Enter the new administrator’s full name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Enter a valid email address.';
    if (form.password.length < 12) nextErrors.password = 'Use at least 12 characters for the initial password.';
    if (form.password !== form.confirm) nextErrors.confirm = 'The passwords do not match.';
    setErrors(nextErrors);
    setError('');
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      const created = await api.createAdminUser({
        name: form.name.trim(), email: form.email.trim(), password: form.password,
      });
      setForm({ name: '', email: '', password: '', confirm: '' });
      onCreated(`Administrator account created for ${created.email}. Share the initial password securely.`);
    } catch (e) {
      setError(e.message);
      setErrors(e.fieldErrors || {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="create-admin-heading">
      <h3 id="create-admin-heading">Create administrator account</h3>
      <p className="meta">Accounts created here can sign in to review claims and manage listings.</p>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={submit} noValidate>
        <Field id="new-admin-name" label="Full name" error={errors.name}>
          <input type="text" autoComplete="name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field id="new-admin-email" label="Login email" error={errors.email}>
          <input type="email" autoComplete="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field id="new-admin-password" label="Initial password"
          hint="At least 12 characters. Share it directly with the new administrator."
          error={errors.password}>
          <input type="password" autoComplete="new-password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field id="new-admin-confirm" label="Confirm initial password" error={errors.confirm}>
          <input type="password" autoComplete="new-password" value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </Field>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create administrator'}
        </button>
      </form>
    </section>
  );
}

function AdminProfileForm({ profile, onUpdated }) {
  const [form, setForm] = useState({
    name: profile.name, email: profile.email, currentPassword: '', newPassword: '', confirmPassword: '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({
      name: profile.name, email: profile.email, currentPassword: '', newPassword: '', confirmPassword: '',
    });
  }, [profile.id, profile.name, profile.email]);

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (form.name.trim().length < 2) nextErrors.name = 'Enter your full name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = 'Enter a valid email address.';
    if (!form.currentPassword) nextErrors.currentPassword = 'Enter your current password.';
    if (form.newPassword && form.newPassword.length < 12)
      nextErrors.newPassword = 'Use at least 12 characters for your new password.';
    if (form.newPassword !== form.confirmPassword)
      nextErrors.confirmPassword = 'The passwords do not match.';
    setErrors(nextErrors);
    setError('');
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      await onUpdated({
        name: form.name.trim(), email: form.email.trim(),
        currentPassword: form.currentPassword, newPassword: form.newPassword,
      });
      setForm((current) => ({ ...current, currentPassword: '', newPassword: '', confirmPassword: '' }));
    } catch (e) {
      setError(e.message);
      setErrors(e.fieldErrors || {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="admin-profile-heading">
      <h3 id="admin-profile-heading">Your administrator profile</h3>
      <p className="meta">Update your name, sign-in email, or password. Confirm with your current password.</p>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={submit} noValidate>
        <Field id="admin-profile-name" label="Full name" error={errors.name}>
          <input type="text" autoComplete="name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field id="admin-profile-email" label="Login email" error={errors.email}>
          <input type="email" autoComplete="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field id="admin-current-password" label="Current password" error={errors.currentPassword}>
          <input type="password" autoComplete="current-password" value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </Field>
        <Field id="admin-new-password" label="New password (optional)"
          hint="Leave blank to keep your current password. New passwords need at least 12 characters."
          error={errors.newPassword}>
          <input type="password" autoComplete="new-password" value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        {form.newPassword && (
          <Field id="admin-confirm-password" label="Confirm new password" error={errors.confirmPassword}>
            <input type="password" autoComplete="new-password" value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
          </Field>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </section>
  );
}

export default function Admin() {
  const location = useLocation();
  const { user, updateAdminProfile } = useAuth();
  const [claims, setClaims] = useState(null);
  const [items, setItems] = useState(null);
  const [admins, setAdmins] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(location.state?.flash || '');
  const [section, setSection] = useState('claims');
  const [filter, setFilter] = useState('pending');
  const [itemFilter, setItemFilter] = useState('open');

  const load = useCallback(() => {
    setError('');
    return Promise.all([api.adminClaims(), api.adminItems(), api.adminUsers(), api.adminProfile()])
      .then(([nextClaims, nextItems, nextAdmins, nextProfile]) => {
        setClaims(nextClaims);
        setItems(nextItems);
        setAdmins(nextAdmins);
        setProfile(nextProfile);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChanged = (msg) => {
    setMessage(msg);
    load();
  };

  const handleProfileUpdated = async (data) => {
    await updateAdminProfile(data);
    setMessage('Administrator profile updated.');
    await load();
  };

  if (error && !claims) {
    return (
      <section className="panel">
        <Alert type="error">{error}</Alert>
        <button type="button" className="btn secondary" onClick={load}>Try again</button>
      </section>
    );
  }
  if (!claims || !items || !admins || !profile) return <Loading label="Loading administrator dashboard…" />;

  const pendingCount = claims.filter((claim) => claim.status === 'pending').length;
  const approvedCount = claims.filter((claim) => claim.status === 'approved').length;
  const openCount = items.filter((item) => item.status === 'open').length;
  const shownClaims = claims.filter((claim) => !filter || claim.status === filter);
  const shownItems = items.filter((item) => !itemFilter || item.status === itemFilter);

  return (
    <div className="admin-dashboard">
      <header className="admin-heading">
        <div>
          <p className="admin-eyebrow">UCU CAMPUS LOST &amp; FOUND</p>
          <h1>Administrator dashboard</h1>
          <p className="lead">Review ownership claims and keep campus listings accurate.</p>
        </div>
      </header>

      {message && <Alert type="success">{message}</Alert>}
      {error && <Alert type="error">{error}</Alert>}

      <section className="admin-metrics" aria-label="Dashboard summary">
        <Metric label="Claims awaiting review" value={pendingCount} />
        <Metric label="Approved claims" value={approvedCount} />
        <Metric label="Open listings" value={openCount} />
        <Metric label="Total listings" value={items.length} />
        <Metric label="Administrator accounts" value={admins.length} />
      </section>

      <div className="admin-tabs" role="group" aria-label="Administrator tasks">
        <button type="button" aria-pressed={section === 'claims'}
          className={section === 'claims' ? 'active' : ''} onClick={() => setSection('claims')}>
          Claims <span className="admin-tab-count">{pendingCount}</span>
        </button>
        <button type="button" aria-pressed={section === 'items'}
          className={section === 'items' ? 'active' : ''} onClick={() => setSection('items')}>
          Listings <span className="admin-tab-count">{items.length}</span>
        </button>
        <button type="button" aria-pressed={section === 'accounts'}
          className={section === 'accounts' ? 'active' : ''} onClick={() => setSection('accounts')}>
          Administrators <span className="admin-tab-count">{admins.length}</span>
        </button>
      </div>

      {section === 'claims' ? (
        <section role="tabpanel" aria-label="Claim review">
          <div className="admin-section-heading">
            <div>
              <h2>Claim review</h2>
              <p className="meta">{pendingCount} {pendingCount === 1 ? 'claim needs' : 'claims need'} your attention.</p>
            </div>
            <div className="field narrow-field">
              <label htmlFor="claim-filter">Filter claims</label>
              <select id="claim-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="pending">Awaiting review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="">All claims</option>
              </select>
            </div>
          </div>

          {shownClaims.length === 0 ? (
            <EmptyState title="No claims to show">
              <p>Claims that match this filter will appear here.</p>
            </EmptyState>
          ) : (
            <ul className="list">
              {shownClaims.map((claim) => (
                <ClaimCard key={claim.id} claim={claim} onChanged={handleChanged} />
              ))}
            </ul>
          )}
        </section>
      ) : section === 'items' ? (
        <section role="tabpanel" aria-label="Listing management">
          <div className="admin-section-heading">
            <div>
              <h2>Listing management</h2>
              <p className="meta">Edit active reports, review completed returns, or delete any listing.</p>
            </div>
            <div className="field narrow-field">
              <label htmlFor="item-filter">Filter listings</label>
              <select id="item-filter" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
                <option value="open">Open listings</option>
                <option value="returned">Returned</option>
                <option value="">All listings</option>
              </select>
            </div>
          </div>

          {shownItems.length === 0 ? (
            <EmptyState title="No listings to show">
              <p>Listings that match this filter will appear here.</p>
            </EmptyState>
          ) : (
            <ul className="list">
              {shownItems.map((item) => (
                <AdminItemCard key={item.id} item={item} onDeleted={handleChanged} />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section role="tabpanel" aria-label="Administrator accounts">
          <div className="admin-section-heading">
            <div>
              <h2>Administrator accounts</h2>
              <p className="meta">Create individual accounts and update your own sign-in details.</p>
            </div>
          </div>
          <div className="admin-account-layout">
            <div>
              <CreateAdminForm onCreated={handleChanged} />
              <section className="panel" aria-labelledby="admin-list-heading">
                <h3 id="admin-list-heading">Current administrators</h3>
                <ul className="admin-user-list">
                  {admins.map((admin) => (
                    <li key={admin.id}>
                      <strong>{admin.name}{admin.id === user.id ? ' (you)' : ''}</strong>
                      <span className="meta">{admin.email}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <AdminProfileForm profile={profile} onUpdated={handleProfileUpdated} />
          </div>
        </section>
      )}
    </div>
  );
}
