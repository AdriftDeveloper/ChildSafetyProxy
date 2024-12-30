import bcrypt from 'bcrypt';
import { typedDb } from '../database/db';
import { UserRow } from '../models/user';

export async function createTestUser() {
  const testUser = 'admin';
  const testPassword = 'password';
  const hashedPassword = await bcrypt.hash(testPassword, 10);

  try {
    await typedDb.run(
      'INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)',
      [testUser, hashedPassword]
    );
  } catch (err) {
    console.error('Error inserting test user:', err);
  }
}

export async function authenticateUser(username: string, password: string): Promise<boolean> {
  const user = await typedDb.get<Pick<UserRow, 'password'>>(
    'SELECT password FROM users WHERE username = ?',
    [username]
  );

  if (!user) return false;

  return await bcrypt.compare(password, user.password);
}

export async function createUser(username: string, password: string): Promise<void> {
  const hashedPassword = await bcrypt.hash(password, 10);
  await typedDb.run(
    'INSERT INTO users (username, password) VALUES (?, ?)',
    [username, hashedPassword]
  );
}