/* ═══════════════════════════════════════════════
   ROUTER
═══════════════════════════════════════════════ */
const PAGES = ['home','library','wishlist','profile','gamedetails'];
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
   API HELPERS
═══════════════════════════════════════════════ */
const BASE = 'http://localhost:3001';

async function api(path, body = null) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };
  const res = await fetch(BASE + path, opts);
  return res.json();
}

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
  heroTimer = setInterval(() => goHero(heroIdx + 1), 5000);
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

async function loadHome() {
  try {
    const [trendingData, salesData, recData] = await Promise.all([
      api('/trending'),
      api('/sales'),
      api('/recommend', { games: ['Hollow Knight'] })
    ]);
    const trending = trendingData.trending;
    const sales = salesData.sale;
    const recs = recData.recommendations;

    // Details for trending
    const details = await Promise.all(
      trending.slice(0,5).map(g => {
        const id = g.logo.split('/apps/')[1]?.split('/')[0];
        return api('/getGameDetails', { appId: id }).catch(() => null);
      })
    );

    const heroSection = document.getElementById('heroSection');
    const top = trending.slice(0, 5);
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

    // Recommendations
    document.getElementById('recommendationsGrid').innerHTML = recs.slice(0,10).map(g => `
      <div class="game-card" onclick="navigate('gamedetails',{appid:'${g.GameID}'})">
        <img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${g.GameID}/header.jpg"
          onerror="this.src='https://placehold.co/460x260/1a1a24/532494?text=${encodeURIComponent(g.Name)}'"/>
        <div class="card-hover-overlay"></div>
        <div class="card-label">${g.Name}</div>
      </div>`).join('');

    // Sales grid
    document.getElementById('gamesGrid').innerHTML = sales.slice(0,6).map(g => `
      <div class="game-tile" onclick="navigate('gamedetails',{appid:'${g.id}'})">
        <img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${g.id}/header.jpg"
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

document.querySelectorAll('.filter-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
  });
});

/* ═══════════════════════════════════════════════
   LIBRARY PAGE — full faithful port of library.js
═══════════════════════════════════════════════ */
const LIB_USER_IDS = ['76561199259784816', '76561198400254796'];

// API helpers
async function fetchLibrary(steamId) {
  const res = await fetch(`http://localhost:3001/getSteamLib`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steamId })
  });
  const data = await res.json();
  return data.recommendations ?? [];
}

async function searchGames(query) {
  const res = await fetch(`http://localhost:3001/searchGame`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term: query })
  });
  const data = await res.json();
  return data.recommendations ?? [];
}

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
window.addEventListener('hostMessage', (e) => {
  const msg = e.detail;
  if (msg.type === 'localGameAdded') {
    if (msg.success) { libAllGames.push(msg.game); libRender(); }
    else console.error('Failed to add local game:', msg.error);
  }
});

// State
let libAllGames      = [];
let libCurrentView   = 'grid';
let libSearchQuery   = '';
let libCurrentPlatform = 'All Games';
let libFavorites     = new Set();

function libStarsHTML(rating, size = 'sm') {
  const cls = size === 'sm' ? 'card-star' : 'list-star';
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="${cls} ${i + 1 <= rating ? '' : 'empty'}">★</span>`
  ).join('');
}
function clockSVG() {
  return `<svg width="16" height="16" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M10 6v4l3 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}
function heartSVG(filled) {
  return `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
}

function buildGridCard(game) {
  const isLocal = game.source === 'local';
  const title   = isLocal ? game.title : game.Name;
  const isFav   = libFavorites.has(title);
  const imgSrc  = isLocal
    ? (game.coverImage || `https://placehold.co/214x321/1A1A24/E1E1EA?text=${encodeURIComponent(title.substring(0,6))}`)
    : `https://cdn.akamai.steamstatic.com/steam/apps/${game.GameID}/library_600x900.jpg`;
  const fallback = `https://placehold.co/214x321/1A1A24/E1E1EA?text=${encodeURIComponent(title.substring(0,6))}`;
  const statsHTML = isLocal
    ? `<div class="card-playtime">${clockSVG()} ${game.playTimeMinutes ?? 0} mins</div>`
    : `<div class="card-stars">${libStarsHTML(game.rating, 'sm')}</div>
       <div class="card-playtime">${clockSVG()} ${((game.playtime_forever ?? 0) / 60).toFixed(1)}H played</div>`;
  const clickFn = isLocal
    ? `window.chrome?.webview?.postMessage({ type: 'launchGame', id: '${game.id}' })`
    : `navigate('gamedetails',{appid:'${game.GameID}'})`;
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
  const title   = isLocal ? game.title : game.Name;
  const isFav   = libFavorites.has(title);
  const imgSrc  = isLocal
    ? (game.coverImage || `https://placehold.co/90x115/1A1A24/E1E1EA?text=${encodeURIComponent(title.substring(0,4))}`)
    : `https://cdn.akamai.steamstatic.com/steam/apps/${game.GameID}/library_600x900.jpg`;
  const fallback = `https://placehold.co/90x115/1A1A24/E1E1EA?text=${encodeURIComponent(title.substring(0,4))}`;
  const statsHTML = isLocal
    ? `<div class="list-playtime">${clockSVG()} <span>${game.playTimeMinutes ?? 0} mins</span></div>`
    : `<div class="list-stars">${libStarsHTML(game.rating, 'lg')}</div>
       <div class="list-playtime">${clockSVG()} <span>${((game.playtime_forever ?? 0) / 60).toFixed(1)}H</span></div>`;
  const clickFn = isLocal
    ? `window.chrome?.webview?.postMessage({ type: 'launchGame', id: '${game.id}' })`
    : `navigate('gamedetails',{appid:'${game.GameID}'})`;
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
    list = list.filter(g => libCurrentPlatform === 'Local' ? g.source === 'local' : g.source !== 'local');
  }
  if (libSearchQuery.trim()) {
    const q = libSearchQuery.toLowerCase();
    list = list.filter(g => (g.source === 'local' ? g.title : g.Name).toLowerCase().includes(q));
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
    libAllGames.push(...mergedLocal);
    libRender();
  } catch (err) {
    console.error('Failed to load local games:', err);
  }

  // 2. Steam libraries for each user ID
  for (const userId of LIB_USER_IDS) {
    try {
      const data = await fetchLibrary(userId);
      libAllGames.push(...data);
      libRender();
    } catch (err) {
      console.error(`Failed to load Steam library for ${userId}:`, err);
    }
  }
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

// Hook global search bar to library when on that page
document.getElementById('globalSearch').addEventListener('input', e => {
  if (currentPage === 'library') { libSearchQuery = e.target.value; libRender(); }
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
const RECENTLY_PLAYED = [
  {title:'Cyberpunk 2077',img:'Uploads/cyberpunk2077.png'},
  {title:'Elden Ring',img:'Uploads/eldenring.png'},
  {title:'God of War: Ragnarök',img:'Uploads/godofwarragnarok.png'},
  {title:'Spider-Man 2',img:'Uploads/spiderman2.png'},
  {title:'The Witcher 3',img:'Uploads/thewitcher.png'},
  {title:'Horizon Forbidden West',img:'Uploads/horrizenforbiddenwest.png'},
];
const RECENTLY_ADDED = [
  {title:'Red Dead Redemption',img:'Uploads/red-dead-redemption.png'},
  {title:'Metal Gear Solid',img:'Uploads/metalgearsolid.png'},
  {title:'Grand Theft Auto',img:'Uploads/grandtheftauto.png'},
  {title:'Alan Wake II',img:'Uploads/alanwake2.png'},
  {title:'Tekken 8',img:'Uploads/tekken8.png'},
  {title:'Mafia',img:'Uploads/mafia.png'},
];
const FAVOURITES = [
  {title:'Cyberpunk 2077',img:'Uploads/cyberpunk2077.png'},
  {title:'Elden Ring',img:'Uploads/eldenring.png'},
  {title:'Ghost of Tsushima',img:'Uploads/ghostoftsushima.png'},
  {title:'The Witcher 3',img:'Uploads/thewitcher.png'},
  {title:'Spider-Man 2',img:'Uploads/spiderman2.png'},
];
const REVIEWS = [
  {game:'Cyberpunk 2077',img:'Uploads/cyberpunk2077.png',date:'Feb 18, 2026',stars:5,text:'After the latest updates, this game has become an absolute masterpiece.',likes:null,comments:null},
  {game:'Elden Ring',img:'Uploads/eldenring.png',date:'Feb 10, 2026',stars:4,text:'An epic journey through a beautifully crafted dark fantasy world.',likes:null,comments:null},
  {game:'Ghost of Tsushima',img:'Uploads/ghostoftsushima.png',date:'Dec 28, 2025',stars:5,text:'One of the most visually stunning games ever made.',likes:342,comments:12},
];

function starsSVGProfile(n) {
  let h='';
  for(let i=0;i<5;i++){
    const f=i<n;
    h+=`<span><svg width="16" height="16" viewBox="0 0 16 16" fill="${f?'#FDC700':'none'}" stroke="${f?'#FDC700':'rgba(225,225,234,0.3)'}" stroke-width="1"><path d="M8 1.5L9.6 5.2L13.7 5.7L10.8 8.5L11.6 12.6L8 10.5L4.4 12.6L5.2 8.5L2.3 5.7L6.4 5.2L8 1.5Z"/></svg></span>`;
  }
  return h;
}
function buildReview(r) {
  const fb = `https://placehold.co/80x80/1A1A24/E1E1EA?text=${encodeURIComponent(r.game.substring(0,3))}`;
  const actions = r.likes!==null ? `<div class="review-actions"><button class="review-act-btn">👍 ${r.likes}</button><button class="review-act-btn">💬 ${r.comments}</button></div>` : '';
  return `<div class="review-card">
    <img src="${r.img}" alt="${r.game}" class="review-thumb" onerror="this.src='${fb}'"/>
    <div class="review-body">
      <div class="review-top"><span class="review-game">${r.game}</span><span class="review-date">${r.date}</span></div>
      <div class="review-stars">${starsSVGProfile(r.stars)}</div>
      <p class="review-text">${r.text}</p>
      ${actions}
    </div>
  </div>`;
}

function initProfile() {
  const fb = t => `https://placehold.co/402x564/1A1A24/E1E1EA?text=${encodeURIComponent(t.substring(0,6))}`;
  const fbThumb = t => `https://placehold.co/160x245/1A1A24/E1E1EA?text=${encodeURIComponent(t.substring(0,6))}`;
  document.getElementById('recentlyPlayed').innerHTML = RECENTLY_PLAYED.map(g=>`<div class="thumb-card"><img src="${g.img}" alt="${g.title}" onerror="this.src='${fbThumb(g.title)}'"/></div>`).join('');
  document.getElementById('recentlyAdded').innerHTML = RECENTLY_ADDED.map(g=>`<img src="${g.img}" alt="${g.title}" class="lib-grid-card" onerror="this.src='${fb(g.title)}'"/>`).join('');
  document.getElementById('favouriteGrid').innerHTML = FAVOURITES.map(g=>`<img src="${g.img}" alt="${g.title}" class="lib-grid-card" onerror="this.src='${fb(g.title)}'"/>`).join('');
  document.getElementById('activityReviews').innerHTML = REVIEWS.slice(0,2).map(buildReview).join('');
  document.getElementById('reviewsTabList').innerHTML = REVIEWS.map(buildReview).join('');
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

/* ═══════════════════════════════════════════════
   GAME DETAILS PAGE
═══════════════════════════════════════════════ */

// ── API calls ──────────────────────────────────────────────────────────────────

async function fetchGameDetails(appId) {
  const response = await fetch(`http://localhost:3001/getGameDetails`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId })
  });
  const data = await response.json();
  return data.gameDetails;
}

async function fetchReviews(appId) {
  const response = await fetch(`http://localhost:3001/getGameReviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId })
  });
  const data = await response.json();
  return data.reviews.reviews;
}

async function fetchGameRecommendations(gameName) {
  const response = await fetch(`http://localhost:3001/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ games: [gameName] })
  });
  const data = await response.json();
  return data.recommendations;
}

// ── Main loader — called by navigate() instead of reading URL params ────────────

async function loadGameDetails(appId) {
  const el = document.getElementById('gameDetailsContent');
  el.innerHTML = '<div class="loading-screen"><div class="loading-spinner"></div><div class="loading-text">Loading game details...</div></div>';

  // ── Fetch all data ──
  let data;
  let reviews;
  let recommendations;

  try {
    data            = await fetchGameDetails(appId);
    reviews         = await fetchReviews(appId);
    recommendations = await fetchGameRecommendations(data.name);
  } catch (err) {
    console.warn('Fetch failed', err);
    el.innerHTML = '<div class="loading-screen"><div class="loading-text">⚠ Could not load game details. Is the server running?</div></div>';
    return;
  }

  console.log('Fetched game data:', data);
  console.log('Fetched reviews:', reviews);
  console.log('Fetched recommendations:', recommendations);

  // ── Parse data (identical to original gamedetails.js) ──

  const MEDIA = data.screenshots.map(s => s.path_full);

  const TRAILERS = data.movies.map(m => ({
    id: m.id,
    name: m.name,
    thumbnail: m.thumbnail,
    hls: m.hls_h264,
    dash_h264: m.dash_h264,
    dash_av1: m.dash_av1,
    highlight: m.highlight
  }));

  const SHORT_DESCRIPTION    = data.short_description;
  const DETAILED_DESCRIPTION = data.detailed_description;
  const ABOUT_THE_GAME       = data.about_the_game;

  let METACRITIC;
  if (!data.metacritic) {
    METACRITIC = "Unavailable";
  } else {
    METACRITIC = { score: data.metacritic.score, url: data.metacritic.url };
  }

  const CATEGORIES             = data.categories.map(c => c.description);
  const ACHIEVEMENTS_TOTAL     = data.achievements?.total;
  const ACHIEVEMENTS_HIGHLIGHTED = data.achievements?.highlighted;
  const SUPPORT_INFO           = { url: data.support_info.url, email: data.support_info.email };
  const LEGAL_NOTICE           = data.legal_notice;

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
      { name: "GOG",          cls: "gog",    orig: null, price: "Free" },
      { name: "Humble Store", cls: "humble", orig: null, price: "Free" },
    ];
  } else {
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
      { name: "Humble Store", cls: "humble", orig: null, price: data.price_overview.final_formatted },
    ];
  }

  const RATINGS = Object.entries(data.ratings).map(([region, r]) => ({
    region,
    rating:           r.rating,
    rating_generated: r.rating_generated,
    required_age:     r.required_age,
    descriptors:      r.descriptors,
    banned:           r.banned,
    use_age_gate:     r.use_age_gate
  }));

  function parseRequirements(htmlString) {
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

  const REQUIREMENTS = {
    windows: {
      minimum:     parseRequirements(data.pc_requirements.minimum),
      recommended: parseRequirements(data.pc_requirements.recommended)
    },
    mac: {
      minimum:     parseRequirements(data.mac_requirements.minimum),
      recommended: parseRequirements(data.mac_requirements.recommended)
    },
    linux: {
      minimum:     parseRequirements(data.linux_requirements.minimum),
      recommended: parseRequirements(data.linux_requirements.recommended)
    }
  };

  const GAME_DETAILS = [
    { icon: "Uploads/releasedate.svg", label: "Release Date", value: data.release_date.date },
    { icon: "Uploads/workson.svg",     label: "Works On",     value: null, platforms: Object.keys(data.platforms).filter(k => data.platforms[k]).map(k => k.charAt(0).toUpperCase() + k.slice(1)) },
    { icon: "Uploads/developer.svg",   label: "Developer",    value: data.developers.join(', ') },
    { icon: "Uploads/publisher.svg",   label: "Publisher",    value: data.publishers.join(', ') },
    { icon: "Uploads/genre.svg",       label: "Genre",        value: data.genres.map(g => g.description).join(', ') },
    { icon: "Uploads/filesize.svg",    label: "File Size",    value: "8 GB" },
    { icon: "Uploads/lastupdate.svg",  label: "Last Update",  value: data.release_date.date + " - Launch" }
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

  function heartSVG(filled) {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>`;
  }

  // ── Inject the game details HTML into the page ──
  // (This replaces the static gamedetails.html. All the IDs match exactly.)

  el.innerHTML = `
    <div class="game-header">
      <div class="game-title-section">
        <h1 class="game-title" id="gameTitle"></h1>
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

        <div class="card game-overview">
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
            <button class="btn-primary" id="addToLibraryBtn">
              <img src="Uploads/basil_add-outline.svg" alt="" onerror="this.style.display='none'"> Play Game
            </button>
            <button class="btn-secondary" id="visitStoreBtn">
              <img src="Uploads/basil_add-outline.svg" alt="" onerror="this.style.display='none'"> Visit Store
            </button>
            <button class="btn-icon-only" id="favBtn" title="Favourite"></button>
          </div>
          <div class="tags" id="tags"></div>
        </div>

        <div class="card where-to-buy">
          <div class="section-header">
            <div class="section-icon"><img src="Uploads/whereyoubuy.svg" alt="" onerror="this.style.display='none'"></div>
            <div class="section-title">
              <h3>Where You Buy</h3>
              <span class="ownership-status">Not Owned</span>
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

        <div class="card description" id="detailedDescription"></div>

        <div class="card system-requirements">
          <h3>System Requirements</h3>
          <div class="platform-tabs" id="reqPlatformTabs">
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

        <div class="card reviews">
          <div class="reviews-header">
            <h3>Reviews &amp; Community</h3>
            <a class="see-all-reviews" id="reviewsAll">See All Reviews</a>
          </div>
          <div class="rating-bars" id="ratingBars"></div>
          <div class="review-list" id="reviewList"></div>
        </div>

      </div>

      <div class="right-column">

        <div class="card game-details">
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

        <div class="card recommendations-sidebar">
          <div class="recommendations-title">Recommended For You</div>
          <div class="recommendations-list" id="recList"></div>
        </div>

        <div class="card languages">
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
    document.getElementById('rateScore').textContent = (METACRITIC.score / 20).toFixed(1);
    document.getElementById('rateCount').textContent = `(${data.recommendations.total.toLocaleString()} reviews)`;

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

  function renderTags() {
    document.getElementById('tags').innerHTML = data.genres.map(c => `<span class="tag">${c.description}</span>`).join('');
  }

  function renderStats() {
    const statRev = document.getElementById('statReview');
    console.log('Metacritic score:', METACRITIC.score);
    switch (true) {
      case METACRITIC.score > 90: statRev.textContent = 'Overwhelmingly Positive'; break;
      case METACRITIC.score > 80: statRev.textContent = 'Very Positive';           break;
      case METACRITIC.score > 70: statRev.textContent = 'Positive';                break;
      case METACRITIC.score > 60: statRev.textContent = 'Mixed';                   break;
      case METACRITIC.score > 50: statRev.textContent = 'Negative';                break;
      default:                    statRev.textContent = 'Unrated';
    }
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
          ${s.orig ? `<span class="original-store-price">${s.orig}</span>` : ''}
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
    document.getElementById('recList').innerHTML = recommendations.slice(0, 15).map(r => `
      <div class="recommendation-item" onclick="navigate('gamedetails', { appid: '${r.GameID}' })">
        <img src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${r.GameID}/library_hero.jpg" alt="${r.Name}"
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

  function renderTrailers() {
    const el = document.getElementById('trailersList');
    if (!el) return;
    el.innerHTML = TRAILERS.map(t => `
      <div class="trailer-item ${t.highlight ? 'highlight' : ''}">
        <img src="${t.thumbnail}" alt="${t.name}" onerror="this.src='https://placehold.co/600x337/1A1A24/E1E1EA?text=Trailer'"/>
        <div class="trailer-name">${t.name}</div>
      </div>
    `).join('');
  }

  function renderDescription() {
    const shortEl  = document.getElementById('shortDescription');
    if (shortEl) shortEl.innerHTML = `<h3>Description</h3> ${SHORT_DESCRIPTION}`;
    const detailEl = document.getElementById('detailedDescription');
    if (detailEl) detailEl.innerHTML = `<h3>Description</h3> ${DETAILED_DESCRIPTION}`;
    const aboutEl  = document.getElementById('aboutGame');
    if (aboutEl) aboutEl.innerHTML = `<h3>Description</h3> ${ABOUT_THE_GAME}`;
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
    renderTrailers();
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
   BOOT
═══════════════════════════════════════════════ */
(async () => {
  // Init purely local pages (no API)
  renderWishlist();
  initProfile();

  // Navigate — this lazy-inits home/library APIs on first visit
  const { page, appid } = parseHash();
  navigate(page || 'home', appid ? { appid } : {});
})();