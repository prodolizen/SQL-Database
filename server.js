const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Create or open database for server ips and room codes
const roomsDB = new sqlite3.Database('./matchmaking.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Connected to SQLite DB');
    }
});

// create or open DB for account information
const accountDB = new sqlite3.Database('./accounts.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    else {
        console.log('accounts connected to SQL DB')
    }
});

// Create a table for ips and roomcodes if it doesn't exist
roomsDB.run(`
  CREATE TABLE IF NOT EXISTS rooms (
    roomCode INTEGER PRIMARY KEY,
    serverIp TEXT
  )
`);

accountDB.run(`
  CREATE TABLE IF NOT EXISTS accounts (
    username TEXT PRIMARY KEY,
    password TEXT
  )
`);

// Add a new room
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
                res.status(404).send('Room not found hahahahha');
            }
        }
    );
});

app.listen(port, () => {
    console.log(`Matchmaking server running at http://localhost:${port}`);
});

app.delete('/delete-room/:roomCode', (req, res) => {
    const roomCode = parseInt(req.params.roomCode);

    roomsDB.run('DELETE FROM rooms WHERE roomCode = ?', [roomCode], function (err) {
        if (err) {
            console.error(err.message);
            res.status(500).json({ error: 'Failed to delete room' });
        } else {
            res.json({ message: `Room ${roomCode} deleted successfully` });
        }
    });
});

// Register a new user
app.post('/register', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    accountDB.run(
        `INSERT INTO accounts (username, password) VALUES (?, ?)`,
        [username, password],
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

// Log in user
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    accountDB.get(
        `SELECT * FROM accounts WHERE username = ? AND password = ?`,
        [username, password],
        (err, row) => {
            if (err) {
                res.status(500).json({ error: 'Login error' });
            } else if (!row) {
                res.status(401).json({ error: 'Invalid username or password' });
            } else {
                res.json({ message: 'Login successful' });
            }
        }
    );
});


