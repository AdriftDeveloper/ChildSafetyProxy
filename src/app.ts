import express from 'express';
import session from 'express-session';
import { SESSION_SECRET } from './config/constants';
import { router } from './routes';
import { createTestUser } from './services/auth';
import { typedDb } from './database/db';

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  })
);

app.use(router);

(async () => {
  await typedDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  await createTestUser();
})();

export default app;