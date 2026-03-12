const express = require('express');
const cors = require('cors');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const sql = require('mssql/msnodesqlv8');
const session = require('express-session');
// const color_theif = require('color-thief-node');

const app = express();
app.use(cors());
app.use(express.json());
app.use(session({
    secret: 'some-random-secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        httpOnly: false,
        secure: false,
        sameSite: 'lax'
    }
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
    returnURL: 'http://localhost:3000/auth/steam/return',
    realm: 'http://localhost:3000/',
    apiKey: 'ADD_API_KEY_HERE'
}, (identifier, profile, done) => {
    const steamID = profile.id;
    return done(null, profile);
}));

const config = {
    connectionString: "Driver={ODBC Driver 17 for SQL Server};Server=Yassen;Database=gameScope;Trusted_Connection=Yes;"
};
sql.connect(config)
.then(() => {
    console.log("Connected to MSSQL ✅");
    return sql.query`SELECT TOP 5 * FROM users`; // just a quick test
})
.then(result => {
    console.log(result.recordset); // should print some rows
})
.catch(err => console.error(err));

const PORT = process.env.PORT || 3001;
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5000';
const REQUEST_TIMEOUT = 15000; // 15 seconds

// Middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.post('/login', async (req,res) => {
    console.log('Login endpoint hit!');
    const {email,password} = req.body;

  const result = await sql.query`
    SELECT * FROM users
    WHERE email = ${email}
    AND password = ${password}
  `;

  if(result.recordset.length > 0){

    res.json({
      success:true,
      user: result.recordset[0]
    });

  } else {

    res.json({
      success:false,
      message:"Invalid credentials"
    });

  }
});

app.post('/getSteamLib', async (req, res) => {
    const { steamId, userId = 4 } = req.body;
    console.log('getSteamLib endpoint hit with steamId:', steamId, 'and userId:', userId);
    if (!steamId || !userId) {
        return res.status(400).json({ error: "Missing steamId or userId" });
    }

    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=AD93D64A61369FD9B96A9CEC4B56FF1C&steamid=${steamId}&include_appinfo=1`;

    try {
        const response = await fetch(url);

        // Check if Steam returned JSON
        // const contentType = response.headers.get('content-type') || '';
        // if (!contentType.includes('application/json')) {
        //     const text = await response.text();
        //     console.error('Steam API returned non-JSON:', text);
        //     return res.status(502).json({
        //         error: "Steam API returned invalid response",
        //         details: text
        //     });
        // }

        const data = await response.json();

        // Ensure the response has games
        if (!data.response || !data.response.games) {
            return res.status(404).json({
                error: "No games found for this Steam ID"
            });
        }

        const games = data.response.games;

        for (const game of games) {
            // Insert game if not exists
            await sql.query`
                IF NOT EXISTS (SELECT 1 FROM games WHERE steam_appid = ${game.appid})
                INSERT INTO games (steam_appid, game_name)
                VALUES (${game.appid}, ${game.name})
            `;

            // Get internal game id
            const result = await sql.query`
                SELECT id FROM games WHERE steam_appid = ${game.appid}
            `;
            const gameId = result.recordset[0].id;

            // Insert user-game relation
            await sql.query`
                IF NOT EXISTS (
                    SELECT 1 FROM user_game
                    WHERE user_id = ${userId} AND game_id = ${gameId}
                )
                INSERT INTO user_game (user_id, game_id, platform, play_time)
                VALUES (${userId}, ${gameId}, 'steam', ${game.playtime_forever})
            `;
        }

        res.json({
            success: true,
            totalGames: games
        });

    } catch (err) {
        console.error('Error in /getSteamLib:', err);
        res.status(500).json({
            error: "Failed to save Steam library",
            details: err.message
        });
    }
});

app.get('/trending', async (req,res) => {
    console.log('Trending endpoint hit!');
    const response = await fetch(`https://store.steampowered.com/search/results/?query&start=0&count=20&dynamic_data=&sort_by=_ASC&snr=1_7_7_7000_7&filter=popularnew&os=win&nopackages=1&json=1&cc=us`);
    const Data = await response.json();
    const trendingGames = Data?.items || [];
    console.log('Trending games fetched:', trendingGames);
    res.json({ status: 'success', trending: trendingGames });
});

app.get('/sales', async (req,res) => {
    console.log('Sale endpoint hit!');
    const response = await fetch(`https://store.steampowered.com/api/featuredcategories?cc=us`);
    const Data = await response.json();
    const saleGames = Data?.specials?.items || [];
    console.log('Sale games fetched:', saleGames);
    res.json({ status: 'success', sale: saleGames });
});

app.post('/getGameDetails', async (req,res) => {
    console.log('GetGameDetails endpoint hit!');
    const { appId } = req.body;
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us`);
    const Data = await response.json();
    console.log('Game details fetched:', Data);
    const gameD = Data[appId]?.data;
    res.json({ status: 'success', gameDetails: gameD||null });
});

app.post('/getGameReviews', async (req,res) => {
    console.log('GetGameReviews endpoint hit!');
    const { appId } = req.body;
    const response = await fetch(`https://store.steampowered.com/appreviews/${appId}?json=1&cc=us`);
    const Data = await response.json();
    console.log('Game reviews fetched:', Data);
    res.json({ status: 'success', reviews: Data||null });
});

app.post("/searchGame", async (req, res) => {
    const term = req.body.term;
    console.log(`SearchGame endpoint hit with term: ${term}`);
    const response = await fetch(`https://store.steampowered.com/api/storesearch/?term=${term}&cc=us`);
    const data = await response.json();
    console.log(data);

    const IDs = data.items.map(item => item.id);

    const responsePython = await fetch(`${PYTHON_SERVICE_URL}/searchGames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appIds: IDs })
    });

    const dataPython = await responsePython.json();

    const transformedResponse = {
        status: 'success',
        recommendations: dataPython.map(game => ({
            GameID: game.AppID,
            Name: game.Name,
            image: game.game_image,
            match_score: game.score,
            positive_reviews: game.actual_positive,
            negative_reviews: game.actual_negative,
            total_reviews: game.total_reviews,
            positive_ratio: game.positive_ratio
        }))
    };

    res.json(transformedResponse);
});


app.post('/recommend', async (req, res) => {
    console.log('Recommend endpoint hit!');
    console.log('Request body:', req.body);
    
    const { games } = req.body;
    
    if (!games || !Array.isArray(games) || games.length === 0) {
        return res.status(400).json({ 
            status: 'error',
            message: 'games array is required',
            example: { games: ["Hollow Knight", "Celeste"] }
        });
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        
        const response = await fetch(`${PYTHON_SERVICE_URL}/recommend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ library: games }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Python service error:', errorText);
            return res.status(response.status).json({ 
                status: 'error',
                message: 'Recommendation service error',
                details: errorText
            });
        }
        
        const pythonResponse = await response.json();
        console.log('Python response received, transforming...');
        
        // Transform the response to match frontend expectations
        const transformedResponse = {
            status: 'success',
            recommendations: pythonResponse.map(game => ({
                GameID: game.AppID,
                Name: game.Name,
                image: game.game_image,
                match_score: game.score,
                positive_reviews: game.actual_positive,
                negative_reviews: game.actual_negative,
                total_reviews: game.total_reviews,
                positive_ratio: game.positive_ratio
            }))
        };
        
        console.log(`Returning ${transformedResponse.recommendations.length} recommendations`);
        res.json(transformedResponse);
        
    } catch (error) {
        console.error('Error calling Python service:', error);
        
        if (error.name === 'AbortError') {
            return res.status(504).json({ 
                status: 'error',
                message: 'Request timeout - the recommendation service took too long to respond'
            });
        }
        
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ 
                status: 'error',
                message: 'Service unavailable - could not connect to recommendation service. Make sure Flask is running on port 5000.'
            });
        }
        
        res.status(500).json({ 
            status: 'error',
            message: 'Failed to get recommendations',
            details: error.message
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
    res.status(404).json({ status: 'error', message: 'Not found' });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Python service URL: ${PYTHON_SERVICE_URL}`);
});