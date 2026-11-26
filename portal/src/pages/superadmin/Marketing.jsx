import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import Layout from '../../components/Layout';
import QrCode from '../../components/QrCode';
import { marketing } from '../../api/client';

const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'x', 'linkedin', 'tiktok', 'telegram', 'youtube', 'email', 'sms', 'print', 'website', 'other'];
const CHANNEL_LABEL = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', x: 'X (Twitter)', linkedin: 'LinkedIn', tiktok: 'TikTok', telegram: 'Telegram', youtube: 'YouTube', email: 'Email', sms: 'SMS', print: 'Print / flyer QR', website: 'Website', other: 'Other', direct: 'Direct (no link)' };
const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];

// Ready-to-send outreach messages, per language and audience. {link} is replaced with the tracking link.
const MESSAGES = {
  en: {
    parent: 'Looking for a trusted tutor for your child? On Lesson Teacher you can watch tutors audition before you book, and get a progress report after every lesson. Have a look: {link}',
    tutor: 'Are you a teacher or have a skill to share? Join Lesson Teacher, set your own hours and rate, and teach live online. Sign up here: {link}',
    any: 'Lesson Teacher connects families with vetted tutors for school subjects, music, coding, sport and more. See how it works: {link}',
  },
  fr: {
    parent: 'Vous cherchez un tuteur de confiance pour votre enfant ? Sur Lesson Teacher, regardez les tuteurs auditionner avant de réserver et recevez un compte rendu après chaque cours : {link}',
    tutor: 'Vous enseignez ou avez un savoir-faire à partager ? Rejoignez Lesson Teacher, fixez vos horaires et vos tarifs, et enseignez en ligne : {link}',
    any: 'Lesson Teacher met les familles en relation avec des tuteurs vérifiés : matières scolaires, musique, programmation, sport et plus. Découvrez comment : {link}',
  },
  es: {
    parent: '¿Buscas un tutor de confianza para tu hijo? En Lesson Teacher puedes ver una audición antes de reservar y recibir un informe tras cada clase: {link}',
    tutor: '¿Eres profesor o tienes una habilidad que compartir? Únete a Lesson Teacher, define tu horario y tarifa, y enseña en línea: {link}',
    any: 'Lesson Teacher conecta a las familias con tutores verificados para materias escolares, música, programación, deporte y más. Mira cómo funciona: {link}',
  },
  pt: {
    parent: 'Procura um tutor de confiança para o seu filho? Na Lesson Teacher pode ver uma audição antes de marcar e receber um relatório após cada aula: {link}',
    tutor: 'É professor ou tem uma competência para partilhar? Junte-se à Lesson Teacher, defina o seu horário e preço, e ensine online: {link}',
    any: 'A Lesson Teacher liga famílias a tutores verificados para disciplinas escolares, música, programação, desporto e muito mais. Veja como funciona: {link}',
  },
};

function shareTargets(text, url) {
  const t = encodeURIComponent(text);
  const u = encodeURIComponent(url);
  return [
    ['WhatsApp', `https://wa.me/?text=${t}`],
    ['Telegram', `https://t.me/share/url?url=${u}&text=${encodeURIComponent(text.replace(url, '').trim())}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ['X', `https://twitter.com/intent/tweet?text=${t}`],
    ['LinkedIn', `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ['SMS', `sms:?&body=${t}`],
    ['Email', `mailto:?subject=${encodeURIComponent('Lesson Teacher')}&body=${t}`],
  ];
}

function withUtm(url, channel) {
  return channel && channel !== 'other' ? `${url}?utm_source=${channel}` : url;
}

function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function flag(cc) {
  if (!cc || cc.length !== 2) return '';
  return String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

function Stat({ label, value, sub }) {
  return (
    <div className="lt-card lt-stat">
      <strong>{value}</strong>
      <span className="lt-muted">{label}</span>
      {sub && <div className="lt-stat-sub">{sub}</div>}
    </div>
  );
}

function BarList({ title, rows, render = (k) => k }) {
  const max = Math.max(1, ...rows.map((r) => r.opens));
  return (
    <div className="lt-card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {rows.length === 0 && <p className="lt-muted">No data yet.</p>}
      <ul className="lt-barlist">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="lt-barlist-label">{render(r.key)}</span>
            <span className="lt-barlist-bar"><span style={{ width: `${(r.opens / max) * 100}%` }} /></span>
            <span className="lt-barlist-num" title={`${r.opens} opens from ${r.devices} devices`}>{r.opens} · {r.devices} dev</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function downloadQr(url, label) {
  const dataUrl = await QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `qr-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  a.click();
}

export default function Marketing() {
  const [days, setDays] = useState('30');
  const [data, setData] = useState(null);
  const [opens, setOpens] = useState([]);
  const [openFilter, setOpenFilter] = useState('');
  const [leads, setLeads] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [newLink, setNewLink] = useState({ label: '', channel: 'whatsapp', audience: 'parent', language: 'en', campaign: '' });
  const [kitFor, setKitFor] = useState(null); // link row for the outreach kit
  const [kitLang, setKitLang] = useState('en');
  const [mail, setMail] = useState({ subject: '', body: 'Hi {name},\n\nThanks for your interest in Lesson Teacher. ' });
  const [settings, setSettings] = useState(null);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - Number(days) * 864e5);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [days]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ov, op, ld] = await Promise.all([
        marketing.overview(range),
        marketing.opens({ limit: 100, ...(openFilter ? { link_id: openFilter } : {}) }),
        marketing.leads(),
      ]);
      setData(ov); setOpens(op.opens); setLeads(ld.leads);
    } catch (e) { setError(e.message); }
  }, [range, openFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { marketing.settings().then((d) => setSettings(d.settings)).catch(() => {}); }, []);

  async function createLink(e) {
    e.preventDefault();
    setNotice(null); setError(null);
    try {
      const { link } = await marketing.createLink(newLink);
      setNotice(`Link created: ${link.url}`);
      setNewLink((l) => ({ ...l, label: '', campaign: '' }));
      await load();
      setKitFor({ ...link, opens: 0 });
      setKitLang(link.language);
    } catch (err) { setError(err.message); }
  }

  async function toggleActive(l) {
    try { await marketing.updateLink(l.id, { is_active: !l.is_active }); await load(); } catch (e) { setError(e.message); }
  }

  async function sendMail(e) {
    e.preventDefault();
    setNotice(null); setError(null);
    try {
      const r = await marketing.emailLeads({ subject: mail.subject, body: mail.body });
      setNotice(`Sent ${r.sent} e-mail${r.sent === 1 ? '' : 's'}. Skipped ${r.skipped} lead${r.skipped === 1 ? '' : 's'} without consent or unsubscribed.`);
      await load();
    } catch (err) { setError(err.message); }
  }

  async function saveSettings(e) {
    e.preventDefault();
    setNotice(null); setError(null);
    try { const d = await marketing.saveSettings(settings); setSettings(d.settings); setNotice('Ad tracking settings saved.'); } catch (err) { setError(err.message); }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setNotice('Copied.'); } catch { setNotice(text); }
  }

  const t = data?.totals;
  const consented = leads.filter((l) => l.consent_marketing && !l.unsubscribed_at && l.email).length;
  const kitUrl = kitFor ? withUtm(kitFor.url, kitFor.channel) : '';
  const kitText = kitFor ? MESSAGES[kitLang][kitFor.audience || 'any'].replace('{link}', kitUrl) : '';

  return (
    <Layout>
      <div className="lt-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Marketing</h1>
        <label>
          <span className="lt-sr-only">Period</span>
          <select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)}>
            {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <p className="lt-muted">Make a tracking link or QR code for each place you advertise. See who opened it, from where, whether the same phone came back or the link was passed on, and who signed up.</p>
      {error && <div className="lt-error-banner">{error}</div>}
      {notice && <div className="lt-success-banner" role="status">{notice}</div>}

      {t && (
        <section className="lt-progress-grid" aria-label="Totals">
          <Stat label="Opens" value={t.opens} sub={<>Different devices: <b>{t.devices}</b><br />Repeat opens (same device): <b>{t.repeat_opens}</b></>} />
          <Stat label="Leads (call-back requests)" value={t.leads} sub={<>{t.lead_rate}% of devices · {t.consented_leads} agreed to e-mails</>} />
          <Stat label="Sign-ups from links" value={t.signups} sub={<>{t.signup_rate}% of devices · {t.converted_leads} leads signed up</>} />
        </section>
      )}

      <section className="lt-card" aria-labelledby="mk-new">
        <h2 id="mk-new" style={{ marginTop: 0 }}>New tracking link</h2>
        <form onSubmit={createLink} className="lt-mk-form">
          <div className="lt-field"><label htmlFor="mk-label">Label</label><input id="mk-label" required maxLength={80} placeholder="e.g. Lagos school gate flyers" value={newLink.label} onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} /></div>
          <div className="lt-field"><label htmlFor="mk-channel">Where it will be posted</label>
            <select id="mk-channel" value={newLink.channel} onChange={(e) => setNewLink({ ...newLink, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select></div>
          <div className="lt-field"><label htmlFor="mk-audience">Aimed at</label>
            <select id="mk-audience" value={newLink.audience} onChange={(e) => setNewLink({ ...newLink, audience: e.target.value })}>
              <option value="parent">Parents</option><option value="tutor">Tutors</option><option value="school">Schools</option><option value="any">Everyone</option>
            </select></div>
          <div className="lt-field"><label htmlFor="mk-lang">Page language</label>
            <select id="mk-lang" value={newLink.language} onChange={(e) => setNewLink({ ...newLink, language: e.target.value })}>
              <option value="en">English</option><option value="fr">Français</option><option value="es">Español</option><option value="pt">Português</option>
            </select></div>
          <div className="lt-field"><label htmlFor="mk-campaign">Campaign (optional)</label><input id="mk-campaign" maxLength={80} placeholder="e.g. Back to school 2027" value={newLink.campaign} onChange={(e) => setNewLink({ ...newLink, campaign: e.target.value })} /></div>
          <button className="lt-btn" type="submit">Create link + QR</button>
        </form>
      </section>

      <section className="lt-card" aria-labelledby="mk-shared">
        <h2 id="mk-shared" style={{ marginTop: 0 }}>Same device or shared?</h2>
        <p className="lt-muted">For each link: how many times it was opened, by how many different phones or computers, and how many opens were the same device coming back.</p>
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead><tr><th>Link</th><th>Opens</th><th>Different devices</th><th>Repeat opens</th><th>Verdict</th><th>Leads</th><th>Sign-ups</th><th></th></tr></thead>
            <tbody>
              {(data?.links || []).map((l) => (
                <tr key={l.id || 'none'}>
                  <td data-label="Link">
                    <strong>{l.label}</strong>
                    {l.channel && <div className="lt-helper-text">{CHANNEL_LABEL[l.channel]}{l.campaign ? ` · ${l.campaign}` : ''}{l.is_active === false ? ' · paused' : ''}</div>}
                  </td>
                  <td data-label="Opens">{l.opens}</td>
                  <td data-label="Different devices">{l.devices}</td>
                  <td data-label="Repeat opens">{l.repeat_opens}</td>
                  <td data-label="Verdict"><span className={`lt-badge ${l.devices > 1 ? 'lt-badge--info' : l.opens ? 'lt-badge--muted' : 'lt-badge--muted'}`}>{l.verdict}</span></td>
                  <td data-label="Leads">{l.leads}</td>
                  <td data-label="Sign-ups">{l.signups}</td>
                  <td>
                    {l.id && (
                      <div className="lt-row">
                        <button className="lt-btn lt-btn--sm" onClick={() => { setKitFor(l); setKitLang(l.language || 'en'); }}>Share kit</button>
                        <button className="lt-btn lt-btn--sm lt-btn--secondary" onClick={() => setOpenFilter(l.id)}>Opens</button>
                        <button className="lt-btn lt-btn--sm lt-btn--ghost" onClick={() => toggleActive(l)}>{l.is_active ? 'Pause' : 'Resume'}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.links.length === 0 && <div className="lt-empty">No links yet. Create one above.</div>}
        </div>
      </section>

      {kitFor && (
        <section className="lt-card lt-mk-kit" aria-labelledby="mk-kit">
          <div className="lt-row" style={{ justifyContent: 'space-between' }}>
            <h2 id="mk-kit" style={{ marginTop: 0 }}>Share kit: {kitFor.label}</h2>
            <button className="lt-btn lt-btn--sm lt-btn--ghost" onClick={() => setKitFor(null)}>Close</button>
          </div>
          <div className="lt-mk-kit-grid">
            <div>
              <QrCode value={kitFor.url} size={180} label={`QR code for ${kitFor.label}`} />
              <div className="lt-row" style={{ marginTop: 8 }}>
                <button className="lt-btn lt-btn--sm" onClick={() => downloadQr(kitFor.url, kitFor.label)}>Download QR (print size)</button>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="lt-field">
                <label htmlFor="mk-url">Link</label>
                <div className="lt-row"><input id="mk-url" readOnly value={kitUrl} style={{ flex: 1, minWidth: 0 }} /><button className="lt-btn lt-btn--sm" onClick={() => copy(kitUrl)}>Copy</button></div>
              </div>
              <div className="lt-field">
                <label htmlFor="mk-kit-lang">Message language</label>
                <select id="mk-kit-lang" value={kitLang} onChange={(e) => setKitLang(e.target.value)}>
                  <option value="en">English</option><option value="fr">Français</option><option value="es">Español</option><option value="pt">Português</option>
                </select>
              </div>
              <div className="lt-field"><label htmlFor="mk-msg">Ready-to-send message</label><textarea id="mk-msg" readOnly rows={4} value={kitText} /></div>
              <div className="lt-row" style={{ flexWrap: 'wrap' }}>
                <button className="lt-btn lt-btn--sm" onClick={() => copy(kitText)}>Copy message</button>
                {shareTargets(kitText, kitUrl).map(([name, href]) => (
                  <a key={name} className="lt-btn lt-btn--sm lt-btn--secondary" href={href} target="_blank" rel="noreferrer noopener">Share on {name}</a>
                ))}
              </div>
              <p className="lt-helper-text">Tip: make one link per group, page or flyer batch, so you can see which one works best.</p>
            </div>
          </div>
        </section>
      )}

      <section className="lt-card" aria-labelledby="mk-recent">
        <div className="lt-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="mk-recent" style={{ marginTop: 0 }}>Recent opens</h2>
          <select aria-label="Filter opens by link" style={{ maxWidth: '100%' }} value={openFilter} onChange={(e) => setOpenFilter(e.target.value)}>
            <option value="">All links</option>
            {(data?.links || []).map((l) => <option key={l.id || 'none'} value={l.id || 'none'}>{l.label}</option>)}
          </select>
        </div>
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead><tr><th>When</th><th>Link</th><th>Device</th><th>Opened by</th><th>Phone / browser</th><th>Location</th><th>Language</th></tr></thead>
            <tbody>
              {opens.map((o) => (
                <tr key={o.id}>
                  <td data-label="When">{fmtWhen(o.created_at)}</td>
                  <td data-label="Link">{o.label}</td>
                  <td data-label="Device"><span className="lt-device-no">#{o.device_no}</span></td>
                  <td data-label="Opened by"><span className={`lt-badge ${o.is_new_device ? 'lt-badge--success' : 'lt-badge--warning'}`}>{o.status}</span>{o.device_source === 'fingerprint' && <div className="lt-helper-text" title="No device ID was available; matched by phone model, screen, time zone and language">approx. match</div>}</td>
                  <td data-label="Phone / browser">{[o.device_model, o.os && `${o.os}${o.os_version ? ` ${o.os_version}` : ''}`].filter(Boolean).join(' · ') || '—'}<div className="lt-helper-text">{[o.browser, o.in_app && o.in_app !== o.browser ? `via ${o.in_app}` : null, o.device_type].filter(Boolean).join(' · ')}</div></td>
                  <td data-label="Location">{o.country ? `${flag(o.country)} ${[o.city, o.region, o.country].filter(Boolean).join(', ')}` : <span className="lt-muted">Unknown</span>}<div className="lt-helper-text">{o.timezone}</div></td>
                  <td data-label="Language">{o.language || '—'}{o.utm_source && <div className="lt-helper-text">source: {o.utm_source}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {opens.length === 0 && <div className="lt-empty">No opens yet.</div>}
        </div>
      </section>

      {data && (
        <section className="lt-mk-breakdowns" aria-label="Where opens come from">
          <BarList title="Countries" rows={data.breakdowns.countries} render={(k) => `${flag(k)} ${k}`} />
          <BarList title="Cities" rows={data.breakdowns.cities} />
          <BarList title="Channels" rows={data.breakdowns.channels} render={(k) => CHANNEL_LABEL[k] || k} />
          <BarList title="Device type" rows={data.breakdowns.device_types} />
          <BarList title="Operating system" rows={data.breakdowns.os} />
          <BarList title="Browser" rows={data.breakdowns.browsers} />
          <BarList title="Opened inside app" rows={data.breakdowns.in_app.filter((r) => r.key !== 'Unknown')} />
          <BarList title="Visitor language" rows={data.breakdowns.languages} />
          <BarList title="Hour of day (visitor’s time)" rows={data.breakdowns.hours.map((h) => ({ key: `${String(h.hour).padStart(2, '0')}:00`, opens: h.opens, devices: h.opens }))} />
        </section>
      )}

      <section className="lt-card" aria-labelledby="mk-leads">
        <div className="lt-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="mk-leads" style={{ marginTop: 0 }}>Leads</h2>
          <button className="lt-btn lt-btn--sm lt-btn--secondary" onClick={() => marketing.downloadLeadsCsv().catch((e) => setError(e.message))}>Export CSV</button>
        </div>
        <div className="lt-table-wrap">
          <table className="lt-table">
            <thead><tr><th>When</th><th>Name</th><th>Contact</th><th>Is a</th><th>Location</th><th>Link</th><th>Opened page</th><th>E-mails OK</th><th>Signed up</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td data-label="When">{fmtWhen(l.created_at)}</td>
                  <td data-label="Name">{l.full_name}{l.message && <div className="lt-helper-text">{l.message}</div>}</td>
                  <td data-label="Contact">{l.email && <a href={`mailto:${l.email}`}>{l.email}</a>}{l.phone && <div><a href={`https://wa.me/${l.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer noopener">{l.phone}</a></div>}</td>
                  <td data-label="Is a">{l.interest}</td>
                  <td data-label="Location">{l.country ? `${flag(l.country)} ${[l.city, l.country].filter(Boolean).join(', ')}` : '—'}</td>
                  <td data-label="Link">{l.label}</td>
                  <td data-label="Opened page">{l.opens_before}× before asking</td>
                  <td data-label="E-mails OK">{l.unsubscribed_at ? 'Unsubscribed' : l.consent_marketing ? 'Yes' : 'No'}</td>
                  <td data-label="Signed up">{l.converted_name ? `Yes (${l.converted_name})` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {leads.length === 0 && <div className="lt-empty">No leads yet.</div>}
        </div>

        <form onSubmit={sendMail} className="lt-mk-mail">
          <h3>E-mail leads who agreed to hear from you ({consented})</h3>
          <div className="lt-field"><label htmlFor="mk-subj">Subject</label><input id="mk-subj" required maxLength={150} value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></div>
          <div className="lt-field"><label htmlFor="mk-body">Message</label><textarea id="mk-body" required rows={5} maxLength={5000} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} />
            <span className="lt-helper-text">{'{name}'} becomes the lead’s first name. A sign-up link and an unsubscribe link are added automatically.</span></div>
          <button className="lt-btn" type="submit" disabled={!consented}>Send to {consented} lead{consented === 1 ? '' : 's'}</button>
        </form>
      </section>

      {settings && (
        <section className="lt-card" aria-labelledby="mk-ads">
          <h2 id="mk-ads" style={{ marginTop: 0 }}>Ad tracking (optional)</h2>
          <p className="lt-muted">Add your ad account IDs to measure Facebook/Instagram, Google and TikTok ads and build retargeting audiences. They load on the pitch page only after the visitor accepts cookies.</p>
          <form onSubmit={saveSettings} className="lt-mk-form">
            <div className="lt-field"><label htmlFor="mk-meta">Meta Pixel ID</label><input id="mk-meta" placeholder="e.g. 123456789012345" value={settings.meta_pixel_id} onChange={(e) => setSettings({ ...settings, meta_pixel_id: e.target.value })} /></div>
            <div className="lt-field"><label htmlFor="mk-google">Google tag ID</label><input id="mk-google" placeholder="e.g. G-ABC123 or AW-123456" value={settings.google_tag_id} onChange={(e) => setSettings({ ...settings, google_tag_id: e.target.value })} /></div>
            <div className="lt-field"><label htmlFor="mk-tiktok">TikTok Pixel ID</label><input id="mk-tiktok" value={settings.tiktok_pixel_id} onChange={(e) => setSettings({ ...settings, tiktok_pixel_id: e.target.value })} /></div>
            <button className="lt-btn" type="submit">Save</button>
          </form>
        </section>
      )}

      <p className="lt-helper-text">How devices are told apart: the pitch page keeps a random ID in the visitor’s browser (no personal data). If it’s missing, a rough match uses phone model, screen size, time zone and language, which can’t tell two identical phones apart. A private window, cleared browser data, or switching browser (for example from WhatsApp’s built-in browser to Chrome) shows up as a new device, so treat “Shared” as a strong hint, not proof. Locations are city-level estimates from the network address; exact addresses are never stored. This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.</p>
    </Layout>
  );
}
