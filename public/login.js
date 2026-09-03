(() => {
  const form = document.getElementById('form-login');
  const errorEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorEl.textContent = data.error || 'No se pudo iniciar sesión';
        return;
      }
      window.location.href = '/';
    } catch {
      errorEl.textContent = 'No se pudo conectar con el servidor';
    }
  });
})();
