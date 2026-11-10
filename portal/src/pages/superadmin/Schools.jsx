import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { admin } from '../../api/client';

export default function SuperAdminSchools() {
  const [schools, setSchools] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    admin.listSchools().then((d) => setSchools(d.schools)).catch((e) => setError(e.message));
  }, []);

  return (
    <Layout>
      <h1>Schools</h1>
      <p>Every school registered on the platform.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      <div className="lt-card">
        <table className="lt-table">
          <thead>
            <tr><th>Name</th><th>Address</th><th>Contact</th><th>Join code</th><th>Status</th></tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.address || '—'}</td>
                <td>{s.contact_email || s.contact_phone || '—'}</td>
                <td><code>{s.join_code}</code></td>
                <td>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {schools.length === 0 && <div className="lt-empty">No schools yet.</div>}
      </div>
    </Layout>
  );
}
