// Tab switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab === 'signin' ? 'signinContent' : 'registerContent').classList.add('active');
    // Clear errors
    document.querySelectorAll('.login-error, .login-success').forEach((e) => e.classList.remove('visible'));
  });
});

// Sign In
document.getElementById('customerLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('loginEmail').value.trim();
  const phone = document.getElementById('loginPhone').value.trim();

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

// Register
document.getElementById('customerRegisterForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('registerError');
  const successEl = document.getElementById('registerSuccess');
  const btn = document.getElementById('registerBtn');

  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const phone = document.getElementById('regPhone').value.trim();
  const city = document.getElementById('regCity').value.trim() || 'Unknown';
  const address = document.getElementById('regAddress').value.trim();

  errorEl.classList.remove('visible');
  successEl.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Creating account...';

  try {
    const res = await fetch('/api/auth/customer/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, city, address })
    });
    const data = await res.json();

    if (res.ok && data.ok) {
      successEl.textContent = '🎉 Account created! Redirecting to your portal...';
      successEl.classList.add('visible');
      setTimeout(() => {
        window.location.href = '/customer-portal.html';
      }, 1000);
    } else {
      errorEl.textContent = data.error || 'Registration failed.';
      errorEl.classList.add('visible');
    }
  } catch (err) {
    errorEl.textContent = 'Network error. Is the CRM server running?';
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Account & Get 100 Points 🎉';
  }
});
