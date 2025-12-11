import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Share2, ShoppingCart, DiamondPlus, Menu, Home, Library, Clock, User, Settings, Search, ArrowLeft, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import './GameStore.css';
import Dither from './Dither';

const gamesDatabase = [];

var session_test = false;
const User_IDS = ['76561199259784816', '76561198400254796'];

const handleLogin = async(email, password) => {
  console.log('Attempting login with:', email, password);
  try {
    const response = await fetch(`http://localhost:3001/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    console.log('Login response:', data);
  } catch (error) {
    console.error('Login failed:', error);
  }
};
async function loadLibrary(id){
    const response = await fetch(`http://localhost:3001/getSteamLib`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamId: id })
    });
    const data = await response.json();
    console.log('Library data:', data);
    const games = data.response.games;
    return games;
  };

export default function GameStorePage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState('store');
  const [selectedGame, setSelectedGame] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [gameRecs, setGameRecs] = useState([]);
  const [likedGames, setLikedGames] = useState(new Set());

  // Initialize history state on mount
  useEffect(() => {
    // Set initial state if none exists
    if (!window.history.state) {
      window.history.replaceState({ page: 'store' }, '', '#store');
    }

    // Listen for browser back/forward button
    const handlePopState = (event) => {
      if (event.state) {
        setCurrentPage(event.state.page);
        if (event.state.page === 'search') {
          setSearchQuery(event.state.searchQuery || '');
          setSearchResults(event.state.searchResults || []);
        } else if (event.state.page === 'game') {
          setSelectedGame(event.state.selectedGame || null);
          setGameRecs(event.state.gameRecs || []);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (page, state = {}) => {
    const historyState = { page, ...state };
    window.history.pushState(historyState, '', `#${page}`);
    setCurrentPage(page);
  };
  
  const handleSearch = async (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      console.log('Searching for:', searchQuery);
      try {
        const response = await fetch(`http://localhost:3001/searchGame`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ term: searchQuery })
        });
        const data = await response.json();
        const results = data['recommendations'];
        
        setSearchResults(results);
        navigateTo('search', { searchQuery, searchResults: results });
      } catch (error) {
        console.error('Search failed:', error);
      }
    }
  };

  const openGame = async (game) => {
    try {
      const response = await fetch(`https://corsproxy.io/?https://store.steampowered.com/api/appdetails?appids=${game.GameID}`);
      const data = await response.json();
      const gameD = data[game.GameID].data;

      console.log('Fetched game details:', gameD);

      const recoResponse = await fetch('http://localhost:3001/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ games: [game.Name] })
      });
      
      const recoData = await recoResponse.json();
      const recs = recoData.recommendations;
      
      setSelectedGame(gameD);
      setGameRecs(recs);
      navigateTo('game', { selectedGame: gameD, gameRecs: recs });
    } catch (error) {
      console.error("Failed to fetch game details:", error);
    }
  };

  const goBack = () => {
    window.history.back();
  };

  const toggleLike = (gameId) => {
    setLikedGames(prev => {
      const newSet = new Set(prev);
      if (newSet.has(gameId)) {
        newSet.delete(gameId);
      } else {
        newSet.add(gameId);
      }
      return newSet;
    });
  };

  const navItems = [
    { icon: Home, label: 'Home', active: currentPage === 'store', onClick: () => navigateTo('store') },
    { icon: Library, label: 'Library', active: currentPage === 'library', onClick: () => navigateTo('library') },
    { icon: Clock, label: 'Recent', active: false },
  ];

  return (
    <div className="game-store-container">
      {/* Sidebar */}
      <motion.div
        className="sidebar"
        animate={{ width: sidebarOpen ? 256 : 72 }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
      >
        <div className="sidebar-header">
          <AnimatePresence>
            {sidebarOpen && (
              <motion.img
                className="logo"
                src='./src/assets/Logo White.png'
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              />
            )}
          </AnimatePresence>
          <motion.button
            className="menu-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            whileHover={{ scale: 1.05, backgroundColor: '#1f2937' }}
            whileTap={{ scale: 0.95 }}
          >
            <Menu size={20} />
          </motion.button>
        </div>

        <nav className="nav">
          {navItems.map((item, idx) => (
            <motion.button
              key={idx}
              className={`nav-btn ${item.active ? 'active' : ''}`}
              onClick={item.onClick}
              whileHover={{ scale: 1.02, x: 4 }}
              whileTap={{ scale: 0.98 }}
            >
              <item.icon size={20} className="nav-icon" />
              <AnimatePresence>
                {sidebarOpen && (
                  <motion.span
                    className="nav-label"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2, delay: idx * 0.05 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {[
            { icon: Settings, label: 'Settings' },
            { icon: User, label: 'Profile', active: currentPage === 'profile', onClick: () => navigateTo('profile') },
          ].map((item, idx) => (
            <motion.button
              key={idx}
              className="nav-btn"
              onClick={item.onClick}
              whileHover={{ scale: 1.02, x: 4 }}
              whileTap={{ scale: 0.98 }}
            >
              <item.icon size={20} className="nav-icon" />
              <AnimatePresence>
                {sidebarOpen && (
                  <motion.span
                    className="nav-label"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* Main Content */}
      <motion.div className="main-content-wrapper">
        <div className="dither-background">
          <Dither
            waveColor={[0.3, 0, 0.5]}
            disableAnimation={false}
            enableMouseInteraction={true}
            mouseRadius={0}
            colorNum={4}
            waveAmplitude={0.2}
            waveFrequency={3}
            waveSpeed={0.04}
          />
        </div>
        <div className="main-content">
        
        
        <div className="search-container">
          <AnimatePresence mode="wait">
              <motion.div
                key="search-input"
                className="search-input-wrapper"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                <Search size={18} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search games..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearch}
                  className="search-input"
                />
              </motion.div>
          </AnimatePresence>
        </div>
        <AnimatePresence mode="wait">
          {currentPage === 'store' && <StorePage games={gamesDatabase} openGame={openGame} likedGames={likedGames} toggleLike={toggleLike} />}
          {currentPage === 'library' && <LibraryPage />}
          {currentPage === 'search' && <SearchResultsPage results={searchResults} searchQuery={searchQuery} openGame={openGame} goBack={goBack} likedGames={likedGames} toggleLike={toggleLike} />}
          {currentPage === 'game' && <GameDetailPage game={selectedGame} goBack={goBack} likedGames={likedGames} toggleLike={toggleLike} recs={gameRecs} openGame={openGame} />}
          {currentPage === 'profile' && <ProfilePage />}
        </AnimatePresence>
      </div>
      </motion.div>
      
    </div>
  );
}

function ProfilePage() {
  if (session_test) {
    return (
      <motion.div>
          <h1>Welcome, User!</h1>
      </motion.div>
    )
  }
  else {
    return (
      <motion.div>
          <h1>Login/SignUp</h1>
          <input id="email" type="text" placeholder="email" />
          <input id="password" type="text" placeholder="Password" />
          <motion.button onClick={() => handleLogin(document.getElementById("email").value,document.getElementById("password").value)}>Login</motion.button>
          <button>SignUp</button>
      </motion.div>
    )
  }
}

function StorePage({ games, openGame, likedGames, toggleLike }) {
  return (
    <motion.div
      key="store"
      className="content-wrapper Home-Page"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="card" id='Home-Free-Games'>
        <h1 className="page-title">Free Games</h1>
      </div>
      <div className="card" id='Home-On-Sale'>
        <h1 className="page-title">On Sale</h1>
      </div>
      <div className="card" id='Home-Trend'>
        <h1 className="page-title">Trending</h1>
      </div>
      <div className="card" id='Home-Recommend'>
        <h1 className="page-title">Recommended</h1>
      </div>
      <div className="games-grid">
        {games.map((game, idx) => (
          <motion.div
            key={game.id}
            className="game-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            whileHover={{ y: -8, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
            onClick={() => openGame(game)}
          >
            <div className="game-card-image">
              <img src={game.images[0]} alt={game.title} />
              <motion.button
                className={`game-card-like ${likedGames.has(game.id) ? 'liked' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLike(game.id);
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Heart size={18} fill={likedGames.has(game.id) ? 'currentColor' : 'none'} />
              </motion.button>
            </div>
            <div className="game-card-content">
              <h3 className="game-card-title">{game.title}</h3>
              <div className="game-card-rating">
                <Star size={14} fill="#a855f7" color="#a855f7" />
                <span>{game.rating}</span>
              </div>
              <div className="game-card-price">
                <span className="game-card-current-price">${game.price}</span>
                <span className="game-card-old-price">${game.oldPrice}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function LibraryPage({}) {
  const [libraryData, setLibraryData] = useState(null);

  useEffect(() => {
    const fetchAllLibraries = async () => {
      const allGames = [];
      for (const user_id of User_IDS) {
        try {
          const data = await loadLibrary(user_id);
          if (data && Array.isArray(data)) {
            allGames.push(...data);
          }
        } catch (error) {
          console.error(`Failed to load library for user ${user_id}:`, error);
        }
      }
      const uniqueGames = Array.from(
        new Map(allGames.map(game => [game.appid, game])).values()
      );
      setLibraryData(uniqueGames);
    };
    
    fetchAllLibraries();
  }, []);

  console.log('Library Data in LibraryPage:', libraryData);

  return (
    <motion.div
      key="library"
      // className="content-wrapper"
      style={{margin:20 }}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="card library-card">
        {libraryData ? (
          libraryData.map((game, idx) => (
            <motion.div
            key={game.appid}
            style={{margin: 10}}
            className='library-game-card'
            whileHover={{ scale: 1.05, x: -4 }}
            whileTap={{ scale: 0.95 }}>
              {/* <h3>{game.name}</h3>
              <p>Playtime: {Math.round(game.playtime_forever / 60)} hours</p> */}
              <img src={`https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`} alt="" />
            </motion.div>
          ))
        ) : (
          <p>Loading library...</p>
        )}
      </div>
    </motion.div>
  );
}

function SearchResultsPage({ results, searchQuery, openGame, goBack, likedGames, toggleLike }) {
  return (
    <motion.div
      key="search"
      className="content-wrapper"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="page-header">
        <motion.button
          className="back-btn"
          onClick={goBack}
          whileHover={{ scale: 1.05, x: -4 }}
          whileTap={{ scale: 0.95 }}
        >
          <ArrowLeft size={20} />
          Back
        </motion.button>
        <h1 className="page-title">Search Results for "{searchQuery}"</h1>
      </div>

      {results.length === 0 ? (
        <motion.div
          className="no-results"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Search size={64} className="no-results-icon" />
          <h2>No games found</h2>
          <p>Try searching for something else</p>
        </motion.div>
      ) : (
        <div className="games-grid">
          {results.map((game, idx) => (
            <motion.div
              key={game.GameID}
              className="game-card"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              whileHover={{ y: -8, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
              onClick={() => openGame(game)}
            >
              <div className="game-card-image">
                <img src={`https://cdn.akamai.steamstatic.com/steam/apps/${game.GameID}/library_600x900.jpg`} alt={game.Name} />
                <motion.button
                  className={`game-card-like ${likedGames.has(game.GameID) ? 'liked' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike(game.GameID);
                  }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Heart size={18} fill={likedGames.has(game.GameID) ? 'currentColor' : 'none'} />
                </motion.button>
              </div>
              <div className="game-card-content">
                <h3 className="game-card-title">{game.Name}</h3>
                <div className="game-card-rating">
                  <Star size={14} fill="#a855f7" color="#a855f7" />
                  <span>{(game.positive_ratio * 5).toFixed(1)}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function GameDetailPage({ game, goBack, likedGames, toggleLike, recs, openGame }) {
  const [currentImage, setCurrentImage] = useState(0);

  if (!game) return null;

  const screenshots = game.screenshots || [];
  const nextImage = () => setCurrentImage((prev) => (prev + 1) % screenshots.length);
  const prevImage = () => setCurrentImage((prev) => (prev - 1 + screenshots.length) % screenshots.length);

  return (
    <motion.div
      key="game"
      className="content-wrapper"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <div className="page-header">
        <motion.button
          className="back-btn"
          onClick={goBack}
          whileHover={{ scale: 1.05, x: -4 }}
          whileTap={{ scale: 0.95 }}
        >
          <ArrowLeft size={20} />
          Back
        </motion.button>
        <h1 className="page-title">{game.name}</h1>
        <motion.button
          className="share-btn"
          whileHover={{ scale: 1.1, rotate: 5 }}
          whileTap={{ scale: 0.9 }}
        >
          <Share2 size={20} />
        </motion.button>
      </div>

      {/* Carousel */}
      {screenshots.length > 0 && (
        <>
          <div className="carousel-container">
            <div className="image-wrapper">
              <AnimatePresence mode="wait">
                <motion.img
                  key={currentImage}
                  src={screenshots[currentImage].path_full}
                  alt={`Screenshot ${currentImage + 1}`}
                  className="main-image"
                  initial={{ opacity: 0, scale: 1.1 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.5 }}
                />
              </AnimatePresence>
              <div className="image-gradient" />
            </div>

            {screenshots.length > 1 && (
              <>
                <motion.button
                  onClick={prevImage}
                  className="carousel-btn carousel-btn-left"
                  whileHover={{ scale: 1.1, x: -4 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <ChevronLeft size={24} />
                </motion.button>
                <motion.button
                  onClick={nextImage}
                  className="carousel-btn carousel-btn-right"
                  whileHover={{ scale: 1.1, x: 4 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <ChevronRight size={24} />
                </motion.button>
              </>
            )}
          </div>

          {/* Thumbnails */}
          <div className="thumbnail-container">
            {screenshots.map((img, index) => (
              <motion.button
                key={img.id}
                onClick={() => setCurrentImage(index)}
                className={`thumbnail ${currentImage === index ? "active" : ""}`}
                whileHover={{ scale: 1.05, opacity: 1 }}
                whileTap={{ scale: 0.95 }}
              >
                <img
                  src={img.path_thumbnail}
                  alt={`Thumbnail ${index + 1}`}
                  className="thumbnail-image"
                />
              </motion.button>
            ))}
          </div>
        </>
      )}

      <div className="grid">
        {/* Left Column */}
        <div className="left-column">
          <motion.div className="card" whileHover={{ backgroundColor: 'rgba(31, 41, 55, 0.7)' }}>
            <div className="game-info-header">
              <h1 className="game-title">{game.name}</h1>
            </div>

            <div className="button-group">
              <motion.button className="play-btn" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <DiamondPlus size={20} />
                Add to Library
              </motion.button>
              <motion.button className="library-btn" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <ShoppingCart size={20} />
                Visit Store
              </motion.button>
              <motion.button
                onClick={() => toggleLike(game.steam_appid)}
                className={`like-btn ${likedGames.has(game.steam_appid) ? 'liked' : ''}`}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <Heart size={20} fill={likedGames.has(game.steam_appid) ? 'currentColor' : 'none'} />
              </motion.button>
            </div>

            <div
              className="about-container"
              dangerouslySetInnerHTML={{ __html: game.about_the_game }}
            />
          </motion.div>
        </div>

        {/* Right Column */}
        <div className="right-column">
          <motion.div className="card" whileHover={{ backgroundColor: 'rgba(31, 41, 55, 0.7)' }}>
            <div className="info-section">
              <h3 className="info-label">Release Date</h3>
              <p className="info-value">{game.release_date?.date}</p>
            </div>
            <div className="info-section">
              <h3 className="info-label">Developer</h3>
              <p className="info-value">{game.developers?.join(", ")}</p>
            </div>
            <div className="info-section">
              <h3 className="info-label">Publisher</h3>
              <p className="info-value">{game.publishers?.[0]}</p>
            </div>
            <div className="info-section">
              <h3 className="info-label">Genre</h3>
              <p className="info-value">{game.genres?.map(g => g.description).join(", ")}</p>
            </div>
            <div className="info-section">
              <h3 className="info-label">Works On</h3>
              <div className="platform-container">
                {['Windows', 'macOS', 'Linux'].map((platform, idx) => (
                  <motion.span key={idx} className="platform" whileHover={{ scale: 1.05 }}>
                    {platform}
                  </motion.span>
                ))}
              </div>
            </div>
          </motion.div>

          {recs && recs.length > 0 && (
            <motion.div className='card' id='recos'>
              <h2>Recommended Games</h2>
              {recs.slice(0, 10).map((rec, recIDX) => (
                <motion.div
                  key={rec.GameID}
                  className="game-card"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: recIDX * 0.1 }}
                  whileHover={{ y: -8, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}
                  onClick={() => openGame(rec)}
                >
                  <div className="game-card-image">
                    <img src={rec.image} alt={rec.Name} />
                  </div>
                  <div className="game-card-content">
                    <h3 className="game-card-title">{rec.Name}</h3>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
