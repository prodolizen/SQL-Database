const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Create or open database
const db = new sqlite3.Database('./matchmaking.db', (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Connected to SQLite DB');
    }
});

// Create a table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS rooms (
    roomCode INTEGER PRIMARY KEY,
    serverIp TEXT
  )
`);

// Add a new room
app.post('/create-room', (req, res) => {
    const { roomCode, serverIp } = req.body;

    db.run(
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

    db.get(
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
