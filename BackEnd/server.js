const express = require('express');
const cors = require('cors');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const { MongoClient, ServerApiVersion } = require('mongodb');
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
        httpOnly: false, // Prevents client-side JavaScript access to the cookie (security)
        secure: false, // Set to true if using HTTPS (required for production)
        sameSite: 'lax' // Recommended for modern web security
    }
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
    returnURL: 'http://localhost:3000/auth/steam/return',
    realm: 'http://localhost:3000/',
    apiKey: 'AD93D64A61369FD9B96A9CEC4B56FF1C'
}, (identifier, profile, done) => {
    const steamID = profile.id;
    return done(null, profile);
}));

const uri = "mongodb+srv://LeDanzan24:OmarWaleed@cluster0.pirwgdb.mongodb.net/?appName=Cluster0";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function DB_connect(){
    client.connect();
    const db = await client.db('Game_Scope');
    const collection = await db.collection('Users');
    const first = await collection.findOne();
    console.log(first);
}

// DB_connect();
const PORT = process.env.PORT || 3001;
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:5000';
const REQUEST_TIMEOUT = 15000; // 30 seconds

// Middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.post('/login', async (req,res) => {
    console.log('Login endpoint hit!');
    const { email, password } = req.body;
    console.log(`Email: ${email}, Password: ${password}`);

    const user_from_DB = await client.db('Game_Scope').collection('Users').findOne({email: email, passwordHash: password});
    if(user_from_DB != null){
        req.session.user = user_from_DB;
        req.session.save();
        console.log('User logged in:', user_from_DB);
        res.json({status: 'success', message: 'Login successful', user: user_from_DB});
    }
});

app.get('/trending', async (req,res) => {
    console.log('Trending endpoint hit!');
    const response = await fetch(`https://store.steampowered.com/search/results/?query&start=0&count=20&dynamic_data=&sort_by=_ASC&snr=1_7_7_7000_7&filter=popularnew&os=win&nopackages=1&json=1&cc=us`);
    const Data = await response.json();
    console.log('Trending games fetched:', Data);
    const trendingGames = Data?.specials?.items || [];
    res.json({ status: 'success', trending: trendingGames });
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

app.post('/getSteamLib', async (req, res) => {
    console.log('GetSteamLib endpoint hit!');

    const { steamId } = req.body;

    if (!steamId) {
        return res.status(400).json({ error: "Missing steamId" });
    }

    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=AD93D64A61369FD9B96A9CEC4B56FF1C&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        const games = data.response?.games || [];

        const transformedResponse = {
            status: 'success',
            recommendations: games.map(game => ({
                GameID: game.appid,
                Name: game.name,
                playtime_forever: game.playtime_forever,
                image: game.img_icon_url
            }))
        };

        res.json(transformedResponse);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Steam API failed" });
    }
});

app.post("/searchGame", async (req, res) => {
    const term = req.body.term;
    console.log(`SearchGame endpoint hit with term: ${term}`);
    const response = await fetch(`https://store.steampowered.com/api/storesearch/?term=${term}&cc=us`);
    const data = await response.json();
    console.log(data);

    const IDs = data.items.map(item => item.id);

    // 👇 Match key name with Flask
    const responsePython = await fetch(`${PYTHON_SERVICE_URL}/searchGames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appIds: IDs }) // was listIDs before
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
    
    // Validation
    if (!games || !Array.isArray(games) || games.length === 0) {
        return res.status(400).json({ 
            status: 'error',
            message: 'games array is required',
            example: { games: ["Hollow Knight", "Celeste"] }
        });
    }
    try {
        // Create abort controller for timeout
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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ status: 'error', message: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Python service URL: ${PYTHON_SERVICE_URL}`);
});
