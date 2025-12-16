const express = require('express');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const router = express.Router();
const usersFilePath = path.join(__dirname, 'users.json');
const JWT_SECRET = 'your_jwt_secret'; // Replace with a strong secret in a real application

// Middleware to verify token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);

        // If user is admin, grant all permissions
        if (user.role === 'admin') {
            user.roles = new Proxy({}, {
                get: function(target, name) {
                    // Always return true for any permission check for admin
                    if (name === Symbol.iterator || name === 'then') {
                        return undefined;
                    }
                    return true;
                }
            });
        }
        
        req.user = user;
        next();
    });
};

// Middleware to check for admin role
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

// Helper function to read users from the JSON file
const readUsers = () => {
    if (!fs.existsSync(usersFilePath)) {
        return {};
    }
    const usersData = fs.readFileSync(usersFilePath);
    return JSON.parse(usersData);
};

// Helper function to write users to the JSON file
const writeUsers = (users) => {
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
};

// User login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();
    const user = users[username];

    if (!user) {
        return res.status(400).json({ message: 'Invalid username or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
        return res.status(400).json({ message: 'Invalid username or password' });
    }

    const userPayload = { username: username, role: user.role, roles: user.roles || {} };
    const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '1h' });
    // Return token and minimal user info so frontend can react immediately after login
    res.json({ token, user: userPayload });
});

// Get all users (admin only)
router.get('/users', authenticateToken, isAdmin, (req, res) => {
    const users = readUsers();
    const usersList = Object.keys(users).map(username => {
        const { password, ...userWithoutPassword } = users[username];
        return { username, ...userWithoutPassword };
    });
    res.json(usersList);
});

// Admin route to create a new user
router.post('/create-user', authenticateToken, isAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    const users = readUsers();

    if (users[username]) {
        return res.status(400).json({ message: 'User already exists' });
    }

    if (!password || password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users[username] = { password: hashedPassword, role: role || 'user', roles: {} };
    writeUsers(users);

    res.status(201).json({ message: 'User created successfully' });
});

// Admin route to update a user's password
router.post('/update-password', authenticateToken, isAdmin, async (req, res) => {
    const { username, password } = req.body;
    const users = readUsers();

    if (!users[username]) {
        return res.status(404).json({ message: 'User not found' });
    }

    if (!password || password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users[username].password = hashedPassword;
    writeUsers(users);

    res.json({ message: 'Password updated successfully' });
});

// Admin route to delete a user
router.delete('/delete-user/:username', authenticateToken, isAdmin, (req, res) => {
    const { username } = req.params;
    const users = readUsers();

    if (!users[username]) {
        return res.status(404).json({ message: 'User not found' });
    }
    
    // Prevent admin from deleting themselves
    if (req.user.username === username) {
        return res.status(400).json({ message: "Cannot delete your own admin account." });
    }

    delete users[username];
    writeUsers(users);

    res.json({ message: 'User deleted successfully' });
});

// Update user roles (admin only)
router.post('/user-roles', authenticateToken, isAdmin, (req, res) => {
    const { username, role, value } = req.body;
    const users = readUsers();

    if (!users[username]) {
        return res.status(404).json({ message: 'User not found' });
    }

    if (!users[username].roles) {
        users[username].roles = {};
    }

    users[username].roles[role] = value;
    writeUsers(users);

    res.json({ message: 'User roles updated successfully' });
});

module.exports = { router, authenticateToken };

