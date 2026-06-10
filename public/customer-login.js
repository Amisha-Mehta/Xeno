document.getElementById('customerLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('email').value.trim();
  const phone = document.getElementById('phone').value.trim();

  errorEl.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/auth/customer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone })
    });

    const data = await res.json();

    if (res.ok && data.ok) {
      window.location.href = '/customer-portal.html';
    } else {
      errorEl.textContent = data.error || 'Login failed. Check your email and phone number.';
      errorEl.classList.add('visible');
    }
  } catch (err) {
    errorEl.textContent = 'Network error. Is the CRM server running?';
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Access My Portal';
  }
});
