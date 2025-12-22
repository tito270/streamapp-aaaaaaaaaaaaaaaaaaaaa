const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const usersFilePath = path.join(__dirname, 'users.json');

async function createAdmin() {
    const username = 'admin';
    const password = '123456';
    const role = 'admin';

    const hashedPassword = await bcrypt.hash(password, 10);

    const users = {
        [username]: {
            password: hashedPassword,
            role: role
        }
    };

    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
    console.log(`Admin user '${username}' created in ${usersFilePath}`);
}

createAdmin();
