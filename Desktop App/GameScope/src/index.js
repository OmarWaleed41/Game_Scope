const socket = io('http://localhost:3001');

socket.on('connect', () => {
    const myId = currentUser?.userId ?? currentUser?.id;
    if (myId) socket.emit('register', myId);
});

let authToken = localStorage.getItem('authToken') || null;
let currentUser = null;
let _pendingEmail = '';
let currentTheme = localStorage.getItem('theme') || 'dark'; // 'dark' or 'light'

// ── Library state ──
let libAllGames      = [];
let libGameMap       = new Map();
let libCurrentView   = 'grid';
let libSearchQuery   = '';
let libCurrentPlatform = 'All Games';
let libFavorites     = new Set();
let steamAccounts    = [];

function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger reflow for animation
    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

socket.on('steam-auth-success', async ({ steamID, userId: serverUserId }) => {
    const myId   = currentUser?.userId ?? currentUser?.id;
    const userID = serverUserId || myId;

    if (!userID || !myId || String(userID) !== String(myId)) return;

    showToast(`Steam account ${steamID} linked — syncing library…`);

    // Kick off the sync and await it here so we don't only rely on the socket event
    try {
        await fetchSteamLibrary(steamID, userID);
        await loadUserLibrary();
        libRender();

        if (currentPage === 'library') {
            libraryInitialized = false;
            initLibrary();
        }

        // Always refresh recommendations with the updated library
        await refreshRecommendations();
    } catch (err) {
        console.error('Steam sync failed:', err);
        showToast('Steam library sync failed — please refresh.');
    }

    await loadLinkedSteamAccounts();
});
socket.on('library-sync-complete', async ({ userId: serverUserId }) => {
    const myId = currentUser?.userId ?? currentUser?.id;
    if (!myId || String(serverUserId) !== String(myId)) return;

    await loadUserLibrary();
    libRender();

    if (currentPage === 'library') {
        libraryInitialized = false;
        initLibrary();
    }

    // Always refresh recommendations with the updated library
    await refreshRecommendations();

    showToast(`Library refreshed — ${libAllGames.length} game(s) loaded`);
});

// ── Thin wrappers kept for call-site readability; all route through api() ──
const BASE = 'http://localhost:3001';

async function api(path, body = null, method = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    // Auto-detect method if not explicitly provided
    const resolvedMethod = method ?? (body ? 'POST' : 'GET');

    const opts = {
        method: resolvedMethod,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
    };

    const res = await fetch(BASE + path, opts);

    if (res.status === 401) {
        authToken = null;
        localStorage.removeItem('authToken');
        showLoginOverlay();
        throw new Error('Not authenticated');
    }

    return res.json();
}

async function fetchGameDetails(appId)              { return (await api('/getGameDetails', { appId })); }
async function fetchReviews(appId)                  { return (await api('/getGameReviews', { appId })).reviews.reviews; }
async function fetchGameRecommendations(games) {
    const gameList = Array.isArray(games) ? games : [games];
    return (await api('/recommend', { games: gameList })).recommendations;
}
async function fetchSteamLibrary(steamId, userID)        { return (await api(`/getSteamLib`, {steamId: steamId , userId: userID})).totalGames; }
async function fetchEpicLibrary(gamePayload, userID){ return (await api('/getEpicLib', { EpicGames: gamePayload, userId: userID })); }
async function searchGames(query)                   { return (await api('/searchGame', { term: query })).filteredResults; }
async function userLibrary(userID)                  { return (await api('/userLibrary', { userId: userID })).result; }


async function loadUserLibrary() {
  if (!currentUser) return;
  try {
    const myId = currentUser.userId ?? currentUser.id;
    const lib = await userLibrary(myId);
    libAllGames = Array.isArray(lib) ? lib : [];
    libGameMap  = new Map(libAllGames.map(g => [String(g.GameID), g]));
    console.log(`Library loaded: ${lib.length} games`);
  } catch (err) {
    console.error('Failed to load user library:', err);
  }
}

function isOwned(gameId) {
  return libGameMap.has(String(gameId));
}
window.isOwned = isOwned;

/* ═══════════════════════════════════════════════
   THEME MANAGEMENT
═══════════════════════════════════════════════ */
function initTheme() {
    // Load saved theme preference
    if (currentTheme === 'light') {
        document.body.classList.add('light-mode');
        const toggle = document.getElementById('darkModeToggle');
        if (toggle) toggle.checked = true;
    }
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', currentTheme);
    
    if (currentTheme === 'light') {
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
    }
    
    // Sync both toggles
    const headerToggle = document.getElementById('themeToggleBtn');
    const settingsToggle = document.getElementById('darkModeToggle');
    if (settingsToggle) settingsToggle.checked = (currentTheme === 'light');
}

function saveSteamAccounts() {
    // no-op: DB is the source of truth, localStorage no longer used
}

function renderSteamAccounts() {
    const container = document.getElementById('steamAccountsList');
    if (!container) return;

    if (steamAccounts.length === 0) {
        container.innerHTML = '<div class="account-placeholder">No Steam accounts linked yet.</div>';
        return;
    }

    container.innerHTML = steamAccounts.map((account, index) => `
        <div class="account-chip">
          <span>${account}</span>
          <button class="account-remove" data-index="${index}" aria-label="Remove ${account}">×</button>
        </div>
    `).join('');

    container.querySelectorAll('.account-remove').forEach(btn => {
        btn.addEventListener('click', async (event) => {
            const idx = Number(event.currentTarget.dataset.index);
            const steamId = steamAccounts[idx];
            try {
                await api('/unlinkSteamAccount', { steamId });
            } catch (err) {
                console.error('Failed to unlink Steam account from DB:', err);
            }
            steamAccounts.splice(idx, 1);
            renderSteamAccounts();
        });
    });
}

function jumpToSettingsSection(sectionId) {
    navigate('settings');
    requestAnimationFrame(() => {
        const scrollArea = document.getElementById('settingsScrollArea');
        const target = document.getElementById(sectionId);
        if (!scrollArea || !target) return;
        scrollArea.scrollTo({ top: target.offsetTop - 20, behavior: 'smooth' });
        document.querySelectorAll('.jump-link').forEach(link => {
            link.classList.toggle('active', link.dataset.target === sectionId);
        });
    });
}

/* ═══════════════════════════════════════════════
   ROUTER
═══════════════════════════════════════════════ */
const PAGES = ['home','library','wishlist','profile','gamedetails','settings','reviews'];
let currentPage = 'home';
let currentGameId = null;
let libraryInitialized = false;
let homeInitialized = false;

function navigate(page, params = {}) {
  if (!PAGES.includes(page)) return;
  
  // Hide all
  PAGES.forEach(p => {
    document.getElementById('page-' + p)?.classList.remove('active');
  });

  // Update nav
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelector(`.user-avatar[data-page]`)?.classList.remove('active');
  if (page === 'profile') document.querySelector(`.user-avatar[data-page="profile"]`)?.classList.add('active');

  // Show page
  document.getElementById('page-' + page)?.classList.add('active');
  document.getElementById('mainContent').scrollTop = 0;
  currentPage = page;

  if (page === 'gamedetails' && params.appid) {
    currentGameId = params.appid;
    loadGameDetails(params.appid);
  }
  else if (page === 'reviews' && params.appid) {
    currentGameId = params.appid;
    loadReviewsPage(params.appid);
  }
  else if (page === 'settings') {
    loadLinkedSteamAccounts();
  }

  // Lazy-init data-heavy pages on first visit
  if (page === 'home' && !homeInitialized) {
    homeInitialized = true;
    loadHome();
  }
  if (page === 'library' && !libraryInitialized) {
    libraryInitialized = true;
    initLibrary();
  }

  // Hash update
  const hash = params.appid ? `#${page}?appid=${params.appid}` : `#${page}`;
  history.pushState({ page, ...params }, '', hash);
}

function parseHash() {
  const hash = location.hash.slice(1);
  if (!hash) return { page: 'home' };
  const [pagePart, queryPart] = hash.split('?');
  const params = {};
  if (queryPart) queryPart.split('&').forEach(p => { const [k,v] = p.split('='); params[k] = v; });
  return { page: pagePart || 'home', ...params };
}

// Expose globally so inline onclick="navigate(...)" attributes work
window.navigate = navigate;

window.addEventListener('popstate', () => {
  const { page, appid } = parseHash();
  navigate(page, appid ? { appid } : {});
});

// Nav clicks
document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    const page = el.dataset.page;
    navigate(page);
  });
});

// Defined at module level so it isn't recreated on every keystroke
window.handleImageError = (imgElement, gameId) => {
  imgElement.onerror = null; // prevent infinite loop
  imgElement.src = `https://placehold.co/460x215/1a1a24/532494?text=No+Image`;
};

document.getElementById('globalSearch').addEventListener('focus', () => {
  document.getElementById('searchResults').style.visibility = 'visible';
});

let debounceTimer;

// Single input listener — handles global search dropdown AND library filtering
document.getElementById('globalSearch').addEventListener('input', e => {
  const query = e.target.value.trim();

  // Library page: filter in-place, no dropdown needed
  if (currentPage === 'library') {
    libSearchQuery = query;
    libRender();
    return;
  }

  clearTimeout(debounceTimer);
  if (!query) return;

  const resultsContainer = document.getElementById('searchResults');
  resultsContainer.style.visibility = 'visible';

  debounceTimer = setTimeout(async () => {
    try {
      const data    = await api('/searchGame', { term: query });
      const results = data.filteredResults || [];

      resultsContainer.innerHTML = results.map(game => {
        const img = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.id}/capsule_231x87.jpg`;
        return `
          <div class="search-result-item" onclick="navigate('gamedetails',{appid:'${game.id}'})">
            <img src="${img}" alt="${game.name}" onerror="handleImageError(this,'${game.id}')"/>
            <p>${game.name}</p>
          </div>`;
      }).join('');
    } catch (err) {
      console.error('Search failed:', err);
    }
  }, 500);
});
document.addEventListener("click", (event) => {
  const isClickInside = document.getElementById('globalSearch').contains(event.target) || document.getElementById('searchResults').contains(event.target);
  if (!isClickInside) {
    document.getElementById('searchResults').style.visibility = "hidden";
  }
});

// Mobile menu
document.getElementById('mobileMenuBtn').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('mobile-open');
});
document.addEventListener('click', e => {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('mobileMenuBtn');
  if (sidebar.classList.contains('mobile-open') && !sidebar.contains(e.target) && e.target !== btn) {
    sidebar.classList.remove('mobile-open');
  }
});

/* ═══════════════════════════════════════════════
   AUTH  (replaces the localStorage-based version)
═══════════════════════════════════════════════ */

async function checkSession() {
    if (!authToken) { showLoginOverlay(); return; }
    try {
        const data = await api('/me');
        if (data.authenticated) {
            currentUser = data.user;
            onAuthSuccess();
        } else {
            authToken = null;
            localStorage.removeItem('authToken');
            showLoginOverlay();
        }
    } catch {
        showLoginOverlay();
    }
}

async function onAuthSuccess() {
    hideLoginOverlay();
    updateUserUI();
    // Register this socket so the server can emit events only to this user
    const myId = currentUser?.userId ?? currentUser?.id;
    if (myId) socket.emit('register', myId);
    await Promise.all([loadUserLibrary(), loadLinkedSteamAccounts()]);
}

async function loadLinkedSteamAccounts() {
    try {
        const data = await api('/getLinkedAccounts');
        if (data.success && Array.isArray(data.steamIds)) {
            steamAccounts = data.steamIds;
            renderSteamAccounts();
        }
    } catch (err) {
        console.error('Failed to load linked Steam accounts:', err);
    }
}

function showLoginOverlay(step = 'login') {
    document.getElementById('loginOverlay').classList.add('visible');
    showAuthStep(step);
}

function hideLoginOverlay() {
    document.getElementById('loginOverlay').classList.remove('visible');
    // Reset to login step for next time
    showAuthStep('login');
    clearAuthErrors();
}

function showAuthStep(step) {
    ['stepAuth', 'stepQR', 'step2FA'].forEach(id => {
        document.getElementById(id)?.classList.remove('active');
    });
    const map = { login: 'stepAuth', signup: 'stepAuth', qr: 'stepQR', '2fa': 'step2FA' };
    document.getElementById(map[step])?.classList.add('active');

    // Switch the tab if needed
    if (step === 'signup') {
        document.getElementById('tabLoginBtn').classList.remove('active');
        document.getElementById('tabSignupBtn').classList.add('active');
        document.getElementById('tabLogin').style.display  = 'none';
        document.getElementById('tabSignup').style.display = 'block';
    } else if (step === 'login') {
        document.getElementById('tabLoginBtn').classList.add('active');
        document.getElementById('tabSignupBtn').classList.remove('active');
        document.getElementById('tabLogin').style.display  = 'block';
        document.getElementById('tabSignup').style.display = 'none';
    }
}

function clearAuthErrors() {
    ['loginError','signupError','qrError','tfaError'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
}

function updateUserUI() {
    if (!currentUser) return;
    const nameEl = document.querySelector('.profile-username');
    if (nameEl) nameEl.textContent = currentUser.username;
}

// ── Login ──
async function handleLoginSubmit() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl  = document.getElementById('loginError');
    const btn      = document.getElementById('loginSubmitBtn');

    if (!email || !password) { errorEl.textContent = 'Please enter email and password'; return; }

    btn.disabled = true; btn.textContent = 'Signing in…';

    try {
        const data = await api('/login', { email, password });

        if (data.status === 'success') {
            authToken = data.token;
            localStorage.setItem('authToken', data.token);
            currentUser = data.user;
            onAuthSuccess();

        } else if (data.status === '2fa_setup') {
            _pendingEmail = data.email;
            document.getElementById('qrImage').src = data.qrCode;
            showAuthStep('qr');

        } else if (data.status === '2fa_required') {
            _pendingEmail = data.email;
            showAuthStep('2fa');

        } else {
            errorEl.textContent = data.message || 'Login failed';
        }
    } catch {
        errorEl.textContent = 'Cannot reach server';
    } finally {
        btn.disabled = false; btn.textContent = 'Sign In';
    }
}

// ── 2FA verify (shared by QR setup step and normal 2FA step) ──
async function handle2FASubmit(codeId, errorId, btnId) {
    const token   = document.getElementById(codeId).value.replace(/\D/g, '');
    const errorEl = document.getElementById(errorId);
    const btn     = document.getElementById(btnId);

    if (!token || token.length !== 6) { errorEl.textContent = 'Enter 6-digit code'; return; }
    if (!_pendingEmail) { errorEl.textContent = 'Session lost — please log in again'; showAuthStep('login'); return; }

    btn.disabled = true;
    btn.textContent = 'Verifying…';

    try {
        // ← send email in body, no session cookie needed
        const data = await fetch(`${BASE}/verify-2fa`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email: _pendingEmail, token }),
        }).then(r => r.json());

        if (data.status === 'success') {
            authToken = data.token;
            localStorage.setItem('authToken', data.token);
            currentUser = data.user;
            onAuthSuccess();
        } else {
            errorEl.textContent = data.message || 'Invalid code';
            document.getElementById(codeId).value = '';
            document.getElementById(codeId).focus();
        }
    } catch {
        errorEl.textContent = 'Server error';
    } finally {
        btn.disabled = false;
        btn.textContent = btnId === 'qrSubmit' ? 'Verify & Continue' : 'Verify';
    }
}

// ── Signup ──
async function handleSignup() {
    const username        = document.getElementById('signupUsername').value.trim();
    const email           = document.getElementById('signupEmail').value.trim();
    const password        = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;
    const errorEl         = document.getElementById('signupError');
    const btn             = document.getElementById('signupSubmitBtn');

    if (!username || !email || !password) { errorEl.textContent = 'Fill all fields'; return; }
    if (password !== confirmPassword)     { errorEl.textContent = 'Passwords do not match'; return; }
    if (password.length < 6)             { errorEl.textContent = 'Password must be at least 6 characters'; return; }

    btn.disabled = true; btn.textContent = 'Creating…';

    try {
        const data = await api('/signup', { username, email, password });
        if (data.status === 'success') {
            showAuthStep('login');
            document.getElementById('loginError').textContent = '';
            showToast('Account created — please sign in');
        } else {
            errorEl.textContent = data.message || 'Signup failed';
        }
    } catch {
        errorEl.textContent = 'Cannot reach server';
    } finally {
        btn.disabled = false; btn.textContent = 'Create Account';
    }
}

// ── Logout ──
async function handleLogout() {
    authToken = null;
    localStorage.removeItem('authToken');
    currentUser = null;
    steamAccounts = [];
    showLoginOverlay();
}

// ── Wire up buttons ──
document.getElementById('tabLoginBtn')     ?.addEventListener('click', () => showAuthStep('login'));
document.getElementById('tabSignupBtn')    ?.addEventListener('click', () => showAuthStep('signup'));
document.getElementById('loginSubmitBtn')  ?.addEventListener('click', handleLoginSubmit);
document.getElementById('qrSubmit')        ?.addEventListener('click', () => handle2FASubmit('qrCode',  'qrError',  'qrSubmit'));
document.getElementById('tfaSubmit')       ?.addEventListener('click', () => handle2FASubmit('tfaCode', 'tfaError', 'tfaSubmit'));
document.getElementById('signupSubmitBtn') ?.addEventListener('click', handleSignup);
document.getElementById('switchToSignup')  ?.addEventListener('click', () => showAuthStep('signup'));
document.getElementById('switchToLogin')   ?.addEventListener('click', () => showAuthStep('login'));
document.getElementById('qrBackBtn')       ?.addEventListener('click', () => showAuthStep('login'));
document.getElementById('tfaBackBtn')      ?.addEventListener('click', () => showAuthStep('login'));
document.getElementById('tfaBackAlt')      ?.addEventListener('click', () => showAuthStep('login'));

['loginEmail','loginPassword'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => e.key === 'Enter' && handleLoginSubmit())
);
['signupPassword','signupConfirmPassword'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => e.key === 'Enter' && handleSignup())
);

/* ═══════════════════════════════════════════════
   HOME PAGE
═══════════════════════════════════════════════ */
let heroSlides = [], heroIdx = 0, heroTimer;

function goHero(n) {
  if (!heroSlides.length) return;
  heroSlides[heroIdx].classList.remove('active');
  heroSlides[heroIdx].style.pointerEvents = 'none';
  document.querySelectorAll('.hero-dot')[heroIdx]?.classList.remove('active');
  heroIdx = (n + heroSlides.length) % heroSlides.length;
  heroSlides[heroIdx].classList.add('active');
  heroSlides[heroIdx].style.pointerEvents = 'auto';
  document.querySelectorAll('.hero-dot')[heroIdx]?.classList.add('active');
}

function startHeroAuto() {
  clearInterval(heroTimer);
  heroTimer = setInterval(() => goHero(heroIdx + 1), 5000); //change this timer
}

function initHeroCarousel() {
  heroSlides = Array.from(document.querySelectorAll('.hero-slide'));
  if (!heroSlides.length) return;
  heroSlides.forEach((s, i) => { s.classList.toggle('active', i === 0); s.style.pointerEvents = i === 0 ? 'auto' : 'none'; });
  document.querySelectorAll('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === 0));
  document.getElementById('heroNext').onclick = () => { clearInterval(heroTimer); goHero(heroIdx + 1); startHeroAuto(); };
  document.getElementById('heroPrev').onclick = () => { clearInterval(heroTimer); goHero(heroIdx - 1); startHeroAuto(); };
  document.querySelectorAll('.hero-dot').forEach(d => d.addEventListener('click', () => { clearInterval(heroTimer); goHero(+d.dataset.dot); startHeroAuto(); }));
  startHeroAuto();
}

function initForYouCarousel(recs) {
  const grid = document.getElementById('forYouGrid');
  const leftBtn = document.getElementById('foryouLeft');
  const rightBtn = document.getElementById('foryouRight');

  if (recs.length === 0) {
    grid.innerHTML = '<div class="no-results">No recommendations available. Add Games to Your Library!</div>';
    leftBtn.disabled = true;
    rightBtn.disabled = true;
    return;
  }

  const PER_PAGE = 10;
  let page = 0;
  const totalPages = Math.ceil(recs.length / PER_PAGE);

  function renderPage() {
    const slice = recs.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
    grid.innerHTML = slice.map(g => `
      <div class="game-card" onclick="navigate('gamedetails',{appid:'${g.GameID}'})">
        <img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${g.GameID}/header.jpg"
          onerror="this.src='https://placehold.co/460x260/1a1a24/532494?text=${encodeURIComponent(g.Name)}'"/>
        <div class="card-hover-overlay"></div>
        <div class="card-label">${g.Name}</div>
      </div>
    `).join('');
    leftBtn.disabled  = page === 0;
    rightBtn.disabled = page === totalPages - 1;
    leftBtn.style.opacity  = page === 0 ? '0.3' : '1';
    rightBtn.style.opacity = page === totalPages - 1 ? '0.3' : '1';
  }

  leftBtn.onclick  = () => { if (page > 0) { page--; renderPage(); } };
  rightBtn.onclick = () => { if (page < totalPages - 1) { page++; renderPage(); } };

  renderPage();
}

async function refreshRecommendations() {
  try {
    const gameTitles = libAllGames.map(g => g.name);
    const recs = await fetchGameRecommendations(gameTitles) || [];
    initForYouCarousel(recs);
  } catch (err) {
    console.error('Failed to refresh recommendations:', err);
  }
}

async function loadHome() {
  try {
    const [trendingData, salesData] = await Promise.all([
      api('/trending'),
      api('/sales')
    ]);
    const trending = trendingData.trending || [];
    const sales = salesData.sale || [];

    const gameTitles = libAllGames.map(g => g.name);
    const recs = await fetchGameRecommendations(gameTitles) || [];

    console.log('Trending:', trending);
    console.log('Sales:', sales);
    console.log('recos: ', recs);
    // Details for trending
    const details = await Promise.all(
      trending.map(g => {
        const id = g.logo.split('/apps/')[1]?.split('/')[0];
        return api('/getGameDetails', { appId: id }).catch(() => null);
      })
    );

    const heroSection = document.getElementById('heroSection');
    const top = trending.slice(0, 5);
    const rest = trending.slice(6, trending.length);
    console.log('Top trending games:', top);
    console.log('Rest trending games:', rest);
    const slidesHTML = top.map((g, i) => {
      const id = g.logo.split('/apps/')[1]?.split('/')[0];
      const info = details[i]?.gameDetails;
      return `<div class="hero-slide ${i===0?'active':''}" style="pointer-events:${i===0?'auto':'none'}">
        <img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg"
          onerror="this.src='https://placehold.co/1200x370/1a2434/532494?text=${encodeURIComponent(g.name)}'"/>
        <div class="hero-overlay"></div>
        <div class="hero-content">
          <div class="hero-badge"><span class="badge-dot"></span> Trending Now</div>
          <div class="hero-title">${g.name}</div>
          <p class="hero-desc">${info?.short_description || 'Explore this trending title on Game Scope.'}</p>
          <div class="hero-actions">
            <button class="btn-primary" onclick="navigate('gamedetails',{appid:'${id}'})">View Details</button>
            <button class="btn-ghost">Add to Wishlist</button>
            <div class="hero-rating">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
              ${g.rating ?? 'N/A'}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
    heroSection.innerHTML = slidesHTML + `
      <div class="hero-nav">
        <button class="hero-arrow" id="heroPrev"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg></button>
        <button class="hero-arrow" id="heroNext"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button>
      </div>
      <div class="hero-dots">${top.map((_,i)=>`<div class="hero-dot ${i===0?'active':''}" data-dot="${i}"></div>`).join('')}</div>`;
    initHeroCarousel();

    // Trending grid (skip top 5)
    document.getElementById('trendingGrid').innerHTML = rest.map((g, i) => {
      const id = g.logo.split('/apps/')[1]?.split('/')[0];
      const info = details[i + 6]?.gameDetails;
      return `<div class="game-card" onclick="navigate('gamedetails',{appid:'${id}'})">
        <img src="${info?.header_image}"
          onerror="this.src='https://placehold.co/460x260/1a1a24/532494?text=${encodeURIComponent(g.name)}'"/>
        <div class="card-hover-overlay"></div>
        <div class="card-label">${g.name}</div>
      </div>
      `
    }).join('');

    // For You
    initForYouCarousel(recs);

    // Sales grid
    document.getElementById('gamesGrid').innerHTML = sales.slice(0,6).map(g => `
      <div class="game-tile" onclick="navigate('gamedetails',{appid:'${g.id}'})">
        <img src="${g.header_image}"
          onerror="this.src='https://placehold.co/400x267/1a1a24/22c55e?text=${encodeURIComponent(g.name)}'"/>
        <div class="free-badge">-${g.discount_percent}%</div>
        <div class="card-hover-overlay"></div>
        <div class="card-label">${g.name}</div>
        <button class="tile-wish"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button>
      </div>`).join('');

  } catch (err) {
    console.error('Home load error:', err);
    document.getElementById('heroSection').innerHTML = `<div class="loading-screen"><div class="loading-text">Could not load data — is the server running?</div></div>`;
  }
}

// Filter tab endpoint mapping
const FILTER_TAB_ENDPOINTS = {
  onsale:     { endpoint: '/sales',      key: 'sale',  type: 'sale' },
  freebies:   { endpoint: '/free',       key: 'free',  type: 'free' },
  topsellers: { endpoint: '/topsellers', key: 'items', type: 'search' },
  toprated:   { endpoint: '/toprated',   key: 'items', type: 'search' },
  newrelease: { endpoint: '/newrelease', key: 'items', type: 'search' }
};

document.querySelectorAll('.filter-tab').forEach(t => {
  t.addEventListener('click', async () => {
    document.querySelectorAll('.filter-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');

    const tab = t.dataset.tab;
    const config = FILTER_TAB_ENDPOINTS[tab];
    if (!config) return;

    const grid = document.getElementById('gamesGrid');
    grid.innerHTML = '<div class="loading-screen" style="grid-column:1/-1"><div class="loading-spinner"></div></div>';

    try {
      const data = await api(config.endpoint);
      const items = data[config.key] || [];

      if (config.type === 'sale') {
        grid.innerHTML = items.slice(0, 6).map(g => `
          <div class="game-tile" onclick="navigate('gamedetails',{appid:'${g.id}'})">
            <img src="${g.header_image}"
              onerror="this.onerror=null;this.src='https://placehold.co/400x267/1a1a24/22c55e?text=${encodeURIComponent(g.name)}'"/>
            <div class="free-badge">-${g.discount_percent}%</div>
            <div class="card-hover-overlay"></div>
            <div class="card-label">${g.name}</div>
            <button class="tile-wish"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button>
          </div>`).join('');
      } else if (config.type === 'free') {
        grid.innerHTML = items.slice(0, 6).map(g => `
          <div class="game-tile" onclick="window.chrome?.webview?.postMessage({type:'openBrowser',url:'${g.open_giveaway_url || '#'}'})">
            <img src="${g.thumbnail}"
              onerror="this.onerror=null;this.src='https://placehold.co/400x267/1a1a24/22c55e?text=${encodeURIComponent(g.title)}'"/>
            <div class="free-badge">FREE</div>
            <div class="card-hover-overlay"></div>
            <div class="card-label">${g.title}</div>
          </div>`).join('');
      } else {
        // search-type results (topsellers, toprated, newrelease, upcoming)
        grid.innerHTML = items.slice(0, 6).map(g => {
          const id = g.logo?.split('/apps/')[1]?.split('/')[0] || '';
          return `
          <div class="game-tile" onclick="navigate('gamedetails',{appid:'${id}'})">
            <img src="https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg"
              onerror="this.onerror=null;this.src='https://placehold.co/400x267/1a1a24/532494?text=${encodeURIComponent(g.name)}'"/>
            <div class="card-hover-overlay"></div>
            <div class="card-label">${g.name}</div>
          </div>`;
        }).join('');
      }
    } catch (err) {
      console.error('Filter tab load error:', err);
      grid.innerHTML = '<div class="no-results">Failed to load data</div>';
    }
  });
});

/* ═══════════════════════════════════════════════
   LIBRARY PAGE — full faithful port of library.js
═══════════════════════════════════════════════ */

// C# bridge — gracefully no-ops when not in WebView
function loadLocalLibrary() {
  return new Promise((resolve) => {
    if (!window.chrome?.webview) { resolve([]); return; }
    function handler(e) {
      if (e.detail.type === 'localGamesLoaded') {
        window.removeEventListener('hostMessage', handler);
        resolve(e.detail.data ?? []);
      }
    }
    window.addEventListener('hostMessage', handler);
    window.chrome.webview.postMessage({ type: 'loadLocal' });
    // safety timeout — resolve empty after 3s if C# never responds
    setTimeout(() => { window.removeEventListener('hostMessage', handler); resolve([]); }, 3000);
  });
}

// Central C# message listener
window.addEventListener('hostMessage', async(e) => {
  const msg = e.detail;
  if (msg.type === 'localGameAdded') {
    if (msg.success) { libAllGames.push(msg.game); libRender(); }
    else console.error('Failed to add local game:', msg.error);
  }
  else if (msg.type === 'epicLibrary') {
    if (msg.data) {
        // Filter out DLC and non-game entities immediately
        const gamePayload = msg.data
          .filter(game => !game.is_dlc && game.metadata?.namespace)
          .map(game => ({
              appName:       game.app_name,
              title:         game.app_title,
              developer:     game.metadata?.developer ?? null,
              namespace:     game.metadata?.namespace,
              catalogItemId: game.metadata?.id ?? null,
          }));

        console.log(`Sending ${gamePayload.length} clean game records to Node.`);

        const data = await fetchEpicLibrary(gamePayload, currentUser.userId ?? currentUser.id);
        console.log('Received response from Node for Epic library:', data.results);

        if (Array.isArray(data.results) && data.results.length) {
            // Merge without duplicating entries already in the library
            const existingIds = new Set(libAllGames.map(g => String(g.GameID)));
            const newGames = data.results
                .map(g => ({ ...g, source: 'epic' }))
                .filter(g => !existingIds.has(String(g.GameID)));
            libAllGames.push(...newGames);
            newGames.forEach(g => { if (g.GameID) libGameMap.set(String(g.GameID), g); });
            libRender();
        }
    }
  }
});



function libStarsHTML(rating, size = 'sm') {
  const cls = size === 'sm' ? 'card-star' : 'list-star';
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="${cls} ${i + 1 <= rating ? '' : 'empty'}">★</span>`
  ).join('');
}
function clockSVG() {
  return `<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}
// ── Shared SVG helpers (used by library, profile, and game-details) ──
function heartSVG(filled) {
  return `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
}

function buildGridCard(game) {
  const isLocal = game.source === 'local';
  const title   = isLocal ? game.title : (game.name || game.Name || 'Unknown');
  const isFav   = libFavorites.has(title);
  const imgSrc  = isLocal
    ? (game.coverImage || `https://placehold.co/214x321/1A1A24/E1E1EA?text=${encodeURIComponent(title.substring(0,6))}`)
    : `https://cdn.akamai.steamstatic.com/steam/apps/${game.GameID || game.appid}/library_600x900.jpg`;
  const fallback = `https://placehold.co/214x321/1A1A24/E1E1EA?text=${encodeURIComponent(title.substring(0,6))}`;
  const statsHTML = isLocal
    ? `<div class="card-playtime">${clockSVG()} ${game.playTimeMinutes ?? 0} mins</div>`
    : `<div class="card-stars">${libStarsHTML(game.rating, 'sm')}</div>
       <div class="card-playtime">${clockSVG()} ${((game.playtime_forever ?? 0) / 60).toFixed(1)}H played</div>`;
  const clickFn = isLocal
    ? `window.chrome?.webview?.postMessage({ type: 'launchGame', id: '${game.id}' })`
    : `navigate('gamedetails',{appid:'${game.GameID || game.appid}'})`;
  return `<div class="lib-card" data-title="${title}" data-source="${game.source ?? 'steam'}" onclick="${clickFn}">
    <img class="lib-card-image" src="${imgSrc}" alt="${title}" onerror="this.src='${fallback}'" loading="lazy"/>
    <button class="fav-btn ${isFav ? 'active' : ''}" data-fav="${title}" onclick="event.stopPropagation()">${heartSVG(isFav)}</button>
    <div class="lib-card-overlay">
      <div class="lib-card-title">${title}</div>
      ${statsHTML}
    </div>
  </div>`;
}

function buildListItem(game) {
  const isLocal = game.source === 'local';
  const title   = isLocal ? game.title : (game.name || game.Name || 'Unknown');
  const isFav   = libFavorites.has(title);
  const imgSrc  = isLocal
    ? (game.coverImage || `https://placehold.co/90x115/1A1A24/E1E1EA?text=${encodeURIComponent(title.substring(0,4))}`)
    : `https://cdn.akamai.steamstatic.com/steam/apps/${game.GameID || game.appid}/library_600x900.jpg`;
  const fallback = `https://placehold.co/90x115/1A1A24/E1E1EA?text=${encodeURIComponent(title.substring(0,4))}`;
  const statsHTML = isLocal
    ? `<div class="list-playtime">${clockSVG()} <span>${game.playTimeMinutes ?? 0} mins</span></div>`
    : `<div class="list-stars">${libStarsHTML(game.rating, 'lg')}</div>
       <div class="list-playtime">${clockSVG()} <span>${((game.playtime_forever ?? 0) / 60).toFixed(1)}H</span></div>`;
  const clickFn = isLocal
    ? `window.chrome?.webview?.postMessage({ type: 'launchGame', id: '${game.id}' })`
    : `navigate('gamedetails',{appid:'${game.GameID || game.appid}'})`;
  return `<div class="game-list-item" data-title="${title}" data-source="${game.source ?? 'steam'}" onclick="${clickFn}">
    <div class="list-item-content">
      <div class="list-item-img"><img src="${imgSrc}" alt="${title}" onerror="this.src='${fallback}'" loading="lazy"/></div>
      <div class="list-item-info">
        <div class="list-title">${title}</div>
        <div class="list-stats">${statsHTML}</div>
      </div>
    </div>
    <button class="list-fav-btn ${isFav ? 'active' : ''}" data-fav="${title}" onclick="event.stopPropagation()">${heartSVG(isFav)}</button>
  </div>`;
}

function libGetFiltered() {
  let list = [...libAllGames];
  if (libCurrentPlatform !== 'All Games') {
    const platform = libCurrentPlatform.toLowerCase();
    list = list.filter(g => platform === 'local' ? g.source === 'local' : (g.source || '').toLowerCase() === platform);
  }
  if (libSearchQuery.trim()) {
    const q = libSearchQuery.toLowerCase();
    list = list.filter(g => (g.source === 'local' ? g.title : (g.name || g.Name || '')).toLowerCase().includes(q));
  }
  return list;
}

function libRender() {
  const container = document.getElementById('libContainer');
  if (!container) return;
  const filtered = libGetFiltered();
  container.className = libCurrentView === 'list' ? 'lib-grid list-view' : 'lib-grid';
  if (!filtered.length) {
    container.innerHTML = libAllGames.length
      ? '<div class="no-results">No games found</div>'
      : '<div class="no-results"><div class="loading-spinner" style="margin:0 auto 12px"></div>Loading library...</div>';
    return;
  }
  container.innerHTML = filtered
    .map(libCurrentView === 'grid' ? buildGridCard : buildListItem)
    .join('');
  container.querySelectorAll('[data-fav]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const t = btn.dataset.fav;
      libFavorites.has(t) ? libFavorites.delete(t) : libFavorites.add(t);
      libRender();
    });
  });
  // update count badge
  const allCount = document.getElementById('allCount');
  if (allCount) allCount.textContent = libAllGames.length;
}

async function initLibrary() {
  libRender(); // show loading state immediately

  // 1. Local games first (C# bridge)
  try {
    const localGames = await loadLocalLibrary();

    // The cloud library was already fetched by loadUserLibrary() during auth.
    // Only fall back to a fresh fetch if it somehow wasn't loaded yet.
    if (!libAllGames.length) {
      const userLib = await userLibrary(currentUser.userId ?? currentUser.id);
      libAllGames = [...userLib];
      libGameMap  = new Map(libAllGames.map(g => [String(g.GameID), g]));
    }

    const enriched = await Promise.allSettled(
      localGames.map(async (game) => {
        try {
          const results = await searchGames(game.title);
          const match = results[0];
          if (!match) return game;
          return {
            ...game,
            GameID: match.GameID,
            Name: match.Name,
            coverImage: game.coverImage || match.image,
            rating: match.positive_ratio,
            playtime_forever: game.playTimeMinutes
          };
        } catch { return game; }
      })
    );
    const mergedLocal = enriched.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    const existingLocalIds = new Set(libAllGames.filter(g => g.source === 'local').map(g => String(g.id)));
    const newLocal = mergedLocal.filter(g => !existingLocalIds.has(String(g.id)));
    libAllGames.push(...newLocal);
    // Keep libGameMap in sync for local games that matched a Steam ID
    newLocal.forEach(g => { if (g.GameID) libGameMap.set(String(g.GameID), g); });
    libRender();
  } catch (err) {
    console.error('Failed to load local games:', err);
  }
}


const addMenuBtn = document.getElementById('addMenuBtn');
const addMenu = document.getElementById('addMenu');
const addLocalBtn = document.getElementById('addLocalBtn');
const linkAccountsBtn = document.getElementById('linkAccountsBtn');
const addSteamAccountBtn = document.getElementById('addSteamAccountBtn');
const linkEpicAccountBtn = document.getElementById('linkEpicAccountBtn');

if (addMenuBtn && addMenu) {
  addMenuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const expanded = addMenu.classList.toggle('open');
    addMenuBtn.setAttribute('aria-expanded', expanded.toString());
  });
}

document.addEventListener('click', (event) => {
  if (addMenu && addMenuBtn && !addMenu.contains(event.target) && !addMenuBtn.contains(event.target)) {
    addMenu.classList.remove('open');
    addMenuBtn.setAttribute('aria-expanded', 'false');
  }
});

if (addLocalBtn) {
  addLocalBtn.addEventListener('click', () => {
    addMenu?.classList.remove('open');
    if (addMenuBtn) addMenuBtn.setAttribute('aria-expanded', 'false');

    const title = window.prompt('Enter the name of the local game');
    if (!title) return;

    const newGame = {
      source: 'local',
      title: title.trim(),
      playTimeMinutes: 0,
      coverImage: '',
      id: Math.random().toString(36).slice(2)
    };
    libAllGames.unshift(newGame);
    libRender();
  });
}

if (linkAccountsBtn) {
  linkAccountsBtn.addEventListener('click', () => {
    addMenu?.classList.remove('open');
    if (addMenuBtn) addMenuBtn.setAttribute('aria-expanded', 'false');
    jumpToSettingsSection('library-sec');
  });
}

if (addSteamAccountBtn) {
  addSteamAccountBtn.addEventListener('click', () => {
    // Open the Passport Steam OAuth flow in a small popup.
    // The server will emit 'steam-auth-success' via socket.io once
    // the user authenticates, giving us the real steamID.
    const socketId = socket.id ?? '';
    const steamUrl = `${BASE}/auth/steam${authToken ? `?token=${encodeURIComponent(authToken)}&socketId=${encodeURIComponent(socketId)}` : ''}`;
    const popup = window.open(
      steamUrl,
      'steam-login',
      'width=800,height=600,menubar=no,toolbar=no,status=no'
    );
    // Fallback: if popup was blocked, redirect the main tab
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      window.location.href = steamUrl;
    }
  });
}

if (linkEpicAccountBtn) {
  linkEpicAccountBtn.addEventListener('click', () => {
    window.chrome?.webview?.postMessage({ type: 'epicLogin' });
  });
}

document.getElementById('gridViewBtn').addEventListener('click', () => {
  libCurrentView = 'grid';
  document.getElementById('gridViewBtn').classList.add('active');
  document.getElementById('listViewBtn').classList.remove('active');
  libRender();
});
document.getElementById('listViewBtn').addEventListener('click', () => {
  libCurrentView = 'list';
  document.getElementById('listViewBtn').classList.add('active');
  document.getElementById('gridViewBtn').classList.remove('active');
  libRender();
});
document.getElementById('platformTabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('#platformTabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  libCurrentPlatform = btn.dataset.platform;
  libRender();
});

/* ═══════════════════════════════════════════════
   WISHLIST PAGE
═══════════════════════════════════════════════ */
const WISH_GAMES = [
  {id:1,title:'Cyberpunk 2077',img:'Uploads/cyberpunk2077.png',badge:'price-drop',discount:'-45%',tags:['RPG','Sci-Fi','Open World'],origPrice:'$59.99',newPrice:'$32.99'},
  {id:2,title:'Elden Ring',img:'Uploads/eldenring.png',badge:'price-drop',discount:'-30%',tags:['RPG','Souls-like','Fantasy'],origPrice:'$59.99',newPrice:'$41.99'},
  {id:3,title:'God of War: Ragnarök',img:'Uploads/godofwarragnarok.png',badge:'free',tags:['Action','Adventure'],origPrice:null,newPrice:'Free'},
  {id:4,title:'Spider-Man 2',img:'Uploads/spiderman2.png',badge:'free',tags:['Action','Superhero'],origPrice:null,newPrice:'Free'},
  {id:5,title:'Ghost of Tsushima',img:'Uploads/ghostoftsushima.png',badge:'price-drop',discount:'-25%',tags:['Action','Open World','Samurai'],origPrice:'$59.99',newPrice:'$44.99'},
  {id:6,title:'Horizon Forbidden West',img:'Uploads/horrizenforbiddenwest.png',badge:'price-drop',discount:'-20%',tags:['Action','RPG','Open World'],origPrice:'$59.99',newPrice:'$47.99'},
  {id:7,title:'The Witcher 3',img:'Uploads/thewitcher.png',badge:'price-drop',discount:'-40%',tags:['RPG','Open World','Action'],origPrice:'$39.99',newPrice:'$23.99'},
  {id:8,title:'Indiana Jones',img:'Uploads/indianajones.png',badge:'price-drop',discount:'-50%',tags:['Action','Adventure','Story'],origPrice:'$59.99',newPrice:'$29.99'},
  {id:9,title:'Silent Hill 2',img:'Uploads/silenthill2.png',badge:'price-drop',discount:'-20%',tags:['Horror','Survival','Remake'],origPrice:'$59.99',newPrice:'$47.99'},
  {id:10,title:'Final Fantasy VII',img:'Uploads/ffvii.png',badge:'price-drop',discount:'-35%',tags:['RPG','JRPG','Story'],origPrice:'$39.99',newPrice:'$25.99'},
  {id:11,title:'Alan Wake II',img:'Uploads/alanwake2.png',badge:'price-drop',discount:'-40%',tags:['Horror','Action','Thriller'],origPrice:'$59.99',newPrice:'$35.99'},
  {id:12,title:'Call of Duty: Warzone',img:'Uploads/callofdutywarzone.png',badge:'free',tags:['FPS','Multiplayer'],origPrice:null,newPrice:'Free'},
];

function buildWishCard(g) {
  const fb = `https://placehold.co/402x564/1A1A24/E1E1EA?text=${encodeURIComponent(g.title.substring(0,8))}`;
  const badge = g.badge==='price-drop'
    ? `<span class="badge-price-drop">Price Dropped</span><span class="badge-discount">${g.discount}</span>`
    : `<span class="badge-free">Free</span>`;
  const tags = g.tags.map(t=>`<span class="overlay-tag">${t}</span>`).join('');
  const price = g.origPrice
    ? `<span class="overlay-price-orig">${g.origPrice}</span><span class="overlay-price-new">${g.newPrice}</span>`
    : `<span class="overlay-price-new">${g.newPrice}</span>`;
  return `<div class="wish-card">
    <img src="${g.img}" alt="${g.title}" loading="lazy" onerror="this.src='${fb}'"/>
    ${badge}
    <div class="wish-card-overlay">
      <div class="overlay-left"><span class="overlay-game-title">${g.title}</span><div class="overlay-tags">${tags}</div></div>
      <div class="overlay-prices">${price}</div>
    </div>
  </div>`;
}

function renderWishlist(filter = 'All Games') {
  let games = [...WISH_GAMES];
  if (filter === 'Free') games = games.filter(g => g.badge === 'free');
  if (filter === 'On Sale') games = games.filter(g => g.badge === 'price-drop');
  document.getElementById('wishGrid').innerHTML = games.map(buildWishCard).join('');
}

// Wishlist dropdowns
let activityOpen = false;
document.getElementById('activityToggle').addEventListener('click', e => {
  e.stopPropagation();
  activityOpen = !activityOpen;
  document.getElementById('activityPanel').classList.toggle('open', activityOpen);
});
document.addEventListener('click', () => {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  if (activityOpen) { document.getElementById('activityPanel').classList.remove('open'); activityOpen = false; }
});
document.getElementById('activityPanel').addEventListener('click', e => e.stopPropagation());

function initWishDropdown(triggerId, menuId, labelId, prefix, onSelect) {
  const trigger = document.getElementById(triggerId);
  const menu = document.getElementById(menuId);
  const label = document.getElementById(labelId);
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.dropdown-menu.open').forEach(m => { if(m!==menu) m.classList.remove('open'); });
    menu.classList.toggle('open');
  });
  menu.querySelectorAll('.dd-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      menu.querySelectorAll('.dd-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      label.textContent = prefix + item.dataset.val;
      menu.classList.remove('open');
      onSelect(item.dataset.val);
    });
  });
}
initWishDropdown('sortTrigger','sortMenu','sortLabel','Sort: ',()=>{});
initWishDropdown('filterTriggerWish','filterMenuWish','filterLabelWish','Filter: ', val => renderWishlist(val));

/* ═══════════════════════════════════════════════
   PROFILE PAGE
═══════════════════════════════════════════════ */
function starsSVGProfile(n) {
  let h='';
  for(let i=0;i<5;i++){
    const f=i<n;
    h+=`<span><svg width="16" height="16" viewBox="0 0 16 16" fill="${f?'#FDC700':'none'}" stroke="${f?'#FDC700':'rgba(225,225,234,0.3)'}" stroke-width="1"><path d="M8 1.5L9.6 5.2L13.7 5.7L10.8 8.5L11.6 12.6L8 10.5L4.4 12.6L5.2 8.5L2.3 5.7L6.4 5.2L8 1.5Z"/></svg></span>`;
  }
  return h;
}

async function initProfile() {
  // Update username from current session
  if (currentUser) {
    const nameEl = document.querySelector('.profile-username');
    if (nameEl) nameEl.textContent = currentUser.username;
  }

  try {
    const lib = await userLibrary(currentUser.userId ?? currentUser.id);

    // Compute stats from library
    const totalGames = lib.length;
    const totalHours = lib.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
    const totalHoursFormatted = Math.round(totalHours / 60).toLocaleString();

    // Find most played game
    const mostPlayed = lib.reduce((best, g) => (g.playtime_forever || 0) > (best?.playtime_forever || 0) ? g : best, lib[0] || null);
    const mostPlayedName = mostPlayed?.name || 'N/A';
    const mostPlayedHours = mostPlayed ? Math.round((mostPlayed.playtime_forever || 0) / 60) + 'h' : '0h';

    // Update stat cards
    const statCards = document.querySelectorAll('.stat-card');
    if (statCards[0]) statCards[0].querySelector('.stat-val').textContent = totalGames;
    if (statCards[2]) statCards[2].querySelector('.stat-val').textContent = totalHoursFormatted;

    // Most played game & recent grind
    const mostPlayedCard = document.querySelector('.stats-row-2 .stat-card:first-child .stat-val');
    if (mostPlayedCard) mostPlayedCard.textContent = mostPlayedName;
    const recentGrind = document.querySelector('.stats-row-2 .stat-card:last-child .stat-val');
    if (recentGrind) recentGrind.textContent = mostPlayedHours;

    // Recently added: show last 6 games from library
    const recentGames = lib.slice(-6).reverse();
    const fb = t => `https://placehold.co/402x564/1A1A24/E1E1EA?text=${encodeURIComponent((t || 'Game').substring(0,6))}`;

    document.getElementById('recentlyAdded').innerHTML = recentGames.map(g => {
      const appId = g.GameID || g.appid || '';
      const name = g.name || 'Unknown';
      return `<img src="https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg" alt="${name}" class="lib-grid-card" onerror="this.onerror=null;this.src='${fb(name)}'" style="cursor:pointer" onclick="navigate('gamedetails',{appid:'${appId}'})"/>`;
    }).join('');

    // Favourites: top 5 by playtime
    const topByPlaytime = [...lib].sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0)).slice(0, 5);
    document.getElementById('favouriteGrid').innerHTML = topByPlaytime.map(g => {
      const appId = g.GameID || g.appid || '';
      const name = g.name || 'Unknown';
      return `<img src="https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg" alt="${name}" class="lib-grid-card" onerror="this.onerror=null;this.src='${fb(name)}'" style="cursor:pointer" onclick="navigate('gamedetails',{appid:'${appId}'})"/>`;
    }).join('');

    // Reviews placeholder (no user review system in DB yet)
    document.getElementById('activityReviews').innerHTML = '<p style="color:var(--text-muted);font-size:14px;">No reviews yet. Play some games and share your thoughts!</p>';
    document.getElementById('reviewsTabList').innerHTML = '<p style="color:var(--text-muted);font-size:14px;">No reviews yet.</p>';

  } catch (err) {
    console.error('Failed to load profile data:', err);
    document.getElementById('recentlyAdded').innerHTML = '<p style="color:var(--text-muted)">Link your accounts to see your library here.</p>';
    document.getElementById('favouriteGrid').innerHTML = '<p style="color:var(--text-muted)">No favourites yet.</p>';
    document.getElementById('activityReviews').innerHTML = '<p style="color:var(--text-muted)">No reviews yet.</p>';
    document.getElementById('reviewsTabList').innerHTML = '<p style="color:var(--text-muted)">No reviews yet.</p>';
  }
}

document.querySelectorAll('.profile-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.profile-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById('tab-' + btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});
document.getElementById('logout')?.addEventListener('click', async () => {
    if (confirm('Sign out?')) await handleLogout();
});
/* ═══════════════════════════════════════════════
   GAME DETAILS PAGE
═══════════════════════════════════════════════ */
// ── Main loader — called by navigate() instead of reading URL params ────────────

async function loadGameDetails(appId) {
  const el = document.getElementById('gameDetailsContent');
  el.innerHTML = '<div class="loading-screen"><div class="loading-spinner"></div><div class="loading-text">Loading game details...</div></div>';

  // ── Fetch all data ──
  let data;
  let reviews = [];
  let recommendations = [];
  let owned = false;

  try {
    const rawData   = await fetchGameDetails(appId);
    data            = rawData.gameDetails;
    owned           = isOwned(appId);
    if (!data) {
      el.innerHTML = '<div class="loading-screen"><div class="loading-text">⚠ Game data not available for this title.</div></div>';
      return;
    }
    try { reviews = (await fetchReviews(appId)) || []; } catch { reviews = []; }
    recommendations = rawData.recommendations?.recommendations || [];
  } catch (err) {
    console.warn('Fetch failed', err);
    el.innerHTML = '<div class="loading-screen"><div class="loading-text">⚠ Could not load game details. Is the server running?</div></div>';
    return;
  }

  console.log('Fetched game data:', data);
  console.log('Fetched reviews:', reviews);
  console.log('Fetched recommendations:', recommendations);

  // ── Parse data with null safety ──

  if (data.name === undefined) data.name = 'Unknown Game';

  const MEDIA = (data.screenshots || []).map(s => s.path_full);

  const DETAILED_DESCRIPTION = data.detailed_description || data.short_description || '<p>No description available.</p>';

  let METACRITIC;
  if (!data.metacritic) {
    METACRITIC = { score: null, url: null };
  } else {
    METACRITIC = { score: data.metacritic.score, url: data.metacritic.url };
  }

  const CATEGORIES             = (data.categories || []).map(c => c.description);
  const ACHIEVEMENTS_TOTAL     = data.achievements?.total || 0;
  const ACHIEVEMENTS_HIGHLIGHTED = data.achievements?.highlighted || [];
  const SUPPORT_INFO           = { url: data.support_info?.url || '', email: data.support_info?.email || '' };
  const LEGAL_NOTICE           = data.legal_notice || '';

  let PRICE, STORES = null;
  if (!data.price_overview && data.is_free) {
    PRICE = {
      currency:         null,
      initial:          "Free",
      final:            "Free",
      discount_percent: null,
      formatted:        "Free"
    };
    STORES = [
      { name: "Steam",        cls: "steam",  orig: null, price: "Free" },
      { name: "Epic Games",   cls: "epic",   orig: null, price: "Free" },
      { name: "GOG",          cls: "gog",    orig: null, price: "Free" }
    ];
  } else if (data.price_overview) {
    PRICE = {
      currency:         data.price_overview.currency,
      initial:          data.price_overview.initial,
      final:            data.price_overview.final,
      discount_percent: data.price_overview.discount_percent,
      formatted:        data.price_overview.final_formatted
    };
    STORES = [
      { name: "Steam",        cls: "steam",  orig: null, price: data.price_overview.final_formatted },
      { name: "Epic Games",   cls: "epic",   orig: null, price: data.price_overview.final_formatted },
      { name: "GOG",          cls: "gog",    orig: null, price: data.price_overview.final_formatted },
    ];
  } else {
    PRICE = { currency: null, initial: 'N/A', final: 'N/A', discount_percent: 0, formatted: 'N/A' };
    STORES = [
      { name: "Steam",        cls: "steam",  orig: null, price: "N/A" },
      { name: "Epic Games",   cls: "epic",   orig: null, price: "N/A" },
      { name: "GOG",          cls: "gog",    orig: null, price: "N/A" },
    ];
  }

  const RATINGS = Object.entries(data.ratings || {}).map(([region, r]) => ({
    region,
    rating:           r.rating,
    rating_generated: r.rating_generated,
    required_age:     r.required_age,
    descriptors:      r.descriptors,
    banned:           r.banned,
    use_age_gate:     r.use_age_gate
  }));

  function parseRequirements(htmlString) {
    if (!htmlString) return [];
    const items = [];
    const liRegex = /<li>(.*?)<\/li>/gs;
    let match;
    while ((match = liRegex.exec(htmlString)) !== null) {
      const raw = match[1].replace(/<br>/gi, '').trim();
      if (raw.toLowerCase().includes('requires a 64-bit')) continue;
      const labelMatch = raw.match(/<strong>(.*?)<\/strong>:?\s*(.*)/);
      if (labelMatch) {
        items.push({
          label: labelMatch[1].replace(/:$/, ''),
          value: labelMatch[2].replace(/<[^>]+>/g, '').trim()
        });
      }
    }
    return items;
  }

  const pcReq    = data.pc_requirements    || {};
  const macReq   = data.mac_requirements   || {};
  const linuxReq = data.linux_requirements || {};

  const REQUIREMENTS = {
    windows: {
      minimum:     parseRequirements(pcReq.minimum),
      recommended: parseRequirements(pcReq.recommended)
    },
    mac: {
      minimum:     parseRequirements(macReq.minimum),
      recommended: parseRequirements(macReq.recommended)
    },
    linux: {
      minimum:     parseRequirements(linuxReq.minimum),
      recommended: parseRequirements(linuxReq.recommended)
    }
  };

  const releaseDate = data.release_date?.date || 'TBA';
  const platforms   = data.platforms || {};
  const developers  = data.developers || [];
  const publishers  = data.publishers || [];
  const genres      = data.genres || [];

  const GAME_DETAILS = [
    { icon: "Uploads/releasedate.svg", label: "Release Date", value: releaseDate },
    { icon: "Uploads/workson.svg",     label: "Works On",     value: null, platforms: Object.keys(platforms).filter(k => platforms[k]).map(k => k.charAt(0).toUpperCase() + k.slice(1)) },
    { icon: "Uploads/developer.svg",   label: "Developer",    value: developers.join(', ') || 'Unknown' },
    { icon: "Uploads/publisher.svg",   label: "Publisher",    value: publishers.join(', ') || 'Unknown' },
    { icon: "Uploads/genre.svg",       label: "Genre",        value: genres.map(g => g.description).join(', ') || 'N/A' },
    { icon: "Uploads/lastupdate.svg",  label: "Last Update",  value: releaseDate + " - Launch" }
  ];

  const RATING_BARS = [
    { stars: 5, pct: 78 },
    { stars: 4, pct: 14 },
    { stars: 3, pct: 5  },
    { stars: 2, pct: 2  },
    { stars: 1, pct: 1  }
  ];

  function parseLanguages(htmlString) {
    const plain = htmlString.replace(/<[^>]+>/g, '');
    return plain.split(',').map(l => l.trim()).filter(Boolean).map(l => ({
      lang:  l.replace(/\*$/, '').trim(),
      ui:    true,
      audio: htmlString.includes(l.replace(/\*$/, '').trim() + '<strong>*</strong>'),
      subs:  true
    }));
  }

  const LANGUAGES = parseLanguages(data.supported_languages);

  let currentMediaIndex  = 0;
  let isFavorite         = false;
  let currentReqPlatform = 'windows';
  let currentReqLevel    = 'minimum';

  // ── SVG helpers ──

  function starsSVG(count, size = 16) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const col = i <= count ? '#FDC700' : 'rgba(255,255,255,0.2)';
      html += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${col}">
        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
      </svg>`;
    }
    return html;
  }

  function checkSVG() {
    return `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7l4 4 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ── Inject the game details HTML into the page ──
  // (This replaces the static gamedetails.html. All the IDs match exactly.)

  el.innerHTML = `
    <div class="game-header">
      <div class="game-title-section">
        <h1 class="game-big-title" id="gameTitle"></h1>
        <div class="header-actions">
          <div class="action-icon" id="shareBtn" title="Share">
            <img src="Uploads/share.svg" alt="Share" onerror="this.style.display='none'">
          </div>
        </div>
      </div>

      <div class="game-media">
        <div class="main-banner">
          <img id="mainBannerImg" alt="Main Banner"/>
        </div>
        <div class="media-thumbnails" id="mediaThumbnails"></div>
        <div class="media-controls">
          <button class="nav-btn prev" id="prevBtn">
            <img src="Uploads/backbtn.svg" alt="Prev" onerror="this.innerHTML='&#8249;'; this.style.fontSize='24px'">
          </button>
          <button class="nav-btn next" id="nextBtn">
            <img src="Uploads/nextbtn.svg" alt="Next" onerror="this.innerHTML='&#8250;'; this.style.fontSize='24px'">
          </button>
        </div>
      </div>
    </div>

    <div class="content-grid">

      <div class="left-column">

        <div class="gd-card game-overview">
          <div class="game-info" id="gameInfo">
            <div class="title-section">
              <h2 class="game-name" id="infoName"></h2>
            </div>
            <div class="rating-section">
              <div class="stars" id="overviewStars"></div>
              <div class="rating-text">
                <span class="rating-score" id="rateScore"></span>
                <span class="rating-count" id="rateCount"></span>
              </div>
            </div>
            <div class="pricing-section" id="priceSection"></div>
          </div>
          <div class="action-buttons">
            <button class="gd-btn-primary" id="addToLibraryBtn">
              <img src="Uploads/basil_add-outline.svg" alt="" onerror="this.style.display='none'"> Play Game
            </button>
            <button class="gd-btn-secondary" id="visitStoreBtn">
              <img src="Uploads/basil_add-outline.svg" alt="" onerror="this.style.display='none'"> Visit Store
            </button>
            <button class="btn-icon-only" id="favBtn" title="Favourite"></button>
          </div>
          <div class="tags" id="tags"></div>
        </div>

        <div class="gd-card where-to-buy">
          <div class="section-header">
            <div class="section-icon"><img src="Uploads/whereyoubuy.svg" alt="" onerror="this.style.display='none'"></div>
            <div class="section-title">
              <h3>Where You Buy</h3>
              <span class="ownership-status ${owned ? 'is-owned' : ''}">${owned ? 'Owned' : 'Not Owned'}</span>
            </div>
          </div>
          <div class="stats-grid" id="statsGrid">
            <div class="stat-item">
              <div class="stat-icon"><img src="Uploads/filledstar.svg" alt="" onerror="this.style.display='none'"></div>
              <div class="stat-info">
                <div class="stat-label">User Reviews</div>
                <div class="stat-value" id="statReview"></div>
              </div>
            </div>
            <div class="stat-item">
              <div class="stat-icon"><img src="Uploads/awards.svg" alt="" onerror="this.style.display='none'"></div>
              <div class="stat-info">
                <div class="stat-label">Awards</div>
                <div class="stat-value">250+ Game of the Year</div>
              </div>
            </div>
            <div class="stat-item">
              <div class="stat-icon"><img src="Uploads/extracontent.svg" alt="" onerror="this.style.display='none'"></div>
              <div class="stat-info">
                <div class="stat-label">Extra Content</div>
                <div class="stat-value" id="statDLC"></div>
              </div>
            </div>
          </div>
          <div class="stores-list">
            <div class="stores-header">AVAILABLE STORES</div>
            <div id="storesList"></div>
            <div class="stores-footer">Prices May Vary By Region And Platform</div>
          </div>
        </div>

        <div class="gd-card description" id="detailedDescription"></div>

        <div class="gd-card system-requirements">
          <h3>System Requirements</h3>
          <div class="platform-tabs-gd" id="reqPlatformTabs">
            <button class="platform-tab active" data-platform="windows">Windows</button>
            <button class="platform-tab" data-platform="mac">Mac</button>
            <button class="platform-tab" data-platform="linux">Linux</button>
          </div>
          <div class="requirement-level" id="reqLevelTabs">
            <button class="level-tab active" data-level="minimum">Minimum</button>
            <button class="level-tab" data-level="recommended">Recommended</button>
          </div>
          <div class="requirements-list" id="requirementsList"></div>
        </div>

        <div class="gd-card reviews">
          <div class="reviews-header-gd">
            <h3>Reviews &amp; Community</h3>
            <a class="see-all-reviews" id="reviewsAll">See All Reviews</a>
          </div>
          <div class="rating-bars" id="ratingBars"></div>
          <div class="review-list" id="reviewList"></div>
        </div>

      </div>

      <div class="right-column">

        <div class="gd-card game-details">
          <h3>Game Details</h3>
          <div class="details-list" id="detailsList"></div>
          <div class="links-section">
            <div class="section-title">
              <div class="links-icon"><img src="Uploads/links.svg" alt="" onerror="this.style.display='none'"></div>
              <span>Links</span>
            </div>
            <div class="links-list">
              <a href="#" class="link">Official Website</a>
              <a href="#" class="link">Support</a>
              <a href="#" class="link">Forums</a>
            </div>
          </div>
          <div class="features-section">
            <h4>Features</h4>
            <div class="features-grid" id="featuresGrid"></div>
          </div>
        </div>

        <div class="gd-card recommendations-sidebar">
          <div class="recommendations-title">Recommended For You</div>
          <div class="recommendations-list" id="recList"></div>
        </div>

        <div class="gd-card languages">
          <h3>Languages</h3>
          <div class="languages-table" id="langTable"></div>
        </div>

      </div>

    </div>
  `;

  // ── Render functions (identical to original gamedetails.js) ──

  function renderGameHeader() {
    document.getElementById('gameTitle').textContent = data.name;
  }

  function renderMainBanner() {
    const img = document.getElementById('mainBannerImg');
    img.src = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`;
    img.onerror = () => { img.src = 'https://placehold.co/800x402/1A1A24/E1E1EA?text=Screenshot'; };
  }

  function renderThumbnails() {
    const wrap = document.getElementById('mediaThumbnails');
    wrap.innerHTML = MEDIA.map((img, i) => `
      <div class="thumbnail ${i === currentMediaIndex ? 'active' : ''}" data-index="${i}">
        <img src="${img}" alt="Screenshot ${i+1}" onerror="this.src='https://placehold.co/276x164/1A1A24/E1E1EA?text=Screenshot'"/>
      </div>
    `).join('');
    wrap.querySelectorAll('.thumbnail').forEach(thumb => {
      thumb.addEventListener('click', () => {
        currentMediaIndex = parseInt(thumb.dataset.index);
        updateBanner();
      });
    });
  }

  function updateBanner() {
    const img = document.getElementById('mainBannerImg');
    img.classList.add('fade-out');
    setTimeout(() => {
      img.src = MEDIA[currentMediaIndex];
      img.onerror = () => { img.src = 'https://placehold.co/800x402/1A1A24/E1E1EA?text=Screenshot'; };
      img.classList.remove('fade-out');
      renderThumbnails();
    }, 150);
  }

  function renderInfo() {
    document.getElementById('infoName').textContent = data.name;
    const metaScore = METACRITIC.score != null ? (METACRITIC.score / 20).toFixed(1) : 'N/A';
    document.getElementById('rateScore').textContent = metaScore;
    const totalReviews = data.recommendations?.total || 0;
    document.getElementById('rateCount').textContent = `(${totalReviews.toLocaleString()} reviews)`;

    if (!owned) {
      if (PRICE.discount_percent > 0) {
        const orig = document.createElement('span');
        orig.className = 'original-price';
        orig.textContent = PRICE.formatted;
        document.getElementById('priceSection').appendChild(orig);

        const disc = document.createElement('span');
        disc.className = 'discounted-price';
        disc.textContent = PRICE.formatted;
        document.getElementById('priceSection').appendChild(disc);

        const discountBadge = document.createElement('span');
        discountBadge.className = 'discount-badge';
        discountBadge.textContent = `-${PRICE.discount_percent}%`;
        document.getElementById('priceSection').appendChild(discountBadge);
      } else {
        const price = document.createElement('span');
        price.className = 'current-price';
        price.textContent = PRICE.formatted;
        document.getElementById('priceSection').appendChild(price);
      }
    }
  }

  function renderTags() {
    document.getElementById('tags').innerHTML = genres.map(c => `<span class="tag">${c.description}</span>`).join('');
  }

  function renderStats() {
    const statRev = document.getElementById('statReview');
    const score = METACRITIC.score;
    if (score == null) { statRev.textContent = 'Unrated'; }
    else if (score > 90) { statRev.textContent = 'Overwhelmingly Positive'; }
    else if (score > 80) { statRev.textContent = 'Very Positive'; }
    else if (score > 70) { statRev.textContent = 'Positive'; }
    else if (score > 60) { statRev.textContent = 'Mixed'; }
    else if (score > 50) { statRev.textContent = 'Negative'; }
    else { statRev.textContent = 'Unrated'; }
    if (data.dlc && data.dlc.length > 0) {
      const dlcCount = document.getElementById('statDLC');
      if (dlcCount) dlcCount.textContent = `${data.dlc.length} DLC${data.dlc.length > 1 ? 's' : ''}`;
    } else {
      const dlcCount = document.getElementById('statDLC');
      if (dlcCount) dlcCount.textContent = "0 DLCs";
    }
  }

  function renderRequirements() {
    const list = REQUIREMENTS[currentReqPlatform][currentReqLevel];
    document.getElementById('requirementsList').innerHTML = list.map(item => `
      <div class="requirement-item">
        <span class="requirement-label">${item.label}</span>
        <span class="requirement-value">${item.value}</span>
      </div>
    `).join('');
  }

  function renderStores() {
    document.getElementById('storesList').innerHTML = STORES.map(s => `
      <div class="store-item">
        <div class="store-info">
          <div class="store-logo ${s.cls}">${s.name.charAt(0)}</div>
          <div class="store-name">${s.name}</div>
        </div>
        <div class="store-pricing">
          ${s.orig ? `<span class="original-price">${s.orig}</span>` : ''}
          <span class="current-store-price">${s.price}</span>
          <button class="buy-btn" onclick="alert('Redirecting to ${s.name}...')">BUY</button>
        </div>
      </div>
    `).join('');
  }

  function renderOverviewStars() {
    document.getElementById('overviewStars').innerHTML = starsSVG(5, 18);
  }

  function renderRatingBars() {
    document.getElementById('ratingBars').innerHTML = RATING_BARS.map(rb => `
      <div class="rating-bar">
        <div class="rating-stars">
          <span class="star-count">${rb.stars}</span>
          <div class="stars-small">${starsSVG(rb.stars, 12)}</div>
        </div>
        <div class="bar-container"><div class="bar-fill" style="width:${rb.pct}%"></div></div>
        <span class="percentage">${rb.pct}%</span>
      </div>
    `).join('');
  }

  function renderReviews() {
    document.getElementById('reviewList').innerHTML = reviews.slice(0, 5).map(r => `
      <div class="review-item">
        <div class="review-header">
          <div class="reviewer-avatar"><img class="avatar-img" src="https://avatars.steamstatic.com/${r.author.avatar}.jpg"></div>
          <div class="reviewer-info">
            <div class="reviewer-name">${r.author.personaname}</div>
            <div class="reviewer-stats">${(r.author.playtime_forever / 60).toFixed(1) || 0} hours</div>
          </div>
          <div class="review-date">${new Date(r.timestamp_created * 1000).toLocaleDateString()}</div>
        </div>
        <span class="review-tag recommended">${r.voted_up ? 'Recommended' : "Didn't Like It"}</span>
        <p class="review-text">${r.review}</p>
        <div class="review-actions">
          <span class="helpful" onclick="this.textContent='Thanks!'">Helpful (234)</span>
          <span class="reply">Reply</span>
          <span class="report">Report</span>
        </div>
      </div>
    `).join('');
  }

  function renderDetails() {
    document.getElementById('detailsList').innerHTML = GAME_DETAILS.map(d => `
      <div class="detail-item">
        <div class="detail-header">
          <div class="detail-icon"><img src="${d.icon}" alt="" onerror="this.style.display='none'"/></div>
          <span class="detail-label">${d.label}</span>
        </div>
        ${d.platforms
          ? `<div class="platform-tags">${d.platforms.map(p => `<span class="platform-tag">${p}</span>`).join('')}</div>`
          : `<span class="detail-value">${d.value}</span>`}
      </div>
    `).join('');
  }

  function renderRecommendations() {
    // 1. Check if 'data' actually exists here
    if (typeof data === 'undefined') {
      console.error("Critical Error: 'data' is undefined in this scope.");
      return;
    }

    const listElement = document.getElementById('recList');
    
    const filtered = recommendations.filter(r => {
      // Normalizing both to lowercase and trimming whitespace to remove "invisible" mismatches
      const currentName = String(r.Name || r.name || "").toLowerCase().trim();
      const targetName = String(data.Name || data.name || "").toLowerCase().trim();
      
      const isMatch = currentName === targetName;
      
      // Debugging: This will tell you EXACTLY why a skip is or isn't happening
      if (isMatch) console.log(`Skipping: ${r.Name}`); 
      
      return !isMatch;
    });

    listElement.innerHTML = filtered
      .slice(0, 15)
      .map(r => `
        <div class="recommendation-item" onclick="navigate('gamedetails', { appid: '${r.AppID}' })">
          <img src="${r.game_image}" alt="${r.Name}"
            onerror="this.src='https://placehold.co/317x187/1A1A24/E1E1EA?text=${encodeURIComponent(r.Name)}'"/>
          <div class="recommendation-name">${r.Name}</div>
        </div>
      `).join('');
  }

  function renderLanguages() {
    document.getElementById('langTable').innerHTML = `
      <div class="table-header">
        <span class="header-label">Language</span>
        <div class="header-features"><span>UI</span><span>Audio</span><span>Subs</span></div>
      </div>
      ${LANGUAGES.map(l => `
        <div class="table-row">
          <span class="language-name">${l.lang}</span>
          <div class="language-features">
            <div class="feature-check ${l.ui    ? 'checked' : ''}">${l.ui    ? checkSVG() : ''}</div>
            <div class="feature-check ${l.audio ? 'checked' : ''}">${l.audio ? checkSVG() : ''}</div>
            <div class="feature-check ${l.subs  ? 'checked' : ''}">${l.subs  ? checkSVG() : ''}</div>
          </div>
        </div>
      `).join('')}
    `;
  }


  function renderDescription() {
    const detailEl = document.getElementById('detailedDescription');
    if (detailEl) detailEl.innerHTML = `<h3>Description</h3> ${DETAILED_DESCRIPTION}`;
  }

  function renderMetacritic() {
    const el = document.getElementById('metacriticScore');
    if (!el) return;
    el.innerHTML = `<a href="${METACRITIC.url}" target="_blank" class="metacritic-link">
      <span class="metacritic-score">${METACRITIC.score}</span>
      <span class="metacritic-label">Metacritic</span>
    </a>`;
  }

  function renderCategories() {
    const el = document.getElementById('featuresGrid');
    if (!el) return;
    el.innerHTML = CATEGORIES.map(c => `<span class="feature-tag">${c}</span>`).join('');
  }

  function renderAchievements() {
    const totalEl = document.getElementById('achievementsTotal');
    if (totalEl) totalEl.textContent = ACHIEVEMENTS_TOTAL + ' Achievements';
    const gridEl = document.getElementById('achievementsGrid');
    if (!gridEl) return;
    gridEl.innerHTML = ACHIEVEMENTS_HIGHLIGHTED.map(a => `
      <div class="achievement-item" title="${a.name}">
        <img src="${a.path}" alt="${a.name}" onerror="this.src='https://placehold.co/64x64/1A1A24/E1E1EA?text=?'"/>
        <span class="achievement-name">${a.name}</span>
      </div>
    `).join('');
  }

  function renderSupportInfo() {
    const el = document.getElementById('supportInfo');
    if (!el) return;
    el.innerHTML = `
      <a href="${SUPPORT_INFO.url}" target="_blank" class="support-link">Support Site</a>
      <a href="mailto:${SUPPORT_INFO.email}" class="support-link">${SUPPORT_INFO.email}</a>
    `;
  }

  function renderLegalNotice() {
    const el = document.getElementById('legalNotice');
    if (el) el.textContent = LEGAL_NOTICE;
  }

  function renderRatingsInfo() {
    const el = document.getElementById('ratingsInfo');
    if (!el) return;
    el.innerHTML = RATINGS.map(r => `
      <div class="rating-region">
        <span class="rating-badge">${r.rating.toUpperCase()}</span>
        <div class="rating-details">
          <span class="rating-region-name">${r.region === 'dejus' ? 'Brazil (DEJUS)' : 'Germany (USK)'}</span>
          <span class="rating-descriptor">${r.descriptors}</span>
        </div>
      </div>
    `).join('');
  }

  function renderFavBtn() {
    const btn = document.getElementById('favBtn');
    btn.innerHTML = heartSVG(isFavorite);
    btn.style.color = isFavorite ? '#532494' : '#E1E1EA';
  }

  // ── setupUI — wire up everything, identical to original ──

  function setupUI() {
    renderGameHeader();
    renderMainBanner();
    renderThumbnails();
    renderInfo();
    renderTags();
    renderStats();
    renderRequirements();
    renderStores();
    renderOverviewStars();
    renderRatingBars();
    renderReviews();
    renderDetails();
    renderRecommendations();
    renderLanguages();
    renderFavBtn();
    renderDescription();
    renderMetacritic();
    renderCategories();
    renderAchievements();
    renderSupportInfo();
    renderLegalNotice();
    renderRatingsInfo();

    // C# bridge messages
    window.addEventListener('hostMessage', (e) => {
      const message = e.detail;
      switch (message.type) {
        case 'browserOpened':
          console.log('C# confirmed browser opened:', message.success);
          break;
        case 'libraryData':
          console.log('Received library from C#:', message.games);
          break;
      }
    });

    document.getElementById('prevBtn').addEventListener('click', () => {
      currentMediaIndex = (currentMediaIndex - 1 + MEDIA.length) % MEDIA.length;
      updateBanner();
    });

    document.getElementById('nextBtn').addEventListener('click', () => {
      currentMediaIndex = (currentMediaIndex + 1) % MEDIA.length;
      updateBanner();
    });

    document.getElementById('reqPlatformTabs').addEventListener('click', e => {
      const btn = e.target.closest('.platform-tab');
      if (!btn) return;
      document.querySelectorAll('#reqPlatformTabs .platform-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentReqPlatform = btn.dataset.platform;
      renderRequirements();
    });

    document.getElementById('reqLevelTabs').addEventListener('click', e => {
      const btn = e.target.closest('.level-tab');
      if (!btn) return;
      document.querySelectorAll('#reqLevelTabs .level-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentReqLevel = btn.dataset.level;
      renderRequirements();
    });

    document.getElementById('favBtn').addEventListener('click', () => {
      isFavorite = !isFavorite;
      renderFavBtn();
    });

    document.getElementById('addToLibraryBtn').addEventListener('click', () => {
      window.chrome?.webview?.postMessage({ type: 'openBrowser', game: `steam://rungameid/${appId}` });
    });

    document.getElementById('visitStoreBtn').addEventListener('click', () => {
      alert('Opening Steam store...');
    });

    document.getElementById('reviewsAll').addEventListener('click', () => {
      // In the SPA we'd navigate to a reviews page — wire up when ready
      navigate('reviews', { appid: appId });
    });

    document.getElementById('shareBtn').addEventListener('click', () => {
      if (navigator.share) {
        navigator.share({ title: data.name, url: window.location.href });
      } else {
        navigator.clipboard.writeText(window.location.href).then(() => alert('Link copied!'));
      }
    });
  }

  setupUI();
}

/* ═══════════════════════════════════════════════
   SETTINGS
═══════════════════════════════════════════════ */

function initSettingsNav() {
    const jumpLinks = document.querySelectorAll('.jump-link');
    const scrollArea = document.getElementById('settingsScrollArea');

    jumpLinks.forEach(link => {
        link.addEventListener('click', () => {
            const targetId = link.getAttribute('data-target');
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                // Scroll the container to the element
                scrollArea.scrollTo({
                    top: targetElement.offsetTop - 20,
                    behavior: 'smooth'
                });

                // Update active state
                jumpLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
            }
        });
    });

    // Settings-page Steam button — opens the same Passport OAuth popup
    document.getElementById('settingsAddSteamBtn')?.addEventListener('click', () => {
        const steamUrl = `${BASE}/auth/steam?token=${encodeURIComponent(authToken)}&socketId=${encodeURIComponent(socket.id)}`;
        const popup = window.open(
            steamUrl,
            'steam-login',
            'width=800,height=600,menubar=no,toolbar=no,status=no'
        );
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
            window.location.href = steamUrl;
        }
    });

    // Settings-page Epic button — tells C# to start the legendary login flow
    document.getElementById('settingsLinkEpicBtn')?.addEventListener('click', () => {
        window.chrome?.webview?.postMessage({ type: 'epicLogin' });
    });
}

function init2FASettings() {
    const toggleBtn   = document.getElementById('twoFaToggleBtn');
    const panel       = document.getElementById('settings2faPanel');
    const qrImg       = document.getElementById('settings2faQR');
    const codeInput   = document.getElementById('settings2faCode');
    const verifyBtn   = document.getElementById('settings2faVerifyBtn');
    const cancelBtn   = document.getElementById('settings2faCancelBtn');
    const errorEl     = document.getElementById('settings2faError');
    const statusText  = document.getElementById('twoFaStatusText');

    if (!toggleBtn) return;

    function refreshUI(enabled) {
        if (enabled) {
            toggleBtn.textContent = 'Disable 2FA';
            toggleBtn.style.background = 'rgba(239,68,68,0.15)';
            toggleBtn.style.color = '#f87171';
            toggleBtn.style.borderColor = 'rgba(239,68,68,0.3)';
            statusText.textContent = '2FA is enabled. Your account is protected.';
        } else {
            toggleBtn.textContent = 'Enable 2FA';
            toggleBtn.style.background = '';
            toggleBtn.style.color = '';
            toggleBtn.style.borderColor = '';
            statusText.textContent = 'Adds an extra layer of security to your account.';
        }
        // Hide panel whenever state changes
        panel.style.display = 'none';
        codeInput.value = '';
        errorEl.textContent = '';
    }

    // Derive initial state from JWT (set during login)
    let is2FAEnabled = false;
    try {
        if (authToken) {
            const payload = JSON.parse(atob(authToken.split('.')[1]));
            // two_fa_enabled isn't in the JWT payload, so we check via /me or just leave as unknown
            // We'll do a quick /me check when settings page opens
        }
    } catch {}

    // Check current 2FA status from server
    async function loadStatus() {
        try {
            const data = await api('/me');
            if (data?.user?.two_fa_enabled != null) {
                is2FAEnabled = !!data.user.two_fa_enabled;
                refreshUI(is2FAEnabled);
            }
        } catch {}
    }

    // Load status whenever settings page is visited
    const origNavigate = window.navigate;
    window.navigate = function(page, params = {}) {
        origNavigate(page, params);
        if (page === 'settings') loadStatus();
    };
    // Also load immediately in case we're already on settings
    if (document.getElementById('page-settings')?.classList.contains('active')) loadStatus();

    toggleBtn.addEventListener('click', async () => {
        if (is2FAEnabled) {
            // Disable flow
            if (!confirm('Are you sure you want to disable two-factor authentication?')) return;
            toggleBtn.disabled = true;
            toggleBtn.textContent = 'Disabling…';
            try {
                const data = await api('/disable-2fa', {});
                if (data.status === 'success') {
                    is2FAEnabled = false;
                    refreshUI(false);
                    showToast('2FA disabled');
                } else {
                    errorEl.textContent = data.message || 'Failed to disable 2FA';
                    toggleBtn.textContent = 'Disable 2FA';
                }
            } catch {
                errorEl.textContent = 'Server error';
                toggleBtn.textContent = 'Disable 2FA';
            } finally {
                toggleBtn.disabled = false;
            }
        } else {
            // Enable flow — fetch QR
            toggleBtn.disabled = true;
            toggleBtn.textContent = 'Loading…';
            errorEl.textContent = '';
            try {
                const data = await api('/setup-2fa', {});
                if (data.status === '2fa_setup') {
                    qrImg.src = data.qrCode;
                    panel.style.display = 'block';
                    codeInput.focus();
                } else {
                    errorEl.textContent = data.message || 'Could not start 2FA setup';
                }
            } catch {
                errorEl.textContent = 'Server error';
            } finally {
                toggleBtn.disabled = false;
                toggleBtn.textContent = 'Enable 2FA';
            }
        }
    });

    verifyBtn.addEventListener('click', async () => {
        const token = codeInput.value.replace(/\D/g, '');
        if (!token || token.length !== 6) { errorEl.textContent = 'Enter a 6-digit code'; return; }

        verifyBtn.disabled = true;
        verifyBtn.textContent = 'Verifying…';
        errorEl.textContent = '';

        try {
            const data = await fetch(`${BASE}/verify-2fa`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ email: currentUser?.email, token }),
            }).then(r => r.json());

            if (data.status === 'success') {
                // Update stored token (server re-issues one)
                authToken = data.token;
                localStorage.setItem('authToken', data.token);
                is2FAEnabled = true;
                refreshUI(true);
                showToast('2FA enabled — your account is now protected');
            } else {
                errorEl.textContent = data.message || 'Invalid code';
                codeInput.value = '';
                codeInput.focus();
            }
        } catch {
            errorEl.textContent = 'Server error';
        } finally {
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'Verify';
        }
    });

    codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') verifyBtn.click(); });

    cancelBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        codeInput.value = '';
        errorEl.textContent = '';
    });
}
init2FASettings();

// Call this inside your existing setupUI() or DOMContentLoaded


/* ═══════════════════════════════════════════════
   REVIEWS PAGE LOGIC
═══════════════════════════════════════════════ */
let revData = [];
let revFiltered = [];
let revFilter = 'all';
let revPage = 1;
const REV_PER_PAGE = 4;
let revRating = 0;
let revUserVotes = {};

async function loadReviewsPage(appId) {
  const list = document.getElementById('reviewsList');
  if (list) list.innerHTML = '<div class="no-reviews" style="opacity:0.6">Loading reviews…</div>';
  
  try {
    const [gameDetails, reviewsResponse] = await Promise.all([
      api('/getGameDetails', { appId: Number(appId) }),
      api('/getGameReviews', { appId: Number(appId) })
    ]);
    
    // Populate info
    const info = gameDetails.gameDetails;
    document.getElementById('revGameCoverImg').src = info.header_image || '';
    document.getElementById('revGameTitleText').textContent = info.name || 'Unknown Game';
    
    const score = info.metacritic?.score ? (info.metacritic.score / 20).toFixed(1) : '—';
    document.getElementById('ratingScore').textContent = score;
    
    const totalRecs = info.recommendations?.total ?? 0;
    document.getElementById('reviewCountSummary').textContent = `Based on ${totalRecs.toLocaleString()} reviews`;
    const fmt = n => n > 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
    document.getElementById('revStatPlayers').textContent = fmt(totalRecs);
    document.getElementById('revStatWishlisted').textContent = '—';
    document.getElementById('revStatReviews').textContent = fmt(totalRecs);
    
    // Parse reviews
    // Parse Steam reviews
    const raw = reviewsResponse.reviews?.reviews ?? [];
    revData = raw.map(r => ({
        name:      r.author?.personaname ?? r.author?.steamid ?? 'Anonymous',
        avatarUrl: r.author?.avatar ? `https://avatars.steamstatic.com/${r.author.avatar}.jpg` : null,
        hours:     r.author?.playtime_forever != null ? `${(r.author.playtime_forever / 60).toFixed(1)} hours played` : 'Unknown playtime',
        date:      r.timestamp_created ? new Date(r.timestamp_created * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown date',
        text:      r.review ?? '',
        helpful:   r.votes_up ?? 0,
        rating:    r.voted_up ? 5 : 2,
    }));

    // Fetch and prepend local DB reviews
    try {
        const localResult = await api('/getLocalReviews', { appId: Number(appId) });
        if (localResult.success && localResult.reviews.length > 0) {
            const localMapped = localResult.reviews.map(r => ({
                name:      r.username,
                avatarUrl: null,
                hours:     '—',
                date:      new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
                text:      r.body,
                helpful:   r.likes ?? 0,
                rating:    r.rating,
                isLocal:   true,
            }));
            revData = [...localMapped, ...revData];
        }
    } catch (err) {
        console.error('Failed to load local reviews:', err);
    }

    revFilter = 'all';
    revApplyFilter('all');
  } catch (err) {
    console.error('Reviews load error:', err);
    if (list) list.innerHTML = '<div class="no-reviews">Failed to load reviews.</div>';
  }
}

function revStarSVG(filled, size = 20) {
  const col = filled ? '#C27AFF' : 'none';
  const stroke = filled ? '#C27AFF' : 'currentColor';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${col}" stroke="${stroke}" stroke-width="1.5">
    <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
  </svg>`;
}

function revStarsHTML(count, size = 20) {
  return Array.from({length: 5}, (_, i) => revStarSVG(i < count, size)).join('');
}

function revAvatarHTML(name, avatarUrl) {
  if (avatarUrl) {
    return `<img class="avatar-initials" src="${avatarUrl}" alt="${name}" style="object-fit:cover;border-radius:50%;" onerror="this.outerHTML=revFallbackAvatar('${name}')">`;
  }
  return revFallbackAvatar(name);
}

window.revFallbackAvatar = function(name) {
  const colors = ['#532494','#7C3AED','#AD46FF','#2A475E','#107C10'];
  const color = colors[(name||'A').charCodeAt(0) % colors.length];
  const initials = (name||'AN').substring(0, 2).toUpperCase();
  return `<div class="avatar-initials" style="background:${color}">${initials}</div>`;
};

function revBuildCard(review, index) {
  const vote = revUserVotes[index] || null;
  const helpfulCount = review.helpful + (vote === 'up' ? 1 : vote === 'down' ? -1 : 0);
  const localBadge = review.isLocal
    ? `<span style="font-size:10px;background:#532494;color:#fff;padding:2px 7px;border-radius:999px;margin-left:8px;vertical-align:middle;">GameScope Review</span>`
    : '';
  return `
    <div class="review-card" data-index="${index}">
      <div class="review-header">
        <div class="reviewer-info">${revAvatarHTML(review.name, review.avatarUrl)}<div class="reviewer-details"><div class="reviewer-name">${review.name}${localBadge}</div><div class="play-time">${review.hours}</div></div></div>
        <div class="review-date">${review.date}</div>
      </div>
      <div class="review-stars">${revStarsHTML(review.rating, 18)}</div>
      <div class="review-content"><p class="review-text">${review.text}</p></div>
      <div class="review-actions">
        <div class="helpful-section">
          <span class="helpful-text">Was this review helpful?</span>
          <div class="helpful-buttons">
            <button class="helpful-btn ${vote === 'up' ? 'active' : ''}" onclick="revVote(${index},'up')"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vote === 'up' ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"><path d="M7 22V10L14 2l1.25 1.25c.167.167.292.375.375.625.083.25.125.508.125.775V5L14.5 10H20c.533 0 .983.183 1.35.55.367.367.55.817.55 1.35v2c0 .133-.017.275-.05.425l-3 7.05C18.617 21.8 18.1 22 17.5 22H7zM7 10H4v12h3" stroke-linejoin="round"/></svg> Helpful (${helpfulCount})</button>
            <button class="helpful-btn ${vote === 'down' ? 'active' : ''}" onclick="revVote(${index},'down')"><svg width="16" height="16" viewBox="0 0 24 24" fill="${vote === 'down' ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5"><path d="M17 2v12l-7 8-1.25-1.25a1.56 1.56 0 01-.375-.625A2.34 2.34 0 018.25 19v-.375L9.5 14H4c-.533 0-.983-.183-1.35-.55A1.84 1.84 0 012 12.1V10.1c0-.133.017-.275.05-.425l3-7.05C5.383 2.2 5.9 2 6.5 2H17zM17 14h3V2h-3" stroke-linejoin="round"/></svg></button>
          </div>
        </div>
      </div>
    </div>`;
}

window.revVote = function(idx, vote) {
  revUserVotes[idx] = revUserVotes[idx] === vote ? null : vote;
  revRender();
};

function revRender() {
  const list = document.getElementById('reviewsList');
  const countEl = document.getElementById('reviewCount');
  if (!list) return;
  const start = (revPage - 1) * REV_PER_PAGE;
  const pageReviews = revFiltered.slice(start, start + REV_PER_PAGE);
  if (countEl) countEl.textContent = revFiltered.length;
  list.innerHTML = pageReviews.length === 0 ? `<div class="no-reviews">No reviews match this filter.</div>` : pageReviews.map((r, i) => revBuildCard(r, start + i)).join('');
  revRenderPagination();
}

function revRenderPagination() {
  const totalPages = Math.ceil(revFiltered.length / REV_PER_PAGE);
  const pageNumbers = document.getElementById('pageNumbers');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  if (prevBtn) prevBtn.disabled = revPage === 1;
  if (nextBtn) nextBtn.disabled = revPage >= totalPages;
  if (!pageNumbers) return;
  pageNumbers.innerHTML = '';
  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement('button');
    btn.className = `page-number ${i === revPage ? 'active' : ''}`;
    btn.textContent = i;
    btn.onclick = () => { revPage = i; revRender(); document.getElementById('mainContent').scrollTo({top:0, behavior:'smooth'}); };
    pageNumbers.appendChild(btn);
  }
}

function revApplyFilter(filter) {
  revFilter = filter;
  revPage = 1;
  switch(filter) {
    case 'helpful':  revFiltered = [...revData].sort((a,b) => b.helpful - a.helpful); break;
    case 'positive': revFiltered = revData.filter(r => r.rating >= 4); break;
    case 'negative': revFiltered = revData.filter(r => r.rating <= 2); break;
    case 'rating':   revFiltered = [...revData].sort((a,b) => b.rating - a.rating); break;
    default:         revFiltered = [...revData].sort((a,b) => new Date(b.date) - new Date(a.date));
  }
  revRender();
}

function revRenderFormStars() {
    const container = document.getElementById('ratingStars');
    if (!container) return;

    container.innerHTML = Array.from({length: 5}, (_, i) => `
        <div class="rating-star ${i < revRating ? '' : 'empty'}" data-rating="${i+1}">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="${i < revRating ? '#C27AFF' : 'none'}" stroke="${i < revRating ? '#C27AFF' : 'currentColor'}" stroke-width="2">
                <path d="M16 2.62L19.36 11.61L19.46 11.88H19.75H29.12L21.97 17.64L21.73 17.81L21.83 18.08L25.19 27.08L16 21.29L6.81 27.08L10.17 18.08L10.27 17.81L10.03 17.64L2.88 11.88H12.25H12.54L12.64 11.61L16 2.62Z"/>
            </svg>
        </div>`).join('');

    container.querySelectorAll('.rating-star').forEach(star => {
        star.addEventListener('click', () => {
            // Update rating
            revRating = parseInt(star.dataset.rating);

            // Update visuals in-place — no re-render, no event destruction
            container.querySelectorAll('.rating-star').forEach((s, idx) => {
                const svg    = s.querySelector('svg');
                const filled = idx < revRating;
                svg.setAttribute('fill',   filled ? '#C27AFF' : 'none');
                svg.setAttribute('stroke', filled ? '#C27AFF' : 'currentColor');
                s.classList.toggle('empty', !filled);
            });

            revCheckSubmitEnabled();
        });

        star.addEventListener('mouseenter', () => {
            const hoverRating = parseInt(star.dataset.rating);
            container.querySelectorAll('.rating-star').forEach((s, idx) => {
                const svg    = s.querySelector('svg');
                const filled = idx < hoverRating;
                svg.setAttribute('fill',   filled ? '#C27AFF' : 'none');
                svg.setAttribute('stroke', filled ? '#C27AFF' : 'currentColor');
            });
        });

        star.addEventListener('mouseleave', () => {
            // Restore to actual selected rating on mouse leave
            container.querySelectorAll('.rating-star').forEach((s, idx) => {
                const svg    = s.querySelector('svg');
                const filled = idx < revRating;
                svg.setAttribute('fill',   filled ? '#C27AFF' : 'none');
                svg.setAttribute('stroke', filled ? '#C27AFF' : 'currentColor');
            });
        });
    });
}

function revCheckSubmitEnabled() {
  const text      = document.getElementById('reviewText');
  const submitBtn = document.getElementById('submitBtn');
  if (!submitBtn || !text) return;
  const enabled = revRating > 0 && text.value.trim().length >= 10; // was 50
  submitBtn.disabled = !enabled;
  submitBtn.style.opacity = enabled ? '1' : '0.5';
}

async function revSubmit() {
    const text      = document.getElementById('reviewText');
    const submitBtn = document.getElementById('submitBtn');

    if (!currentGameId) { showToast('Could not identify the game.'); return; }
    if (revRating === 0) { showToast('Please select a rating.'); return; }
    if (text.value.length < 10) { showToast('Review must be at least 50 characters.'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
        const result = await api('/submitReview', {
            gameId: Number(currentGameId),
            rating: revRating,
            body:   text.value,
        });

        if (!result.success) {
            showToast(result.error || 'Failed to submit review');
            return;
        }

        showToast('Review submitted!');

        // Prepend optimistically to local list
        revData.unshift({
            name:      currentUser?.username ?? 'You',
            avatarUrl: null,
            hours:     '0 hours played',
            date:      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
            text:      text.value,
            helpful:   0,
            rating:    revRating,
            isLocal:   true,
        });
        revApplyFilter(revFilter);
        revRender();

    } catch (err) {
        console.error('Review submit failed:', err);
        showToast('Failed to submit review — please try again.');
    } finally {
        revRating = 0;
        text.value = '';
        document.getElementById('charCount').textContent = '0 characters';
        revRenderFormStars();
        revCheckSubmitEnabled();
        document.getElementById('reviewFormContainer').classList.remove('visible');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Review';
    }
}

// Attach static review listeners once
document.addEventListener('DOMContentLoaded', () => {
  const elOverallStars = document.getElementById('overallStars');
  if (elOverallStars) elOverallStars.innerHTML = revStarsHTML(5, 20);
  revRenderFormStars();
  
  document.getElementById('revFilterTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#revFilterTabs .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    revApplyFilter(tab.dataset.filter);
  });
  
  document.getElementById('prevPageBtn')?.addEventListener('click', () => { if (revPage > 1) { revPage--; revRender(); } });
  document.getElementById('nextPageBtn')?.addEventListener('click', () => { if (revPage < Math.ceil(revFiltered.length / REV_PER_PAGE)) { revPage++; revRender(); } });
  
  document.getElementById('writeReviewBtn')?.addEventListener('click', () => {
    const form = document.getElementById('reviewFormContainer');
    form.classList.add('visible');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  
  document.getElementById('cancelBtn')?.addEventListener('click', () => document.getElementById('reviewFormContainer').classList.remove('visible'));
  document.getElementById('submitBtn')?.addEventListener('click', revSubmit);
  
  document.getElementById('reviewText')?.addEventListener('input', e => {
    document.getElementById('charCount').textContent = `${e.target.value.length} characters`;
    revCheckSubmitEnabled();
  });
  
  document.getElementById('spoilersOption')?.addEventListener('click', () => document.getElementById('spoilersCheckbox').classList.toggle('checked'));
  document.getElementById('recommendOption')?.addEventListener('click', () => document.getElementById('recommendCheckbox').classList.toggle('checked'));
  
  document.getElementById('platformSelect')?.addEventListener('click', e => {
    e.stopPropagation(); document.getElementById('platformDropdown').classList.toggle('open');
  });
  document.getElementById('platformDropdown')?.addEventListener('click', e => {
    const opt = e.target.closest('.platform-option');
    if (!opt) return;
    document.getElementById('platformLabel').textContent = opt.dataset.value;
    document.getElementById('platformDropdown').classList.remove('open');
  });
  document.addEventListener('click', () => document.getElementById('platformDropdown')?.classList.remove('open'));
});


/* ═══════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════ */
(async () => {
    initTheme();                    // ← initialize theme before rendering
    await checkSession();           // ← gate everything behind auth
    
    // Setup theme toggle buttons
    const themeBtn = document.getElementById('themeToggleBtn');
    const darkModeToggle = document.getElementById('darkModeToggle');
    
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    if (darkModeToggle) darkModeToggle.addEventListener('change', toggleTheme);
    
    renderSteamAccounts();
    renderWishlist();
    initProfile();
    initSettingsNav();
    const { page, appid } = parseHash();
    navigate(page || 'home', appid ? { appid } : {});
})();
