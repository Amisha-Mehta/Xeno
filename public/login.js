document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  errorEl.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const res = await fetch('/api/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (res.ok && data.ok) {
      window.location.href = '/';
    } else {
      errorEl.textContent = data.error || 'Login failed. Check your credentials.';
      errorEl.classList.add('visible');
    }
  } catch (err) {
    errorEl.textContent = 'Network error. Is the CRM server running?';
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in as Admin';
  }
});
