  // ══════════════════════════════════════════
  // SUPABASE CONFIG
  // ══════════════════════════════════════════
  var SUPABASE_URL = 'https://dnhsufwdyhkwrsdtfgyx.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_TQztgMqEoUjGQVUqQjPCPA_joWxqPtG';
  var WORKER_BASE = 'https://app.cryptotaxedge.com';
  var sbClient = null;
  (function initSb() {
    var sdk = null;
    try { if (typeof window.CTE_supabase !== 'undefined') sdk = window.CTE_supabase; } catch(e) {}
    try { if (!sdk && typeof window.supabase !== 'undefined') sdk = window.supabase; } catch(e) {}
    try { if (!sdk && typeof supabase !== 'undefined') sdk = supabase; } catch(e) {}
    if (sdk && typeof sdk.createClient === 'function') {
      sbClient = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('[CTE] Supabase client ready');
    } else {
      console.error('[CTE] Supabase SDK not found.');
    }
  })();

  const TIER_COLORS = {
    anonymous: '#475569', admin: '#fbbf24', pro: '#a78bfa', cpa: '#00c9b1', starter: '#60a5fa', free: '#64748b'
  };

  const TIER_LIMITS = {
    anonymous: 10, free: 25, starter: 300, pro: 1000, cpa: Infinity, admin: Infinity
  };
  const ANON_KEY = 'cte_anon_used';

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
    document.getElementById('screen-' + id).classList.add('active');
  }

  function showExtErr(msg) {
    clearExtMsgs();
    var el = document.createElement('div');
    el.id = 'login-err'; el.className = 'login-err';
    el.textContent = msg;
    var tabs = document.querySelector('.login-tabs-auth');
    tabs.parentNode.insertBefore(el, tabs.nextSibling);
  }
  function showExtSuccess(msg) {
    clearExtMsgs();
    var el = document.createElement('div');
    el.id = 'login-success'; el.className = 'login-err login-success-msg';
    el.textContent = msg;
    var tabs = document.querySelector('.login-tabs-auth');
    tabs.parentNode.insertBefore(el, tabs.nextSibling);
  }
  function clearExtMsgs() {
    ['login-err','login-success'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  // ── Panel switching ────────────────────────────────────────
  window.switchExtTab = function switchExtTab(tab) {
    document.getElementById('ext-panel-login').style.display  = tab === 'login'  ? 'block' : 'none';
    document.getElementById('ext-panel-signup').style.display = tab === 'signup' ? 'block' : 'none';
    document.getElementById('ext-panel-forgot').style.display = 'none';
    document.getElementById('ext-panel-verify').style.display = 'none';
    document.getElementById('ext-tab-login').classList.toggle('active',  tab === 'login');
    document.getElementById('ext-tab-signup').classList.toggle('active', tab === 'signup');
    clearExtMsgs();
  };

  function showForgotPanel() {
    document.getElementById('ext-panel-login').style.display  = 'none';
    document.getElementById('ext-panel-signup').style.display = 'none';
    document.getElementById('ext-panel-forgot').style.display = 'block';
    document.getElementById('ext-tab-login').classList.remove('active');
    document.getElementById('ext-tab-signup').classList.remove('active');
    clearExtMsgs();
  }

  // ── Set logged-in state ────────────────────────────────────
  function setLoggedIn(email, userData) {
    document.getElementById('popup-email').textContent = email;
    document.getElementById('popup-tier').textContent = (userData.tier || 'free').toUpperCase();
    document.getElementById('popup-tier').style.color = TIER_COLORS[userData.tier] || '#64748b';

    var plan = userData.tier ? (userData.tier.charAt(0).toUpperCase() + userData.tier.slice(1)) : 'Free';
    var planEl = document.getElementById('popup-plan');
    planEl.textContent = plan + ' Plan';
    planEl.className = 'user-plan plan-' + (userData.tier || 'free');

    var upgradeSection = document.getElementById('upgrade-section');
    if (userData.tier === 'free') {
      upgradeSection.innerHTML = '<div class="upgrade-banner"><div class="upgrade-text">Free plan · 25 TX/month<br>Upgrade to Starter for 300/month</div><a class="upgrade-link" href="https://cryptotaxedge.com/#pricing" target="_blank">Upgrade →</a></div>';
    } else if (userData.tier === 'starter') {
      upgradeSection.innerHTML = '<div class="upgrade-banner"><div class="upgrade-text">Starter · 300 TX/month<br>Upgrade to Pro for 1,000/month</div><a class="upgrade-link" href="https://cryptotaxedge.com/#pricing" target="_blank">Upgrade →</a></div>';
    } else {
      upgradeSection.innerHTML = '';
    }

    chrome.storage.local.set({ cteEmail: email, cteUserData: userData, userTier: userData.tier });
    showScreen('app');
    loadSettings();
  }

  // ── Sign In (direct Supabase) ─────────────────────────────
  function submitLogin() {
    var email = (document.getElementById('login-email').value || '').trim().toLowerCase();
    var password = (document.getElementById('login-password').value || '').trim();
    if (!email || !email.includes('@')) { showExtErr('Enter a valid email.'); return; }
    if (!password || password.length < 6) { showExtErr('Enter your password.'); return; }

    var btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';

    fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      btn.disabled = false; btn.textContent = 'Sign In';
      if (!res.ok || !res.data.access_token) {
        showExtErr(res.data.error_description || res.data.error || 'Sign in failed.');
        return;
      }
      fetch(SUPABASE_URL + '/rest/v1/profiles?select=email,tier&limit=1', {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + res.data.access_token }
      })
      .then(function(r2) { return r2.json(); })
      .then(function(rows) {
        var tier = (rows && rows.length && rows[0].tier) ? rows[0].tier : 'free';
        chrome.storage.local.set({ cteAccessToken: res.data.access_token });
        setLoggedIn(res.data.user.email || email, { tier: tier });
      })
      .catch(function() {
        var meta = (res.data.user && res.data.user.user_metadata) || {};
        setLoggedIn(res.data.user.email || email, { tier: meta.tier || 'free' });
      });
    })
    .catch(function() {
      btn.disabled = false; btn.textContent = 'Sign In';
      showExtErr('Network error. Check your connection.');
    });
  }

  // ── Sign Up — FIX: use redirectTo matching Supabase site URL ─
  function submitSignup() {
    var email = (document.getElementById('signup-email').value || '').trim().toLowerCase();
    var password = (document.getElementById('signup-password').value || '').trim();
    if (!email || !email.includes('@')) { showExtErr('Enter a valid email.'); return; }
    if (!password || password.length < 8) { showExtErr('Password must be at least 8 characters.'); return; }

    var btn = document.getElementById('signup-btn');
    btn.disabled = true; btn.textContent = 'Creating account…';

    // POST to Supabase signup with redirectTo so confirmation link works
    fetch(SUPABASE_URL + '/auth/v1/signup', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: email,
        password: password,
        options: {
          emailRedirectTo: 'https://app.cryptotaxedge.com/auth/callback'
        }
      })
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function(res) {
      btn.disabled = false; btn.textContent = 'Create Account';

      // Supabase returns 422 if email already registered
      if (res.status === 422) {
        showExtErr('An account with this email already exists. Please sign in.');
        switchExtTab('login');
        document.getElementById('login-email').value = email;
        return;
      }

      if (!res.ok) {
        var errMsg = res.data.error_description || res.data.msg || res.data.error || 'Sign up failed. Please try again.';
        showExtErr(errMsg);
        return;
      }

      if (res.data.access_token) {
        // Email confirmation disabled — auto-login
        chrome.storage.local.set({ cteAccessToken: res.data.access_token });
        var meta = (res.data.user && res.data.user.user_metadata) || {};
        setLoggedIn(res.data.user.email || email, { tier: meta.tier || 'free' });
      } else {
        // Confirmation email sent — show dedicated verification screen
        clearExtMsgs();
        document.getElementById('ext-panel-login').style.display = 'none';
        document.getElementById('ext-panel-signup').style.display = 'none';
        document.getElementById('ext-panel-forgot').style.display = 'none';
        document.getElementById('ext-panel-verify').style.display = 'block';
        document.getElementById('verify-email-display').textContent = email;
        // Store email for easy sign-in after verify
        document.getElementById('login-email').value = email;
      }
    })
    .catch(function(err) {
      btn.disabled = false; btn.textContent = 'Create Account';
      console.error('[CTE] Signup error:', err);
      showExtErr('Network error. Check your connection.');
    });
  }

  // ── Forgot password ────────────────────────────────────────
  function submitForgotPassword() {
    if (!sbClient) { showExtErr('Auth not configured.'); return; }
    var email = (document.getElementById('forgot-email').value || '').trim().toLowerCase();
    if (!email || !email.includes('@')) { showExtErr('Enter a valid email.'); return; }

    var btn = document.getElementById('forgot-btn');
    btn.disabled = true; btn.textContent = 'Sending…';

    sbClient.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://app.cryptotaxedge.com/reset-password'
    }).then(function(res) {
      btn.disabled = false; btn.textContent = 'Send Reset Link';
      if (res.error) {
        showExtErr(res.error.message || 'Failed to send reset email.');
      } else {
        showExtSuccess('Reset link sent! Check your email.');
      }
    });
  }

  // ── Logout ─────────────────────────────────────────────────
  document.getElementById('logout-btn').addEventListener('click', function() {
    if (sbClient) sbClient.auth.signOut();
    chrome.storage.local.remove(['cteEmail', 'userTier', 'cteUserData', 'cteAccessToken'], function() {
      showScreen('login');
      switchExtTab('login');
    });
  });

  // ── Settings ───────────────────────────────────────────────
  function loadSettings() {}

  // ── Anonymous trial logic ──────────────────────────────────
  function tryAnonymous() {
    chrome.storage.local.get([ANON_KEY], function(s) {
      var used = s[ANON_KEY] || 0;
      if (used >= TIER_LIMITS.anonymous) {
        showModal('anonymous_exhausted');
      } else {
        setAnonymousMode();
      }
    });
  }

  function setAnonymousMode() {
    chrome.storage.local.set({ userTier: 'anonymous' });
    chrome.storage.local.get([ANON_KEY], function(s) {
      var used = s[ANON_KEY] || 0;
      document.getElementById('popup-email').textContent = 'Guest';
      document.getElementById('popup-tier').textContent = 'TRIAL';
      document.getElementById('popup-tier').style.color = TIER_COLORS.anonymous;
      var planEl = document.getElementById('popup-plan');
      planEl.textContent = 'Free Trial';
      planEl.className = 'user-plan plan-anonymous';
      var upgradeSection = document.getElementById('upgrade-section');
      upgradeSection.innerHTML = '<div class="upgrade-banner"><div class="upgrade-text">Trial: ' + used + '/' + TIER_LIMITS.anonymous + ' TX used<br><b>Sign up free for 25 TX/month</b></div><button id="anon-upgrade-btn" class="upgrade-link" style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:12px;font-weight:600">Sign up free →</button></div>';
      setTimeout(function() {
        var b = document.getElementById('anon-upgrade-btn');
        if (b) b.addEventListener('click', showSignupFromModal);
      }, 0);
      showScreen('app');
      loadSettings();
    });
  }

  function refreshAnonBanner() {
    chrome.storage.local.get([ANON_KEY], function(s) {
      var used = s[ANON_KEY] || 0;
      var upgradeSection = document.getElementById('upgrade-section');
      if (upgradeSection && document.getElementById('popup-tier').textContent === 'TRIAL') {
        upgradeSection.innerHTML = '<div class="upgrade-banner"><div class="upgrade-text">Trial: ' + used + '/' + TIER_LIMITS.anonymous + ' TX used<br><b>Sign up free for 25 TX/month</b></div><button id="anon-upgrade-btn" class="upgrade-link" style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:12px;font-weight:600">Sign up free →</button></div>';
        setTimeout(function() {
          var b = document.getElementById('anon-upgrade-btn');
          if (b) b.addEventListener('click', showSignupFromModal);
        }, 0);
      }
    });
  }

  // ── Modal helpers ──────────────────────────────────────────
  function showModal(reason) {
    var modal = document.getElementById('upgrade-modal');
    var title = document.getElementById('modal-title');
    var body  = document.getElementById('modal-body');
    if (reason === 'anonymous_exhausted') {
      title.textContent = 'You\'ve used your 10 free analyses';
      body.textContent  = 'Sign up free — no credit card needed — to get 25 TX/month.';
    } else if (reason === 'free_exhausted') {
      title.textContent = 'Monthly limit reached';
      body.textContent  = 'You\'ve used all 25 free TX this month. Upgrade to Starter for 300 TX/month.';
    }
    modal.style.display = 'flex';
  }

  function closeModal() {
    document.getElementById('upgrade-modal').style.display = 'none';
  }

  function showSignupFromModal() {
    closeModal();
    showScreen('login');
    setTimeout(function() { switchExtTab('signup'); }, 50);
  }

  // ── Init: restore session ──────────────────────────────────
  chrome.storage.local.get(['cteEmail', 'cteUserData'], function(s) {
    if (sbClient) {
      sbClient.auth.getSession().then(function(res) {
        var session = res.data && res.data.session;
        if (session) {
          var meta = session.user.user_metadata || {};
          setLoggedIn(session.user.email, { tier: meta.tier || 'free' });
        } else if (s.cteEmail && s.cteUserData) {
          setLoggedIn(s.cteEmail, s.cteUserData);
        } else {
          showScreen('login');
        }
      });
    } else if (s.cteEmail && s.cteUserData) {
      setLoggedIn(s.cteEmail, s.cteUserData);
    } else {
      showScreen('login');
    }
  });

  // ── Global delegation ──────────────────────────────────────
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (t && (t.id === 'anon-upgrade-btn' || t.id === 'anon-upgrade-btn2' ||
              t.classList.contains('upgrade-link'))) {
      showSignupFromModal();
    }
  });

  // ── Event listeners ────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    var tabLogin  = document.getElementById('ext-tab-login');
    var tabSignup = document.getElementById('ext-tab-signup');
    if (tabLogin)  tabLogin.addEventListener('click',  function() { switchExtTab('login');  });
    if (tabSignup) tabSignup.addEventListener('click', function() { switchExtTab('signup'); });

    var loginBtn   = document.getElementById('login-btn');
    var signupBtn  = document.getElementById('signup-btn');
    var forgotBtn  = document.getElementById('forgot-btn');
    var anonBtn    = document.getElementById('try-anon-btn');
    var forgotLink = document.getElementById('forgot-pw-link');
    var backLink   = document.getElementById('back-to-login-link');
    var signupLink = document.getElementById('goto-signup-link');

    if (loginBtn)   loginBtn.addEventListener('click',   submitLogin);
    if (signupBtn)  signupBtn.addEventListener('click',  submitSignup);
    if (forgotBtn)  forgotBtn.addEventListener('click',  submitForgotPassword);
    if (anonBtn)    anonBtn.addEventListener('click',    tryAnonymous);
    if (forgotLink) forgotLink.addEventListener('click', function(e) { e.preventDefault(); showForgotPanel(); });
    if (backLink)   backLink.addEventListener('click',   function(e) { e.preventDefault(); switchExtTab('login'); });
    if (signupLink) signupLink.addEventListener('click', function(e) { e.preventDefault(); switchExtTab('signup'); });

    // Verification panel buttons
    var verifySigninBtn = document.getElementById('verify-signin-btn');
    var resendLink = document.getElementById('resend-verify-link');
    if (verifySigninBtn) verifySigninBtn.addEventListener('click', function() {
      document.getElementById('ext-panel-verify').style.display = 'none';
      switchExtTab('login');
    });
    if (resendLink) resendLink.addEventListener('click', function(e) {
      e.preventDefault();
      var email = document.getElementById('verify-email-display').textContent;
      if (!email) return;
      fetch(SUPABASE_URL + '/auth/v1/resend', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'signup', email: email })
      }).then(function() {
        resendLink.textContent = 'Sent!';
        setTimeout(function() { resendLink.textContent = 'resend email'; }, 3000);
      });
    });

    var loginPw  = document.getElementById('login-password');
    var signupPw = document.getElementById('signup-password');
    if (loginPw)  loginPw.addEventListener('keydown',  function(e) { if (e.key === 'Enter') submitLogin(); });
    if (signupPw) signupPw.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitSignup(); });

    var modalSignupBtn = document.getElementById('modal-signup-btn');
    var modalCloseBtn  = document.getElementById('modal-close-btn');
    if (modalSignupBtn) modalSignupBtn.addEventListener('click', showSignupFromModal);
    if (modalCloseBtn)  modalCloseBtn.addEventListener('click',  closeModal);
  });
