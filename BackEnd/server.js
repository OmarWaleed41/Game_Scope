// ─── Dependencies ────────────────────────────────────────────────────────────
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const passport   = require('passport');
const { Strategy: SteamStrategy } = require('passport-steam');
const sql        = require('mssql/msnodesqlv8');
const session    = require('express-session');
const fs         = require('fs');
const http       = require('http');
const { Server } = require('socket.io');
const Fuse       = require('fuse.js');
const axios      = require('axios');
const cheerio    = require('cheerio')
const speakeasy  = require('speakeasy');
const QRCode     = require('qrcode');
const bcrypt     = require('bcrypt');
const jwt        = require('jsonwebtoken');

// ─── Config / Constants ──────────────────────────────────────────────────────
const PORT               = process.env.PORT               || 3001;
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5000';
const STEAM_API_KEY      = process.env.STEAM_API_KEY;
const SESSION_SECRET     = process.env.SESSION_SECRET;
const JWT_SECRET         = process.env.JWT_SECRET;
const REQUEST_TIMEOUT    = 15_000;
const EPIC_BATCH_SIZE    = 5;
const EPIC_BATCH_DELAY   = 500;

const DB_CONFIG = {
    connectionString: process.env.DB_CONNECTION_STRING,
};

// ─── App Setup ───────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors({
    origin: 'https://gamescope.local',
    credentials: true
}));
app.use(express.json());
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge:   1000 * 60 * 60 * 24,
        httpOnly: false,
        secure:   false,
        sameSite: 'lax',
    },
}));
app.use(passport.initialize());
app.use(passport.session());

// ─── Passport / Auth ─────────────────────────────────────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, { id }));

passport.use(new SteamStrategy(
    {
        returnURL: `http://localhost:${PORT}/auth/steam/return`,
        realm:     `http://localhost:${PORT}/`,
        apiKey:    STEAM_API_KEY,
    },
    (_identifier, profile, done) => done(null, profile),
));

function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ status: 'error', message: 'Not authenticated' });
    }
    try {
        req.user = jwt.verify(header.slice(7), JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ status: 'error', message: 'Token expired or invalid' });
    }
}

// ─── Database ────────────────────────────────────────────────────────────────
async function connectDB() {
    try {
        await sql.connect(DB_CONFIG);
        console.log('Connected to MSSQL ✅');
    } catch (err) {
        console.error('Failed to connect to MSSQL:', err.message);
        process.exit(1);
    }
}

// ─── Utilities ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeStrict = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

function removeNoise(name) {
    return name
        .toLowerCase()
        .replace(/\s*:\s*(\d+\s*(year|th|st|nd|rd)|anniversary|celebration|.*(edition|bundle|collection)).*/i, '')
        .replace(/\b(edition|remastered|deluxe|ultimate|complete|definitive|bundle|goty|game of the year)\b/gi, '')
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getCleanDescription(html) {
    let formatted = html.replace(/<br\s*\/?>/gi, '\n');
    
    let text = formatted.replace(/<[^>]*>/g, '');
    
    return text.replace(/\n{3,}/g, '\n\n').trim();
}
// ─── Steam Catalog ───────────────────────────────────────────────────────────
let steamCatalogMap = null;
let steamFuse       = null;

/**
 * Fetches the full Steam app catalog from the API and writes it to disk.
 * Only needs to be run once; comment out after the first run.
 * just minimize this part
 */
async function fetchSteamCatalog(lastId = 0, accumulator = []) {
    const url      = `https://api.steampowered.com/IStoreService/GetAppList/v1/?key=${STEAM_API_KEY}&include_games=true&include_dlc=false&max_results=150000&last_appid=${lastId}`;
    const response = await fetch(url);
    const data     = await response.json();
    const apps     = data.response?.apps ?? [];

    accumulator.push(...apps);
    console.log(`Fetched ${apps.length} apps (total: ${accumulator.length})`);

    if (data.response?.have_more_results) {
        return fetchSteamCatalog(data.response.last_appid, accumulator);
    }

    await fs.promises.writeFile('steam_catalog.json', JSON.stringify(accumulator));
    console.log(`Done — ${accumulator.length} games written to steam_catalog.json`);
}
// fetchSteamCatalog(); // Run once to build the catalog, then comment out.

async function loadSteamCatalog() {
    if (steamCatalogMap) return steamCatalogMap;

    const raw  = await fs.promises.readFile('steam_catalog.json', 'utf-8');
    const apps = JSON.parse(raw);

    steamCatalogMap = new Map(apps.map((app) => [normalizeStrict(app.name), app]));

    steamFuse = new Fuse(apps, {
        keys:              [{ name: 'name', getFn: (app) => removeNoise(app.name) }],
        threshold:         0.35,
        includeScore:      true,
        useExtendedSearch: false,
    });

    console.log(`Loaded ${steamCatalogMap.size} Steam apps into memory`);
    return steamCatalogMap;
}

async function resolveGame(epicTitle, epicDeveloper) {
    const catalog = await loadSteamCatalog();

    // 1. Exact match — O(1)
    const exactKey = normalizeStrict(epicTitle);
    if (catalog.has(exactKey)) return [catalog.get(exactKey)];

    // 2. Noise-stripped exact match
    const cleanKey = removeNoise(epicTitle).replace(/ /g, '');
    for (const [key, app] of catalog) {
        if (key === cleanKey) return [app];
    }

    // 3. Fuse fuzzy — top 3 candidates
    const candidates = steamFuse
        .search(removeNoise(epicTitle), { limit: 3 })
        .filter((r) => r.score < 0.3);

    if (candidates.length === 0) {
        console.log(`No candidates found for: ${epicTitle}`);
        return [];
    }

    // 4. Verify candidates against Steam API
    const results = [];

    for (const { item, score } of candidates) {
        const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${item.appid}&cc=us`);
        const data     = await response.json();
        const gameData = data[item.appid]?.data;

        if (!gameData) continue;

        const publisherMatch =
            !epicDeveloper ||
            gameData.publishers?.some((p) =>
                p?.toLowerCase().includes(epicDeveloper.toLowerCase()),
            );

        if (publisherMatch) results.push({ ...gameData, _score: score });

        await sleep(300); // stay under rate limit
    }

    return results.sort((a, b) => a._score - b._score).slice(0, 1);
}
async function getSteamTags(appId) {
    try {
        const url = `https://store.steampowered.com/apphover/${appId}?l=english`;
        
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio.load(data);
        const tags = [];

        $('.app_tag').each((_, element) => {
            const tag = $(element).text().trim();
            if (tag) tags.push(tag);
        });

        return tags;
    } catch (error) {
        console.error(`Error fetching tags for ${appId}:`, error.message);
        return [];
    }
}

// ─── Logging Middleware ───────────────────────────────────────────────────────
app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} — ${req.method} ${req.url}`);
    next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────

// ─── Routes ──────────────────────────────────────────────────────────────────

const pendingSteamLinks = new Map();
const userSockets = new Map(); // userId → socketId

io.on('connection', (socket) => {
    socket.on('register', (userId) => {
        if (userId) userSockets.set(String(userId), socket.id);
    });
    socket.on('disconnect', () => {
        for (const [uid, sid] of userSockets) {
            if (sid === socket.id) { userSockets.delete(uid); break; }
        }
    });
});

app.get('/auth/steam', (req, res) => {
    const appToken = req.query.token;
    const socketId = req.query.socketId;

    if (!appToken) return res.status(401).send("Missing authentication token.");

    try {
        const decoded = jwt.verify(appToken, JWT_SECRET);
        const state = require('crypto').randomBytes(16).toString('hex');

        pendingSteamLinks.set(state, {
            userId:    decoded.userId,
            socketId:  socketId || null,
            expiresAt: Date.now() + 10 * 60 * 1000,
        });

        // ✅ Embed state directly in the returnURL — no session needed
        const returnURL = `http://localhost:${PORT}/auth/steam/return?state=${state}`;

        passport.use(new SteamStrategy(
            {
                returnURL,
                realm:  `http://localhost:${PORT}/`,
                apiKey: STEAM_API_KEY,
            },
            (_identifier, profile, done) => done(null, profile),
        ));

        passport.authenticate('steam')(req, res, () => {});
    } catch (err) {
        return res.status(403).send("Invalid or expired token.");
    }
});

app.get(
    '/auth/steam/return',
    (req, res, next) => {
        // ✅ Reconstruct the strategy with the same returnURL Steam used
        // (must match exactly what was passed to returnURL above)
        const state     = req.query.state;
        const returnURL = `http://localhost:${PORT}/auth/steam/return?state=${state}`;

        passport.use(new SteamStrategy(
            {
                returnURL,
                realm:  `http://localhost:${PORT}/`,
                apiKey: STEAM_API_KEY,
            },
            (_identifier, profile, done) => done(null, profile),
        ));

        passport.authenticate('steam', { failureRedirect: '/', session: false })(req, res, next);
    },
    async (req, res) => {
        const steamID = req.user?.id;
        const state   = req.query.state;
        let userId    = null;
        let socketId  = null;

        if (state && pendingSteamLinks.has(state)) {
            const entry = pendingSteamLinks.get(state);
            pendingSteamLinks.delete(state);

            if (entry.expiresAt > Date.now()) {
                userId   = entry.userId;
                socketId = entry.socketId ?? null;
            }
        }

        console.log(`Steam return — userId: ${userId}, steamID: ${steamID}`);

        if (userId && steamID) {
            try {
                await sql.query`
                    IF NOT EXISTS (SELECT 1 FROM user_steam_accounts WHERE user_id = ${userId} AND steam_id = ${steamID})
                    INSERT INTO user_steam_accounts (user_id, steam_id) VALUES (${userId}, ${steamID})
                `;
                console.log(`✅ Linked Steam ${steamID} to user ${userId}`);
            } catch (err) {
                console.error('Failed to persist Steam account link:', err.message);
            }
        }

        // Always use the live socket from userSockets — stored socketId may be stale
        const targetSocket = userSockets.get(String(userId));
        if (targetSocket) {
            io.to(targetSocket).emit('steam-auth-success', { steamID, userId });
        } else {
            console.log(`No active socket found for userId ${userId}`);
        }

        res.send('<h2>Steam login successful! You can close this tab.</h2>');
    },
);

// Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ status: 'error', message: 'Email and password required' });

    try {
        const result = await sql.query`
            SELECT id, username, email, password_hash, two_fa_enabled, two_fa_secret
            FROM users WHERE email = ${email}
        `;

        if (!result.recordset.length)
            return res.status(401).json({ status: 'error', message: 'User not found' });

        const user = result.recordset[0];
        const passwordOk = await bcrypt.compare(password, user.password_hash);
        if (!passwordOk)
            return res.status(401).json({ status: 'error', message: 'Invalid password' });

        // 2FA enabled — ask for code
        if (user.two_fa_enabled) {
            return res.json({ status: '2fa_required', email: user.email });
        }

        // 2FA not enabled — issue JWT directly
        const jwtToken = jwt.sign(
            { userId: user.id, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        return res.json({
            status: 'success',
            token: jwtToken,
            user: { id: user.id, username: user.username, email: user.email },
        });

    } catch (err) {
        console.error('Error in /login:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

app.post('/verify-2fa', async (req, res) => {
    const token = req.body.token?.replace(/\D/g, '');
    const { email } = req.body;  // ← client sends this, no session needed

    console.log('🔐 /verify-2fa | email:', email, '| token:', token);

    if (!email)
        return res.status(400).json({ status: 'error', message: 'Missing email' });
    if (!token || token.length !== 6)
        return res.status(400).json({ status: 'error', message: 'Enter a 6-digit code' });

    try {
        const result = await sql.query`
            SELECT id, username, email, two_fa_secret, two_fa_enabled
            FROM users WHERE email = ${email}
        `;

        if (!result.recordset.length)
            return res.status(400).json({ status: 'error', message: 'User not found' });

        const user = result.recordset[0];

        if (!user.two_fa_secret)
            return res.status(400).json({ status: 'error', message: 'No 2FA secret found — please log in again' });

        const verified = speakeasy.totp.verify({
            secret:   user.two_fa_secret,
            encoding: 'base32',
            token,
            window:   1,
        });

        console.log('   speakeasy result:', verified);

        if (!verified)
            return res.status(401).json({ status: 'error', message: 'Invalid code' });

        // First-time: flip the enabled flag
        if (!user.two_fa_enabled) {
            await sql.query`UPDATE users SET two_fa_enabled = 1 WHERE id = ${user.id}`;
        }

        // Issue JWT — no session needed
        const jwtToken = jwt.sign(
            { userId: user.id, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log('✅ 2FA verified, JWT issued for', user.email);
        res.json({
            status: 'success',
            token: jwtToken,
            user: { id: user.id, username: user.username, email: user.email },
        });

    } catch (err) {
        console.error('Error in /verify-2fa:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Optional 2FA setup (called from settings)
app.post('/setup-2fa', requireAuth, async (req, res) => {
    try {
        const result = await sql.query`SELECT id, email, two_fa_enabled FROM users WHERE id = ${req.user.userId}`;
        if (!result.recordset.length)
            return res.status(404).json({ status: 'error', message: 'User not found' });

        const user = result.recordset[0];
        if (user.two_fa_enabled)
            return res.status(400).json({ status: 'error', message: '2FA is already enabled' });

        const secret = speakeasy.generateSecret({ name: `GameScope (${user.email})` });
        await sql.query`UPDATE users SET two_fa_secret = ${secret.base32} WHERE id = ${user.id}`;
        const qrCode = await QRCode.toDataURL(secret.otpauth_url);
        res.json({ status: '2fa_setup', email: user.email, qrCode });
    } catch (err) {
        console.error('Error in /setup-2fa:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Disable 2FA
app.post('/disable-2fa', requireAuth, async (req, res) => {
    try {
        await sql.query`UPDATE users SET two_fa_enabled = 0, two_fa_secret = NULL WHERE id = ${req.user.userId}`;
        res.json({ status: 'success', message: '2FA disabled' });
    } catch (err) {
        console.error('Error in /disable-2fa:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
        return res.status(400).json({ status: 'error', message: 'All fields required' });
    if (password.length < 6)
        return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });

    try {
        // Check for existing email or username
        const existing = await sql.query`
            SELECT id FROM users WHERE email = ${email} OR username = ${username}
        `;
        if (existing.recordset.length)
            return res.status(409).json({ status: 'error', message: 'Email or username already taken' });

        const password_hash = await bcrypt.hash(password, 12);

        await sql.query`
            INSERT INTO users (username, email, password_hash)
            VALUES (${username}, ${email}, ${password_hash})
        `;

        res.json({ status: 'success', message: 'Account created successfully' });

    } catch (err) {
        console.error('Error in /signup:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

app.post('/logout', (_req, res) => {
    res.json({ success: true });
});

app.get('/me', async (req, res) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.json({ authenticated: false });
    }
    try {
        const decoded = jwt.verify(header.slice(7), JWT_SECRET);
        // Fetch live two_fa_enabled flag from DB so settings page reflects reality
        const result = await sql.query`
            SELECT two_fa_enabled FROM users WHERE id = ${decoded.userId}
        `;
        const two_fa_enabled = result.recordset[0]?.two_fa_enabled ?? false;
        res.json({ authenticated: true, user: { ...decoded, two_fa_enabled } });
    } catch {
        res.json({ authenticated: false });
    }
});

// Steam library
app.post('/getSteamLib', async (req, res) => {
    const { steamId, userId } = req.body;

    console.log(`the steamID: ${steamId} and the user: ${userId}`);

    if (!steamId || !userId) {
        return res.status(400).json({ error: 'Missing steamId or userId' });
    }

    try {
        const response = await fetch(
            `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&appids_filter=0`,
        );
        const data = await response.json();

        if (!data.response?.games) {
            return res.status(404).json({ error: 'No games found for this Steam ID' });
        }

        const games = data.response.games;
        console.log(`found ${games.length} games...`);

        // Batched approach: process in chunks of 50 to reduce round-trips
        const BATCH_SIZE = 50;
        for (let i = 0; i < games.length; i += BATCH_SIZE) {
            const batch = games.slice(i, i + BATCH_SIZE);

            // Upsert games in batch using Promise.all for concurrent execution
            await Promise.all(batch.map(game => sql.query`
                IF NOT EXISTS (SELECT 1 FROM games WHERE steam_appid = ${game.appid})
                INSERT INTO games (steam_appid, game_name)
                VALUES (${game.appid}, ${game.name})
            `));

            // Fetch all game IDs for this batch in one query.
            // mssql tagged templates treat the whole interpolation as one param,
            // so a joined string won't work for IN — use a typed Request instead.
            const appIds = batch.map(g => g.appid);
            const inReq = new sql.Request();
            appIds.forEach((id, idx) => inReq.input(`id${idx}`, sql.Int, id));
            const paramList = appIds.map((_, idx) => `@id${idx}`).join(', ');
            const idResult = await inReq.query(
                `SELECT id, steam_appid FROM games WHERE steam_appid IN (${paramList})`
            );
            const idMap = new Map(idResult.recordset.map(r => [r.steam_appid, r.id]));

            // Batch insert into user_library concurrently
            await Promise.all(batch.map(async (game) => {
                const gameId = idMap.get(game.appid);
                if (!gameId) return;
                await sql.query`
                    IF NOT EXISTS (
                        SELECT 1 FROM user_library
                        WHERE user_id = ${userId} AND game_id = ${gameId}
                    )
                    INSERT INTO user_library (user_id, game_id, platform, play_time_mins)
                    VALUES (${userId}, ${gameId}, 'steam', ${game.playtime_forever})
                `;
            }));

            console.log(`Processed ${Math.min(i + BATCH_SIZE, games.length)}/${games.length} Steam games`);
        }

        res.json({ success: true, totalGames: games });

        // Notify the user's socket that library is ready to reload
        const userSocketId = userSockets.get(String(userId));
        if (userSocketId) {
            io.to(userSocketId).emit('library-sync-complete', { userId });
        }
    } catch (err) {
        console.error('Error in /getSteamLib:', err);
        res.status(500).json({ error: 'Failed to save Steam library', details: err.message });
    }
});

// Epic library
app.post('/getEpicLib', async (req, res) => {
    const { EpicGames, userId } = req.body;

    if (!EpicGames || !Array.isArray(EpicGames) || EpicGames.length === 0) {
        return res.status(400).json({ error: 'EpicGames array is required' });
    }

    if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
    }

    try {
        const results = [];

        for (let i = 0; i < EpicGames.length; i += EPIC_BATCH_SIZE) {
            const batch        = EpicGames.slice(i, i + EPIC_BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map((game) => resolveGame(game.title, game.developer)),
            );

            // Each resolvedGame is an array — unwrap the first element
            for (const resolvedArr of batchResults) {
                const resolvedGame = Array.isArray(resolvedArr) ? resolvedArr[0] : resolvedArr;
                
                // console.log(resolvedGame);
                if (!resolvedGame) {
                    console.log(`Skipping — no match found`);
                    continue;
                }

                // Handle both shapes: { appid } and { steam_appid }
                const steamAppId = resolvedGame.appid ?? resolvedGame.steam_appid ?? null;
                const gameName   = resolvedGame.name  ?? resolvedGame.game_name   ?? null;

                if (!steamAppId || !gameName) {
                    console.log(`Skipping — missing appid or name for:`, resolvedGame);
                    continue;
                }

                if (steamAppId) {
                    await sql.query`
                        IF NOT EXISTS (SELECT 1 FROM games WHERE steam_appid = ${steamAppId})
                        INSERT INTO games (steam_appid, game_name)
                        VALUES (${steamAppId}, ${gameName})
                    `;
                } else {
                    await sql.query`
                        IF NOT EXISTS (SELECT 1 FROM games WHERE game_name = ${gameName})
                        INSERT INTO games (game_name)
                        VALUES (${gameName})
                    `;
                }

                const result = steamAppId
                    ? await sql.query`SELECT id FROM games WHERE steam_appid = ${steamAppId}`
                    : await sql.query`SELECT id FROM games WHERE game_name = ${gameName}`;

                const gameId = result.recordset[0]?.id;
                if (!gameId) continue;

                await sql.query`
                    IF NOT EXISTS (
                        SELECT 1 FROM user_library
                        WHERE user_id = ${userId} AND game_id = ${gameId}
                    )
                    INSERT INTO user_library (user_id, game_id, platform, play_time_mins)
                    VALUES (${userId}, ${gameId}, 'epic', 0)
                `;

                results.push(resolvedGame);
            }

            console.log(`Processed ${Math.min(i + EPIC_BATCH_SIZE, EpicGames.length)}/${EpicGames.length}`);
            if (i + EPIC_BATCH_SIZE < EpicGames.length) await sleep(EPIC_BATCH_DELAY);
        }

        res.json({ success: true, results });
    } catch (err) {
        console.error('Error in /getEpicLib:', err);
        res.status(500).json({ error: 'Failed to process Epic library', details: err.message });
    }
});

app.post('/userLibrary', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, error: "Missing userId" });
        }

        const result = await sql.query`
            SELECT 
                g.game_name AS name, 
                g.steam_appid AS GameID, 
                ul.play_time_mins AS playtime_forever, 
                ul.platform AS source
            FROM user_library AS ul
            INNER JOIN games AS g 
                ON ul.game_id = g.id
            WHERE ul.user_id = ${userId}
            ORDER BY ul.platform ASC
        `;

        console.log("sql response:", result);
        res.json({ success: true, result: result.recordset });

    } catch (error) {
        console.error("Database Query Error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

// Linked Steam accounts
app.get('/getLinkedAccounts', requireAuth, async (req, res) => {
    try {
        console.log(`Fetching Steam accounts for userId: ${req.user.userId}`);
        const result = await sql.query`
            SELECT steam_id FROM user_steam_accounts WHERE user_id = ${req.user.userId}
        `;
        const steamIds = result.recordset.map(r => r.steam_id);
        console.log(`Found ${steamIds.length} Steam accounts`);
        res.json({ success: true, steamIds });
    } catch (err) {
        console.error('Error in /getLinkedAccounts:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch linked accounts' });
    }
});

// Unlink a Steam account
app.post('/unlinkSteamAccount', requireAuth, async (req, res) => {
    const { steamId } = req.body;
    if (!steamId) return res.status(400).json({ success: false, error: 'Missing steamId' });
    try {
        await sql.query`
            DELETE FROM user_steam_accounts
            WHERE user_id = ${req.user.userId} AND steam_id = ${steamId}
        `;
        res.json({ success: true });
    } catch (err) {
        console.error('Error in /unlinkSteamAccount:', err);
        res.status(500).json({ success: false, error: 'Failed to unlink account' });
    }
});

// games data endpoints
app.get('/trending', async (_req, res) => {
    try {
        const response = await fetch(
            'https://store.steampowered.com/search/results/?query&start=0&count=20&sort_by=_ASC&filter=popularnew&os=win&nopackages=1&json=1&cc=us',
        );
        const data = await response.json();
        res.json({ status: 'success', trending: data?.items ?? [] });
    } catch (err) {
        console.error('Error in /trending:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch trending games' });
    }
});

app.get('/free', async (_req, res) => {
    try {
        const response = await fetch('https://www.gamerpower.com/api/giveaways?type=game&platform=pc');
        const data     = await response.json();
        res.json({ status: 'success', free: data ?? [] });
    } catch (err) {
        console.error('Error in /free:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch free games' });
    }
});

app.get('/sales', async (_req, res) => {
    try {
        const response = await fetch('https://store.steampowered.com/api/featuredcategories?cc=us');
        const data     = await response.json();
        res.json({ status: 'success', sale: data?.specials?.items ?? [] });
    } catch (err) {
        console.error('Error in /sales:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch sale games' });
    }
});

app.get('/topsellers', async (_req, res) => {
    try {
        const response = await fetch(
            'https://store.steampowered.com/search/results/?query&start=0&count=20&sort_by=Revenue+DESC&os=win&nopackages=1&json=1&cc=us',
        );
        const data = await response.json();
        res.json({ status: 'success', items: data?.items ?? [] });
    } catch (err) {
        console.error('Error in /topsellers:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch top sellers' });
    }
});

app.get('/toprated', async (_req, res) => {
    try {
        const response = await fetch(
            'https://store.steampowered.com/search/results/?query&start=0&count=20&sort_by=Reviews_DESC&os=win&nopackages=1&json=1&cc=us',
        );
        const data = await response.json();
        res.json({ status: 'success', items: data?.items ?? [] });
    } catch (err) {
        console.error('Error in /toprated:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch top rated' });
    }
});

app.get('/newrelease', async (_req, res) => {
    try {
        const response = await fetch(
            'https://store.steampowered.com/search/results/?query&start=0&count=20&sort_by=Released_DESC&os=win&nopackages=1&json=1&cc=us',
        );
        const data = await response.json();
        res.json({ status: 'success', items: data?.items ?? [] });
    } catch (err) {
        console.error('Error in /newrelease:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch new releases' });
    }
});

app.get('/upcoming', async (_req, res) => {
    try {
        const response = await fetch(
            'https://store.steampowered.com/search/results/?query&start=0&count=20&sort_by=Coming_Soon&os=win&nopackages=1&json=1&cc=us',
        );
        const data = await response.json();
        res.json({ status: 'success', items: data?.items ?? [] });
    } catch (err) {
        console.error('Error in /upcoming:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch upcoming games' });
    }
});
app.post('/getGameDetails', async (req, res) => {
    const { appId } = req.body;
    if (!appId) return res.status(400).json({ status: 'error', message: 'appId is required' });

    try {
        const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us`);
        const data     = await response.json();

        const gameData = data[appId]?.data;
        if (!gameData) {
            return res.json({ status: 'success', gameDetails: null, tags: [], recommendations: { recommendations: [] } });
        }

        const desc   = getCleanDescription(gameData.detailed_description || '');
        const genres = (gameData.genres || []).map(g => g.description);
        const tags   = await getSteamTags(appId);

        let recommendation_data = { recommendations: [] };
        try {
            const recommendation_response = await fetch(`${PYTHON_SERVICE_URL}/recommend_by_description`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ description: desc, genres: genres, tags: tags }),
            });
            recommendation_data = await recommendation_response.json();
        } catch (recErr) {
            console.error('Recommendation service unavailable:', recErr.message);
        }

        console.log(recommendation_data);
        res.json({ status: 'success', gameDetails: gameData, tags: tags, recommendations: recommendation_data });
    } catch (err) {
        console.error('Error in /getGameDetails:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch game details' });
    }
});

app.post('/getGameReviews', async (req, res) => {
    const { appId } = req.body;
    if (!appId) return res.status(400).json({ status: 'error', message: 'appId is required' });

    try {
        const response = await fetch(`https://store.steampowered.com/appreviews/${appId}?json=1&cc=us`);
        const data     = await response.json();
        res.json({ status: 'success', reviews: data ?? null });
    } catch (err) {
        console.error('Error in /getGameReviews:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch game reviews' });
    }
});

app.post('/searchGame', async (req, res) => {
    const { term } = req.body;
    if (!term) return res.status(400).json({ status: 'error', message: 'Search term is required' });

    try {
        const response = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us`);
        const data     = await response.json();
        const results  = data.items ?? [];

        const blacklist = ['soundtrack', 'artbook', 'digital artbook', 'dlc', 'expansion', 'season pass'];
        const filteredResults = results.filter(item => {
            const name = item.name.toLowerCase();
            const isTrash = blacklist.some(word => name.includes(word));

            return !isTrash;
        });

        res.json({ status: 'success', filteredResults });
    } catch (err) {
        console.error('Error in /searchGame:', err);
        res.status(500).json({ status: 'error', message: 'Failed to search games' });
    }
});

// Recommendations
app.post('/recommend', async (req, res) => {
    const { games } = req.body;

    if (!Array.isArray(games) || games.length === 0) {
        return res.status(400).json({
            status:  'error',
            message: 'games array is required',
            example: { games: ['Hollow Knight', 'Celeste'] },
        });
    }

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const response = await fetch(`${PYTHON_SERVICE_URL}/recommend`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ library: games }),
            signal:  controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Python service error:', errorText);
            return res.status(response.status).json({
                status:  'error',
                message: 'Recommendation service error',
                details: errorText,
            });
        }

        const pythonResponse = await response.json();

        const recommendations = pythonResponse.map((game) => ({
            GameID:          game.AppID,
            Name:            game.Name,
            image:           game.game_image,
            match_score:     game.score,
            positive_reviews: game.actual_positive,
            negative_reviews: game.actual_negative,
            total_reviews:   game.total_reviews,
            positive_ratio:  game.positive_ratio,
        }));

        console.log(`Returning ${recommendations.length} recommendations`);
        res.json({ status: 'success', recommendations: recommendations });
    } catch (err) {
        clearTimeout(timeoutId);
        console.error('Error in /recommend:', err);

        if (err.name === 'AbortError') {
            return res.status(504).json({
                status:  'error',
                message: 'Request timed out — recommendation service took too long',
            });
        }

        if (err.code === 'ECONNREFUSED') {
            return res.status(503).json({
                status:  'error',
                message: 'Recommendation service unavailable — make sure Flask is running on port 5000',
            });
        }

        res.status(500).json({ status: 'error', message: 'Failed to get recommendations', details: err.message });
    }
});

// Submit a review
app.post('/submitReview', requireAuth, async (req, res) => {
    const { gameId, rating, body } = req.body;
    const userId = req.user.userId;

    if (!gameId || !rating || !body) {
        return res.status(400).json({ success: false, error: 'Missing gameId, rating, or body' });
    }

    try {
        const gameResult = await sql.query`
            SELECT id FROM games WHERE steam_appid = ${gameId}
        `;
        const internalGameId = gameResult.recordset[0]?.id;
        if (!internalGameId) {
            return res.status(404).json({ success: false, error: 'Game not found in database' });
        }

        const existing = await sql.query`
            SELECT id FROM reviews WHERE user_id = ${userId} AND game_id = ${internalGameId}
        `;
        if (existing.recordset.length > 0) {
            return res.status(409).json({ success: false, error: 'You have already reviewed this game' });
        }

        await sql.query`
            INSERT INTO reviews (user_id, game_id, rating, body)
            VALUES (${userId}, ${internalGameId}, ${rating}, ${body})
        `;

        res.json({ success: true });
    } catch (err) {
        console.error('Error in /submitReview:', err);
        res.status(500).json({ success: false, error: 'Failed to save review' });
    }
});

// Get local (DB) reviews for a game
app.post('/getLocalReviews', async (req, res) => {
    const { appId } = req.body;
    if (!appId) return res.status(400).json({ success: false, error: 'Missing appId' });

    try {
        const result = await sql.query`
            SELECT 
                r.id, r.rating, r.body, r.likes, r.created_at,
                u.username
            FROM reviews r
            INNER JOIN users u ON r.user_id = u.id
            INNER JOIN games g ON r.game_id = g.id
            WHERE g.steam_appid = ${appId}
            ORDER BY r.created_at DESC
        `;
        res.json({ success: true, reviews: result.recordset });
    } catch (err) {
        console.error('Error in /getLocalReviews:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch local reviews' });
    }
});

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Error Handlers ───────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ status: 'error', message: 'Not found' });
});

app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
    await connectDB();
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log(`Python service URL: ${PYTHON_SERVICE_URL}`);
    });
})();
