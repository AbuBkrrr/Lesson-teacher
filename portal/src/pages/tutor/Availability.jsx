import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { tutors } from '../../api/client';
import { browserTimeZone, timeZoneOptions } from '../../utils/time';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function emptySlot() {
  return { day_of_week: 1, start_time: '09:00', end_time: '17:00' };
}

export default function TutorAvailability() {
  const [slots, setSlots] = useState(null);
  const [tz, setTz] = useState(browserTimeZone());
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    tutors.myAvailability().then((d) => { setSlots(d.slots); if (d.slots.length && d.timezone) setTz(d.timezone); }).catch((e) => setError(e.message));
  }, []);

  function updateSlot(index, field, value) {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: field === 'day_of_week' ? Number(value) : value } : s)));
  }

  function addSlot() {
    setSlots((prev) => [...prev, emptySlot()]);
  }

  function removeSlot(index) {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { slots: saved } = await tutors.updateMyAvailability(slots, tz);
      setSlots(saved);
      setSuccess('Availability updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!slots) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout>
      <h1>My availability</h1>
      <p>Set the weekly hours you teach. Parents can only request lessons that fit inside these hours (one-hour lessons), and your confirmed lessons can't overlap. Leave this empty to accept any time.</p>

      {error && <div className="lt-error-banner">{error}</div>}
      {success && <div className="lt-success-banner">{success}</div>}

      <div className="lt-card" style={{ maxWidth: 620 }}>
        <form onSubmit={handleSave}>
          <div className="lt-field">
            <label htmlFor="availability-tz">Time zone for these hours</label>
            <select id="availability-tz" value={tz} onChange={(e) => setTz(e.target.value)}>
              {timeZoneOptions(tz).map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          {slots.length === 0 && <p style={{ color: 'var(--lt-muted)' }}>No weekly slots yet — add one below.</p>}

          {slots.map((slot, i) => (
            <div key={i} className="lt-row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
              <div className="lt-field" style={{ flex: 1 }}>
                <label htmlFor={`availability-f1-${i}`}>Day</label>
                <select id={`availability-f1-${i}`} value={slot.day_of_week} onChange={(e) => updateSlot(i, 'day_of_week', e.target.value)}>
                  {DAYS.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
                </select>
              </div>
              <div className="lt-field" style={{ width: 120 }}>
                <label htmlFor={`availability-f2-${i}`}>From</label>
                <input id={`availability-f2-${i}`} type="time" value={slot.start_time} onChange={(e) => updateSlot(i, 'start_time', e.target.value)} />
              </div>
              <div className="lt-field" style={{ width: 120 }}>
                <label htmlFor={`availability-f3-${i}`}>To</label>
                <input id={`availability-f3-${i}`} type="time" value={slot.end_time} onChange={(e) => updateSlot(i, 'end_time', e.target.value)} />
              </div>
              <button type="button" className="lt-btn" style={{ marginBottom: 16 }} onClick={() => removeSlot(i)}>Remove</button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="lt-btn" onClick={addSlot}>+ Add a slot</button>
            <button className="lt-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save availability'}</button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
