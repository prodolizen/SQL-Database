const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcrypt');
const https = require('https');
const fs = require('fs');

const app = express();
const port = 3000; // 
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
app.post('/create-room', (req, res) => {
    const { roomCode, serverIp } = req.body;
    roomsDB.run(`INSERT INTO rooms (roomCode, serverIp) VALUES (?, ?)`, [roomCode, serverIp], function (err) {
        if (err) res.status(500).send('Error creating room');
        else res.send({ id: this.lastID });
    });
});

app.get('/get-ip/:roomCode', (req, res) => {
    const roomCode = req.params.roomCode;
    roomsDB.get(`SELECT serverIp FROM rooms WHERE roomCode = ?`, [roomCode], (err, row) => {
        if (err) res.status(500).send('Error retrieving room');
        else if (row) res.send({ serverIp: row.serverIp });
        else res.status(404).send('Room not found');
    });
});

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
app.post('/start-dedicated-server', (req, res) => {
    const basePort = 7777;
    const port = basePort + activeServers.length;

    const serverPath = '/home/ubuntu/dedicated_servers/GameServer.x86_64';

    const serverProcess = spawn(serverPath, [-port, port], {
        cwd: '/home/ubuntu/dedicated_servers/',
    });

    serverProcess.stdout.on('data', (data) => {
        console.log('Server stdout: ${ data }');
    });

    serverProcess.stderr.on('data', (data) => {
        console.error('Server stderr: ${ data }');
    });

    const serverInfo = {
        pid: serverProcess.pid,
        ip: 'YOUR-EC2-PUBLIC-IP', // Change this to your EC2 public IP or domain
        port: port
    };

    activeServers.push(serverInfo);
    console.log('Started server at port ${ port }');

    res.json(serverInfo);
});

// Manually register an existing server (e.g., PM2 started)
app.post('/register-dedicated-server', (req, res) => {
    const { ip, port } = req.body;
    if (!ip || !port) return res.status(400).json({ error: 'IP and Port required' });

    activeServers.push({ ip, port });
    console.log('Manually registered server ${ ip }: ${ port }');
    res.json({ message: 'Server registered.' });
});

// List available running servers
app.get('/list-dedicated-servers', (req, res) => {
    res.json(activeServers);
});

// Stop and unregister server
app.post('/stop-dedicated-server', (req, res) => {
    const { pid } = req.body;
    const server = activeServers.find(s => s.pid === pid);

    if (server) {
        try {
            process.kill(pid);
            activeServers = activeServers.filter(s => s.pid !== pid);
            console.log('Stopped server with PID ${ pid }');
res.json({ message: 'Server stopped.' });
        } catch (e) {
    res.status(500).json({ error: 'Failed to stop server' });
}
    } else {
    res.status(404).json({ error: 'Server not found' });
}
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
