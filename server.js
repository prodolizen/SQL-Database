const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
const port = 3000;
const SALT_ROUNDS = 10;

app.use(cors());
app.use(express.json());

// === DATABASE SETUP === //
const roomsDB = new sqlite3.Database('./matchmaking.db', (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to matchmaking DB');
});

const accountDB = new sqlite3.Database('./accounts.db', (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to accounts DB');
});

// Create tables if they don't exist
roomsDB.run(`
    CREATE TABLE IF NOT EXISTS rooms (
        roomCode INTEGER PRIMARY KEY,
        serverIp TEXT
    )
`);

accountDB.run(`
    CREATE TABLE IF NOT EXISTS accounts (
        username TEXT PRIMARY KEY,
        password TEXT,
        kills INTEGER DEFAULT 0,
        deaths INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0
    )
`);

// === ROOM ROUTES === //

// Create a new room
app.post('/create-room', (req, res) => {
    const { roomCode, serverIp } = req.body;

    roomsDB.run(
        `INSERT INTO rooms (roomCode, serverIp) VALUES (?, ?)`,
        [roomCode, serverIp],
        function (err) {
            if (err) {
                res.status(500).send('Error creating room');
            } else {
                res.send({ id: this.lastID });
            }
        }
    );
});

// Get IP by room code
app.get('/get-ip/:roomCode', (req, res) => {
    const roomCode = req.params.roomCode;

    roomsDB.get(
        `SELECT serverIp FROM rooms WHERE roomCode = ?`,
        [roomCode],
        (err, row) => {
            if (err) {
                res.status(500).send('Error retrieving room');
            } else if (row) {
                res.send({ serverIp: row.serverIp });
            } else {
                res.status(404).send('Room not found');
            }
        }
    );
});

// Delete a room
app.delete('/delete-room/:roomCode', (req, res) => {
    const roomCode = parseInt(req.params.roomCode);

    roomsDB.run(`DELETE FROM rooms WHERE roomCode = ?`, [roomCode], function (err) {
        if (err) {
            res.status(500).json({ error: 'Failed to delete room' });
        } else {
            res.json({ message: `Room ${roomCode} deleted successfully` });
        }
    });
});

// === ACCOUNT ROUTES === //

// Register user
app.post('/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    bcrypt.hash(password, SALT_ROUNDS, (err, hash) => {
        if (err) {
            return res.status(500).json({ error: 'Error hashing password' });
        }

        accountDB.run(
            `INSERT INTO accounts (username, password) VALUES (?, ?)`,
            [username, hash],
            function (err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        res.status(409).json({ error: 'Username already exists' });
                    } else {
                        res.status(500).json({ error: 'Failed to register user' });
                    }
                } else {
                    res.json({ message: 'User registered successfully' });
                }
            }
        );
    });
});

// Login user
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    accountDB.get(`SELECT * FROM accounts WHERE username = ?`, [username], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Login error' });
        }

        if (!row) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        bcrypt.compare(password, row.password, (err, result) => {
            if (err || !result) {
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            res.json({ message: 'Login successful' });
        });
    });
});

// Update user statistics
app.post('/update-stats', (req, res) => {
    const { username, kills, deaths, wins, losses } = req.body;

    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    accountDB.run(
        `
        UPDATE accounts SET
            kills = kills + ?,
            deaths = deaths + ?,
            wins = wins + ?,
            losses = losses + ?
        WHERE username = ?
        `,
        [kills || 0, deaths || 0, wins || 0, losses || 0, username],
        function (err) {
            if (err) {
                res.status(500).json({ error: 'Failed to update stats' });
            } else {
                res.json({ message: 'Stats updated successfully' });
            }
        }
    );
});

// Get user statistics
app.get('/stats/:username', (req, res) => {
    const username = req.params.username;

    accountDB.get(
        `SELECT kills, deaths, wins, losses FROM accounts WHERE username = ?`,
        [username],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: 'Error fetching stats' });
            } else if (!row) {
                return res.status(404).json({ error: 'User not found' });
            }

            const { kills, deaths, wins, losses } = row;
            const kd = deaths === 0 ? kills : (kills / deaths).toFixed(2);
            const wl = losses === 0 ? wins : (wins / losses).toFixed(2);

            res.json({
                kills,
                deaths,
                wins,
                losses,
                kd,
                winLoss: wl
            });
        }
    );
});

// === START SERVER === //
app.listen(port, () => {
    console.log(`Matchmaking server running at http://localhost:${port}`);
});
