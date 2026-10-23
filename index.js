import express from 'express';
import { app } from './server/index.js';

// Vercel detects this root entry as an Express application. Vite build output
// is copied to /public for the CDN; this app handles the /api routes.
void express;
export default app;
