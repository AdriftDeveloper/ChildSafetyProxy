import express from 'express';
import { authenticateUser, createUser } from '../services/auth';
import { UserRow } from '../models/user';
import { typedDb } from '../database/db';


export const authRouter = express.Router();

authRouter.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  res.send(`
    <html>
      <body>
        <form method="POST" action="/login">
          <label>Username: <input type="text" name="username" required /></label><br />
          <label>Password: <input type="password" name="password" required /></label><br />
          <button type="submit">Login</button>
        </form>
      </body>
    </html>
  `);
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const isValid = await authenticateUser(username, password);
    if (!isValid) {
      return res.status(401).send('Invalid username or password.');
    }

    req.session.user = { username };
    res.redirect('/');
  } catch (err) {
    return res.status(401).send('Invalid username or password.');
  }
});

authRouter.get('/signup', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  res.send(`
    <html>
      <body>
        <form method="POST" action="/signup">
          <label>Username: <input type="text" name="username" required /></label><br />
          <label>Password: <input type="password" name="password" required /></label><br />
          <button type="submit">Sign Up</button>
        </form>
      </body>
    </html>
  `);
});

authRouter.post('/signup', async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await typedDb.get<UserRow>(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existingUser) {
      return res.status(400).send('Username already taken.');
    }

    await createUser(username, password);
    res.redirect('/login');
  } catch (err) {
    console.error('Error during signup:', err);
    res.status(500).send('Internal server error');
  }
});

authRouter.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});