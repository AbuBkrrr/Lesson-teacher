function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error(err);

  if (err.code === '23505') { // Postgres unique_violation
    return res.status(409).json({ error: 'A record with that unique value already exists (email, phone, or code).' });
  }

  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  const status = err.status || err.statusCode || 500;
  // Never leak internals (SQL, stack hints) on 5xx; 4xx messages are intentional.
  const message = status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : (err.message || 'Internal server error');
  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
