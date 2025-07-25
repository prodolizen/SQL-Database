﻿//module import requirements
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const https = require('https');
const fs = require('fs');

const app = express();
const port = 3000; // 
const SALT_ROUNDS = 10; //number of rounds for password hashing

app.use(cors());
app.use(express.json()); //parse json bodies

// === DATABASE SETUP === //

//create matchmaking database
const roomsDB = new sqlite3.Database('./matchmaking.db', (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to matchmaking DB');
});

//create accounts database
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

//create a room and fill correct rows in DB 
app.post('/create-room', (req, res) => {
    const { roomCode, serverIp } = req.body;
    roomsDB.run(`INSERT INTO rooms (roomCode, serverIp) VALUES (?, ?)`, [roomCode, serverIp], function (err) {
        if (err) res.status(500).send('Error creating room');
        else res.send({ id: this.lastID });
    });
});

//search for roomcode and retrieve linked serverip
app.get('/get-ip/:roomCode', (req, res) => {
    const roomCode = req.params.roomCode;
    roomsDB.get(`SELECT serverIp FROM rooms WHERE roomCode = ?`, [roomCode], (err, row) => {
        if (err) res.status(500).send('Error retrieving room');
        else if (row) res.send({ serverIp: row.serverIp });
        else res.status(404).send('Room not found');
    });
});

//remove the row containing a specified roomccode from the database
app.delete('/delete-room/:roomCode', (req, res) => {
    const roomCode = parseInt(req.params.roomCode);
    roomsDB.run(`DELETE FROM rooms WHERE roomCode = ?`, [roomCode], function (err) {
        if (err) res.status(500).json({ error: 'Failed to delete room' });
        else res.json({ message: `Room ${roomCode} deleted successfully` });
    });
});

// === ACCOUNT ROUTES === //
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    //hash pwd before saving to db 
    bcrypt.hash(password, SALT_ROUNDS, (err, hash) => {
        if (err) return res.status(500).json({ error: 'Error hashing password' });

        accountDB.run(`INSERT INTO accounts (username, password) VALUES (?, ?)`, [username, hash], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE')) res.status(409).json({ error: 'Username already exists' });
                else res.status(500).json({ error: 'Failed to register user' });
            } else {
                res.json({ message: 'User registered successfully' });
            }
        });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    accountDB.get(`SELECT * FROM accounts WHERE username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ error: 'Login error' });
        if (!row) return res.status(401).json({ error: 'Invalid username or password' });

        //compare provided password with hashed password
        bcrypt.compare(password, row.password, (err, result) => {
            if (err || !result) return res.status(401).json({ error: 'Invalid username or password' });
            res.json({ message: 'Login successful' });
        });
    });
});

app.post('/update-stats', (req, res) => {
    const { username, kills, deaths, wins, losses } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    accountDB.run(`
        UPDATE accounts SET
            kills = kills + ?,
            deaths = deaths + ?,
            wins = wins + ?,
            losses = losses + ?
        WHERE username = ?
    `, [kills || 0, deaths || 0, wins || 0, losses || 0, username], function (err) {
        if (err) res.status(500).json({ error: 'Failed to update stats' });
        else res.json({ message: 'Stats updated successfully' });
    });
});

app.get('/stats/:username', (req, res) => {
    const username = req.params.username;
    accountDB.get(`SELECT kills, deaths, wins, losses FROM accounts WHERE username = ?`, [username], (err, row) => {
        if (err) return res.status(500).json({ error: 'Error fetching stats' });
        if (!row) return res.status(404).json({ error: 'User not found' });

        const { kills, deaths, wins, losses } = row;
        const kd = deaths === 0 ? kills : (kills / deaths).toFixed(2);
        const wl = losses === 0 ? wins : (wins / losses).toFixed(2);

        res.json({ kills, deaths, wins, losses, kd, winLoss: wl });
    });
});

// === DEDICATED SERVER MANAGEMENT === //
let activeServers = [];

// Start a new Unity dedicated server
const { exec } = require('child_process');

app.post('/start-dedicated-server', (req, res) => {
    const cmd = 'pm2 start /home/ubuntu/dedicated_servers/start_server_7777.sh --name unity-server-7777';

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error starting server: ${error.message}`);
            return res.status(500).send('Failed to start server');
        }
        if (stderr) {
            console.error(`stderr: ${stderr}`);
        }

        console.log(`stdout: ${stdout}`);
        const ip = '13.51.167.138';
        const port = 7777;
        const name = 'unity-server-7777';

        // Register in memory
        activeServers.push({ ip, port, name });
        console.log(`Auto-registered server ${name} at ${ip}:${port}`);

        res.json({ ip, port, name });

    });
});


app.post('/register-dedicated-server', (req, res) => {
    const { ip, port, name } = req.body;

    if (!ip || !port || !name)
        return res.status(400).json({ error: 'IP, Port, and Name required' });

    activeServers.push({ ip, port, name });
    console.log(`Registered server ${name} at ${ip}:${port}`);
    res.json({ message: 'Server registered.' });
});


// List available running servers
app.get('/list-dedicated-servers', (req, res) => {
    res.json(activeServers);
});

// Stop and unregister server
app.post('/stop-dedicated-server', (req, res) => {
    const { name } = req.body;

    if (!name) return res.status(400).json({ error: 'Server name is required' });

    // Remove from the activeServers list
    activeServers = activeServers.filter(s => s.name !== name);
    console.log(`Unregistered server: ${name}`);

    // Stop the server with pm2
    exec(`sudo pm2 delete ${name}`, (err, stdout, stderr) => {
        if (err) {
            console.error(`Failed to stop server ${name}: ${stderr}`);
            return res.status(500).json({ error: 'Failed to stop server' });
        }

        console.log(`Stopped server ${name}`);
        res.json({ message: `Server ${name} stopped.` });
    });
});

// Unregister server without killing (optional if needed)
app.post('/unregister-dedicated-server', (req, res) => {
    const { ip, port } = req.body;
    activeServers = activeServers.filter(s => !(s.ip === ip && s.port === port));
    console.log('Unregistered server ${ ip }: ${ port }');
    res.json({ message: 'Server unregistered.' });
});

// === START SECURE HTTPS SERVER === //
const privateKey = fs.readFileSync('/home/ubuntu/certs/privkey.pem', 'utf8');
const certificate = fs.readFileSync('/home/ubuntu/certs/cert.pem', 'utf8');
const ca = fs.readFileSync('/home/ubuntu/certs/chain.pem', 'utf8');

const credentials = { key: privateKey, cert: certificate, ca: ca };

https.createServer(credentials, app).listen(port, () => {
    console.log(`Secure matchmaking server running at https://localhost:${port}`);
});
