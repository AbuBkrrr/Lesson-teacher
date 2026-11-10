import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import ConfirmButton from '../components/ConfirmButton';
import StatusBadge from '../components/StatusBadge';
import { subscriptions } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function Subscriptions() {
  const { user } = useAuth();
  const audience = user?.role === 'school_admin' ? 'school' : 'parent';
  const [plans, setPlans] = useState([]);
  const [mine, setMine] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [newPlan, setNewPlan] = useState({ code: '', name: '', audience: 'parent', price: '', interval: 'monthly' });

  const load = () => {
    subscriptions.plans(user?.role === 'super_admin' ? undefined : audience).then((d) => setPlans(d.plans)).catch((e) => setError(e.message));
    if (user?.role !== 'super_admin') subscriptions.mine().then((d) => setMine(d.subscriptions)).catch(() => {});
  };
  useEffect(load, [user]);

  async function handleSubscribe(planId) {
    setBusyId(planId);
    setError(null);
    try {
      const res = await subscriptions.subscribe(planId);
      if (res.authorization_url?.startsWith('mock://')) {
        await subscriptions.mockComplete(res.reference);
      } else if (res.authorization_url) {
        window.location.href = res.authorization_url;
        return;
      }
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(id) {
    setError(null);
    try { await subscriptions.cancel(id); load(); } catch (err) { setError(err.message); }
  }

  async function handleCreatePlan(e) {
    e.preventDefault();
    setError(null);
    try {
      await subscriptions.createPlan({ ...newPlan, price: Number(newPlan.price) });
      setNewPlan({ code: '', name: '', audience: 'parent', price: '', interval: 'monthly' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout>
      <h1>Subscriptions</h1>
      <p>{user?.role === 'school_admin' ? 'School-wide plans for access to Lesson Teacher.' : 'Priority booking, unlimited messaging, and a booking discount.'}</p>

      {error && <div className="lt-error-banner">{error}</div>}

      {user?.role === 'super_admin' && (
        <div className="lt-card" style={{ maxWidth: 480, marginBottom: 16 }}>
          <h3>New plan</h3>
          <form onSubmit={handleCreatePlan}>
            <div className="lt-field"><label htmlFor="subscriptions-f1">Code</label><input id="subscriptions-f1" value={newPlan.code} onChange={(e) => setNewPlan((p) => ({ ...p, code: e.target.value }))} required /></div>
            <div className="lt-field"><label htmlFor="subscriptions-f2">Name</label><input id="subscriptions-f2" value={newPlan.name} onChange={(e) => setNewPlan((p) => ({ ...p, name: e.target.value }))} required /></div>
            <div className="lt-field">
              <label htmlFor="subscriptions-f3">Audience</label>
              <select id="subscriptions-f3" value={newPlan.audience} onChange={(e) => setNewPlan((p) => ({ ...p, audience: e.target.value }))}>
                <option value="parent">Parent</option>
                <option value="school">School</option>
              </select>
            </div>
            <div className="lt-field"><label htmlFor="subscriptions-f4">Price (NGN)</label><input id="subscriptions-f4" type="number" value={newPlan.price} onChange={(e) => setNewPlan((p) => ({ ...p, price: e.target.value }))} required /></div>
            <button className="lt-btn" type="submit">Create plan</button>
          </form>
        </div>
      )}

      {mine.length > 0 && (
        <div className="lt-card" style={{ marginBottom: 16 }}>
          <h3>Your subscription</h3>
          <table className="lt-table">
            <thead><tr><th>Plan</th><th>Status</th><th>Renews</th><th></th></tr></thead>
            <tbody>
              {mine.map((s) => (
                <tr key={s.id}>
                  <td>{s.plan_name}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>{new Date(s.current_period_end).toLocaleDateString()}</td>
                  <td>{s.status === 'active' && <ConfirmButton confirmLabel="Yes, cancel plan" onConfirm={() => handleCancel(s.id)}>Cancel</ConfirmButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="lt-grid">
        {plans.map((p) => (
          <div className="lt-card" key={p.id}>
            <h3>{p.name}</h3>
            <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>{p.currency} {p.price.toLocaleString()}<span style={{ fontSize: '0.8rem' }}>/{p.interval}</span></p>
            <ul style={{ fontSize: '0.85rem' }}>
              {(JSON.parse(p.benefits || '[]')).map((b) => <li key={b}>{b}</li>)}
              {p.booking_discount_percent > 0 && <li>{p.booking_discount_percent}% off bookings</li>}
            </ul>
            {user?.role !== 'super_admin' && (
              <button className="lt-btn" disabled={busyId === p.id} onClick={() => handleSubscribe(p.id)}>
                {busyId === p.id ? 'Processing…' : 'Subscribe'}
              </button>
            )}
          </div>
        ))}
      </div>
      {plans.length === 0 && <div className="lt-card lt-empty">No plans available yet.</div>}
    </Layout>
  );
}
