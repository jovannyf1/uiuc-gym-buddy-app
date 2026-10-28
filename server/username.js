import { InputError } from './core.js';

export function normalizeUsername(value) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw new InputError('Choose a username with 3–24 letters, numbers, or underscores.');
  }
  return username;
}

export function usernameConflict(error) {
  return error?.constraint === 'users_username_lower'
    || /users_username_lower|users\.username/i.test(String(error?.message || ''));
}

export function emailConflict(error) {
  return error?.constraint === 'users_email_key'
    || /users_email_key|users\.email/i.test(String(error?.message || ''));
}
