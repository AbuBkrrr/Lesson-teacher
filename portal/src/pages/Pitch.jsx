import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { marketing } from '../api/client';
import { deviceInfo, rememberAttribution } from '../utils/tracking';

// Public landing page opened from a tracking link / QR code (#/go/<code>).
const T = {
  en: {
    tagline: 'Trusted tutors for every child, every skill.',
    sub: 'Lesson Teacher matches your child with vetted tutors for school subjects, music, coding, sports, life skills and more. Watch a tutor audition first, book lessons, and follow progress after every class.',
    parent: 'Find a tutor', tutor: 'Teach on Lesson Teacher',
    how: 'How it works',
    steps: ['Tell us what your child wants to learn', 'Watch tutors audition: video, live or a challenge you set', 'Book single or weekly lessons and pay securely', 'Get a report after every lesson and track progress'],
    safe: 'Built for children’s safety', safeText: 'ID-verified tutors, parent-approved child accounts, and parents can see every chat and lesson report.',
    tutorsTitle: 'For tutors', tutorsText: 'Set your hours and rate, audition for families, teach live with video, screen share and a whiteboard, and get paid.',
    formTitle: 'Questions? Ask for a free call-back', name: 'Your name', email: 'Email', phone: 'Phone (WhatsApp is fine)', iam: 'I am a',
    roles: { parent: 'Parent', tutor: 'Tutor', school: 'School', other: 'Other' }, message: 'What would you like help with? (optional)',
    consent: 'Send me news and offers from Lesson Teacher. I can unsubscribe at any time.', send: 'Request a call-back',
    thanks: 'Thank you! We will contact you shortly.', needContact: 'Please add an email or phone number.',
    cookies: 'We use cookies to measure our adverts. Accept?', accept: 'Accept', decline: 'No thanks', inactive: 'This link has expired, but you are still welcome here.',
    privacy: 'We record anonymous visit statistics (device type and approximate city) to improve our outreach. We never store your exact location.',
  },
  fr: {
    tagline: 'Des tuteurs de confiance pour chaque enfant, pour chaque compétence.',
    sub: 'Lesson Teacher met votre enfant en relation avec des tuteurs vérifiés : matières scolaires, musique, programmation, sport, compétences de vie et plus. Regardez d’abord une audition, réservez des cours et suivez les progrès après chaque séance.',
    parent: 'Trouver un tuteur', tutor: 'Enseigner sur Lesson Teacher',
    how: 'Comment ça marche',
    steps: ['Dites-nous ce que votre enfant veut apprendre', 'Regardez les tuteurs auditionner : vidéo, en direct ou un défi de votre choix', 'Réservez des cours ponctuels ou hebdomadaires et payez en toute sécurité', 'Recevez un compte rendu après chaque cours et suivez les progrès'],
    safe: 'Pensé pour la sécurité des enfants', safeText: 'Tuteurs à l’identité vérifiée, comptes enfants approuvés par les parents, et les parents voient chaque conversation et chaque compte rendu.',
    tutorsTitle: 'Pour les tuteurs', tutorsText: 'Fixez vos horaires et vos tarifs, auditionnez pour des familles, enseignez en direct avec vidéo, partage d’écran et tableau blanc, et soyez payé.',
    formTitle: 'Des questions ? Demandez à être rappelé gratuitement', name: 'Votre nom', email: 'E-mail', phone: 'Téléphone (WhatsApp accepté)', iam: 'Je suis',
    roles: { parent: 'Parent', tutor: 'Tuteur', school: 'École', other: 'Autre' }, message: 'Sur quoi souhaitez-vous de l’aide ? (facultatif)',
    consent: 'Envoyez-moi les nouveautés et offres de Lesson Teacher. Je peux me désabonner à tout moment.', send: 'Être rappelé',
    thanks: 'Merci ! Nous vous contacterons très vite.', needContact: 'Indiquez un e-mail ou un numéro de téléphone.',
    cookies: 'Nous utilisons des cookies pour mesurer nos publicités. Accepter ?', accept: 'Accepter', decline: 'Non merci', inactive: 'Ce lien a expiré, mais vous êtes le bienvenu.',
    privacy: 'Nous enregistrons des statistiques de visite anonymes (type d’appareil et ville approximative) pour améliorer notre communication. Nous ne conservons jamais votre position exacte.',
  },
  es: {
    tagline: 'Tutores de confianza para cada niño y cada habilidad.',
    sub: 'Lesson Teacher conecta a tu hijo con tutores verificados para materias escolares, música, programación, deportes, habilidades para la vida y más. Mira primero una audición, reserva clases y sigue el progreso después de cada sesión.',
    parent: 'Buscar un tutor', tutor: 'Enseñar en Lesson Teacher',
    how: 'Cómo funciona',
    steps: ['Cuéntanos qué quiere aprender tu hijo', 'Mira a los tutores en una audición: video, en vivo o un reto que tú eliges', 'Reserva clases sueltas o semanales y paga de forma segura', 'Recibe un informe después de cada clase y sigue el progreso'],
    safe: 'Pensado para la seguridad infantil', safeText: 'Tutores con identidad verificada, cuentas infantiles aprobadas por los padres, y los padres ven cada chat e informe.',
    tutorsTitle: 'Para tutores', tutorsText: 'Define tu horario y tarifa, haz audiciones para familias, enseña en vivo con video, pantalla compartida y pizarra, y cobra.',
    formTitle: '¿Preguntas? Pide que te llamemos gratis', name: 'Tu nombre', email: 'Correo electrónico', phone: 'Teléfono (WhatsApp sirve)', iam: 'Soy',
    roles: { parent: 'Padre/Madre', tutor: 'Tutor', school: 'Escuela', other: 'Otro' }, message: '¿En qué te podemos ayudar? (opcional)',
    consent: 'Envíame noticias y ofertas de Lesson Teacher. Puedo darme de baja cuando quiera.', send: 'Solicitar llamada',
    thanks: '¡Gracias! Te contactaremos pronto.', needContact: 'Añade un correo o un número de teléfono.',
    cookies: 'Usamos cookies para medir nuestros anuncios. ¿Aceptas?', accept: 'Aceptar', decline: 'No, gracias', inactive: 'Este enlace ha caducado, pero eres bienvenido.',
    privacy: 'Registramos estadísticas anónimas de visitas (tipo de dispositivo y ciudad aproximada) para mejorar nuestra difusión. Nunca guardamos tu ubicación exacta.',
  },
  pt: {
    tagline: 'Tutores de confiança para cada criança e cada habilidade.',
    sub: 'A Lesson Teacher liga o seu filho a tutores verificados para disciplinas escolares, música, programação, desporto, competências para a vida e muito mais. Veja primeiro uma audição, marque aulas e acompanhe o progresso depois de cada sessão.',
    parent: 'Encontrar um tutor', tutor: 'Ensinar na Lesson Teacher',
    how: 'Como funciona',
    steps: ['Diga-nos o que o seu filho quer aprender', 'Veja os tutores numa audição: vídeo, ao vivo ou um desafio à sua escolha', 'Marque aulas avulsas ou semanais e pague em segurança', 'Receba um relatório após cada aula e acompanhe o progresso'],
    safe: 'Feito para a segurança das crianças', safeText: 'Tutores com identidade verificada, contas infantis aprovadas pelos pais, e os pais veem cada conversa e relatório.',
    tutorsTitle: 'Para tutores', tutorsText: 'Defina o seu horário e preço, faça audições para famílias, ensine ao vivo com vídeo, partilha de ecrã e quadro branco, e receba.',
    formTitle: 'Dúvidas? Peça uma chamada gratuita', name: 'O seu nome', email: 'E-mail', phone: 'Telefone (WhatsApp serve)', iam: 'Sou',
    roles: { parent: 'Pai/Mãe', tutor: 'Tutor', school: 'Escola', other: 'Outro' }, message: 'Em que podemos ajudar? (opcional)',
    consent: 'Enviem-me novidades e ofertas da Lesson Teacher. Posso cancelar a qualquer momento.', send: 'Pedir chamada',
    thanks: 'Obrigado! Entraremos em contacto em breve.', needContact: 'Indique um e-mail ou um número de telefone.',
    cookies: 'Usamos cookies para medir os nossos anúncios. Aceita?', accept: 'Aceitar', decline: 'Não, obrigado', inactive: 'Este link expirou, mas é bem-vindo na mesma.',
    privacy: 'Registamos estatísticas anónimas de visitas (tipo de dispositivo e cidade aproximada) para melhorar a nossa divulgação. Nunca guardamos a sua localização exata.',
  },
};
const LANG_NAMES = { en: 'English', fr: 'Français', es: 'Español', pt: 'Português' };
const CONSENT_KEY = 'lt_cookie_consent';

function pickLanguage(linkLang) {
  try {
    const saved = localStorage.getItem('lt_pitch_lang');
    if (saved && T[saved]) return saved;
  } catch { /* ignore */ }
  // The visitor's own phone language wins when we have it; the link's language
  // is the fallback for visitors whose language we don't offer.
  const nav = (navigator.language || '').slice(0, 2);
  if (T[nav]) return nav;
  if (linkLang && T[linkLang]) return linkLang;
  return 'en';
}

/** Ad tags load only after the visitor accepts cookies. */
function loadAdTags(cfg) {
  if (!cfg) return;
  if (cfg.google_tag_id && !window.gtag) {
    const s = document.createElement('script');
    s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.google_tag_id)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', cfg.google_tag_id);
  }
  if (cfg.meta_pixel_id && !window.fbq) {
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', cfg.meta_pixel_id); window.fbq('track', 'PageView');
  }
  if (cfg.tiktok_pixel_id && !window.ttq) {
    const s = document.createElement('script');
    s.async = true; s.src = `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(cfg.tiktok_pixel_id)}&lib=ttq`;
    document.head.appendChild(s);
  }
}
function trackLead() {
  try { window.fbq?.('track', 'Lead'); window.gtag?.('event', 'generate_lead'); window.ttq?.track?.('SubmitForm'); } catch { /* ignore */ }
}

export default function Pitch() {
  const { slug } = useParams();
  const [lang, setLang] = useState(() => pickLanguage(null));
  const [link, setLink] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [consent, setConsent] = useState(() => { try { return localStorage.getItem(CONSENT_KEY); } catch { return 'no'; } });
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', interest: 'parent', message: '', consent_marketing: false });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const reported = useRef(false);
  const t = T[lang];

  useEffect(() => {
    if (reported.current) return; // StrictMode runs effects twice in dev: count one open per page view
    reported.current = true;
    (async () => {
      const info = await deviceInfo();
      const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
      const utm = Object.fromEntries(['source', 'medium', 'campaign', 'content', 'term'].map((k) => [k, q.get(`utm_${k}`)]).filter(([, v]) => v));
      try {
        const res = await marketing.open({ slug: slug || undefined, ...info, referrer: document.referrer || undefined, utm });
        setLink(res.link);
        if (res.link?.language) setLang(pickLanguage(res.link.language));
        rememberAttribution(slug);
      } catch (e) {
        if (/not valid/i.test(e.message)) { setInvalid(true); rememberAttribution(null); }
      }
    })();
    marketing.publicConfig().then(setCfg).catch(() => {});
  }, [slug]);

  useEffect(() => { if (consent === 'yes') loadAdTags(cfg); }, [consent, cfg]);

  function choose(v) {
    setConsent(v);
    try { localStorage.setItem(CONSENT_KEY, v); } catch { /* ignore */ }
  }
  function changeLang(v) {
    setLang(v);
    try { localStorage.setItem('lt_pitch_lang', v); } catch { /* ignore */ }
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.email.trim() && !form.phone.trim()) { setError(t.needContact); return; }
    setBusy(true);
    try {
      await marketing.lead({ ...form, slug: invalid ? undefined : slug, ...(await deviceInfo()) });
      setSent(true);
      trackLead();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const audience = link?.audience;
  const hasAds = cfg && (cfg.meta_pixel_id || cfg.google_tag_id || cfg.tiktok_pixel_id);

  return (
    <div className="lt-pitch" dir="ltr" lang={lang}>
      <header className="lt-pitch-top">
        <strong className="lt-pitch-brand">Lesson Teacher</strong>
        <label className="lt-pitch-lang">
          <span className="lt-sr-only">Language</span>
          <select value={lang} onChange={(e) => changeLang(e.target.value)} aria-label="Language">
            {Object.entries(LANG_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </header>

      <section className="lt-pitch-hero">
        {(invalid || (link && !link.active)) && <p className="lt-pitch-note">{t.inactive}</p>}
        <h1>{t.tagline}</h1>
        <p>{t.sub}</p>
        <div className="lt-pitch-ctas">
          {audience !== 'tutor' && <Link className="lt-btn lt-pitch-cta" to="/signup?role=parent">{t.parent}</Link>}
          {audience !== 'parent' && <Link className={`lt-btn ${audience === 'tutor' ? 'lt-pitch-cta' : 'lt-btn--secondary'}`} to="/signup?role=tutor">{t.tutor}</Link>}
        </div>
      </section>

      <section className="lt-pitch-grid">
        <div className="lt-card">
          <h2>{t.how}</h2>
          <ol>{t.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
        <div className="lt-card">
          <h2>{t.safe}</h2>
          <p>{t.safeText}</p>
          <h2>{t.tutorsTitle}</h2>
          <p>{t.tutorsText}</p>
        </div>
      </section>

      <section className="lt-card lt-pitch-form">
        <h2>{t.formTitle}</h2>
        {sent ? <p className="lt-success-banner" role="status">{t.thanks}</p> : (
          <form onSubmit={submit}>
            {error && <div className="lt-error-banner">{error}</div>}
            <div className="lt-field"><label htmlFor="pitch-name">{t.name}</label><input id="pitch-name" required maxLength={120} value={form.full_name} onChange={set('full_name')} autoComplete="name" /></div>
            <div className="lt-row">
              <div className="lt-field" style={{ flex: 1 }}><label htmlFor="pitch-email">{t.email}</label><input id="pitch-email" type="email" maxLength={200} value={form.email} onChange={set('email')} autoComplete="email" /></div>
              <div className="lt-field" style={{ flex: 1 }}><label htmlFor="pitch-phone">{t.phone}</label><input id="pitch-phone" type="tel" maxLength={20} value={form.phone} onChange={set('phone')} autoComplete="tel" /></div>
            </div>
            <div className="lt-field"><label htmlFor="pitch-interest">{t.iam}</label>
              <select id="pitch-interest" value={form.interest} onChange={set('interest')}>
                {Object.entries(t.roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="lt-field"><label htmlFor="pitch-message">{t.message}</label><textarea id="pitch-message" rows={3} maxLength={1000} value={form.message} onChange={set('message')} /></div>
            <label className="lt-pitch-consent"><input type="checkbox" checked={form.consent_marketing} onChange={set('consent_marketing')} /> {t.consent}</label>
            <button className="lt-btn" type="submit" disabled={busy}>{t.send}</button>
          </form>
        )}
      </section>

      <footer className="lt-pitch-footer"><p className="lt-helper-text">{t.privacy}</p></footer>

      {hasAds && !consent && (
        <div className="lt-pitch-cookies" role="dialog" aria-label="Cookies">
          <span>{t.cookies}</span>
          <button className="lt-btn lt-btn--sm" onClick={() => choose('yes')}>{t.accept}</button>
          <button className="lt-btn lt-btn--sm lt-btn--ghost" onClick={() => choose('no')}>{t.decline}</button>
        </div>
      )}
    </div>
  );
}

/** #/unsubscribe/:token — one-click opt-out from follow-up e-mails. */
export function Unsubscribe() {
  const { token } = useParams();
  const [state, setState] = useState('working');
  useEffect(() => {
    marketing.unsubscribe(token).then(() => setState('done')).catch(() => setState('error'));
  }, [token]);
  return (
    <div className="lt-auth-screen">
      <div className="lt-auth-card">
        <div className="lt-auth-logo">Lesson Teacher</div>
        <p role="status">
          {state === 'working' && 'Unsubscribing…'}
          {state === 'done' && 'You are unsubscribed. You will not receive marketing e-mails from Lesson Teacher.'}
          {state === 'error' && 'This unsubscribe link is not valid or has already been used.'}
        </p>
      </div>
    </div>
  );
}
